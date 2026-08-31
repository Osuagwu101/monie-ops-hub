// Server-only minimal CDP client.
//
// Runtime: the deployed worker runs on the Cloudflare Workers (workerd) target produced by
// nitro. Outbound WebSockets there are opened with a fetch() upgrade handshake
// (`response.webSocket`), which is the only universally supported form on workerd. Node-based
// dev runtimes expose the standard `WebSocket` constructor, so that is kept as a fallback.
//
// No third-party dependency (no Playwright / Puppeteer / chrome-remote-interface) is required.
//
// SECURITY: a cdpUrl is a full-control browser handle. It is accepted as an argument, used
// only to open the socket, and NEVER logged, returned, persisted, or embedded in diagnostics.

export interface CdpPageTarget {
  targetId: string;
  url: string;
  title: string;
  attached: boolean;
}

export interface CdpInspection {
  connected: boolean;
  transport: "fetch_upgrade" | "websocket_constructor";
  browserVersion: string | null;
  targetCount: number;
  pageCount: number;
  activePage: CdpPageTarget | null;
}

interface CdpMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
  method?: string;
}

interface RawTargetInfo {
  targetId?: unknown;
  type?: unknown;
  url?: unknown;
  title?: unknown;
  attached?: unknown;
}

const CONNECT_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 15_000;

function cdpError(code: string, message: string) {
  return Object.assign(new Error(message), { code, retryable: false, httpStatus: 502 });
}

/** Opens the socket without ever surfacing the cdpUrl in an error message. */
async function openSocket(cdpUrl: string): Promise<{
  socket: WebSocket;
  transport: CdpInspection["transport"];
}> {
  const httpUrl = cdpUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");

  try {
    const response = await fetch(httpUrl, { headers: { Upgrade: "websocket" } });
    const socket = (response as unknown as { webSocket?: WebSocket | null }).webSocket;
    if (response.status === 101 && socket) {
      (socket as unknown as { accept: () => void }).accept();
      return { socket, transport: "fetch_upgrade" };
    }
  } catch {
    // Fall through to the standard constructor.
  }

  if (typeof WebSocket === "undefined") {
    throw cdpError("cdp_no_websocket", "No server-side WebSocket transport is available.");
  }

  const socket = new WebSocket(cdpUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(cdpError("cdp_connect_timeout", "CDP WebSocket connection timed out.")),
      CONNECT_TIMEOUT_MS,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(cdpError("cdp_connect_failed", "CDP WebSocket connection failed."));
    });
  });
  return { socket, transport: "websocket_constructor" };
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void }
  >();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event: MessageEvent) => this.onMessage(event));
    socket.addEventListener("close", () => this.rejectAll("cdp_socket_closed"));
    socket.addEventListener("error", () => this.rejectAll("cdp_socket_error"));
  }

  private onMessage(event: MessageEvent) {
    const raw = typeof event.data === "string" ? event.data : "";
    if (!raw) return;
    let message: CdpMessage;
    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return; // CDP event, not a command reply.
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.error) {
      entry.reject(
        cdpError("cdp_command_error", `CDP command failed: ${message.error.message ?? "unknown"}`),
      );
      return;
    }
    entry.resolve(message.result ?? {});
  }

  private rejectAll(code: string) {
    for (const [, entry] of this.pending) {
      entry.reject(cdpError(code, "The CDP connection closed before the command completed."));
    }
    this.pending.clear();
  }

  send(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(cdpError("cdp_command_timeout", `CDP command ${method} timed out.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.socket.close(1000, "done");
    } catch {
      // The socket may already be closed; nothing else to do.
    }
  }
}

function readPageTargets(result: Record<string, unknown>) {
  const infos = Array.isArray(result["targetInfos"])
    ? (result["targetInfos"] as RawTargetInfo[])
    : [];
  const pages = infos
    .filter((info) => info.type === "page")
    .map<CdpPageTarget>((info) => ({
      targetId: typeof info.targetId === "string" ? info.targetId : "",
      url: typeof info.url === "string" ? info.url : "",
      title: typeof info.title === "string" ? info.title : "",
      attached: info.attached === true,
    }));
  return { total: infos.length, pages };
}

/** Only origin + path are ever reported; query/hash can carry tokens. */
export function safePageUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Connects to an existing Browser Use CDP endpoint, lists targets, reads the active page's
 * URL/title, and disconnects. Strictly read-only: no input, navigation, or task mutation.
 */
export async function inspectCdpSession(cdpUrl: string): Promise<CdpInspection> {
  if (!/^wss?:\/\//i.test(cdpUrl)) {
    throw cdpError("cdp_invalid_url", "The browser session did not expose a usable CDP endpoint.");
  }

  const { socket, transport } = await openSocket(cdpUrl);
  const connection = new CdpConnection(socket);

  try {
    let browserVersion: string | null = null;
    try {
      const version = await connection.send("Browser.getVersion");
      browserVersion = typeof version["product"] === "string" ? version["product"] : null;
    } catch {
      browserVersion = null; // Non-fatal: target discovery is the real proof.
    }

    const { total, pages } = readPageTargets(await connection.send("Target.getTargets"));
    const activePage = pages.find((page) => page.attached) ?? pages[0] ?? null;

    return {
      connected: true,
      transport,
      browserVersion,
      targetCount: total,
      pageCount: pages.length,
      activePage: activePage
        ? { ...activePage, url: safePageUrl(activePage.url), title: activePage.title.slice(0, 200) }
        : null,
    };
  } finally {
    connection.close();
  }
}
