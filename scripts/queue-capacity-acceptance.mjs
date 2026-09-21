import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const agentData = readFileSync(resolve(root, "src/lib/agent-data.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202609210001_restore_15_contact_queue_capacity.sql"),
  "utf8",
);
const dbTest = readFileSync(
  resolve(root, "supabase/tests/amina_queue_capacity_regression_test.sql"),
  "utf8",
);
const dbWorkflow = readFileSync(
  resolve(root, ".github/workflows/database-tests.yml"),
  "utf8",
);

const has = (source, value, message) => assert.ok(source.includes(value), message);

has(
  agentData,
  '"run_operations_team_with_capacity"',
  "The Director Run Team action must use the capacity-safe RPC.",
);
has(
  migration,
  "daily_contact_capacity",
  "The database fix must use the configured contact capacity.",
);
has(
  migration,
  "ranked.position <= v_capacity",
  "The database fix must rank the full configured queue, not only seven items.",
);
has(
  migration,
  "'requiredTarget', 7",
  "The success target must remain seven.",
);
has(
  migration,
  "public.extend_human_support_queue",
  "The manual Run Team wrapper must restore fallback queue capacity.",
);
has(
  dbTest,
  "run_operations_team_with_capacity",
  "The database regression test must cover the capacity-safe wrapper.",
);
has(dbWorkflow, "supabase db reset", "CI must replay every migration from scratch.");
has(dbWorkflow, "supabase test db", "CI must execute the pgTAP database suite.");

console.log("15-contact queue / 7-success regression checks passed.");
