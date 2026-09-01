import { supabase } from "./supabase";

export type AgentTaskType = "TA" | "LOAN" | "FOLLOW_UP";

export type AgentTaskStatus =
  | "assigned"
  | "in_progress"
  | "postponed"
  | "completed"
  | "pending_verification"
  | "verified"
  | "discrepancy"
  | "deferred"
  | "unverifiable";

export type TaskOutcomeCode =
  | "reached_commitment"
  | "reached_no_commitment"
  | "callback_requested"
  | "no_answer"
  | "merchant_busy"
  | "terminal_issue"
  | "merchant_declined"
  | "loan_interest"
  | "loan_disbursed"
  | "escalation_required";

export interface AgentTask {
  id: string;
  task_date: string;
  task_type: AgentTaskType;
  status: AgentTaskStatus;
  priority: number;
  queue_rank: number | null;
  reason: string;
  recommended_talking_points: string | null;
  merchant_id: string | null;
  terminal_id: string | null;
  due_at: string | null;
  rolled_from_task_id: string | null;
  merchant?: {
    id: string;
    business_name: string;
    phone_number: string | null;
    account_number: string | null;
  };
  terminal?: {
    id: string;
    terminal_id: string;
    serial_number: string | null;
  };
  weekly?: {
    report_date: string;
    payment_value: number;
    transfer_value: number;
    official_target_value: number;
    official_target_met: boolean;
    days_since_last_transaction: number;
  };
  latestOutcome?: {
    outcome_code: TaskOutcomeCode | null;
    postponement_reason: string | null;
    callback_at: string | null;
    notes: string | null;
    submitted_at: string;
    attempt_number: number;
  };
}

export interface SubmitAgentOutcomeInput {
  taskId: string;
  outcomeCode: TaskOutcomeCode;
  finalStatus: "postponed" | "completed";
  reachedMerchant: boolean | null;
  commitmentReceived: boolean | null;
  expectedAmount: number | null;
  expectedBy: string | null;
  postponementReason: string | null;
  callbackAt: string | null;
  notes: string | null;
}

export interface AssignedMerchant {
  key: string;
  businessName: string;
  phoneNumber: string | null;
  accountNumber: string | null;
  terminalId: string | null;
  serialNumber: string | null;
  taskContexts: Array<{
    taskId: string;
    taskType: AgentTaskType;
    status: AgentTaskStatus;
    reason: string;
    queueRank: number | null;
  }>;
}

export const DAILY_REQUIRED_CONTACTS = 7;

export const FINISHED_TASK_STATES = new Set<AgentTaskStatus>([
  "completed",
  "pending_verification",
  "verified",
  "discrepancy",
  "deferred",
  "unverifiable",
]);

export const TASK_OUTCOME_OPTIONS: Array<{ value: TaskOutcomeCode; label: string }> = [
  { value: "reached_commitment", label: "Reached — commitment received" },
  { value: "reached_no_commitment", label: "Reached — no commitment" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "no_answer", label: "No answer" },
  { value: "merchant_busy", label: "Merchant busy" },
  { value: "terminal_issue", label: "Terminal issue identified" },
  { value: "merchant_declined", label: "Merchant declined" },
  { value: "loan_interest", label: "Loan interest" },
  { value: "loan_disbursed", label: "Loan disbursed — confirmed success" },
  { value: "escalation_required", label: "Escalation required" },
];

export async function loadAgentTasks(date = lagosDateKey()): Promise<AgentTask[]> {
  const { data: taskData, error: taskError } = await supabase
    .from("tasks")
    .select(
      "id,task_date,task_type,status,priority,queue_rank,reason,recommended_talking_points,merchant_id,terminal_id,due_at,rolled_from_task_id",
    )
    .eq("task_date", date)
    .order("queue_rank", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: false });

  if (taskError) throw taskError;

  const tasks = (taskData ?? []) as AgentTask[];
  if (!tasks.length) return tasks;

  const merchantIds = unique(tasks.map((task) => task.merchant_id));
  const terminalIds = unique(tasks.map((task) => task.terminal_id));
  const taskIds = tasks.map((task) => task.id);

  const [merchantResult, terminalResult, weeklyResult, outcomeResult] = await Promise.all([
    merchantIds.length
      ? supabase
          .from("merchants")
          .select("id,business_name,phone_number,account_number")
          .in("id", merchantIds)
      : Promise.resolve({ data: [], error: null }),
    terminalIds.length
      ? supabase.from("terminals").select("id,terminal_id,serial_number").in("id", terminalIds)
      : Promise.resolve({ data: [], error: null }),
    terminalIds.length
      ? supabase
          .from("terminal_performance_snapshots")
          .select(
            "terminal_id,report_date,payment_value,transfer_value,official_target_value,official_target_met,days_since_last_transaction",
          )
          .in("terminal_id", terminalIds)
          .eq("period_kind", "rolling_7_day")
          .order("report_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("task_outcomes")
      .select(
        "task_id,outcome_code,postponement_reason,callback_at,notes,submitted_at,attempt_number",
      )
      .in("task_id", taskIds)
      .order("submitted_at", { ascending: false }),
  ]);

  const contextError =
    merchantResult.error ?? terminalResult.error ?? weeklyResult.error ?? outcomeResult.error;
  if (contextError) throw contextError;

  const merchantMap = new Map(
    (merchantResult.data ?? []).map((merchant) => [merchant.id, merchant] as const),
  );
  const terminalMap = new Map(
    (terminalResult.data ?? []).map((terminal) => [terminal.id, terminal] as const),
  );
  const weeklyMap = new Map<string, NonNullable<AgentTask["weekly"]>>();
  for (const row of weeklyResult.data ?? []) {
    if (!weeklyMap.has(row.terminal_id)) {
      weeklyMap.set(row.terminal_id, {
        report_date: row.report_date,
        payment_value: Number(row.payment_value ?? 0),
        transfer_value: Number(row.transfer_value ?? 0),
        official_target_value: Number(row.official_target_value ?? 0),
        official_target_met: Boolean(row.official_target_met),
        days_since_last_transaction: Number(row.days_since_last_transaction ?? 0),
      });
    }
  }

  const outcomeMap = new Map<string, NonNullable<AgentTask["latestOutcome"]>>();
  for (const row of outcomeResult.data ?? []) {
    if (!outcomeMap.has(row.task_id)) {
      outcomeMap.set(row.task_id, {
        outcome_code: row.outcome_code as TaskOutcomeCode | null,
        postponement_reason: row.postponement_reason,
        callback_at: row.callback_at,
        notes: row.notes,
        submitted_at: row.submitted_at,
        attempt_number: row.attempt_number,
      });
    }
  }

  return tasks.map((task) => ({
    ...task,
    merchant: task.merchant_id ? merchantMap.get(task.merchant_id) : undefined,
    terminal: task.terminal_id ? terminalMap.get(task.terminal_id) : undefined,
    weekly: task.terminal_id ? weeklyMap.get(task.terminal_id) : undefined,
    latestOutcome: outcomeMap.get(task.id),
  }));
}

export async function startAgentTask(taskId: string) {
  const { data, error } = await supabase.rpc("set_my_task_status", {
    p_task_id: taskId,
    p_status: "in_progress",
  });
  if (error) throw error;
  return data;
}

export async function submitAgentOutcome(input: SubmitAgentOutcomeInput) {
  const { data, error } = await supabase.rpc("submit_my_task_outcome", {
    p_task_id: input.taskId,
    p_outcome_code: input.outcomeCode,
    p_final_status: input.finalStatus,
    p_reached_merchant: input.reachedMerchant,
    p_commitment_received: input.commitmentReceived,
    p_expected_amount: input.expectedAmount,
    p_expected_by: input.expectedBy,
    p_postponement_reason: input.postponementReason,
    p_callback_at: input.callbackAt,
    p_notes: input.notes,
  });
  if (error) throw error;
  return data;
}

export function buildAssignedMerchants(tasks: AgentTask[]): AssignedMerchant[] {
  const groups = new Map<string, AssignedMerchant>();

  for (const task of tasks) {
    const key = `${task.merchant_id ?? "merchant-missing"}:${task.terminal_id ?? "terminal-missing"}`;
    const existing = groups.get(key);
    const context = {
      taskId: task.id,
      taskType: task.task_type,
      status: task.status,
      reason: task.reason,
      queueRank: task.queue_rank,
    };

    if (existing) {
      existing.taskContexts.push(context);
      continue;
    }

    groups.set(key, {
      key,
      businessName: task.merchant?.business_name ?? "Assigned merchant",
      phoneNumber: nonBlank(task.merchant?.phone_number),
      accountNumber: nonBlank(task.merchant?.account_number),
      terminalId: nonBlank(task.terminal?.terminal_id),
      serialNumber: nonBlank(task.terminal?.serial_number),
      taskContexts: [context],
    });
  }

  return [...groups.values()];
}

export function dialablePhoneNumber(value: string | null | undefined) {
  const trimmed = nonBlank(value);
  if (!trimmed || !/^\+?[\d\s().-]+$/.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;

  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function reachedFromOutcome(outcome: TaskOutcomeCode) {
  if (outcome === "no_answer" || outcome === "merchant_busy") return false;
  if (
    outcome === "reached_commitment" ||
    outcome === "reached_no_commitment" ||
    outcome === "callback_requested" ||
    outcome === "merchant_declined" ||
    outcome === "loan_interest"
  ) {
    return true;
  }
  return null;
}

export function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function nonBlank(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
