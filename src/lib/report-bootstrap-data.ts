import { callRpc, restSelect } from "@/lib/cloud-api";

export interface ManualBootstrapStatus {
  reportImported: boolean;
  reportId: string | null;
  latestReportDate: string | null;
  sourceFilename: string | null;
  importedAt: string | null;
  rowsParsed: number;
  contactsCached: number;
  verifiedMatches: number;
  reviewRequired: number;
  noContactBlockers: number;
  tasksCreated: number;
  lastResolvedAt: string | null;
}

export interface ManualBootstrapResult {
  reportId: string;
  reportDate: string;
  verifiedMatches: number;
  reviewRequired: number;
  noContactBlockers: number;
  tasksCreated: number;
}

export interface ContactResolutionRecord {
  id: string;
  report_id: string;
  terminal_external_id: string;
  terminal_serial: string | null;
  business_name: string;
  resolution_status: "verified" | "review" | "no_contact";
  resolution_reason: string;
  phone_number: string | null;
  account_number: string | null;
  task_created: boolean;
  updated_at: string;
}

export async function loadManualBootstrapStatus(accessToken: string) {
  return callRpc<ManualBootstrapStatus>("manual_report_bootstrap_status", {}, accessToken);
}

export async function bootstrapManualReport(reportId: string, accessToken: string) {
  return callRpc<ManualBootstrapResult>(
    "bootstrap_manual_report",
    { p_report_id: reportId },
    accessToken,
  );
}

export async function loadContactResolutions(
  reportId: string,
  accessToken: string,
  limit = 25,
  status?: ContactResolutionRecord["resolution_status"],
) {
  const statusFilter = status ? `&resolution_status=eq.${status}` : "";
  return restSelect<ContactResolutionRecord[]>(
    `report_contact_resolutions?select=id,report_id,terminal_external_id,terminal_serial,business_name,resolution_status,resolution_reason,phone_number,account_number,task_created,updated_at&report_id=eq.${reportId}${statusFilter}&order=resolution_status.asc,terminal_external_id.asc&limit=${limit}`,
    accessToken,
  );
}
