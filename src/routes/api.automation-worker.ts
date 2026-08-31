import { createFileRoute } from "@tanstack/react-router";

import type { ParsedMoniepointReport, ParsedTerminalRow } from "@/lib/moniepoint-report-core";

const cloudUrl = import.meta.env["VITE_SUPABASE_URL"]?.replace(/\/$/, "") ?? "";
const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
const browserUseBaseUrl = "https://api.browser-use.com/api/v2";
// Authenticated BRM dashboard anchor. The mirroring stage starts here explicitly instead of
// relying on natural-language "return to dashboard" navigation.
const monieCrmDashboardUrl = "https://v2.mab.console.teamapt.com";
const reportBucket = "moniepoint-reports";

interface WorkerRequest {
  runId?: string;
  action?: "execute" | "poll" | "cdp_probe";
}

// Bridge-token-gated, read-only lookup of the live Browser Use session for a run.
interface BrowserSessionContext {
  runId: string;
  browserSessionId: string | null;
  browserTaskId: string | null;
  browserUseApiKey: string;
}

// GET /browsers/{session_id}. cdpUrl is a full-control browser handle: it is consumed in
// memory only and never logged, persisted, or returned to a caller.
interface BrowserSessionDetail {
  id: string;
  status?: string;
  cdpUrl?: string | null;
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
  maxSteps: number;
  pollIntervalMinutes: number;
}

interface PollClaim {
  runId: string;
  action: "poll";
  triggerKind: string;
  browserUseApiKey: string;
  browserTaskId: string;
  uploadNonce: string;
  pollIntervalMinutes: number;
}

type AutomationClaim = ExecuteClaim | PollClaim;

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
  output: string | null;
  finishedAt: string | null;
  isSuccess: boolean | null;
  cost: string | null;
}

interface BrowserTaskDetail extends BrowserTaskStatus {
  sessionId: string;
  outputFiles: Array<{ id: string; fileName: string }>;
}

interface BrowserOutputFile {
  id: string;
  fileName: string;
  downloadUrl: string;
}

interface AutomationContext {
  runId: string;
  reportId: string | null;
  browserSessionId: string | null;
  allowedDomains: string[];
  workflowStage: string;
}

interface EnrichedBusiness {
  requestedName: string;
  matchedName: string | null;
  phoneNumber: string | null;
  accountNumber: string | null;
  status: "matched" | "not_found" | "ambiguous";
}

interface EnrichmentOutput {
  sourceUrl: string | null;
  capturedAt: string | null;
  dashboard: {
    metrics: Array<{ label: string; value: string; section: string | null }>;
  };
  businesses: EnrichedBusiness[];
}

export const Route = createFileRoute("/api/automation-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWorkerRequest(request),
    },
  },
});

async function handleWorkerRequest(request: Request) {
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

  if (
    !isUuid(body.runId) ||
    (body.action !== "execute" && body.action !== "poll" && body.action !== "cdp_probe")
  ) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  // Read-only CDP transport probe. It never claims, mutates or fails the run, so it is handled
  // before the claim/fail path below.
  if (body.action === "cdp_probe") {
    return probeCdpTransport(bridgeToken, body.runId);
  }


  try {
    const claim = await rpc<AutomationClaim>("automation_claim_run", {
      p_token: bridgeToken,
      p_run_id: body.runId,
      p_action: body.action,
    });

    if (claim.action === "execute") {
      await dispatchBrowserTask(claim, bridgeToken);
    } else {
      await pollBrowserTask(claim, bridgeToken);
    }

    return json({ ok: true, runId: body.runId, action: body.action }, 202);
  } catch (error) {
    const safe = sanitizeError(error);
    const authFailure = authStateFromFailure(safe);
    if (authFailure) {
      await updateAutomationAuthState(bridgeToken, authFailure.state, authFailure.message);
    }
    console.error("Automation worker failed", {
      runId: body.runId,
      action: body.action,
      code: safe.code,
      message: safe.message,
    });

    try {
      await rpc("automation_fail_run", {
        p_token: bridgeToken,
        p_run_id: body.runId,
        p_error_code: safe.code,
        p_error_message: safe.message,
        p_retryable: safe.retryable,
        p_diagnostics: safe.diagnostics ?? { stage: body.action },
      });
    } catch (markError) {
      console.error("Could not persist automation failure", {
        runId: body.runId,
        message: sanitizeError(markError).message,
      });
    }

    return json({ ok: false, error: safe.code, runId: body.runId }, safe.httpStatus);
  }
}

// Phase 5 transport primitive: resolve the run's live Browser Use session, fetch its CDP
// endpoint and prove a server-side WebSocket/CDP connection can read the active page state.
// Strictly read-only - no typing, clicking, navigation or task resumption.
async function probeCdpTransport(bridgeToken: string, runId: string) {
  try {
    const context = await rpc<BrowserSessionContext>("automation_browser_session_context", {
      p_token: bridgeToken,
      p_run_id: runId,
    });
    if (!isUuid(context.browserSessionId)) {
      return json({ ok: false, error: "browser_session_missing", runId }, 409);
    }

    const browser = await browserFetch<BrowserSessionDetail>(
      `/browsers/${encodeURIComponent(context.browserSessionId)}`,
      context.browserUseApiKey,
      { method: "GET" },
    );
    const cdpUrl = typeof browser.cdpUrl === "string" ? browser.cdpUrl.trim() : "";
    if (browser.id !== context.browserSessionId) {
      return json({ ok: false, error: "browser_session_mismatch", runId }, 409);
    }
    if (!cdpUrl) {
      return json({ ok: false, error: "cdp_url_unavailable", runId }, 409);
    }

    const { inspectCdpSession } = await import("@/lib/browser-cdp.server");
    const inspection = await inspectCdpSession(cdpUrl);

    return json(
      {
        ok: true,
        runId,
        action: "cdp_probe",
        sessionId: context.browserSessionId,
        taskId: context.browserTaskId,
        sessionStatus: browser.status ?? null,
        cdp: inspection,
      },
      200,
    );
  } catch (error) {
    const safe = sanitizeError(error);
    console.error("CDP transport probe failed", { runId, code: safe.code, message: safe.message });
    return json({ ok: false, error: safe.code, message: safe.message, runId }, safe.httpStatus);
  }
}



async function dispatchBrowserTask(claim: ExecuteClaim, bridgeToken: string) {
  validateLoginScope(claim.loginUrl, claim.allowedDomains);

  const credentialValue = `${claim.moniepointUsername}:${claim.moniepointPassword}`;
  const secrets = Object.fromEntries(
    claim.allowedDomains.map((domain) => [domain.replace(/^\*\./, ""), credentialValue]),
  );

  const sessionBody: Record<string, unknown> = {
    startUrl: claim.loginUrl,
    persistMemory: true,
    keepAlive: true,
    enableRecording: false,
  };
  if (claim.proxyCountryCode) sessionBody["proxyCountryCode"] = claim.proxyCountryCode;

  const session = await browserFetch<BrowserSessionCreated>("/sessions", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify(sessionBody),
  });
  if (!isUuid(session.id)) {
    throw workerError(
      "browser_invalid_session",
      "Browser Use returned an invalid session identifier.",
      true,
      502,
    );
  }

  const task = await browserFetch<BrowserTaskCreated>("/tasks", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify({
      task: reportTaskPrompt(claim.triggerKind),
      llm: "browser-use-2.0",
      startUrl: claim.loginUrl,
      sessionId: session.id,
      maxSteps: claim.maxSteps,
      metadata: { source: "monie-ops-hub", runId: claim.runId, trigger: claim.triggerKind },
      secrets,
      allowedDomains: claim.allowedDomains,
      highlightElements: false,
      flashMode: false,
      thinking: false,
      vision: true,
      judge: false,
    }),
  });

  if (!isUuid(task.id)) {
    await stopBrowserSession(session.id, claim.browserUseApiKey);
    throw workerError(
      "browser_invalid_task",
      "Browser Use returned an invalid task identifier.",
      true,
      502,
    );
  }

  await rpc("automation_mark_dispatched", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_browser_task_id: task.id,
    p_browser_session_id: session.id,
  });
}

async function pollBrowserTask(claim: PollClaim, bridgeToken: string) {
  const context = await rpc<AutomationContext>("automation_run_context", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
  });
  const status = await browserFetch<BrowserTaskStatus>(
    `/tasks/${encodeURIComponent(claim.browserTaskId)}/status`,
    claim.browserUseApiKey,
  );

  // Computed unconditionally, before any status is acted on, using the same
  // sanitized diagnostics collected below.
  const signal = await collectTaskSignal(claim, context, status);
  const hasVerificationEvidence = isVerificationPrompt(signal.diagnostics);
  const isActive = status.status === "created" || status.status === "started";
  const isTerminal =
    status.status === "finished" || status.status === "failed" || status.status === "stopped";

  // Pause-and-open-a-challenge only applies while the exact task can still be
  // paused. If the task already reached a terminal state by the time this poll
  // saw the evidence (a race with the agent itself finishing/stopping, or with
  // Browser Use ending the task for another reason), there is no live task left
  // to preserve -- pretending otherwise would open a "resumable" challenge for a
  // task that is already dead. That fallback is handled separately below as a
  // non-retryable reauthentication failure, without opening a challenge.
  if (hasVerificationEvidence && isActive) {
    await handleVerificationDetected(claim, context, bridgeToken, signal.diagnostics);
    return;
  }

  if (hasVerificationEvidence && isTerminal) {
    throw workerError(
      "browser_verification_terminal",
      "MonieCRM requested verification after the Browser Use task had already ended. Scheduled retrieval remains paused; sign in again to continue.",
      false,
      502,
      sanitizeVerificationDiagnostics(signal.diagnostics, {
        verificationDetected: true,
        browserTaskResumable: false,
      }),
    );
  }

  if (isActive) {
    await rpc("automation_mark_pending", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_diagnostics: {
        browserStatus: status.status,
        browserCost: status.cost,
        workflowStage: context.workflowStage,
      },
    });
    return;
  }

  if (status.status === "failed" || status.status === "stopped") {
    throw workerError(
      `browser_${status.status}`,
      failureMessage(`Browser retrieval ended with status ${status.status}.`, signal.diagnostics),
      true,
      502,
      signal.diagnostics,
    );
  }

  if (status.status !== "finished") {
    throw workerError(
      "browser_unknown_status",
      "Browser Use returned an unknown task status.",
      true,
      502,
      { browserStatus: String(status.status).slice(0, 40), workflowStage: context.workflowStage },
    );
  }

  // A "finished" task that still carries the verification marker/keywords in its
  // output or step trace is never a real success, even when Browser Use itself
  // reports isSuccess=true -- it means the task ended (or was reported as ended)
  // right as/after the verification screen appeared, too late to be paused. Route
  // it through the same unsuccessful-result handling as an ordinary failed finish
  // rather than opening a challenge for a task that is already over.
  if (status.isSuccess === false || hasVerificationEvidence) {
    throw workerError(
      "browser_unsuccessful",
      failureMessage("Browser retrieval finished without a successful result.", signal.diagnostics),
      true,
      502,
      signal.diagnostics,
    );
  }

  const detail =
    signal.detail ??
    (await browserFetch<BrowserTaskDetail>(
      `/tasks/${encodeURIComponent(claim.browserTaskId)}`,
      claim.browserUseApiKey,
    ));

  if (context.reportId || context.workflowStage === "enrichment") {
    await finishEnrichment(detail, claim, context, bridgeToken);
    return;
  }

  try {
    await stageOfficialReport(detail, claim, context, bridgeToken);
  } catch (error) {
    // A report-stage failure is terminal for this run. Stop the session so Browser Use
    // commits the persistent profile state instead of leaving a stale active session.
    if (context.browserSessionId) {
      await stopBrowserSession(context.browserSessionId, claim.browserUseApiKey);
    }
    throw error;
  }
}

async function stageOfficialReport(
  detail: BrowserTaskDetail,
  claim: PollClaim,
  context: AutomationContext,
  bridgeToken: string,
) {
  const pdf = detail.outputFiles.find((file) => file.fileName.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    throw workerError(
      "report_file_missing",
      "The Moniepoint report task finished without an official PDF output file.",
      true,
      502,
    );
  }

  await updateAutomationAuthState(
    bridgeToken,
    "authenticated",
    "MonieCRM session verified by a successful official PDF retrieval.",
  );

  const output = await browserFetch<BrowserOutputFile>(
    `/files/tasks/${encodeURIComponent(claim.browserTaskId)}/output-files/${encodeURIComponent(pdf.id)}`,
    claim.browserUseApiKey,
  );
  if (!output.downloadUrl.startsWith("https://")) {
    throw workerError(
      "invalid_download_url",
      "Browser Use returned an invalid report download URL.",
      false,
      502,
    );
  }

  const reportResponse = await fetch(output.downloadUrl, {
    redirect: "follow",
    headers: { Accept: "application/pdf" },
  });
  if (!reportResponse.ok) {
    throw workerError(
      "report_download_failed",
      `Report download failed with status ${reportResponse.status}.`,
      reportResponse.status >= 500 || reportResponse.status === 429,
      502,
    );
  }

  const contentLength = Number(reportResponse.headers.get("content-length") ?? "0");
  if (contentLength > 15 * 1024 * 1024) {
    throw workerError(
      "report_too_large",
      "The downloaded report exceeds the 15 MB limit.",
      false,
      422,
    );
  }

  const bytes = new Uint8Array(await reportResponse.arrayBuffer());
  const { parseMoniepointReportBytes, sha256Bytes } = await import("@/lib/moniepoint-report-node");
  const parsed = await parseMoniepointReportBytes(bytes);
  if (!parsed.canImport) {
    const firstError = parsed.checks.find((check) => check.level === "error")?.message;
    throw workerError(
      "report_validation_failed",
      firstError
        ? `Official report validation failed: ${firstError}`
        : "Official report validation failed.",
      false,
      422,
    );
  }

  const sha256 = sha256Bytes(bytes);
  const filename = safeFilename(
    output.fileName || pdf.fileName || `moniepoint-${parsed.reportDate}.pdf`,
  );
  const storagePath = `automation/${claim.runId}/${claim.uploadNonce}/${filename}`;
  await uploadAutomationPdf(storagePath, bytes);

  await rpc("automation_stage_report", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_upload_nonce: claim.uploadNonce,
    p_metadata: {
      reportDate: parsed.reportDate,
      sourceFilename: filename,
      sourceSha256: sha256,
      sourceStoragePath: storagePath,
      brmName: parsed.brmName,
      parserVersion: parsed.parserVersion,
      pageCount: parsed.pageCount,
      summary: parsed.summary,
    },
    p_rows: serializableRows(parsed.rows),
  });

  if (!context.browserSessionId || !isUuid(context.browserSessionId)) {
    throw workerError(
      "browser_session_missing",
      "The persistent Moniepoint browser session is unavailable for contact enrichment.",
      true,
      502,
    );
  }

  const priorityNames = priorityBusinessNames(parsed);
  const enrichmentTask = await browserFetch<BrowserTaskCreated>("/tasks", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify({
      task: enrichmentTaskPrompt(priorityNames),
      llm: "browser-use-2.0",
      // Anchor the mirroring stage on the authenticated BRM dashboard in the same session.
      startUrl: monieCrmDashboardUrl,
      sessionId: context.browserSessionId,
      allowedDomains: context.allowedDomains,
      maxSteps: Math.max(100, priorityNames.length * 10 + 60),
      structuredOutput: JSON.stringify(enrichmentSchema),
      metadata: {
        source: "monie-ops-hub",
        runId: claim.runId,
        stage: "team-management-enrichment",
      },
      highlightElements: false,
      flashMode: false,
      thinking: false,
      vision: true,
      judge: false,
    }),
  });

  if (!isUuid(enrichmentTask.id)) {
    throw workerError(
      "enrichment_invalid_task",
      "Browser Use returned an invalid enrichment task identifier.",
      true,
      502,
    );
  }

  await rpc("automation_mark_enrichment_dispatched", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_browser_task_id: enrichmentTask.id,
    p_browser_session_id: context.browserSessionId,
  });
}

async function finishEnrichment(
  detail: BrowserTaskDetail,
  claim: PollClaim,
  context: AutomationContext,
  bridgeToken: string,
) {
  // The profile's cookies and local storage are persisted only when the Browser Use session
  // ends cleanly. Always stop the session after a terminal enrichment attempt, including
  // when database finalisation fails, so the next profile-first run can reuse the session.
  try {
    const output = parseEnrichmentOutput(detail.output);
    await rpc("finalize_moniepoint_enrichment", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_contacts: output.businesses,
      p_dashboard: {
        capturedAt: output.capturedAt,
        metrics: output.dashboard.metrics,
      },
      p_source_url: output.sourceUrl,
    });
    await updateAutomationAuthState(
      bridgeToken,
      "authenticated",
      "MonieCRM session verified and Team Management enrichment completed.",
    );
  } finally {
    if (context.browserSessionId) {
      await stopBrowserSession(context.browserSessionId, claim.browserUseApiKey);
    }
  }
}

function reportTaskPrompt(triggerKind: string) {
  const timing =
    triggerKind === "morning_audit"
      ? "Use the latest completed report appropriate for closing the previous day's verification window."
      : "Use the latest official BRM performance report available at this moment.";
  return [
    "Sign in to the Moniepoint BRM portal using the domain-scoped credentials supplied securely to this task.",
    "Navigate to the BRM performance/report area and download the original official BRM daily performance report as a PDF output file.",
    timing,
    "Do not summarize, rewrite, calculate, or fabricate any metric. The task is complete only after the original official PDF has been downloaded as an output file.",
  ].join(" ");
}

function enrichmentTaskPrompt(priorityNames: string[]) {
  const names = JSON.stringify(priorityNames);
  return [
    "Continue in the already authenticated Moniepoint BRM session. Do not sign in again and never submit credentials in this task.",
    `The session already opens at ${monieCrmDashboardUrl}. Confirm the authenticated BRM dashboard is loaded on that exact host before capturing anything.`,
    `If you are redirected to a login page, see an authentication error, an MFA/approval challenge, or cannot confirm the session is authenticated, STOP and report the failure. Never fabricate dashboard values.`,
    "Capture every visible summary/KPI card exactly as displayed as label/value pairs. Do not calculate, rename, infer, or invent fields.",
    "Set sourceUrl to the exact MonieCRM URL of the dashboard page you captured.",
    `Then open Team Management > Business and search each of these exact BO/business names from the official report: ${names}.`,
    "For each requested name, return the confirmed business name, BO phone number and terminal/business account number shown in that area.",
    "Use status matched only when one clear business result corresponds to the requested name. Use ambiguous when multiple plausible results exist and not_found when there is no confirmed result. Leave unconfirmed phone/account fields null.",
    "Return only the requested structured output. Do not fabricate missing values.",
  ].join(" ");
}

const enrichmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceUrl: { type: ["string", "null"] },
    capturedAt: { type: ["string", "null"] },
    dashboard: {
      type: "object",
      additionalProperties: false,
      properties: {
        metrics: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              section: { type: ["string", "null"] },
            },
            required: ["label", "value", "section"],
          },
        },
      },
      required: ["metrics"],
    },
    businesses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          requestedName: { type: "string" },
          matchedName: { type: ["string", "null"] },
          phoneNumber: { type: ["string", "null"] },
          accountNumber: { type: ["string", "null"] },
          status: { type: "string", enum: ["matched", "not_found", "ambiguous"] },
        },
        required: ["requestedName", "matchedName", "phoneNumber", "accountNumber", "status"],
      },
    },
  },
  required: ["sourceUrl", "capturedAt", "dashboard", "businesses"],
} as const;

function priorityBusinessNames(parsed: ParsedMoniepointReport) {
  const candidates = parsed.rollingRows
    .filter(
      (row) =>
        (row.officialTargetValue ?? 0) > 0 && row.officialTargetMet === false && row.businessName,
    )
    .map((row) => {
      const actual = (row.paymentValue ?? 0) + (row.transferValue ?? 0);
      const target = row.officialTargetValue ?? 0;
      const gapRatio = target > 0 ? Math.max(0, Math.min(1, (target - actual) / target)) : 0;
      const score = gapRatio * 40 + Math.min(row.daysSinceLastTransaction ?? 0, 5) * 5;
      return { businessName: row.businessName.trim(), score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return [...new Set(candidates.map((candidate) => candidate.businessName).filter(Boolean))];
}

function parseEnrichmentOutput(value: string | null): EnrichmentOutput {
  if (!value) {
    throw workerError(
      "enrichment_output_missing",
      "The Team Management enrichment task returned no structured output.",
      true,
      502,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw workerError(
      "enrichment_output_invalid",
      "The Team Management enrichment output was not valid JSON.",
      true,
      502,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw workerError(
      "enrichment_output_invalid",
      "The Team Management enrichment output had an invalid shape.",
      true,
      502,
    );
  }
  const candidate = parsed as Partial<EnrichmentOutput>;
  if (
    !candidate.dashboard ||
    !Array.isArray(candidate.dashboard.metrics) ||
    !Array.isArray(candidate.businesses)
  ) {
    throw workerError(
      "enrichment_output_invalid",
      "The Team Management enrichment output was incomplete.",
      true,
      502,
    );
  }
  return {
    sourceUrl: typeof candidate.sourceUrl === "string" ? candidate.sourceUrl : null,
    capturedAt: typeof candidate.capturedAt === "string" ? candidate.capturedAt : null,
    dashboard: {
      metrics: candidate.dashboard.metrics.filter(
        (metric) => metric && typeof metric.label === "string" && typeof metric.value === "string",
      ),
    },
    businesses: candidate.businesses.filter(
      (business) =>
        business &&
        typeof business.requestedName === "string" &&
        ["matched", "not_found", "ambiguous"].includes(business.status),
    ),
  };
}

function validateLoginScope(loginUrl: string, allowedDomains: string[]) {
  let host: string;
  try {
    host = new URL(loginUrl).hostname.toLowerCase();
  } catch {
    throw workerError(
      "invalid_login_url",
      "The configured Moniepoint login URL is invalid.",
      false,
      422,
    );
  }
  const allowed = allowedDomains.some((entry) => {
    const domain = entry.toLowerCase().replace(/^\*\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  });
  if (!allowed) {
    throw workerError(
      "login_scope_mismatch",
      "The login host is outside the configured allowed domains.",
      false,
      422,
    );
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

async function uploadAutomationPdf(path: string, bytes: Uint8Array) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const response = await fetch(
    `${cloudUrl}/storage/v1/object/${encodeURIComponent(reportBucket)}/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/pdf",
        "x-upsert": "false",
      },
      body: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    },
  );
  if (!response.ok && response.status !== 409) {
    throw workerError(
      "storage_upload_failed",
      `Immutable report upload failed with status ${response.status}.`,
      response.status >= 500 || response.status === 429,
      502,
    );
  }
}

function serializableRows(rows: ParsedTerminalRow[]) {
  return rows.map((row) => ({
    section: row.section,
    rowNumber: row.rowNumber,
    terminalId: row.terminalId,
    terminalSerial: row.terminalSerial,
    businessName: row.businessName,
    paymentValue: row.paymentValue,
    paymentVolume: row.paymentVolume,
    transferValue: row.transferValue,
    transferVolume: row.transferVolume,
    officialTargetValue: row.officialTargetValue,
    officialTargetMet: row.officialTargetMet,
    daysSinceLastTransaction: row.daysSinceLastTransaction,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    lastTransactionDate: row.lastTransactionDate,
    businessRegistrationDate: row.businessRegistrationDate,
    terminalAssignmentDate: row.terminalAssignmentDate,
  }));
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report.pdf";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function workerError(
  code: string,
  message: string,
  retryable: boolean,
  httpStatus: number,
  diagnostics?: Record<string, unknown>,
) {
  return Object.assign(new Error(message), { code, retryable, httpStatus, diagnostics });
}

// Sanitized, non-secret text: collapse whitespace, drop anything that looks like a
// credential/token/key value, and hard-truncate. Never store DOM field values.
function safeText(value: unknown, limit: number) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\b[A-Za-z0-9._-]{40,}\b/g, "[redacted]")
    .replace(/(password|passwd|secret|token|api[_-]?key|bearer)\s*[:=]?\s*\S+/gi, "$1 [redacted]")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, limit) : null;
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    // Path only: query strings can carry tokens.
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return null;
  }
}

interface BrowserTaskStep {
  number?: number;
  url?: string;
  evaluationPreviousGoal?: string;
  nextGoal?: string;
}

// Fetches the Browser Use task detail (including its step trace) and turns it into
// the same sanitized diagnostics shape used for failure reporting. Called on EVERY
// poll -- active, failed, stopped, or finished -- because verification detection
// below must run before any of those outcomes is acted on, not only after a task
// has already terminated. Screenshots, action payloads (which contain typed field
// values) and secrets are deliberately never read. `detail` is returned alongside
// the diagnostics so a finished/successful poll can reuse it instead of re-fetching.
async function collectTaskSignal(
  claim: PollClaim,
  context: AutomationContext,
  status: BrowserTaskStatus,
): Promise<{
  diagnostics: Record<string, unknown>;
  detail: (BrowserTaskDetail & { steps?: BrowserTaskStep[] }) | null;
}> {
  const diagnostics: Record<string, unknown> = {
    stage: "poll",
    workflowStage: context.workflowStage,
    browserStatus: status.status,
    browserIsSuccess: status.isSuccess,
    browserFinishedAt: status.finishedAt,
    browserCost: status.cost,
    browserTaskId: claim.browserTaskId,
    browserSessionId: context.browserSessionId,
  };

  try {
    const detail = await browserFetch<BrowserTaskDetail & { steps?: BrowserTaskStep[] }>(
      `/tasks/${encodeURIComponent(claim.browserTaskId)}`,
      claim.browserUseApiKey,
    );
    const steps = Array.isArray(detail.steps) ? detail.steps : [];
    const lastStep = [...steps]
      .reverse()
      .find((step) => safeText(step.nextGoal ?? step.evaluationPreviousGoal, 1) !== null);

    diagnostics["browserFinalOutput"] = safeText(detail.output ?? status.output, 600);
    diagnostics["browserStepCount"] = steps.length;
    diagnostics["browserLastUrl"] = safeUrl(lastStep?.url ?? steps[steps.length - 1]?.url);
    diagnostics["browserLastStepNumber"] =
      typeof lastStep?.number === "number" ? lastStep.number : steps.length || null;
    diagnostics["browserLastStepSummary"] = safeText(
      lastStep?.evaluationPreviousGoal ?? lastStep?.nextGoal,
      400,
    );
    diagnostics["browserOutputFileCount"] = Array.isArray(detail.outputFiles)
      ? detail.outputFiles.length
      : 0;
    diagnostics["browserDiagnosticsCaptured"] = true;
    return { diagnostics, detail };
  } catch (error) {
    diagnostics["browserFinalOutput"] = safeText(status.output, 600);
    diagnostics["browserDiagnosticsCaptured"] = false;
    diagnostics["browserDiagnosticsError"] = safeText(sanitizeError(error).code, 100);
    return { diagnostics, detail: null };
  }
}

// Detect a MonieCRM OTP/verification-code prompt from the same sanitized
// diagnostics text collected above -- no new signal source, no screenshot/DOM
// inspection. The task prompt (see api.moniecrm-worker.ts) deliberately does NOT
// tell the agent to finish/end the task on this screen -- ending it would hand
// Browser Use a terminal task before this worker gets a chance to pause it.
// Instead the agent is told to stay on the screen and repeat this exact marker in
// its per-step goal/reasoning text, which is exactly what collectTaskSignal()
// reads while the task is still "created"/"started". The keyword list is a
// fallback for step text that hasn't reached that instruction yet. Deliberately
// distinct from authStateFromFailure()'s generic reauth keywords below so a
// verification prompt is never misclassified as an ordinary expired session. This
// is checked on every poll, before any status is acted on, so it can catch the
// prompt while the task is still active and also stop a finished/"successful"
// task from slipping past it (see pollBrowserTask).
const MONIECRM_VERIFICATION_MARKER = "MONIECRM_VERIFICATION_REQUIRED";

function isVerificationPrompt(diagnostics: Record<string, unknown>): boolean {
  const text = [diagnostics["browserFinalOutput"], diagnostics["browserLastStepSummary"]]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (text.includes(MONIECRM_VERIFICATION_MARKER.toLowerCase())) return true;
  return [
    "otp",
    "one-time password",
    "one time password",
    "one-time code",
    "one time code",
    "verification code",
    "authentication code",
    "authenticator app",
    "two-factor",
    "2fa",
    "mfa challenge",
    "enter the code",
  ].some((marker) => text.includes(marker));
}

// Never store the OTP value itself: strip any 4-8 digit run (the shape of every
// code MonieCRM could show) before this text reaches a challenge message, an
// error message, or diagnostics. The agent is instructed never to output the
// code, but this is a deliberate second layer, not a substitute for that rule.
function scrubPossibleCode(text: string): string {
  return text.replace(/\b\d{4,8}\b/g, "[redacted]");
}

function sanitizeVerificationDiagnostics(
  diagnostics: Record<string, unknown>,
  extra: Record<string, unknown>,
) {
  return {
    ...diagnostics,
    browserFinalOutput:
      typeof diagnostics["browserFinalOutput"] === "string"
        ? scrubPossibleCode(diagnostics["browserFinalOutput"])
        : diagnostics["browserFinalOutput"],
    browserLastStepSummary:
      typeof diagnostics["browserLastStepSummary"] === "string"
        ? scrubPossibleCode(diagnostics["browserLastStepSummary"])
        : diagnostics["browserLastStepSummary"],
    ...extra,
  };
}

// Preserves the exact Browser Use task instead of ending it: pauses the task via
// the documented v2 PATCH /tasks/{id} {action:"pause"} endpoint, and only once that
// succeeds opens (or reuses) the Phase 2 verification challenge for this exact
// run/session/task. automation_open_verification_challenge already moves
// automation_config.auth_state to verification_required and pauses scheduled
// retrieval. The run itself is kept pollable via automation_mark_pending, the same
// RPC already used for an ordinary active poll -- automation_fail_run is
// deliberately never called here, since failing the run would treat it as
// terminal, but the task, its Browser Use session, and this run all need to
// survive for a later phase to resume once a Director supplies the code.
// automation_open_verification_challenge is idempotent per run (returns the
// existing pending challenge on a repeat call), so a later poll that still sees
// the same evidence -- because the task remains paused -- safely reuses it
// instead of opening a second one.
async function handleVerificationDetected(
  claim: PollClaim,
  context: AutomationContext,
  bridgeToken: string,
  diagnostics: Record<string, unknown>,
) {
  const rawReason =
    (diagnostics["browserLastStepSummary"] as string | null) ??
    (diagnostics["browserFinalOutput"] as string | null) ??
    "MonieCRM is asking for a verification code.";
  const message = scrubPossibleCode(rawReason).slice(0, 500);
  const safeDiagnostics = sanitizeVerificationDiagnostics(diagnostics, {
    verificationDetected: true,
    browserTaskPaused: true,
  });

  await browserFetch(`/tasks/${encodeURIComponent(claim.browserTaskId)}`, claim.browserUseApiKey, {
    method: "PATCH",
    body: JSON.stringify({ action: "pause" }),
  });

  await rpc("automation_open_verification_challenge", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_browser_session_id: context.browserSessionId,
    p_browser_task_id: claim.browserTaskId,
    p_challenge_type: "otp",
    p_message: message,
  });

  await rpc("automation_mark_pending", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_diagnostics: safeDiagnostics,
  });
}

type AutomationAuthState = "checking" | "authenticated" | "reauth_required" | "blocked";

function authStateFromFailure(error: {
  code: string;
  message: string;
  diagnostics: Record<string, unknown> | null;
}) {
  const evidence =
    `${error.code} ${error.message} ${JSON.stringify(error.diagnostics ?? {})}`.toLowerCase();
  const blocked = [
    "temporarily suspended",
    "account suspended",
    "account locked",
    "temporarily locked",
    "account blocked",
  ].some((marker) => evidence.includes(marker));
  if (blocked) {
    return {
      state: "blocked" as const,
      message:
        "MonieCRM reported that the account is suspended, locked or blocked. Scheduled retrieval was paused to prevent further attempts.",
    };
  }

  if (error.code === "browser_verification_terminal") {
    return {
      state: "reauth_required" as const,
      message:
        "MonieCRM requested verification after the Browser Use task had already ended. Scheduled retrieval remains paused; sign in again to continue.",
    };
  }

  const reauth = [
    "auth-v2/login",
    "/login",
    "sign in",
    "log in",
    "login page",
    "authentication error",
    "session expired",
    "mfa",
    "verification challenge",
    "credentials",
  ].some((marker) => evidence.includes(marker));
  if (reauth) {
    return {
      state: "reauth_required" as const,
      message:
        "The saved MonieCRM session has expired or requires interactive verification. Scheduled retrieval was paused after the single safe attempt.",
    };
  }
  return null;
}

async function updateAutomationAuthState(
  bridgeToken: string,
  state: AutomationAuthState,
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

function failureMessage(prefix: string, diagnostics: Record<string, unknown>) {
  const reason = diagnostics["browserFinalOutput"] ?? diagnostics["browserLastStepSummary"];
  const url = diagnostics["browserLastUrl"];
  const parts = [prefix];
  if (typeof reason === "string" && reason) parts.push(`Reason: ${reason}`);
  if (typeof url === "string" && url) parts.push(`Last page: ${url}`);
  return parts.join(" ").slice(0, 800);
}

function sanitizeError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Partial<Error> & {
      code?: unknown;
      retryable?: unknown;
      httpStatus?: unknown;
      diagnostics?: unknown;
    };
    return {
      code:
        typeof candidate.code === "string"
          ? candidate.code.slice(0, 100)
          : "automation_worker_error",
      message:
        typeof candidate.message === "string"
          ? candidate.message.replace(/[\r\n]+/g, " ").slice(0, 800)
          : "Automation worker failed.",
      retryable: candidate.retryable === true,
      httpStatus:
        typeof candidate.httpStatus === "number" &&
        candidate.httpStatus >= 400 &&
        candidate.httpStatus <= 599
          ? candidate.httpStatus
          : 500,
      diagnostics:
        candidate.diagnostics && typeof candidate.diagnostics === "object"
          ? (candidate.diagnostics as Record<string, unknown>)
          : null,
    };
  }
  return {
    code: "automation_worker_error",
    message: "Automation worker failed.",
    retryable: false,
    httpStatus: 500,
    diagnostics: null,
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
