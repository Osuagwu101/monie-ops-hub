export const MONIEPOINT_PARSER_VERSION = "brm-daily-report-v3";

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

interface RowLead {
  rowNumber: number;
  businessName: string;
  terminalSerial: string;
  tail: string;
}

const DAY_MONTH_YEAR = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROW_NUMBER = /^\d+$/;
const ROW_LEAD = /^(\d+)\s+(.+)$/;
const FULL_ROW_START = /^([A-Z0-9]{8,10})\s+(\d+)(?:\s+(.+))?$/;
const TRANSACTION_TOKEN = /True|False|[\d,]+(?:\.\d+)?/g;
const NON_TRANSACTING_TOKEN = /\d{4}-\d{2}-\d{2}|\d+/g;

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
  "S/N",
  "Business Name",
  "Terminal Serial",
  "Target Payment",
  "Target Met",
  "Payment Value",
  "Payment Volume",
  "Transfer Value",
  "Transfer Volume",
  "Days Since Last",
  "Last Transaction Date",
  "Business Registration Date",
  "Terminal Assignment Date",
  "Transaction",
  "Value",
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

function countDigits(value: string) {
  return [...value].filter((character) => /\d/.test(character)).length;
}

function isTerminalIdValue(value: string) {
  return /^[A-Z0-9]{8,10}$/.test(value) && countDigits(value) >= 1;
}

function isSerialValue(value: string) {
  return /^[A-Z0-9]{12,20}$/.test(value) && countDigits(value) >= 6;
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
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(cleaned.trim());
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
  return (
    !line ||
    line.startsWith("__PAGE_BREAK_") ||
    HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))
  );
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

export function pushCanonicalLine(lines: string[], rawValue: string) {
  const line = normalizeLine(rawValue);
  if (!line) return;

  const combinedRow = FULL_ROW_START.exec(line);
  if (combinedRow) {
    const terminalId = group(combinedRow, 1);
    const rowNumber = group(combinedRow, 2);
    const remainder = group(combinedRow, 3);
    if (isTerminalIdValue(terminalId) && ROW_NUMBER.test(rowNumber)) {
      lines.push(terminalId);
      lines.push(normalizeLine(`${rowNumber} ${remainder}`));
      return;
    }
  }

  lines.push(line);
}

function nextMeaningfulLine(lines: string[], start: number) {
  let index = start;
  while (index < lines.length && isIgnorableLine(lineAt(lines, index))) index += 1;
  return { line: lineAt(lines, index), index };
}

function isTerminalAt(lines: string[], index: number) {
  const terminalId = lineAt(lines, index);
  if (!isTerminalIdValue(terminalId)) return false;
  const next = nextMeaningfulLine(lines, index + 1).line;
  return ROW_NUMBER.test(next) || ROW_LEAD.test(next);
}

function collectRowChunk(lines: string[], terminalIndex: number) {
  const chunk: string[] = [];
  let cursor = terminalIndex + 1;

  while (cursor < lines.length) {
    const line = lineAt(lines, cursor);
    if (isSectionBoundary(line) || isTerminalAt(lines, cursor)) break;
    if (!isIgnorableLine(line)) chunk.push(line);
    cursor += 1;
  }

  return { chunk, nextIndex: cursor };
}

function parseRowLead(chunk: string[]): RowLead | null {
  if (!chunk.length) return null;
  const rowText = normalizeLine(chunk.join(" "));
  const lead = /^(\d+)\s+(.+)$/.exec(rowText);
  if (!lead) return null;

  const rowNumber = Number.parseInt(group(lead, 1), 10);
  const remainder = group(lead, 2);
  if (!Number.isFinite(rowNumber) || !remainder) return null;

  const tokens = remainder.split(/\s+/);
  const serialIndex = tokens.findIndex(isSerialValue);
  if (serialIndex < 0) return null;

  const terminalSerial = tokens[serialIndex] ?? "";
  const businessName = normalizeLine(tokens.slice(0, serialIndex).join(" "));
  const tail = normalizeLine(tokens.slice(serialIndex + 1).join(" "));
  if (!terminalSerial || !businessName) return null;

  return { rowNumber, businessName, terminalSerial, tail };
}

function transactionTokens(tail: string) {
  return tail.match(TRANSACTION_TOKEN) ?? [];
}

function nonTransactingTokens(tail: string) {
  return tail.match(NON_TRANSACTING_TOKEN) ?? [];
}

function parseTransactionRow(
  lines: string[],
  terminalIndex: number,
  section: "daily" | "rolling_7_day",
  periodStart: string,
  periodEnd: string,
) {
  const terminalId = lineAt(lines, terminalIndex);
  if (!isTerminalIdValue(terminalId)) return null;

  const collected = collectRowChunk(lines, terminalIndex);
  const lead = parseRowLead(collected.chunk);
  if (!lead) return null;

  const tokens = transactionTokens(lead.tail);
  if (tokens.length < 7 || (tokens[1] !== "True" && tokens[1] !== "False")) return null;

  const targetValue = tokens[0];
  const targetMet = tokens[1];
  const paymentValue = tokens[2];
  const paymentVolume = tokens[3];
  const transferVolume = tokens[4];
  const transferValue = tokens[5];
  const daysSinceLastTransaction = tokens[6];

  if (
    parseNumber(targetValue) === null ||
    parseNumber(paymentValue) === null ||
    parseInteger(paymentVolume) === null ||
    parseInteger(transferVolume) === null ||
    parseNumber(transferValue) === null ||
    parseInteger(daysSinceLastTransaction) === null
  ) {
    return null;
  }

  const row: ParsedTerminalRow = {
    section,
    rowNumber: lead.rowNumber,
    terminalId,
    terminalSerial: lead.terminalSerial,
    businessName: lead.businessName,
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

  return { row, nextIndex: collected.nextIndex };
}

function parseNonTransactingRow(lines: string[], terminalIndex: number) {
  const terminalId = lineAt(lines, terminalIndex);
  if (!isTerminalIdValue(terminalId)) return null;

  const collected = collectRowChunk(lines, terminalIndex);
  const lead = parseRowLead(collected.chunk);
  if (!lead) return null;

  const tokens = nonTransactingTokens(lead.tail);
  if (tokens.length < 4) return null;

  const lastTransactionDate = tokens[0] ?? "";
  const daysSinceLastTransaction = tokens[1];
  const businessRegistrationDate = tokens[2] ?? "";
  const terminalAssignmentDate = tokens[3] ?? "";

  if (
    !ISO_DATE.test(lastTransactionDate) ||
    parseInteger(daysSinceLastTransaction) === null ||
    !ISO_DATE.test(businessRegistrationDate) ||
    !ISO_DATE.test(terminalAssignmentDate)
  ) {
    return null;
  }

  const row: ParsedTerminalRow = {
    section: "non_transacting",
    rowNumber: lead.rowNumber,
    terminalId,
    terminalSerial: lead.terminalSerial,
    businessName: lead.businessName,
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

  return { row, nextIndex: collected.nextIndex };
}

function sectionHeaderWindow(lines: string[], index: number) {
  return normalizeLine(
    [lineAt(lines, index), lineAt(lines, index + 1), lineAt(lines, index + 2)]
      .filter((line) => line && !line.startsWith("__PAGE_BREAK_"))
      .join(" "),
  );
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
    const headerWindow = sectionHeaderWindow(lines, index);

    if (headerWindow.includes("Daily Terminal Transactions")) {
      const dailyHeader = /Daily Terminal Transactions\s*\(([^)]+)\)/.exec(headerWindow);
      const parsed = dailyHeader ? parseHeaderDate(group(dailyHeader, 1)) : null;
      dailyStart = parsed ?? reportDate;
      dailyEnd = parsed ?? reportDate;
      section = "daily";
      index += 1;
      continue;
    }

    if (headerWindow.includes("Weekly Terminal Transactions")) {
      const weeklyHeader = /Weekly Terminal Transactions\s*\((.+?)\s+to\s+(.+?)\)/.exec(
        headerWindow,
      );
      rollingStart = weeklyHeader ? (parseHeaderDate(group(weeklyHeader, 1)) ?? "") : "";
      rollingEnd = weeklyHeader
        ? (parseHeaderDate(group(weeklyHeader, 2)) ?? reportDate)
        : reportDate;
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

    if (!section || !isTerminalAt(lines, index)) {
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
    warning(
      `Reconciliation review: Daily section has ${dailyRows.length} rows but the report summary says ${summary.assignedTerminalCount} assigned terminals. Parsed terminal records will be imported; missing identities are not fabricated.`,
    );
  }

  if (rollingRows.length === summary.assignedTerminalCount) {
    pass(`Rolling 7-day section contains all ${rollingRows.length} assigned terminals.`);
  } else {
    warning(
      `Reconciliation review: Rolling 7-day section has ${rollingRows.length} rows but the report summary says ${summary.assignedTerminalCount} assigned terminals. Parsed terminal records will be imported; missing identities are not fabricated.`,
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
    warning("Reconciliation review: daily and rolling sections do not contain the same terminal IDs. Tasks use only the relevant verified report section.");
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

export function parseMoniepointExtractedLines(
  lines: string[],
  pageCount: number,
): ParsedMoniepointReport {
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
