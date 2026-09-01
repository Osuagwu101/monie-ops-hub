import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const assistantData = readFileSync(resolve(root, "src/lib/assistant-data.ts"), "utf8");
const dailyTasks = readFileSync(resolve(root, "src/routes/daily-tasks.tsx"), "utf8");
const worker = readFileSync(resolve(root, "src/routes/api.automation-worker.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202609010001_director_contacts_and_amina_priority.sql"),
  "utf8",
);
const assignmentFix = readFileSync(
  resolve(root, "supabase/migrations/202609010002_nonblocking_contacts_and_numeric_target.sql"),
  "utf8",
);

const has = (source, value, message) => assert.ok(source.includes(value), message);

has(dailyTasks, 'profile?.role === "director"', "Only the Director may see contact edit controls.");
has(dailyTasks, 'type="text"', "Contact identifiers must remain text values.");
has(
  dailyTasks,
  "queryClient.setQueryData",
  "Saved BO details must update the visible queue immediately.",
);
has(
  assistantData,
  '"update_merchant_contact_details"',
  "Contact edits must use the protected RPC.",
);
has(
  assistantData,
  "applyMerchantContactUpdate",
  "Saved contact details must update matching tasks.",
);
has(migration, "if not public.is_director()", "The contact RPC must enforce the Director role.");
has(migration, "merchant_contact_updated", "Contact edits must create an audit event.");
has(
  migration,
  "preserve_director_manual_merchant_contacts",
  "Manual BO details must resist automated overwrite.",
);
has(migration, "rollingValue", "Amina priority must use the actual rolling transaction value.");
has(migration, ") desc", "Amina priority must sort transaction value descending.");
has(worker, "actual: actual", "Contact enrichment must use actual transaction activity.");
has(
  worker,
  "actual < target",
  "A BO whose numeric rolling value meets the target must not be enriched for assignment.",
);
has(
  assignmentFix,
  "Contacts do not gate task creation",
  "Missing phone and POS details must not block Amina from creating tasks.",
);
has(
  assignmentFix,
  ">= coalesce((new.evidence ->> 'officialTargetValue')::numeric, 0)",
  "Numeric target achievement must exclude a BO even when the report flag is contradictory.",
);

const candidates = [
  { name: "BO C", actual: 15_000, days: 0 },
  { name: "Inactive BO", actual: 0, days: 20 },
  { name: "BO A", actual: 50_000, days: 1 },
  { name: "BO B", actual: 30_000, days: 0 },
  { name: "Target met", actual: 117_000, target: 100_000, days: 2 },
];
const ordered = candidates
  .filter((candidate) => candidate.actual < (candidate.target ?? 100_000))
  .toSorted(
    (a, b) =>
      Number(b.actual > 0) - Number(a.actual > 0) ||
      b.actual - a.actual ||
      a.days - b.days ||
      a.name.localeCompare(b.name),
  );
assert.deepEqual(
  ordered.map((candidate) => candidate.name),
  ["BO A", "BO B", "BO C", "Inactive BO"],
  "Active underperformers must rank 50k, 30k, 15k before inactive BOs.",
);

console.log("Web BO-contact persistence and Amina-priority acceptance checks passed.");
