import { callRpc, restSelect } from "@/lib/cloud-api";

export type ReadinessCheckStatus = "pass" | "warning" | "blocker" | "pending_external" | "info";
export type ReadinessCategory = "security" | "report_engine" | "operations" | "people" | "data" | "automation";
export type ReadinessOverallStatus =
  | "blocked"
  | "platform_ready_activation_pending"
  | "manual_operations_ready"
  | "ready_for_live_automation";

export interface ReadinessCheck {
  key: string;
  category: ReadinessCategory;
  label: string;
  status: ReadinessCheckStatus;
  detail: string;
  requiredFor: Array<"manual" | "automation">;
}

export interface ReadinessSnapshot {
  generatedAt: string;
  overallStatus: ReadinessOverallStatus;
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
  latestReport: {
    id: string;
    reportDate: string;
    status: string;
    ageDays: number;
  } | null;
  externalActivation: {
    browserUseApiKeyConfigured: boolean;
    moniepointCredentialsConfigured: boolean;
    loginScopeConfigured: boolean;
  };
  checks: ReadinessCheck[];
}

export interface ReadinessAuditRecord {
  id: string;
  run_by: string | null;
  overall_status: ReadinessOverallStatus;
  snapshot: ReadinessSnapshot;
  created_at: string;
}

export function loadReadinessSnapshot(accessToken: string) {
  return callRpc<ReadinessSnapshot>("system_readiness_snapshot", {}, accessToken);
}

export function runReadinessAudit(accessToken: string) {
  return callRpc<ReadinessAuditRecord>("run_readiness_audit", {}, accessToken);
}

export function loadReadinessAuditHistory(accessToken: string, limit = 12) {
  return restSelect<ReadinessAuditRecord[]>(
    `readiness_audits?select=id,run_by,overall_status,snapshot,created_at&order=created_at.desc&limit=${limit}`,
    accessToken,
  );
}
