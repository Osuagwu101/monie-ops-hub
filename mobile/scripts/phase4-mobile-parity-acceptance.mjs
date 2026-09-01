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
for (const group of ["WORKSPACE", "OPERATIONS", "ADMINISTRATION", "ACCOUNT"]) {
  has(app, `label: "${group}"`, `Grouped Workspace navigation must include ${group}.`);
}
has(app, "DIRECTOR_MENU_GROUPS", "The mobile menu must use the approved Grouped Workspace structure.");
has(app, "directorOnly: true", "Administration must be explicitly Director-only.");
has(app, '!group.directorOnly || isDirector', "Director-only groups must be filtered by authenticated role.");
has(app, 'isDirector && section === "staff"', "Staff Accounts must be mounted only for Directors.");
has(app, 'isDirector && section === "automation"', "Automation must be mounted only for Directors.");
has(app, 'isDirector && section === "readiness"', "Readiness must be mounted only for Directors.");
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
has(tasks, "if (!canEditContacts) return", "Mobile BO editing must be blocked outside Director sessions.");
has(app, "canEditContacts={isDirector}", "Authenticated Director state must control mobile BO editing.");
has(tasks, "future Amina assignments", "Mobile must explain future Amina reuse.");
has(webTasks, "Edit BO details", "Web daily tasks must expose BO detail editing.");
has(webTasks, "Amina will include them", "Web must explain future Amina reuse.");
has(webTasks, 'profile?.role === "director"', "Web BO editing must be visible only to Directors.");
has(webTasks, "canEditContacts && task.merchant_id", "Web queue edit controls must enforce the Director role gate.");

console.log("Phase 4 mobile parity and shared BO-contact acceptance checks passed.");
