import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { extractTextWithInfo, isAvailable } from "expo-pdf-text-extract";

import {
  parseMoniepointExtractedLines,
  pushCanonicalLine,
  type ParsedMoniepointReport,
  type ParsedTerminalRow,
} from "../../../src/lib/moniepoint-report-core";
import { supabase } from "./supabase";

const REPORT_BUCKET = "moniepoint-reports";
const MAX_REPORT_BYTES = 15 * 1024 * 1024;

export interface MobileReportImportRecord {
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

export interface MobileReportIngestResult {
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

export interface ParsedMobileReport {
  uri: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  sha256: string;
  report: ParsedMoniepointReport;
}

export async function pickAndParseMoniepointReport(): Promise<ParsedMobileReport | null> {
  if (!isAvailable()) {
    throw new Error(
      "PDF extraction is unavailable in this build. Install the production/dev native app build rather than Expo Go and retry.",
    );
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: "application/pdf",
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) throw new Error("No PDF was selected.");

  const lowerName = asset.name.toLowerCase();
  const mimeType = asset.mimeType?.toLowerCase() ?? null;
  if (!lowerName.endsWith(".pdf") && mimeType !== "application/pdf") {
    throw new Error("Choose the official Moniepoint report as a PDF file.");
  }

  const file = new File(asset.uri);
  const size = asset.size ?? file.size ?? null;
  if (size !== null && size > MAX_REPORT_BYTES) {
    throw new Error("The Moniepoint report must be 15 MB or smaller.");
  }

  const [extraction, bytes] = await Promise.all([extractTextWithInfo(asset.uri), file.bytes()]);
  if (!extraction.success) {
    if (extraction.passwordRequired) {
      throw new Error("Password-protected PDFs cannot be imported from the mobile app.");
    }
    throw new Error(extraction.error || "The PDF text could not be extracted.");
  }

  const lines: string[] = [];
  for (const rawLine of extraction.text.split(/\r?\n/)) {
    pushCanonicalLine(lines, rawLine);
  }

  const report = parseMoniepointExtractedLines(lines, extraction.pageCount);
  const sha256 = await sha256Bytes(bytes);

  return {
    uri: asset.uri,
    name: asset.name,
    size,
    mimeType: asset.mimeType ?? null,
    sha256,
    report,
  };
}

export async function importParsedMobileReport(parsed: ParsedMobileReport) {
  if (!parsed.report.canImport) {
    throw new Error("This report did not pass the existing Moniepoint parser validation.");
  }

  const storagePath = reportStoragePath(parsed.report.reportDate, parsed.sha256, parsed.name);
  const file = new File(parsed.uri);
  const bytes = await file.bytes();
  const uploadBody = bytes.slice().buffer;

  const { error: uploadError } = await supabase.storage
    .from(REPORT_BUCKET)
    .upload(storagePath, uploadBody, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadError && !isAlreadyStored(uploadError)) {
    throw uploadError;
  }

  const { data, error } = await supabase.rpc("ingest_moniepoint_report", {
    p_metadata: {
      reportDate: parsed.report.reportDate,
      sourceFilename: parsed.name,
      sourceSha256: parsed.sha256,
      sourceStoragePath: storagePath,
      brmName: parsed.report.brmName,
      parserVersion: parsed.report.parserVersion,
      pageCount: parsed.report.pageCount,
      summary: parsed.report.summary,
    },
    p_rows: serializableRows(parsed.report.rows),
  });

  if (error) throw error;
  return data as MobileReportIngestResult;
}

export async function loadRecentMobileReportImports(limit = 12) {
  const { data, error } = await supabase
    .from("report_imports")
    .select(
      "id,report_date,imported_at,source_filename,source_sha256,source_storage_path,brm_name,parser_version,row_count,processing_status,processing_error",
    )
    .order("report_date", { ascending: false })
    .order("imported_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as MobileReportImportRecord[];
}

export async function reconcileMobileReport(reportId: string) {
  const { data, error } = await supabase.rpc("reconcile_ta_tasks_for_report", {
    p_report_id: reportId,
  });
  if (error) throw error;
  return data;
}

export function reportStoragePath(reportDate: string, sha256: string, filename: string) {
  return `${reportDate}/${sha256}/${safeFilename(filename)}`;
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report.pdf";
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

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isAlreadyStored(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: string | number; message?: string };
  return (
    String(candidate.statusCode ?? "") === "409" ||
    /already exists|duplicate/i.test(candidate.message ?? "")
  );
}
