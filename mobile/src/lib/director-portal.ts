import { mobileSupabaseKey, mobileSupabaseUrl, supabase } from "./supabase";

export interface StaffAccount {
  id: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
}

export interface AutomationConfig {
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
  authState: string;
  authStateMessage: string | null;
  authStateCheckedAt: string | null;
}

export interface AutomationRun {
  id: string;
  triggerKind: string;
  status: string;
  attemptCount: number;
  lastErrorMessage: string | null;
  createdAt: string;
}

export interface AutomationSecretStatus {
  browserUseApiKeyConfigured: boolean;
  moniepointUsernameConfigured: boolean;
  moniepointPasswordConfigured: boolean;
  bridgeConfigured: boolean;
}

export interface AutomationChallenge {
  pending: boolean;
  challengeId: string | null;
  status: string | null;
  challengeType: string | null;
  message: string | null;
  expiresAt: string | null;
}

export interface AutomationWorkspace {
  config: AutomationConfig | null;
  runs: AutomationRun[];
  secrets: AutomationSecretStatus | null;
  challenge: AutomationChallenge | null;
}

export interface ReadinessCheck {
  key: string;
  category: string;
  label: string;
  status: string;
  detail: string;
}

export interface ReadinessSnapshot {
  generatedAt: string;
  overallStatus: string;
  platformReady: boolean;
  manualOperationsReady: boolean;
  liveAutomationReady: boolean;
  automationEnabled: boolean;
  counts: {
    directors: number;
    assistants: number;
    cronJobs: number;
    sensitiveRlsTables: number;
    sensitiveRlsExpected: number;
  };
  latestReport: { id: string; reportDate: string; status: string; ageDays: number } | null;
  externalActivation: {
    browserUseApiKeyConfigured: boolean;
    moniepointCredentialsConfigured: boolean;
    loginScopeConfigured: boolean;
  };
  checks: ReadinessCheck[];
}

export interface ReadinessAudit {
  id: string;
  overallStatus: string;
  createdAt: string;
  platformReady: boolean;
}

export interface AssistantOption {
  id: string;
  fullName: string;
}

export interface AgentRun {
  id: string;
  agentKind: string;
  status: string;
  planDate: string;
  createdAt: string;
}

export interface AgentRecommendation {
  id: string;
  agentKind: string;
  title: string;
  rationale: string;
  talkingPoints: string | null;
  score: number | null;
  operationalState: string | null;
  merchantName: string | null;
  phoneNumber: string | null;
  createdAt: string;
}

export interface OperationsTeamWorkspace {
  assistants: AssistantOption[];
  runs: AgentRun[];
  recommendations: AgentRecommendation[];
}

export interface RunOperationsResult {
  totalCalls: number;
  dailyCallTarget: number;
  taCalls: number;
  nonTaCalls: number;
  mixCompliant: boolean;
  contactGaps: number;
}

export async function loadStaffAccounts(): Promise<StaffAccount[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,is_active,created_at")
    .eq("role", "assistant")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  }));
}

export async function createStaffAccount(input: {
  fullName: string;
  email: string;
  temporaryPassword: string;
}) {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const temporaryPassword = input.temporaryPassword.trim();
  if (!fullName) throw new Error("Staff full name is required.");
  if (!email.includes("@")) throw new Error("Enter a valid staff email.");
  if (temporaryPassword.length < 8) throw new Error("Temporary password must be at least 8 characters.");

  const { data: invite, error: inviteError } = await supabase.rpc("create_staff_invite", {
    p_email: email,
    p_full_name: fullName,
  });
  if (inviteError) throw inviteError;

  const result = invite as {
    email: string;
    fullName: string;
    inviteToken: string;
  };
  const response = await fetch(`${mobileSupabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: mobileSupabaseKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: result.email,
      password: temporaryPassword,
      data: { full_name: result.fullName, staff_invite_token: result.inviteToken },
    }),
  });
  const body = (await response.json()) as { error_description?: string; msg?: string; session?: unknown };
  if (!response.ok) throw new Error(body.msg ?? body.error_description ?? "Unable to create staff account.");
  return { email: result.email, requiresEmailConfirmation: !body.session };
}

export async function loadAutomationWorkspace(): Promise<AutomationWorkspace> {
  const [configResult, runsResult, secretResult, challengeResult] = await Promise.all([
    supabase.from("automation_config").select("*").eq("id", true).maybeSingle(),
    supabase.from("automation_runs").select("id,trigger_kind,status,attempt_count,last_error_message,created_at").order("created_at", { ascending: false }).limit(20),
    supabase.rpc("automation_secret_status"),
    supabase.rpc("automation_verification_challenge_status"),
  ]);
  if (configResult.error) throw configResult.error;
  if (runsResult.error) throw runsResult.error;
  if (secretResult.error) throw secretResult.error;
  if (challengeResult.error) throw challengeResult.error;
  const row = configResult.data;
  return {
    config: row
      ? {
          enabled: Boolean(row.enabled),
          moniepointLoginUrl: row.moniepoint_login_url,
          allowedDomains: row.allowed_domains ?? [],
          proxyCountryCode: row.proxy_country_code,
          maxSteps: Number(row.max_steps),
          maxAttempts: Number(row.max_attempts),
          retryBackoffMinutes: Number(row.retry_backoff_minutes),
          morningAuditTime: String(row.morning_audit_time).slice(0, 5),
          morningRefreshTime: String(row.morning_refresh_time).slice(0, 5),
          eveningRefreshTime: String(row.evening_refresh_time).slice(0, 5),
          authState: row.auth_state ?? "unknown",
          authStateMessage: row.auth_state_message,
          authStateCheckedAt: row.auth_state_checked_at,
        }
      : null,
    runs: (runsResult.data ?? []).map((run) => ({
      id: run.id,
      triggerKind: run.trigger_kind,
      status: run.status,
      attemptCount: Number(run.attempt_count),
      lastErrorMessage: run.last_error_message,
      createdAt: run.created_at,
    })),
    secrets: secretResult.data as AutomationSecretStatus,
    challenge: challengeResult.data as AutomationChallenge,
  };
}

export async function updateAutomationConfig(config: AutomationConfig) {
  const { data, error } = await supabase.rpc("update_automation_config", {
    p_enabled: config.enabled,
    p_moniepoint_login_url: config.moniepointLoginUrl,
    p_allowed_domains: config.allowedDomains,
    p_proxy_country_code: config.proxyCountryCode,
    p_max_steps: config.maxSteps,
    p_max_attempts: config.maxAttempts,
    p_retry_backoff_minutes: config.retryBackoffMinutes,
    p_morning_audit_time: config.morningAuditTime,
    p_morning_refresh_time: config.morningRefreshTime,
    p_evening_refresh_time: config.eveningRefreshTime,
  });
  if (error) throw error;
  return data;
}

export async function saveAutomationSecrets(input: {
  browserUseKey: string;
  username: string;
  password: string;
}) {
  for (const [kind, value] of [
    ["browser_use_api_key", input.browserUseKey],
    ["moniepoint_username", input.username],
    ["moniepoint_password", input.password],
  ] as const) {
    if (!value.trim()) continue;
    const { error } = await supabase.rpc("set_automation_secret", {
      p_kind: kind,
      p_value: value.trim(),
    });
    if (error) throw error;
  }
}

export async function queueAutomationRun() {
  const { data, error } = await supabase.rpc("queue_automation_run", {
    p_trigger_kind: "manual",
  });
  if (error) throw error;
  return data as { queued: boolean; reason?: string };
}

export async function submitAutomationCode(challengeId: string, code: string) {
  const { error } = await supabase.rpc("automation_submit_verification_code", {
    p_challenge_id: challengeId,
    p_code: code,
  });
  if (error) throw error;
}

export async function loadReadinessWorkspace() {
  const [snapshotResult, historyResult] = await Promise.all([
    supabase.rpc("system_readiness_snapshot"),
    supabase.from("readiness_audits").select("id,overall_status,snapshot,created_at").order("created_at", { ascending: false }).limit(12),
  ]);
  if (snapshotResult.error) throw snapshotResult.error;
  if (historyResult.error) throw historyResult.error;
  const history: ReadinessAudit[] = (historyResult.data ?? []).map((row) => ({
    id: row.id,
    overallStatus: row.overall_status,
    createdAt: row.created_at,
    platformReady: Boolean((row.snapshot as { platformReady?: boolean } | null)?.platformReady),
  }));
  return { snapshot: snapshotResult.data as ReadinessSnapshot, history };
}

export async function runReadinessAudit() {
  const { data, error } = await supabase.rpc("run_readiness_audit");
  if (error) throw error;
  return data;
}

export async function loadOperationsTeamWorkspace(
  planDate: string,
  assistantId?: string,
): Promise<OperationsTeamWorkspace> {
  const assistantQuery = supabase.from("profiles").select("id,full_name").eq("role", "assistant").eq("is_active", true).order("full_name");
  let runQuery = supabase.from("agent_runs").select("id,agent_kind,status,plan_date,created_at").order("created_at", { ascending: false }).limit(24);
  let recommendationQuery = supabase.from("agent_recommendations").select("id,agent_kind,title,rationale,talking_points,score,operational_state,merchant_id,created_at").eq("plan_date", planDate).in("status", ["open", "accepted"]).order("score", { ascending: false }).limit(60);
  if (assistantId) {
    runQuery = runQuery.eq("assistant_id", assistantId);
    recommendationQuery = recommendationQuery.eq("assigned_to", assistantId);
  }
  const [assistantsResult, runsResult, recommendationsResult] = await Promise.all([
    assistantQuery,
    runQuery,
    recommendationQuery,
  ]);
  if (assistantsResult.error) throw assistantsResult.error;
  if (runsResult.error) throw runsResult.error;
  if (recommendationsResult.error) throw recommendationsResult.error;

  const merchantIds = [...new Set((recommendationsResult.data ?? []).map((row) => row.merchant_id).filter(Boolean))] as string[];
  const merchantResult = merchantIds.length
    ? await supabase.from("merchants").select("id,business_name,phone_number").in("id", merchantIds)
    : { data: [], error: null };
  if (merchantResult.error) throw merchantResult.error;
  const merchantMap = new Map((merchantResult.data ?? []).map((row) => [row.id, row] as const));

  return {
    assistants: (assistantsResult.data ?? []).map((row) => ({ id: row.id, fullName: row.full_name })),
    runs: (runsResult.data ?? []).map((row) => ({
      id: row.id,
      agentKind: row.agent_kind,
      status: row.status,
      planDate: row.plan_date,
      createdAt: row.created_at,
    })),
    recommendations: (recommendationsResult.data ?? []).map((row) => {
      const merchant = row.merchant_id ? merchantMap.get(row.merchant_id) : null;
      return {
        id: row.id,
        agentKind: row.agent_kind,
        title: row.title,
        rationale: row.rationale,
        talkingPoints: row.talking_points,
        score: row.score === null ? null : Number(row.score),
        operationalState: row.operational_state,
        merchantName: merchant?.business_name ?? null,
        phoneNumber: merchant?.phone_number ?? null,
        createdAt: row.created_at,
      };
    }),
  };
}

export async function runOperationsTeam(assistantId: string, planDate: string) {
  const { data, error } = await supabase.rpc("run_operations_team", {
    p_assistant_id: assistantId,
    p_plan_date: planDate,
    p_report_id: null,
  });
  if (error) throw error;
  return data as RunOperationsResult;
}

export async function updateMerchantContact(input: {
  merchantId: string;
  phoneNumber: string;
  accountNumber: string;
}) {
  const phoneNumber = input.phoneNumber.trim() || null;
  const accountNumber = input.accountNumber.trim() || null;
  if (!phoneNumber && !accountNumber) throw new Error("Enter a phone number or POS account number.");
  const { error } = await supabase
    .from("merchants")
    .update({
      phone_number: phoneNumber,
      account_number: accountNumber,
      contact_source: "director_manual",
      contact_synced_at: new Date().toISOString(),
    })
    .eq("id", input.merchantId);
  if (error) throw error;
}
