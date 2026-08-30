import { callRpc, restSelect } from "@/lib/cloud-api";

export interface AutomationConfigRecord {
  id: boolean;
  enabled: boolean;
  worker_url: string;
  moniepoint_login_url: string | null;
  allowed_domains: string[];
  proxy_country_code: string | null;
  browser_profile_id: string | null;
  auth_state:
    | "unknown"
    | "checking"
    | "authenticated"
    | "reauth_required"
    | "blocked"
    | "verification_required";
  auth_state_checked_at: string | null;
  auth_state_message: string | null;
  max_steps: number;
  max_attempts: number;
  retry_backoff_minutes: number;
  poll_interval_minutes: number;
  morning_audit_time: string;
  morning_refresh_time: string;
  evening_refresh_time: string;
  updated_at: string;
}

export interface AutomationRunRecord {
  id: string;
  trigger_kind: "morning_audit" | "morning_refresh" | "evening_refresh" | "manual";
  status:
    | "queued"
    | "dispatching"
    | "browser_running"
    | "polling"
    | "retry_wait"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "skipped";
  scheduled_for: string;
  attempt_count: number;
  browser_task_id: string | null;
  report_id: string | null;
  source_sha256: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AutomationSecretStatus {
  browserUseApiKeyConfigured: boolean;
  moniepointUsernameConfigured: boolean;
  moniepointPasswordConfigured: boolean;
  bridgeConfigured: boolean;
}

export interface AutomationVerificationChallenge {
  pending: boolean;
  challengeId: string | null;
  runId: string | null;
  triggerKind: string | null;
  browserSessionId: string | null;
  browserTaskId: string | null;
  challengeType: "otp" | "mfa_app" | "unknown" | null;
  status: "pending" | "submitted" | "consumed" | "expired" | "cancelled" | "failed" | null;
  message: string | null;
  requestedAt: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
}

export interface AutomationConfigInput {
  enabled: boolean;
  moniepointLoginUrl: string | null;
  allowedDomains: string[];
  proxyCountryCode: string | null;
  maxSteps: number;
  maxAttempts: number;
  retryBackoffMinutes: number;
  morningAuditTime: string;
  morningRefreshTime: string;
  eveningRefreshTime: string;
}

export async function loadAutomationConfig(accessToken: string) {
  const rows = await restSelect<AutomationConfigRecord[]>(
    "automation_config?select=*&id=eq.true&limit=1",
    accessToken,
  );
  return rows[0] ?? null;
}

export async function loadAutomationRuns(accessToken: string, limit = 30) {
  return restSelect<AutomationRunRecord[]>(
    `automation_runs?select=id,trigger_kind,status,scheduled_for,attempt_count,browser_task_id,report_id,source_sha256,last_error_code,last_error_message,started_at,completed_at,created_at&order=created_at.desc&limit=${limit}`,
    accessToken,
  );
}

export function loadAutomationSecretStatus(accessToken: string) {
  return callRpc<AutomationSecretStatus>("automation_secret_status", {}, accessToken);
}

export function setAutomationSecret(
  kind: "browser_use_api_key" | "moniepoint_username" | "moniepoint_password",
  value: string,
  accessToken: string,
) {
  return callRpc<AutomationSecretStatus>(
    "set_automation_secret",
    { p_kind: kind, p_value: value },
    accessToken,
  );
}

export function loadAutomationVerificationChallenge(accessToken: string) {
  return callRpc<AutomationVerificationChallenge>(
    "automation_verification_challenge_status",
    {},
    accessToken,
  );
}

export function submitAutomationVerificationCode(
  challengeId: string,
  code: string,
  accessToken: string,
) {
  return callRpc<{ ok: boolean; challengeId: string; status: "submitted" }>(
    "automation_submit_verification_code",
    { p_challenge_id: challengeId, p_code: code },
    accessToken,
  );
}

export function updateAutomationConfig(input: AutomationConfigInput, accessToken: string) {
  return callRpc<AutomationConfigRecord>(
    "update_automation_config",
    {
      p_enabled: input.enabled,
      p_moniepoint_login_url: input.moniepointLoginUrl,
      p_allowed_domains: input.allowedDomains,
      p_proxy_country_code: input.proxyCountryCode,
      p_max_steps: input.maxSteps,
      p_max_attempts: input.maxAttempts,
      p_retry_backoff_minutes: input.retryBackoffMinutes,
      p_morning_audit_time: input.morningAuditTime,
      p_morning_refresh_time: input.morningRefreshTime,
      p_evening_refresh_time: input.eveningRefreshTime,
    },
    accessToken,
  );
}

export function queueAutomationRun(accessToken: string) {
  return callRpc<{ queued: boolean; runId?: string; reason?: string }>(
    "queue_automation_run",
    { p_trigger_kind: "manual" },
    accessToken,
  );
}

export function rotateAutomationBridgeToken(accessToken: string) {
  return callRpc<{ rotated: boolean }>("rotate_automation_bridge_token", {}, accessToken);
}
