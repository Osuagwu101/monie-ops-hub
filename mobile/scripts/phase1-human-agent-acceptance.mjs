import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const agentLib = readFileSync(resolve(cwd, "src/lib/agent-workspace.ts"), "utf8");
const agentUi = readFileSync(resolve(cwd, "src/components/AgentWorkspace.tsx"), "utf8");
const app = readFileSync(resolve(cwd, "App.tsx"), "utf8");
const webAssistant = readFileSync(resolve(cwd, "../src/lib/assistant-data.ts"), "utf8");

const has = (source, text, message) => assert.ok(source.includes(text), message);

has(agentLib, '.from("tasks")', "Assistant must read the shared tasks table.");
has(agentLib, '.rpc("set_my_task_status"', "Assistant start action must use the existing start RPC.");
has(agentLib, 'p_status: "in_progress"', "Start RPC must set in_progress.");
has(
  agentLib,
  '.rpc("submit_my_task_outcome"',
  "Outcome submission must use the existing audited outcome RPC.",
);

has(agentUi, "Phone number not available", "Missing phone number must render safely.");
has(agentUi, "POS account not available", "Missing POS account number must render safely.");
has(agentUi, "Linking.openURL(`tel:${dialable}`)", "Stored valid phone must open the native dialer.");
has(agentLib, "dialablePhoneNumber", "Phone values must be validated before enabling Call.");

has(app, 'profile.role === "assistant"', "Active assistants must route into the human-agent workspace.");
has(app, "<AgentWorkspace", "Assistant mobile workspace must be mounted.");
has(
  app,
  'currentProfile.role !== "director"',
  "Assistant profile load must stop before Director-only mobile datasets are requested.",
);

for (const sharedName of ["tasks", "set_my_task_status", "submit_my_task_outcome"]) {
  has(agentLib, sharedName, `Mobile must reuse shared ${sharedName}.`);
  has(webAssistant, sharedName, `Web source must use shared ${sharedName}.`);
}

for (const stateText of [
  "Loading your assigned work",
  "No assigned tasks",
  "Something needs attention",
  "Retry",
  "Your session expired. Sign in again.",
  "Signed out successfully.",
]) {
  assert.ok(
    agentUi.includes(stateText) || app.includes(stateText),
    `Missing required state: ${stateText}`,
  );
}

assert.ok(
  !agentLib.includes("portfolio_performance_snapshots") &&
    !agentLib.includes("performance_scorecards") &&
    !agentLib.includes("agent_recommendations") &&
    !agentLib.includes("meeting_occurrences"),
  "Assistant data helper must not query Director-only mobile datasets.",
);

console.log("Phase 1 mobile human-agent acceptance checks passed.");
