import assert from "node:assert/strict";

import { parseMoniepointExtractedLines } from "../src/lib/moniepoint-report-core";

const validLines = [
  "Business Relationship Manager Daily Report",
  "Thu, 13-Aug-2026",
  "TEST BRM",
  "Performance",
  "Top BO Retention Rate",
  "85.4%",
  "Terminal Activity Rate",
  "50.0%",
  "Assigned Terminal Growth (Current Month)",
  "1",
  "Total Terminal Count",
  "2",
  "Terminals Assigned to BOs",
  "2",
  "Active Terminals",
  "1",
  "Unassigned Terminals",
  "0",
  "Terminals Assigned for 7+ Days",
  "2",
  "Active Terminals Assigned for 7+ Days",
  "1",
  "Payment Value",
  "30000.00",
  "Payment Volume",
  "5",
  "Transfer Value",
  "5000.00",
  "Transfer Volume",
  "1",
  "Daily Terminal Transactions (Thu, 13-Aug-2026)",
  "2TEST001",
  "1 TEST MERCHANT ONE P260302687045 14285.71 False 10000.00 2 1 5000.00 0",
  "2TEST002",
  "2 TEST MERCHANT TWO P260302687046 0.00 False 20000.00 3 0 0.00 2",
  "S/N",
  "Weekly Terminal Transactions (Fri, 07-Aug-2026 to Thu, 13-Aug-2026)",
  "2TEST001",
  "1 TEST MERCHANT ONE P260302687045 100000.00 True 120000.00 12 2 10000.00 0",
  "2TEST002",
  "2 TEST MERCHANT TWO P260302687046 100000.00 False 30000.00 4 0 0.00 2",
  "Non-Transacting Terminals",
  "2TEST002",
  "1 TEST MERCHANT TWO P260302687046 2026-08-11 2 2026-01-01 2026-02-01",
];

function runValidReportChecks() {
  const parsed = parseMoniepointExtractedLines(validLines, 3);

  assert.equal(parsed.canImport, true, "Valid fixture must be importable");
  assert.equal(parsed.reportDate, "2026-08-13");
  assert.equal(parsed.dailyRows.length, 2);
  assert.equal(parsed.rollingRows.length, 2);
  assert.equal(parsed.nonTransactingRows.length, 1);
  assert.equal(parsed.summary.terminalActivityRate, 50);

  const dailyOne = parsed.dailyRows.find((row) => row.terminalId === "2TEST001");
  assert.ok(dailyOne);
  assert.equal(dailyOne.officialTargetMet, false);
  assert.equal(
    (dailyOne.paymentValue ?? 0) + (dailyOne.transferValue ?? 0) >
      (dailyOne.officialTargetValue ?? 0),
    true,
    "Fixture intentionally has value above target while official Target Met stays false",
  );

  const zeroTarget = parsed.dailyRows.find((row) => row.terminalId === "2TEST002");
  assert.ok(zeroTarget);
  assert.equal(zeroTarget.officialTargetValue, 0);
  assert.equal(zeroTarget.officialTargetMet, false);

  const rollingOne = parsed.rollingRows.find((row) => row.terminalId === "2TEST001");
  assert.ok(rollingOne);
  assert.equal(rollingOne.officialTargetValue, 100000);
  assert.equal(rollingOne.officialTargetMet, true);
}

function runDuplicateTerminalGuard() {
  const duplicateLines = [...validLines];
  const firstRollingIndex = duplicateLines.findIndex(
    (line) => line === "Weekly Terminal Transactions (Fri, 07-Aug-2026 to Thu, 13-Aug-2026)",
  );
  assert.notEqual(firstRollingIndex, -1);

  const secondDailyTerminalIndex = duplicateLines.findIndex(
    (line, index) => line === "2TEST002" && index < firstRollingIndex,
  );
  assert.notEqual(secondDailyTerminalIndex, -1);
  duplicateLines[secondDailyTerminalIndex] = "2TEST001";

  const parsed = parseMoniepointExtractedLines(duplicateLines, 3);
  assert.equal(parsed.canImport, false, "Duplicate terminal IDs must block import");
  assert.ok(
    parsed.checks.some(
      (check) => check.level === "error" && check.message.includes("more than once"),
    ),
  );
}

function runMissingSummaryGuard() {
  const malformed = validLines.filter(
    (line, index, all) =>
      line !== "Terminals Assigned to BOs" && all[index - 1] !== "Terminals Assigned to BOs",
  );

  assert.throws(
    () => parseMoniepointExtractedLines(malformed, 3),
    /required Moniepoint summary metrics/i,
  );
}

runValidReportChecks();
runDuplicateTerminalGuard();
runMissingSummaryGuard();

console.log(
  "Phase 6 offline acceptance passed: valid report, official-target edge cases, duplicate-terminal guard, and malformed-summary guard.",
);
