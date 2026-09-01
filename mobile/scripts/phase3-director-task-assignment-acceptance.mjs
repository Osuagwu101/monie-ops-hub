import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const app = readFileSync(resolve(cwd, "App.tsx"), "utf8");
const ui = readFileSync(resolve(cwd, "src/components/DirectorTaskAssignment.tsx"), "utf8");
const data = readFileSync(resolve(cwd, "src/lib/director-task-assignment.ts"), "utf8");
const agent = readFileSync(resolve(cwd, "src/lib/agent-workspace.ts"), "utf8");
const phase2Ui = readFileSync(resolve(cwd, "src/components/DirectorOperations.tsx"), "utf8");
const models = readFileSync(resolve(cwd, "../src/domain/models.ts"), "utf8");
const foundation = readFileSync(resolve(cwd, "../supabase/migrations/202608150001_phase1_foundation.sql"), "utf8");

const has = (source, text, message) => assert.ok(source.includes(text), message);

has(app, '"assignments"', "Director section type must include assignments.");
has(app, 'label: "Daily Tasks"', "Director navigation must expose Daily Tasks.");
has(app, "<DirectorTaskAssignment", "Director Task Assignment section must be mounted.");
has(app, "directorId={profile.id}", "Assignment writes must carry the authenticated Director profile ID.");
has(app, 'profile.role === "assistant"', "Assistants must still route to the Phase 1 workspace.");
has(app, "<AgentWorkspace", "Phase 1 AgentWorkspace must remain intact.");
has(app, 'currentProfile.role !== "director"', "Director-only datasets must remain gated from assistants.");

for (const table of ["tasks", "profiles", "merchants", "terminals"]) {
  has(data, `.from("${table}")`, `Phase 3 must reuse existing ${table} data.`);
}
has(data, '.eq("role", "assistant")', "Assignment targets must be assistant profiles.");
has(data, '.eq("is_active", true)', "Only active assistants/businesses should be selectable.");
has(data, '.insert({', "New assignments must use the shared tasks table.");
has(data, '.update({ assigned_to: newAssistantId, queue_rank: null })', "Reassignment must update the shared task record.");
has(data, 'task.status !== "assigned"', "Started/completed work must not be reassigned from mobile.");
has(data, "ACTIVE_TASK_STATUSES", "Duplicate active assignments must be detected.");
has(data, "duplicate: true", "Duplicate submissions must return an explicit safe state.");
has(data, '../../../src/domain/models', "Phase 3 must reuse shared TaskType/TaskStatus definitions.");
has(models, 'export type TaskType = "TA" | "LOAN" | "FOLLOW_UP"', "Shared task type model must remain authoritative.");

has(foundation, "tasks_read_own_or_director", "Existing task RLS must preserve own-task/director reads.");
has(foundation, "tasks_director_create", "Existing RLS must authorize Director task creation.");
has(foundation, "tasks_director_manage", "Existing RLS must authorize Director task reassignment.");

for (const state of [
  "Loading today's Director task queue",
  "No tasks in today's queue",
  "Unable to load or save Director assignments",
  'title="Retry"',
  "Confirm task assignment",
  "Task assigned successfully",
  "Duplicate submission prevented",
]) {
  has(ui, state, `Phase 3 UI must include state: ${state}`);
}

has(ui, "Available businesses", "Director must be able to view available businesses.");
has(ui, "Assigned agent", "Task queue must show the assigned human agent.");
has(ui, "Reassign", "Task queue must expose safe reassignment for untouched tasks.");
has(ui, "Phone number not available", "Missing merchant phone data must remain explicit.");
has(ui, "POS account not available", "Missing merchant account data must remain explicit.");

for (const forbidden of ["Browser Use", "verification_challenge", "OTP", "ingest_moniepoint_report", "expo-notifications"]) {
  assert.ok(!data.includes(forbidden) && !ui.includes(forbidden), `Phase 3 must not add ${forbidden} behavior.`);
}

assert.ok(
  !agent.includes('.from("profiles")'),
  "Assistant Phase 1 helper must not gain Director profile-directory access.",
);

has(phase2Ui, "Official Reports", "Phase 2 report UI must remain present.");
has(phase2Ui, "Merchants & Terminals", "Phase 2 merchant/terminal UI must remain present.");

console.log("Phase 3 mobile Director task-assignment acceptance checks passed.");
