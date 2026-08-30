import { createFileRoute } from "@tanstack/react-router";

const cloudUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const browserUseBaseUrl = "https://api.browser-use.com/api/v2";
const monieCrmHost = "v2.mab.console.teamapt.com";
const monieCrmDashboardUrl = `https://${monieCrmHost}/main-app/moniecrm/dashboard`;
const monieCrmReportUrl = `https://${monieCrmHost}/main-app/moniecrm/reports/overview`;
const monieCrmReportDownloadPath = "/report/api/v1/reports/daily/download";

interface WorkerRequest {
  runId?: string;
  action?: "execute" | "poll";
}

interface ExecuteClaim {
  runId: string;
  action: "execute";
  triggerKind: string;
  browserUseApiKey: string;
  moniepointUsername: string;
  moniepointPassword: string;
  loginUrl: string;
  allowedDomains: string[];
  proxyCountryCode: string | null;
  browserProfileId: string | null;
  maxSteps: number;
  pollIntervalMinutes: number;
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

export const Route = createFileRoute("/api/moniecrm-worker")({
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
  if (!isUuid(body.runId) || (body.action !== "execute" && body.action !== "poll")) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  // The established worker owns polling, immutable PDF import and Team Management enrichment.
  // This route owns only the safer profile-first login/dispatch stage.
  if (body.action === "poll") {
    return proxyLegacyPoll(request, bridgeToken, body.runId);
  }

  try {
    const claim = await rpc<ExecuteClaim>("automation_claim_run", {
      p_token: bridgeToken,
      p_run_id: body.runId,
      p_action: "execute",
    });
    await dispatchMonieCrmTask(claim, bridgeToken);
    return json({ ok: true, runId: body.runId, action: "execute" }, 202);
  } catch (error) {
    const safe = sanitizeError(error);
    console.error("MonieCRM dispatch failed", {
      runId: body.runId,
      code: safe.code,
      message: safe.message,
    });
    try {
      await rpc("automation_fail_run", {
        p_token: bridgeToken,
        p_run_id: body.runId,
        p_error_code: safe.code,
        p_error_message: safe.message,
        p_retryable: false,
        p_diagnostics: { stage: "execute", authSafety: "profile_first_single_attempt" },
      });
    } catch (markError) {
      console.error("Could not persist MonieCRM dispatch failure", {
        runId: body.runId,
        message: sanitizeError(markError).message,
      });
    }
    return json({ ok: false, error: safe.code, runId: body.runId }, safe.httpStatus);
  }
}

async function dispatchMonieCrmTask(claim: ExecuteClaim, bridgeToken: string) {
  assertMonieCrmScope(claim.loginUrl, claim.allowedDomains);

  let profileId = claim.browserProfileId;
  if (!profileId) {
    const profile = await browserFetch<BrowserProfileCreated>("/profiles", claim.browserUseApiKey, {
      method: "POST",
      body: JSON.stringify({
        name: "monie-ops-primary-brm",
        userId: "monie-ops-director",
      }),
    });
    if (!isUuid(profile.id)) {
      throw workerError(
        "browser_invalid_profile",
        "Browser Use returned an invalid persistent profile identifier.",
        false,
        502,
      );
    }
    profileId = profile.id;
    await rpc("automation_set_browser_profile", {
      p_token: bridgeToken,
      p_profile_id: profileId,
    });
  }

  // Start from the authenticated destination, not /login. If the stored profile is still valid,
  // MonieCRM opens directly. Only an expired/missing session should redirect the browser to login.
  const session = await browserFetch<BrowserSessionCreated>("/sessions", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify({
      startUrl: monieCrmDashboardUrl,
      profileId,
      persistMemory: true,
      keepAlive: true,
      enableRecording: false,
      proxyCountryCode: claim.proxyCountryCode ?? "ng",
    }),
  });
  if (!isUuid(session.id)) {
    throw workerError(
      "browser_invalid_session",
      "Browser Use returned an invalid session identifier.",
      false,
      502,
    );
  }

  // Browser Use secrets are named values. Keeping username and password separate lets the agent
  // inject each value into the correct field without exposing either value in the prompt/logs.
  const secrets = {
    MONIECRM_USERNAME: claim.moniepointUsername,
    MONIECRM_PASSWORD: claim.moniepointPassword,
  };

  try {
    const task = await browserFetch<BrowserTaskCreated>("/tasks", claim.browserUseApiKey, {
      method: "POST",
      body: JSON.stringify({
        task: reportTaskPrompt(claim.triggerKind),
        llm: "browser-use-2.0",
        startUrl: monieCrmDashboardUrl,
        sessionId: session.id,
        maxSteps: claim.maxSteps,
        metadata: {
          source: "monie-ops-hub",
          runId: claim.runId,
          trigger: claim.triggerKind,
          authMode: "moniecrm-profile-first-single-attempt",
          reportPage: monieCrmReportUrl,
          reportDownloadPath: monieCrmReportDownloadPath,
        },
        secrets,
        allowedDomains: claim.allowedDomains,
        systemPromptExtension: authSafetyPrompt,
        highlightElements: false,
        flashMode: false,
        thinking: false,
        vision: true,
        judge: false,
      }),
    });

    if (!isUuid(task.id)) {
      throw workerError(
        "browser_invalid_task",
        "Browser Use returned an invalid task identifier.",
        false,
        502,
      );
    }

    await rpc("automation_mark_dispatched", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_browser_task_id: task.id,
      p_browser_session_id: session.id,
    });
    await updateAutomationAuthState(
      bridgeToken,
      "checking",
      "Checking the saved MonieCRM browser session.",
    );
  } catch (error) {
    // Browser Use persists profile cookies/local storage when the session is stopped.
    await stopBrowserSession(session.id, claim.browserUseApiKey);
    throw error;
  }
}

const authSafetyPrompt = [
  "MONIECRM AUTHENTICATION SAFETY RULES ARE MANDATORY.",
  `Use only https://${monieCrmHost} and its allowed subpaths. Never search the web and never navigate to atm.moniepoint.com, moniepoint.com, or another login realm.`,
  `Begin at ${monieCrmDashboardUrl}. First determine whether the saved browser profile is already authenticated.`,
  "If the BRM dashboard is already visible, DO NOT navigate to login and DO NOT enter credentials. Continue directly to the report workflow.",
  "Only if MonieCRM itself redirects this session to its login page may you authenticate.",
  "If a location-access page appears, continue to the login page without leaving the configured host.",
  "Choose the Username login tab. Enter the secret named MONIECRM_USERNAME, then submit with Enter or the button whose exact text is Next.",
  "Wait for the password field. Enter the secret named MONIECRM_PASSWORD, then submit with Enter or the button whose exact text is Login.",
  "NEVER click Forgot Username, Forgot password, Recover username, account recovery, or any recovery link.",
  "Submit the username/password pair at most ONCE in this task. If Login Failed, invalid credentials, temporarily suspended, an MFA challenge that cannot be completed, or any authentication error appears, STOP immediately. Do not retry credentials.",
  `After login, confirm ${monieCrmDashboardUrl} is authenticated before doing anything else.`,
  "If the dashboard redirects back to login, shows an authentication error, or cannot be confirmed as authenticated, STOP and report the failure. Do not retry credentials and do not invent any data.",
  "After the dashboard is confirmed, continue with the requested report workflow in the same session.",
].join(" ");

function reportTaskPrompt(triggerKind: string) {
  const timing =
    triggerKind === "morning_audit"
      ? "Use the latest completed report appropriate for closing the previous day's verification window."
      : "Use the latest official BRM performance report available at this moment.";
  return [
    `Begin at ${monieCrmDashboardUrl} using the persistent browser profile.`,
    "If the profile is already authenticated, do not sign in again. If MonieCRM redirects to login, authenticate exactly once with the named MONIECRM_USERNAME and MONIECRM_PASSWORD secrets and the mandatory safety rules.",
    `Confirm the authenticated BRM dashboard is loaded on ${monieCrmHost}.`,
    `Open the exact MonieCRM report page ${monieCrmReportUrl} in this same authenticated session.`,
    "Confirm the page heading is Overview and the page shows the Download Report control.",
    "Click the button whose exact text is Download Report exactly once. Do not open an API host directly and do not construct a download URL yourself.",
    `The page uses the official request path ${monieCrmReportDownloadPath} and supplies report_date in DD-MM-YYYY format. Let the MonieCRM page choose the report date and complete the browser download.`,
    timing,
    "If Download Report is disabled or the page says new reports are unavailable until 8:30am, stop and report report_not_available_yet without clicking another control.",
    "Do not summarize, rewrite, calculate, or fabricate any metric. The task is complete only after the original official PDF has been downloaded as an output file.",
  ].join(" ");
}

async function proxyLegacyPoll(request: Request, bridgeToken: string, runId: string) {
  const url = new URL("/api/automation-worker", request.url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-monie-automation-token": bridgeToken,
    },
    body: JSON.stringify({ runId, action: "poll" }),
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function assertMonieCrmScope(loginUrl: string, allowedDomains: string[]) {
  let url: URL;
  try {
    url = new URL(loginUrl);
  } catch {
    throw workerError(
      "invalid_login_url",
      "The configured MonieCRM login URL is invalid.",
      false,
      422,
    );
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== monieCrmHost) {
    throw workerError(
      "moniecrm_login_scope_mismatch",
      "Automation must start from the official MonieCRM login host.",
      false,
      422,
    );
  }
  const allowed = allowedDomains.some((entry) => {
    const domain = entry.toLowerCase().replace(/^\*\./, "");
    return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
  });
  if (!allowed) {
    throw workerError(
      "moniecrm_allowed_domain_mismatch",
      "The official MonieCRM host is outside the configured allowed domains.",
      false,
      422,
    );
  }
}

async function updateAutomationAuthState(
  bridgeToken: string,
  state: "checking" | "authenticated" | "reauth_required" | "blocked",
  message: string,
) {
  try {
    await rpc("automation_set_auth_state", {
      p_token: bridgeToken,
      p_state: state,
      p_message: message,
    });
  } catch (error) {
    console.warn("Could not update MonieCRM authentication state", {
      state,
      message: sanitizeError(error).message,
    });
  }
}

async function stopBrowserSession(sessionId: string, apiKey: string) {
  try {
    await browserFetch(`/sessions/${encodeURIComponent(sessionId)}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify({ action: "stop" }),
    });
  } catch (error) {
    console.warn("Could not stop Browser Use session", {
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
    const retryable = response.status === 429 || response.status >= 500;
    throw workerError(
      `browser_http_${response.status}`,
      `Browser Use request failed with status ${response.status}.`,
      retryable,
      retryable ? 503 : 502,
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
    const authFailure =
      response.status === 401 ||
      response.status === 403 ||
      text.includes("Invalid automation token");
    throw workerError(
      authFailure ? "bridge_rejected" : `cloud_rpc_${response.status}`,
      authFailure
        ? "The automation bridge rejected this request."
        : `Automation database RPC failed with status ${response.status}.`,
      !authFailure && response.status >= 500,
      authFailure ? 401 : 502,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function workerError(code: string, message: string, retryable: boolean, httpStatus: number) {
  return Object.assign(new Error(message), { code, retryable, httpStatus });
}

function sanitizeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Partial<Error> & {
      code?: unknown;
      retryable?: unknown;
      httpStatus?: unknown;
    };
    return {
      code:
        typeof candidate.code === "string" ? candidate.code.slice(0, 100) : "moniecrm_worker_error",
      message:
        typeof candidate.message === "string"
          ? candidate.message.replace(/[\r\n]+/g, " ").slice(0, 800)
          : "MonieCRM worker failed.",
      retryable: candidate.retryable === true,
      httpStatus:
        typeof candidate.httpStatus === "number" &&
        candidate.httpStatus >= 400 &&
        candidate.httpStatus <= 599
          ? candidate.httpStatus
          : 500,
    };
  }
  return {
    code: "moniecrm_worker_error",
    message: "MonieCRM worker failed.",
    retryable: false,
    httpStatus: 500,
  };
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
