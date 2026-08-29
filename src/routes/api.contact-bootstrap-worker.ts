/* eslint-disable prettier/prettier */
import { createFileRoute } from "@tanstack/react-router";

const cloudUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const browserUseBaseUrl = "https://api.browser-use.com/api/v2";
const monieCrmHost = "v2.mab.console.teamapt.com";
const monieCrmDashboardUrl = `https://${monieCrmHost}`;

interface WorkerRequest {
  runId?: string;
  action?: "start" | "poll";
}

interface BatchItem {
  businessName: string;
  terminalId: string;
  terminalSerial: string;
}

interface StartClaim {
  runId: string;
  action: "start";
  reportId: string;
  reportDate: string;
  browserUseApiKey: string;
  loginUrl: string;
  allowedDomains: string[];
  proxyCountryCode: string | null;
  browserProfileId: string | null;
  batch: BatchItem[];
  batchSize: number;
  offset: number;
  totalItems: number;
}

interface PollClaim {
  runId: string;
  action: "poll";
  reportId: string;
  reportDate: string;
  browserUseApiKey: string;
  allowedDomains: string[];
  browserSessionId: string;
  browserTaskId: string;
  batch: BatchItem[];
  batchSize: number;
  offset: number;
  totalItems: number;
}

interface BrowserProfileCreated {
  id: string;
}

interface BrowserSessionCreated {
  id: string;
  status: "active" | "stopped";
}

interface BrowserTaskCreated {
  id: string;
  sessionId: string;
}

interface BrowserTaskStatus {
  id: string;
  status: "created" | "started" | "finished" | "failed" | "stopped";
  isSuccess: boolean | null;
  cost: string | null;
}

interface BrowserTaskDetail extends BrowserTaskStatus {
  output: string | null;
}

interface ContactResult {
  businessName: string;
  terminalId: string;
  terminalSerial: string;
  phoneNumber: string | null;
  posAccountNumber: string | null;
  status: "verified" | "review" | "not_found";
  sourcePath: string | null;
}

interface BatchOutput {
  authenticated: boolean;
  sourcePath: string | null;
  businesses: ContactResult[];
}

interface ApplyResult {
  done: boolean;
  nextOffset: number;
  totalItems: number;
  verifiedTotal: number;
  reviewTotal: number;
  notFoundTotal: number;
  nextBatch: BatchItem[];
}

export const Route = createFileRoute("/api/contact-bootstrap-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRequest(request),
    },
  },
});

async function handleRequest(request: Request) {
  const bridgeToken = request.headers.get("x-monie-automation-token")?.trim() ?? "";
  if (!bridgeToken) return json({ ok: false, error: "unauthorized" }, 401);
  if (!cloudUrl || !publishableKey) {
    return json({ ok: false, error: "cloud_not_configured" }, 503);
  }

  let body: WorkerRequest;
  try {
    body = (await request.json()) as WorkerRequest;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!isUuid(body.runId) || (body.action !== "start" && body.action !== "poll")) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  try {
    if (body.action === "start") {
      const claim = await rpc<StartClaim>("contact_bootstrap_claim", {
        p_token: bridgeToken,
        p_run_id: body.runId,
        p_action: "start",
      });
      await startRun(claim, bridgeToken);
    } else {
      const claim = await rpc<PollClaim>("contact_bootstrap_claim", {
        p_token: bridgeToken,
        p_run_id: body.runId,
        p_action: "poll",
      });
      await pollRun(claim, bridgeToken);
    }
    return json({ ok: true, runId: body.runId, action: body.action }, 202);
  } catch (error) {
    const safe = sanitizeError(error);
    console.error("Contact bootstrap worker failed", {
      runId: body.runId,
      action: body.action,
      code: safe.code,
      message: safe.message,
    });
    try {
      await rpc("contact_bootstrap_fail_run", {
        p_token: bridgeToken,
        p_run_id: body.runId,
        p_error_code: safe.code,
        p_error_message: safe.message,
      });
    } catch (markError) {
      console.error("Could not persist contact bootstrap failure", {
        runId: body.runId,
        message: sanitizeError(markError).message,
      });
    }
    return json({ ok: false, error: safe.code, runId: body.runId }, safe.httpStatus);
  }
}

async function startRun(claim: StartClaim, bridgeToken: string) {
  assertScope(claim.loginUrl, claim.allowedDomains);
  if (!claim.batch.length) {
    await rpc("contact_bootstrap_finalize", { p_token: bridgeToken, p_run_id: claim.runId });
    return;
  }

  let profileId = claim.browserProfileId;
  if (!profileId) {
    const profile = await browserFetch<BrowserProfileCreated>("/profiles", claim.browserUseApiKey, {
      method: "POST",
      body: JSON.stringify({ name: "monie-ops-primary-brm", userId: "monie-ops-director" }),
    });
    if (!isUuid(profile.id)) {
      throw workerError("browser_invalid_profile", "Browser Use returned an invalid profile identifier.", 502);
    }
    profileId = profile.id;
    await rpc("automation_set_browser_profile", {
      p_token: bridgeToken,
      p_profile_id: profileId,
    });
  }

  const session = await browserFetch<BrowserSessionCreated>("/sessions", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify({
      startUrl: monieCrmDashboardUrl,
      profileId,
      persistMemory: true,
      keepAlive: true,
      enableRecording: false,
      proxyCountryCode: claim.proxyCountryCode,
    }),
  });
  if (!isUuid(session.id)) {
    throw workerError("browser_invalid_session", "Browser Use returned an invalid session identifier.", 502);
  }

  try {
    const task = await createBatchTask(
      claim.runId,
      session.id,
      claim.browserUseApiKey,
      claim.allowedDomains,
      claim.batch,
      claim.offset,
    );
    await rpc("contact_bootstrap_mark_dispatched", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_browser_session_id: session.id,
      p_browser_task_id: task.id,
    });
  } catch (error) {
    await stopBrowserSession(session.id, claim.browserUseApiKey);
    throw error;
  }
}

async function pollRun(claim: PollClaim, bridgeToken: string) {
  const status = await browserFetch<BrowserTaskStatus>(
    `/tasks/${encodeURIComponent(claim.browserTaskId)}/status`,
    claim.browserUseApiKey,
  );

  if (status.status === "created" || status.status === "started") {
    await rpc("contact_bootstrap_mark_pending", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_diagnostics: { browserStatus: status.status, browserCost: status.cost, offset: claim.offset },
    });
    return;
  }
  if (status.status === "failed" || status.status === "stopped" || status.isSuccess === false) {
    await stopBrowserSession(claim.browserSessionId, claim.browserUseApiKey);
    throw workerError(
      `browser_${status.status}`,
      "MonieCRM contact extraction did not finish successfully. No unverified contact data was stored.",
      502,
    );
  }
  if (status.status !== "finished") {
    throw workerError("browser_unknown_status", "Browser Use returned an unknown task status.", 502);
  }

  const detail = await browserFetch<BrowserTaskDetail>(
    `/tasks/${encodeURIComponent(claim.browserTaskId)}`,
    claim.browserUseApiKey,
  );
  const output = parseBatchOutput(detail.output);
  if (!output.authenticated) {
    await stopBrowserSession(claim.browserSessionId, claim.browserUseApiKey);
    throw workerError(
      "moniecrm_session_not_authenticated",
      "The persistent MonieCRM profile is not authenticated. Contact bootstrap stopped without storing contact data.",
      409,
    );
  }

  const applied = await rpc<ApplyResult>("contact_bootstrap_apply_batch", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_results: output.businesses,
  });

  if (applied.done) {
    await rpc("contact_bootstrap_finalize", { p_token: bridgeToken, p_run_id: claim.runId });
    await stopBrowserSession(claim.browserSessionId, claim.browserUseApiKey);
    return;
  }

  const nextTask = await createBatchTask(
    claim.runId,
    claim.browserSessionId,
    claim.browserUseApiKey,
    claim.allowedDomains,
    applied.nextBatch,
    applied.nextOffset,
  );
  await rpc("contact_bootstrap_mark_dispatched", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_browser_session_id: claim.browserSessionId,
    p_browser_task_id: nextTask.id,
  });
}

async function createBatchTask(
  runId: string,
  sessionId: string,
  apiKey: string,
  allowedDomains: string[],
  batch: BatchItem[],
  offset: number,
) {
  const task = await browserFetch<BrowserTaskCreated>("/tasks", apiKey, {
    method: "POST",
    body: JSON.stringify({
      task: batchPrompt(batch),
      llm: "browser-use-2.0",
      startUrl: monieCrmDashboardUrl,
      sessionId,
      allowedDomains,
      maxSteps: Math.min(320, Math.max(120, batch.length * 10 + 80)),
      structuredOutput: JSON.stringify(batchSchema),
      metadata: { source: "monie-ops-hub", runId, stage: "contact-vault-bootstrap", offset },
      highlightElements: false,
      flashMode: false,
      thinking: false,
      vision: true,
      judge: false,
    }),
  });
  if (!isUuid(task.id)) {
    throw workerError("browser_invalid_task", "Browser Use returned an invalid task identifier.", 502);
  }
  return task;
}

function batchPrompt(batch: BatchItem[]) {
  return [
    "This is a read-only MonieCRM contact verification task in an existing persistent browser profile.",
    `Stay only on https://${monieCrmHost}. Do not search the public web, do not change any Moniepoint record, and never use account-recovery links.`,
    "First confirm the authenticated BRM dashboard is visible. If the page is a login screen, an MFA/approval challenge, or otherwise not authenticated, set authenticated=false and return immediately without contact values.",
    "If authenticated, open Team Management > Business and verify each requested record below.",
    `Requested records: ${JSON.stringify(batch)}.`,
    "For every requested record, search the business and confirm BOTH the exact Terminal ID and exact terminal serial before reading contact details.",
    "Only after that exact identity match, return the BO phone number and the POS/business account number shown by MonieCRM, with status verified.",
    "If multiple records could match, terminal identity differs, or either contact field cannot be confirmed, use status review and leave unconfirmed values null. If the business cannot be found, use not_found.",
    "Return one result for every requested terminal. Copy identifiers exactly. Never infer, transform, calculate, or fabricate phone/account values.",
    "sourcePath should be the MonieCRM path where the verified business details were read, without query tokens or secret values.",
  ].join(" ");
}

const batchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    authenticated: { type: "boolean" },
    sourcePath: { type: ["string", "null"] },
    businesses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          businessName: { type: "string" },
          terminalId: { type: "string" },
          terminalSerial: { type: "string" },
          phoneNumber: { type: ["string", "null"] },
          posAccountNumber: { type: ["string", "null"] },
          status: { type: "string", enum: ["verified", "review", "not_found"] },
          sourcePath: { type: ["string", "null"] },
        },
        required: [
          "businessName",
          "terminalId",
          "terminalSerial",
          "phoneNumber",
          "posAccountNumber",
          "status",
          "sourcePath",
        ],
      },
    },
  },
  required: ["authenticated", "sourcePath", "businesses"],
} as const;

function parseBatchOutput(value: string | null): BatchOutput {
  if (!value) throw workerError("contact_output_missing", "Contact extraction returned no structured output.", 502);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw workerError("contact_output_invalid", "Contact extraction returned invalid JSON.", 502);
  }
  if (!parsed || typeof parsed !== "object") {
    throw workerError("contact_output_invalid", "Contact extraction returned an invalid output shape.", 502);
  }
  const candidate = parsed as Partial<BatchOutput>;
  if (typeof candidate.authenticated !== "boolean" || !Array.isArray(candidate.businesses)) {
    throw workerError("contact_output_invalid", "Contact extraction output was incomplete.", 502);
  }
  return {
    authenticated: candidate.authenticated,
    sourcePath: typeof candidate.sourcePath === "string" ? candidate.sourcePath : null,
    businesses: candidate.businesses.filter(isContactResult),
  };
}

function isContactResult(value: unknown): value is ContactResult {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ContactResult>;
  return (
    typeof item.businessName === "string" &&
    typeof item.terminalId === "string" &&
    typeof item.terminalSerial === "string" &&
    ["verified", "review", "not_found"].includes(String(item.status))
  );
}

function assertScope(loginUrl: string, allowedDomains: string[]) {
  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    throw workerError("invalid_login_url", "The configured MonieCRM login URL is invalid.", 422);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== monieCrmHost) {
    throw workerError("moniecrm_login_scope_mismatch", "The configured host is not the official MonieCRM host.", 422);
  }
  if (!allowedDomains.some((entry) => entry.toLowerCase().replace(/^\*\./, "") === monieCrmHost)) {
    throw workerError("moniecrm_allowed_domain_mismatch", "MonieCRM is outside the configured allowed domains.", 422);
  }
}

async function stopBrowserSession(sessionId: string, apiKey: string) {
  if (!isUuid(sessionId)) return;
  try {
    await browserFetch(`/sessions/${encodeURIComponent(sessionId)}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify({ action: "stop" }),
    });
  } catch (error) {
    console.warn("Could not stop contact-bootstrap Browser Use session", {
      sessionId,
      message: sanitizeError(error).message,
    });
  }
}

async function browserFetch<T>(path: string, apiKey: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("X-Browser-Use-API-Key", apiKey);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${browserUseBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    throw workerError(
      `browser_http_${response.status}`,
      `Browser Use request failed with status ${response.status}.`,
      response.status === 429 || response.status >= 500 ? 503 : 502,
    );
  }
  return (await response.json()) as T;
}

async function rpc<T = unknown>(name: string, payload: unknown) {
  const response = await fetch(`${cloudUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    const authFailure = response.status === 401 || response.status === 403 || text.includes("Invalid automation token");
    throw workerError(
      authFailure ? "bridge_rejected" : `cloud_rpc_${response.status}`,
      authFailure ? "The automation bridge rejected this request." : `Database RPC failed with status ${response.status}.`,
      authFailure ? 401 : 502,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function workerError(code: string, message: string, httpStatus: number) {
  return Object.assign(new Error(message), { code, httpStatus });
}

function sanitizeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Partial<Error> & { code?: unknown; httpStatus?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code.slice(0, 100) : "contact_bootstrap_worker_error",
      message: typeof candidate.message === "string"
        ? candidate.message.replace(/[\r\n]+/g, " ").slice(0, 800)
        : "Contact bootstrap worker failed.",
      httpStatus: typeof candidate.httpStatus === "number" && candidate.httpStatus >= 400 && candidate.httpStatus <= 599
        ? candidate.httpStatus
        : 500,
    };
  }
  return { code: "contact_bootstrap_worker_error", message: "Contact bootstrap worker failed.", httpStatus: 500 };
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
