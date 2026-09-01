import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const app = readFileSync(resolve(cwd, "App.tsx"), "utf8");
const directorUi = readFileSync(resolve(cwd, "src/components/DirectorOperations.tsx"), "utf8");
const reports = readFileSync(resolve(cwd, "src/lib/director-reports.ts"), "utf8");
const terminals = readFileSync(resolve(cwd, "src/lib/director-operations.ts"), "utf8");
const meetings = readFileSync(resolve(cwd, "src/lib/meetings.ts"), "utf8");
const agentWorkspace = readFileSync(resolve(cwd, "src/lib/agent-workspace.ts"), "utf8");
const webReport = readFileSync(resolve(cwd, "../src/lib/report-data.ts"), "utf8");
const webCore = readFileSync(resolve(cwd, "../src/lib/moniepoint-report-core.ts"), "utf8");

const has = (source, text, message) => assert.ok(source.includes(text), message);

for (const section of ["Overview", "Official Reports", "Merchants & Terminals", "Meetings & Alerts", "Profile"]) {
  has(app, `label: "${section}"`, `Director navigation must include ${section}.`);
}

has(app, 'profile.role === "assistant"', "Assistants must still route to the Phase 1 workspace.");
has(app, "<AgentWorkspace", "Phase 1 assistant workspace must remain mounted.");
has(
  app,
  'currentProfile.role !== "director"',
  "Director-only data loading must still stop for assistant profiles.",
);

has(reports, 'type: "application/pdf"', "Report selection must be PDF-only.");
has(reports, "MAX_REPORT_BYTES", "Mobile report selection must enforce the existing 15 MB cap.");
has(
  reports,
  "../../../src/lib/moniepoint-report-core",
  "Mobile must reuse the same pure Moniepoint parser core as web.",
);
has(reports, 'supabase.rpc("ingest_moniepoint_report"', "Mobile must use the existing report-ingest RPC.");
has(
  reports,
  'supabase.rpc("reconcile_ta_tasks_for_report"',
  "Mobile must use the existing reconciliation RPC.",
);
has(reports, 'const REPORT_BUCKET = "moniepoint-reports"', "Mobile must use the existing report bucket.");
has(reports, "upsert: false", "Official report source upload must remain immutable.");
has(directorUi, "PARSER VALIDATION", "Director must see parser validation before import.");
has(directorUi, "Official report imported", "Director must see successful import state.");
has(directorUi, "Unable to load this Director section", "Director sections must expose error state.");
has(directorUi, 'title="Retry"', "Director sections must provide retry behavior.");

has(terminals, '.from("merchants")', "Director merchant view must reuse merchants.");
has(terminals, '.from("terminals")', "Director merchant view must reuse terminals.");
has(
  terminals,
  '.from("terminal_performance_snapshots")',
  "Director terminal view must reuse rolling performance snapshots.",
);
has(directorUi, "Phone number not available", "Missing phone data must render safely.");
has(directorUi, "POS account not available", "Missing account data must render safely.");
has(directorUi, "Terminal serial not available", "Missing serial data must render safely.");

for (const meetingBehavior of [
  "loadUpcomingMeetings",
  "acknowledgeJoined",
  "registerMobileDevice",
]) {
  has(meetings, meetingBehavior, `Existing meeting behavior ${meetingBehavior} must remain available.`);
}
has(app, "listenForMeetingActions", "Existing meeting action listener must remain mounted.");

for (const sharedPrimitive of ["ingest_moniepoint_report", "reconcile_ta_tasks_for_report"]) {
  has(reports, sharedPrimitive, `Mobile report flow must use ${sharedPrimitive}.`);
  has(webReport, sharedPrimitive, `Web report flow must use ${sharedPrimitive}.`);
}
has(webCore, "parseMoniepointExtractedLines", "Shared parser core must remain the report parser authority.");

for (const forbiddenDirectorDataset of [
  "report_imports",
  "performance_scorecards",
  "portfolio_performance_snapshots",
]) {
  assert.ok(
    !agentWorkspace.includes(forbiddenDirectorDataset),
    `Assistant helper must not query Director dataset ${forbiddenDirectorDataset}.`,
  );
}

assert.ok(
  !reports.includes("Browser Use") &&
    !reports.includes("verification_challenge") &&
    !reports.includes("OTP"),
  "Phase 2 report code must not add Browser Use or OTP controls.",
);

console.log("Phase 2 mobile Director operations acceptance checks passed.");
