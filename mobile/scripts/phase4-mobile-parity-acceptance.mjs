import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const app = readFileSync(resolve(cwd, "App.tsx"), "utf8");
const portal = readFileSync(resolve(cwd, "src/components/DirectorPortalSections.tsx"), "utf8");
const portalData = readFileSync(resolve(cwd, "src/lib/director-portal.ts"), "utf8");
const tasks = readFileSync(resolve(cwd, "src/components/DirectorTaskAssignment.tsx"), "utf8");
const webTasks = readFileSync(resolve(cwd, "../src/routes/daily-tasks.tsx"), "utf8");
const webData = readFileSync(resolve(cwd, "../src/lib/assistant-data.ts"), "utf8");

const has = (source, text, message) => assert.ok(source.includes(text), message);

for (const label of [
  "Staff Accounts",
  "Automation",
  "Readiness",
  "Operations Team",
  "Daily Tasks",
]) {
  has(app, `label: "${label}"`, `Director drawer must expose ${label}.`);
}
has(app, "drawerOpen", "Director navigation must use a menu drawer.");
has(app, "Open navigation menu", "The menu drawer must be accessible.");
has(app, "<StaffAccountsSection", "Staff Accounts must be mounted natively.");
has(app, "<AutomationSection", "Automation must be mounted natively.");
has(app, "<ReadinessSection", "Readiness must be mounted natively.");
has(app, "<OperationsTeamSection", "Operations Team must be mounted natively.");

for (const table of ["profiles", "automation_config", "automation_runs", "readiness_audits", "agent_runs", "agent_recommendations"]) {
  has(portalData, `.from("${table}")`, `Mobile parity must use the shared ${table} data.`);
}
for (const rpc of ["create_staff_invite", "system_readiness_snapshot", "run_operations_team"]) {
  has(portalData, `.rpc("${rpc}"`, `Mobile parity must reuse ${rpc}.`);
}
has(portal, "Create Staff Support Agent", "Staff provisioning UI must be present.");
has(portal, "Secure Automation", "Automation UI must be present.");
has(portal, "Readiness & Acceptance", "Readiness UI must be present.");
has(portal, "Run the operations team", "Operations Team UI must be present.");

for (const source of [portalData, webData]) {
  has(source, 'contact_source: "director_manual"', "Director edits must identify their source.");
  has(source, "contact_synced_at", "Director edits must persist a sync timestamp.");
  has(source, "phone_number", "BO phone must persist on the merchant record.");
  has(source, "account_number", "POS account must persist on the merchant record.");
}
has(tasks, "Edit BO details", "Mobile daily tasks must expose BO detail editing.");
has(tasks, "future Amina assignments", "Mobile must explain future Amina reuse.");
has(webTasks, "Edit BO details", "Web daily tasks must expose BO detail editing.");
has(webTasks, "Amina will include them", "Web must explain future Amina reuse.");

console.log("Phase 4 mobile parity and shared BO-contact acceptance checks passed.");
