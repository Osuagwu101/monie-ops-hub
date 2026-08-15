import { createFileRoute } from "@tanstack/react-router";

import type { ParsedTerminalRow } from "@/lib/moniepoint-report-core";

const cloudUrl = import.meta.env["VITE_SUPABASE_URL"]?.replace(/\/$/, "") ?? "";
const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
const browserUseBaseUrl = "https://api.browser-use.com/api/v2";
const reportBucket = "moniepoint-reports";

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

  if (!isUuid(body.runId) || (body.action !== "execute" && body.action !== "poll")) {
    return json({ ok: false, error: "invalid_request" }, 400);
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
        p_diagnostics: { stage: body.action },
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

async function dispatchBrowserTask(claim: ExecuteClaim, bridgeToken: string) {
  validateLoginScope(claim.loginUrl, claim.allowedDomains);

  const credentialValue = `${claim.moniepointUsername}:${claim.moniepointPassword}`;
  const secrets = Object.fromEntries(
    claim.allowedDomains.map((domain) => [domain.replace(/^\*\./, ""), credentialValue]),
  );

  const prompt = taskPrompt(claim.triggerKind);
  const sessionSettings: Record<string, unknown> = { enableRecording: false };
  if (claim.proxyCountryCode) sessionSettings["proxyCountryCode"] = claim.proxyCountryCode;

  const task = await browserFetch<BrowserTaskCreated>("/tasks", claim.browserUseApiKey, {
    method: "POST",
    body: JSON.stringify({
      task: prompt,
      llm: "browser-use-2.0",
      startUrl: claim.loginUrl,
      maxSteps: claim.maxSteps,
      metadata: { source: "monie-ops-hub", runId: claim.runId, trigger: claim.triggerKind },
      secrets,
      allowedDomains: claim.allowedDomains,
      sessionSettings,
      highlightElements: false,
      flashMode: false,
      thinking: false,
      vision: false,
      judge: false,
    }),
  });

  if (!isUuid(task.id))
    throw workerError(
      "browser_invalid_task",
      "Browser Use returned an invalid task identifier.",
      true,
      502,
    );

  await rpc("automation_mark_dispatched", {
    p_token: bridgeToken,
    p_run_id: claim.runId,
    p_browser_task_id: task.id,
    p_browser_session_id: task.sessionId ?? null,
  });
}

async function pollBrowserTask(claim: PollClaim, bridgeToken: string) {
  const status = await browserFetch<BrowserTaskStatus>(
    `/tasks/${encodeURIComponent(claim.browserTaskId)}/status`,
    claim.browserUseApiKey,
  );

  if (status.status === "created" || status.status === "started") {
    await rpc("automation_mark_pending", {
      p_token: bridgeToken,
      p_run_id: claim.runId,
      p_diagnostics: { browserStatus: status.status, browserCost: status.cost },
    });
    return;
  }

  if (status.status === "failed" || status.status === "stopped") {
    throw workerError(
      `browser_${status.status}`,
      `Browser retrieval ended with status ${status.status}.`,
      true,
      502,
    );
  }

  if (status.status !== "finished") {
    throw workerError(
      "browser_unknown_status",
      "Browser Use returned an unknown task status.",
      true,
      502,
    );
  }

  if (status.isSuccess === false) {
    throw workerError(
      "browser_unsuccessful",
      "Browser retrieval finished without a successful result.",
      true,
      502,
    );
  }

  const detail = await browserFetch<BrowserTaskDetail>(
    `/tasks/${encodeURIComponent(claim.browserTaskId)}`,
    claim.browserUseApiKey,
  );
  const pdf = detail.outputFiles.find((file) => file.fileName.toLowerCase().endsWith(".pdf"));
  if (!pdf) {
    throw workerError(
      "report_file_missing",
      "The browser task finished without a PDF output file.",
      true,
      502,
    );
  }

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

  await rpc("automation_complete_run", {
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
}

function taskPrompt(triggerKind: string) {
  const timing =
    triggerKind === "morning_audit"
      ? "Use the latest completed report appropriate for closing the previous day's verification window."
      : "Use the latest official BRM performance report available at this moment.";
  return [
    "Sign in to the Moniepoint BRM portal using the domain-scoped credentials supplied securely to this task.",
    "Navigate to the BRM performance/report area and download the official BRM daily performance report as a PDF output file.",
    timing,
    "Do not summarize, rewrite, calculate, or fabricate any metric. The task is complete only after the original official PDF has been downloaded as an output file.",
  ].join(" ");
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
    };
  }
  return {
    code: "automation_worker_error",
    message: "Automation worker failed.",
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
