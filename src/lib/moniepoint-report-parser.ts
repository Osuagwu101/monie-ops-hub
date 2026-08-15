import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MONIEPOINT_PARSER_VERSION = "brm-daily-report-v1";

export type ReportTerminalSection = "daily" | "rolling_7_day" | "non_transacting";

export interface MoniepointReportSummary {
  topBoRetentionRate: number | null;
  terminalActivityRate: number;
  assignedTerminalGrowth: number | null;
  totalTerminalCount: number;
  assignedTerminalCount: number;
  activeTerminalCount: number;
  unassignedTerminalCount: number;
  assignedSevenPlusDaysCount: number;
  activeAssignedSevenPlusDaysCount: number;
  paymentValue: number | null;
  paymentVolume: number | null;
  transferValue: number | null;
  transferVolume: number | null;
}

export interface ParsedTerminalRow {
  section: ReportTerminalSection;
  rowNumber: number;
  terminalId: string;
  terminalSerial: string;
  businessName: string;
  paymentValue: number | null;
  paymentVolume: number | null;
  transferValue: number | null;
  transferVolume: number | null;
  officialTargetValue: number | null;
  officialTargetMet: boolean | null;
  daysSinceLastTransaction: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  lastTransactionDate: string | null;
  businessRegistrationDate: string | null;
  terminalAssignmentDate: string | null;
}

export interface ParserCheck {
  level: "pass" | "warning" | "error";
  message: string;
}

export interface ParsedMoniepointReport {
  reportDate: string;
  brmName: string;
  parserVersion: string;
  pageCount: number;
  summary: MoniepointReportSummary;
  rows: ParsedTerminalRow[];
  dailyRows: ParsedTerminalRow[];
  rollingRows: ParsedTerminalRow[];
  nonTransactingRows: ParsedTerminalRow[];
  checks: ParserCheck[];
  canImport: boolean;
}

interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
}

const DAY_MONTH_YEAR = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;
const TERMINAL_ID = /^[A-Z0-9]{8,10}$/;
const SERIAL_WITH_TARGET = /^([A-Z0-9]{12,20})\s+([\d,]+\.\d{2})\s+(True|False)$/;
const TRANSACTION_LINE = /^([\d,]+\.\d{2})\s+(\d+)\s+(\d+)$/;
const TRANSFER_AND_DAYS = /^([\d,]+\.\d{2})\s+(\d+)$/;
const SERIAL_WITH_LAST_TRANSACTION = /^([A-Z0-9]{12,20})\s+(\d{4}-\d{2}-\d{2})\s+(\d+)$/;
const TWO_DATES = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/;

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const HEADER_PREFIXES = [
  "Terminal ID",
  "S/N Business Name",
  "Terminal Serial",
  "Value",
  "Target Met",
  "Payment Value",
  "Transfer Value",
  "Transaction",
  "Business Registration Date",
  "Page ",
  "August ",
  "September ",
  "October ",
  "November ",
  "December ",
  "January ",
  "February ",
  "March ",
  "April ",
  "May ",
  "June ",
  "July ",
];

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function lineAt(lines: string[], index: number) {
  return lines[index] ?? "";
}

function group(match: RegExpExecArray, index: number) {
  return match[index] ?? "";
}

function isTextItem(item: unknown): item is PdfTextItemLike {
  return Boolean(item && typeof item === "object" && "str" in item);
}

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | undefined) {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function parseReportDateLine(value: string) {
  const match = DAY_MONTH_YEAR.exec(value);
  if (!match) return null;
  const day = group(match, 1);
  const month = group(match, 2);
  const year = group(match, 3);
  const monthNumber = MONTHS[month];
  if (!day || !monthNumber || !year) return null;
  return `${year}-${monthNumber}-${day.padStart(2, "0")}`;
}

function parseHeaderDate(value: string) {
  const cleaned = value.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+/, "");
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(cleaned);
  if (!match) return null;
  const day = group(match, 1);
  const month = group(match, 2);
  const year = group(match, 3);
  const monthNumber = MONTHS[month];
  if (!day || !monthNumber || !year) return null;
  return `${year}-${monthNumber}-${day.padStart(2, "0")}`;
}

function valueAfterLabel(lines: string[], label: string) {
  const index = lines.findIndex((line) => line === label || line.startsWith(`${label} `));
  if (index < 0) return undefined;

  const sameLine = lineAt(lines, index).slice(label.length).trim();
  if (sameLine && /^[-₦\d,.%]+$/.test(sameLine)) return sameLine;

  let cursor = index + 1;
  while (cursor < lines.length && cursor <= index + 3) {
    const candidate = lineAt(lines, cursor);
    if (/^[-₦\d,.%]+$/.test(candidate)) return candidate;
    cursor += 1;
  }
  return undefined;
}

function requiredNumberAfterLabel(lines: string[], label: string) {
  return parseNumber(valueAfterLabel(lines, label));
}

function isIgnorableLine(line: string) {
  return !line || HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function isSectionBoundary(line: string) {
  return (
    line.startsWith("Daily Terminal Transactions") ||
    line.startsWith("Weekly Terminal Transactions") ||
    line === "Non-Transacting Terminals" ||
    line === "Businesses with Sold Cards" ||
    line === "Business Owners with Referrals"
  );
}

async function extractRawLines(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data: bytes }).promise;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let current: string[] = [];

    const flush = () => {
      const line = normalizeLine(current.join(" "));
      if (line) lines.push(line);
      current = [];
    };

    for (const rawItem of content.items) {
      if (!isTextItem(rawItem)) continue;
      const parts = rawItem.str.split(/\r?\n/);
      parts.forEach((part, index) => {
        if (part.trim()) current.push(part);
        if (index < parts.length - 1) flush();
      });
      if (rawItem.hasEOL) flush();
    }
    flush();
    lines.push(`__PAGE_BREAK_${pageNumber}__`);
  }

  return { lines, pageCount: pdf.numPages };
}

function findNextRowLead(lines: string[], start: number) {
  let index = start;
  while (index < lines.length) {
    const line = lineAt(lines, index);
    if (isSectionBoundary(line) || line.startsWith("__PAGE_BREAK_")) return index;
    if (/^\d+\s+.+/.test(line)) return index;
    index += 1;
  }
  return index;
}

function parseTransactionRow(
  lines: string[],
  terminalIndex: number,
  section: "daily" | "rolling_7_day",
  periodStart: string,
  periodEnd: string,
) {
  const terminalId = lineAt(lines, terminalIndex);
  if (!terminalId) return null;

  const leadIndex = findNextRowLead(lines, terminalIndex + 1);
  const leadLine = lineAt(lines, leadIndex);
  if (!leadLine || isSectionBoundary(leadLine)) return null;

  const lead = /^(\d+)\s+(.+)$/.exec(leadLine);
  if (!lead) return null;

  const rowNumber = Number.parseInt(group(lead, 1), 10);
  const firstBusinessPart = group(lead, 2);
  if (!Number.isFinite(rowNumber) || !firstBusinessPart) return null;

  const businessParts = [firstBusinessPart];
  let cursor = leadIndex + 1;

  while (cursor < lines.length && !SERIAL_WITH_TARGET.test(lineAt(lines, cursor))) {
    const line = lineAt(lines, cursor);
    if (isSectionBoundary(line) || TERMINAL_ID.test(line)) return null;
    if (!isIgnorableLine(line) && !line.startsWith("__PAGE_BREAK_")) businessParts.push(line);
    cursor += 1;
  }

  const serialMatch = SERIAL_WITH_TARGET.exec(lineAt(lines, cursor));
  const transactionMatch = TRANSACTION_LINE.exec(lineAt(lines, cursor + 1));
  const transferMatch = TRANSFER_AND_DAYS.exec(lineAt(lines, cursor + 2));
  if (!serialMatch || !transactionMatch || !transferMatch) return null;

  const terminalSerial = group(serialMatch, 1);
  const targetValue = group(serialMatch, 2);
  const targetMet = group(serialMatch, 3);
  const paymentValue = group(transactionMatch, 1);
  const paymentVolume = group(transactionMatch, 2);
  const transferVolume = group(transactionMatch, 3);
  const transferValue = group(transferMatch, 1);
  const daysSinceLastTransaction = group(transferMatch, 2);
  if (!terminalSerial || !targetValue || !targetMet) return null;

  const row: ParsedTerminalRow = {
    section,
    rowNumber,
    terminalId,
    terminalSerial,
    businessName: normalizeLine(businessParts.join(" ")),
    paymentValue: parseNumber(paymentValue),
    paymentVolume: parseInteger(paymentVolume),
    transferValue: parseNumber(transferValue),
    transferVolume: parseInteger(transferVolume),
    officialTargetValue: parseNumber(targetValue),
    officialTargetMet: targetMet === "True",
    daysSinceLastTransaction: parseInteger(daysSinceLastTransaction),
    periodStart,
    periodEnd,
    lastTransactionDate: null,
    businessRegistrationDate: null,
    terminalAssignmentDate: null,
  };

  return { row, nextIndex: cursor + 3 };
}

function parseNonTransactingRow(lines: string[], terminalIndex: number) {
  const terminalId = lineAt(lines, terminalIndex);
  if (!terminalId) return null;

  const leadIndex = findNextRowLead(lines, terminalIndex + 1);
  const leadLine = lineAt(lines, leadIndex);
  if (!leadLine || isSectionBoundary(leadLine)) return null;

  const lead = /^(\d+)\s+(.+)$/.exec(leadLine);
  if (!lead) return null;

  const rowNumber = Number.parseInt(group(lead, 1), 10);
  const firstBusinessPart = group(lead, 2);
  if (!Number.isFinite(rowNumber) || !firstBusinessPart) return null;

  const businessParts = [firstBusinessPart];
  let cursor = leadIndex + 1;

  while (cursor < lines.length && !SERIAL_WITH_LAST_TRANSACTION.test(lineAt(lines, cursor))) {
    const line = lineAt(lines, cursor);
    if (isSectionBoundary(line) || TERMINAL_ID.test(line)) return null;
    if (!isIgnorableLine(line) && !line.startsWith("__PAGE_BREAK_")) businessParts.push(line);
    cursor += 1;
  }

  const serialMatch = SERIAL_WITH_LAST_TRANSACTION.exec(lineAt(lines, cursor));
  const dateMatch = TWO_DATES.exec(lineAt(lines, cursor + 1));
  if (!serialMatch || !dateMatch) return null;

  const terminalSerial = group(serialMatch, 1);
  const lastTransactionDate = group(serialMatch, 2);
  const daysSinceLastTransaction = group(serialMatch, 3);
  const businessRegistrationDate = group(dateMatch, 1);
  const terminalAssignmentDate = group(dateMatch, 2);
  if (
    !terminalSerial ||
    !lastTransactionDate ||
    !businessRegistrationDate ||
    !terminalAssignmentDate
  ) {
    return null;
  }

  const row: ParsedTerminalRow = {
    section: "non_transacting",
    rowNumber,
    terminalId,
    terminalSerial,
    businessName: normalizeLine(businessParts.join(" ")),
    paymentValue: null,
    paymentVolume: null,
    transferValue: null,
    transferVolume: null,
    officialTargetValue: null,
    officialTargetMet: null,
    daysSinceLastTransaction: parseInteger(daysSinceLastTransaction),
    periodStart: null,
    periodEnd: null,
    lastTransactionDate,
    businessRegistrationDate,
    terminalAssignmentDate,
  };

  return { row, nextIndex: cursor + 2 };
}

function parseRows(lines: string[], reportDate: string) {
  const rows: ParsedTerminalRow[] = [];
  let section: ReportTerminalSection | null = null;
  let dailyStart = reportDate;
  let dailyEnd = reportDate;
  let rollingStart = "";
  let rollingEnd = reportDate;
  let index = 0;

  while (index < lines.length) {
    const line = lineAt(lines, index);

    const dailyHeader = /^Daily Terminal Transactions \((.+)\)$/.exec(line);
    if (dailyHeader) {
      const parsed = parseHeaderDate(group(dailyHeader, 1));
      dailyStart = parsed ?? reportDate;
      dailyEnd = parsed ?? reportDate;
      section = "daily";
      index += 1;
      continue;
    }

    const weeklyHeader = /^Weekly Terminal Transactions \((.+) to (.+)\)$/.exec(line);
    if (weeklyHeader) {
      rollingStart = parseHeaderDate(group(weeklyHeader, 1)) ?? "";
      rollingEnd = parseHeaderDate(group(weeklyHeader, 2)) ?? reportDate;
      section = "rolling_7_day";
      index += 1;
      continue;
    }

    if (line === "Non-Transacting Terminals") {
      section = "non_transacting";
      index += 1;
      continue;
    }

    if (line === "Businesses with Sold Cards" || line === "Business Owners with Referrals") {
      section = null;
      index += 1;
      continue;
    }

    if (!section || !TERMINAL_ID.test(line)) {
      index += 1;
      continue;
    }

    if (section === "daily") {
      const parsed = parseTransactionRow(lines, index, section, dailyStart, dailyEnd);
      if (parsed) {
        rows.push(parsed.row);
        index = parsed.nextIndex;
        continue;
      }
    }

    if (section === "rolling_7_day" && rollingStart) {
      const parsed = parseTransactionRow(lines, index, section, rollingStart, rollingEnd);
      if (parsed) {
        rows.push(parsed.row);
        index = parsed.nextIndex;
        continue;
      }
    }

    if (section === "non_transacting") {
      const parsed = parseNonTransactingRow(lines, index);
      if (parsed) {
        rows.push(parsed.row);
        index = parsed.nextIndex;
        continue;
      }
    }

    index += 1;
  }

  return rows;
}

function buildChecks(summary: MoniepointReportSummary, rows: ParsedTerminalRow[]) {
  const checks: ParserCheck[] = [];
  const dailyRows = rows.filter((row) => row.section === "daily");
  const rollingRows = rows.filter((row) => row.section === "rolling_7_day");
  const nonTransactingRows = rows.filter((row) => row.section === "non_transacting");
  const rollingTargetMetCount = rollingRows.filter((row) => row.officialTargetMet).length;

  const pass = (message: string) => checks.push({ level: "pass" as const, message });
  const warning = (message: string) => checks.push({ level: "warning" as const, message });
  const error = (message: string) => checks.push({ level: "error" as const, message });

  if (dailyRows.length === summary.assignedTerminalCount) {
    pass(`Daily section contains all ${dailyRows.length} assigned terminals.`);
  } else {
    error(
      `Daily section has ${dailyRows.length} rows but the report summary says ${summary.assignedTerminalCount} assigned terminals.`,
    );
  }

  if (rollingRows.length === summary.assignedTerminalCount) {
    pass(`Rolling 7-day section contains all ${rollingRows.length} assigned terminals.`);
  } else {
    error(
      `Rolling 7-day section has ${rollingRows.length} rows but the report summary says ${summary.assignedTerminalCount} assigned terminals.`,
    );
  }

  const uniqueDaily = new Set(dailyRows.map((row) => row.terminalId));
  const uniqueRolling = new Set(rollingRows.map((row) => row.terminalId));
  if (uniqueDaily.size !== dailyRows.length || uniqueRolling.size !== rollingRows.length) {
    error("A terminal appears more than once inside a transaction section.");
  } else {
    pass("Terminal IDs are unique inside each transaction section.");
  }

  const sameTerminalSet =
    uniqueDaily.size === uniqueRolling.size &&
    [...uniqueDaily].every((terminalId) => uniqueRolling.has(terminalId));
  if (sameTerminalSet) {
    pass("Daily and rolling sections cover the same terminal set.");
  } else {
    error("Daily and rolling sections do not contain the same terminal IDs.");
  }

  if (rollingTargetMetCount === summary.activeAssignedSevenPlusDaysCount) {
    pass(
      `Rolling Target Met count (${rollingTargetMetCount}) matches Active Terminals Assigned for 7+ Days.`,
    );
  } else {
    warning(
      `Rolling Target Met count is ${rollingTargetMetCount}, while the summary reports ${summary.activeAssignedSevenPlusDaysCount} active terminals assigned for 7+ days.`,
    );
  }

  if (summary.assignedSevenPlusDaysCount > 0) {
    const calculatedRate =
      (summary.activeAssignedSevenPlusDaysCount / summary.assignedSevenPlusDaysCount) * 100;
    if (Math.abs(calculatedRate - summary.terminalActivityRate) <= 0.2) {
      pass("Terminal Activity Rate reconciles to the 7+ day active/assigned counts.");
    } else {
      warning(
        `Terminal Activity Rate is ${summary.terminalActivityRate}%, while the 7+ day counts calculate to ${calculatedRate.toFixed(1)}%.`,
      );
    }
  }

  if (nonTransactingRows.length) {
    pass(`Captured ${nonTransactingRows.length} non-transacting terminal records.`);
  } else {
    warning("No non-transacting terminal section was parsed.");
  }

  return checks;
}

export async function parseMoniepointReport(file: File): Promise<ParsedMoniepointReport> {
  if (file.type && file.type !== "application/pdf") {
    throw new Error("Please choose a PDF report.");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("The report is larger than the 15 MB import limit.");
  }

  const { lines, pageCount } = await extractRawLines(file);
  const reportDateLine = lines.find((line) => DAY_MONTH_YEAR.test(line));
  const reportDate = reportDateLine ? parseReportDateLine(reportDateLine) : null;
  if (!reportDate) throw new Error("The Moniepoint report date could not be identified.");

  const reportDateIndex = lines.findIndex((line) => line === reportDateLine);
  const brmName = normalizeLine(lineAt(lines, reportDateIndex + 1));
  if (!brmName || brmName === "Performance") {
    throw new Error("The BRM name could not be identified from the report header.");
  }

  const summary: MoniepointReportSummary = {
    topBoRetentionRate: requiredNumberAfterLabel(lines, "Top BO Retention Rate"),
    terminalActivityRate: requiredNumberAfterLabel(lines, "Terminal Activity Rate") ?? Number.NaN,
    assignedTerminalGrowth: requiredNumberAfterLabel(
      lines,
      "Assigned Terminal Growth (Current Month)",
    ),
    totalTerminalCount: requiredNumberAfterLabel(lines, "Total Terminal Count") ?? Number.NaN,
    assignedTerminalCount:
      requiredNumberAfterLabel(lines, "Terminals Assigned to BOs") ?? Number.NaN,
    activeTerminalCount: requiredNumberAfterLabel(lines, "Active Terminals") ?? Number.NaN,
    unassignedTerminalCount: requiredNumberAfterLabel(lines, "Unassigned Terminals") ?? Number.NaN,
    assignedSevenPlusDaysCount:
      requiredNumberAfterLabel(lines, "Terminals Assigned for 7+ Days") ?? Number.NaN,
    activeAssignedSevenPlusDaysCount:
      requiredNumberAfterLabel(lines, "Active Terminals Assigned for 7+ Days") ?? Number.NaN,
    paymentValue: requiredNumberAfterLabel(lines, "Payment Value"),
    paymentVolume: requiredNumberAfterLabel(lines, "Payment Volume"),
    transferValue: requiredNumberAfterLabel(lines, "Transfer Value"),
    transferVolume: requiredNumberAfterLabel(lines, "Transfer Volume"),
  };

  const requiredSummaryValues = [
    summary.terminalActivityRate,
    summary.totalTerminalCount,
    summary.assignedTerminalCount,
    summary.activeTerminalCount,
    summary.unassignedTerminalCount,
    summary.assignedSevenPlusDaysCount,
    summary.activeAssignedSevenPlusDaysCount,
  ];
  if (requiredSummaryValues.some((value) => !Number.isFinite(value))) {
    throw new Error("One or more required Moniepoint summary metrics could not be parsed.");
  }

  const rows = parseRows(lines, reportDate);
  const dailyRows = rows.filter((row) => row.section === "daily");
  const rollingRows = rows.filter((row) => row.section === "rolling_7_day");
  const nonTransactingRows = rows.filter((row) => row.section === "non_transacting");
  const checks = buildChecks(summary, rows);

  return {
    reportDate,
    brmName,
    parserVersion: MONIEPOINT_PARSER_VERSION,
    pageCount,
    summary,
    rows,
    dailyRows,
    rollingRows,
    nonTransactingRows,
    checks,
    canImport: !checks.some((check) => check.level === "error"),
  };
}

export async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
