import { callRpc, restSelect, uploadImmutablePdf } from "@/lib/cloud-api";
import type { ParsedMoniepointReport, ParsedTerminalRow } from "@/lib/moniepoint-report-parser";

const REPORT_BUCKET = "moniepoint-reports";

export interface PortfolioPerformanceSnapshot {
  id: string;
  report_id: string;
  report_date: string;
  top_bo_retention_rate: number | null;
  terminal_activity_rate: number;
  assigned_terminal_growth: number | null;
  total_terminal_count: number | null;
  assigned_terminal_count: number | null;
  active_terminal_count: number | null;
  unassigned_terminal_count: number | null;
  assigned_7_plus_days_count: number | null;
  active_assigned_7_plus_days_count: number | null;
  payment_value: number | null;
  payment_volume: number | null;
  transfer_value: number | null;
  transfer_volume: number | null;
  daily_target_met_count: number | null;
  rolling_target_met_count: number | null;
  parsed_daily_row_count: number | null;
  parsed_rolling_row_count: number | null;
  parsed_non_transacting_row_count: number | null;
  captured_at: string;
}

export interface ReportImportRecord {
  id: string;
  report_date: string;
  imported_at: string;
  source_filename: string;
  source_sha256: string;
  source_storage_path: string | null;
  brm_name: string | null;
  parser_version: string | null;
  row_count: number | null;
  processing_status: "received" | "processing" | "processed" | "failed";
  processing_error: string | null;
}

export interface ReportIngestResult {
  duplicate: boolean;
  reportId: string;
  reportDate: string;
  rowsImported?: number;
  dailyRows?: number;
  rollingRows?: number;
  nonTransactingRows?: number;
  dailyTargetMetCount?: number;
  rollingTargetMetCount?: number;
  reconciliation?: {
    reportId: string;
    reportDate: string;
    finalWindowReached: boolean;
    tasksReconciled: number;
  };
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report.pdf";
}

export function reportStoragePath(reportDate: string, sha256: string, filename: string) {
  return `${reportDate}/${sha256}/${safeFilename(filename)}`;
}

export async function loadLatestPortfolioPerformance(accessToken: string) {
  const rows = await restSelect<PortfolioPerformanceSnapshot[]>(
    "portfolio_performance_snapshots?select=*&order=report_date.desc,captured_at.desc&limit=1",
    accessToken,
  );
  return rows[0] ?? null;
}

export async function loadRecentReportImports(accessToken: string, limit = 12) {
  return restSelect<ReportImportRecord[]>(
    `report_imports?select=id,report_date,imported_at,source_filename,source_sha256,source_storage_path,brm_name,parser_version,row_count,processing_status,processing_error&order=report_date.desc,imported_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function uploadReportSource(
  report: ParsedMoniepointReport,
  file: File,
  sha256: string,
  accessToken: string,
) {
  const path = reportStoragePath(report.reportDate, sha256, file.name);
  const upload = await uploadImmutablePdf(REPORT_BUCKET, path, file, accessToken);
  return { path, ...upload };
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

export async function ingestParsedReport(
  report: ParsedMoniepointReport,
  file: File,
  sha256: string,
  sourceStoragePath: string,
  accessToken: string,
) {
  return callRpc<ReportIngestResult>(
    "ingest_moniepoint_report",
    {
      p_metadata: {
        reportDate: report.reportDate,
        sourceFilename: file.name,
        sourceSha256: sha256,
        sourceStoragePath,
        brmName: report.brmName,
        parserVersion: report.parserVersion,
        pageCount: report.pageCount,
        summary: report.summary,
      },
      p_rows: serializableRows(report.rows),
    },
    accessToken,
  );
}

export async function reconcileReport(reportId: string, accessToken: string) {
  return callRpc<NonNullable<ReportIngestResult["reconciliation"]>>(
    "reconcile_ta_tasks_for_report",
    { p_report_id: reportId },
    accessToken,
  );
}
