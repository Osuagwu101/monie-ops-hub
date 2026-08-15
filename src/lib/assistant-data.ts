import { callRpc, restSelect } from "@/lib/cloud-api";
import type { TaskStatus, TaskType } from "@/domain/models";

export type TaskOutcomeCode =
  | "reached_commitment"
  | "reached_no_commitment"
  | "callback_requested"
  | "no_answer"
  | "merchant_busy"
  | "terminal_issue"
  | "merchant_declined"
  | "loan_interest"
  | "escalation_required";

export interface AssistantProfile {
  id: string;
  full_name: string;
  role: "director" | "assistant";
  is_active: boolean;
}

export interface AssistantTask {
  id: string;
  task_date: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: number;
  merchant_id: string | null;
  terminal_id: string | null;
  reason: string;
  recommended_talking_points: string | null;
  due_at: string | null;
  rolled_from_task_id: string | null;
  created_at: string;
  merchant?:
    | {
        id: string;
        business_name: string;
        phone_number: string | null;
      }
    | undefined;
  terminal?:
    | {
        id: string;
        terminal_id: string;
        serial_number: string | null;
      }
    | undefined;
  latestOutcome?:
    | {
        outcome_code: TaskOutcomeCode | null;
        postponement_reason: string | null;
        callback_at: string | null;
        notes: string | null;
        submitted_at: string;
        attempt_number: number;
      }
    | undefined;
  verification?:
    | {
        state: "verified" | "discrepancy" | "deferred" | "unverifiable";
        rationale: string;
        verified_at: string;
      }
    | undefined;
}

export interface SubmitOutcomeInput {
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

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function loadAssistantProfile(userId: string, accessToken: string) {
  const rows = await restSelect<AssistantProfile[]>(
    `profiles?select=id,full_name,role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`,
    accessToken,
  );
  return rows[0] ?? null;
}

export async function loadAssistantTasks(date: string, accessToken: string) {
  const tasks = await restSelect<AssistantTask[]>(
    `tasks?select=id,task_date,task_type,status,priority,merchant_id,terminal_id,reason,recommended_talking_points,due_at,rolled_from_task_id,created_at&task_date=eq.${encodeURIComponent(date)}&order=priority.desc,created_at.asc`,
    accessToken,
  );

  if (!tasks.length) return tasks;

  const merchantIds = [
    ...new Set(tasks.map((task) => task.merchant_id).filter(Boolean)),
  ] as string[];
  const terminalIds = [
    ...new Set(tasks.map((task) => task.terminal_id).filter(Boolean)),
  ] as string[];
  const taskIds = tasks.map((task) => task.id);

  const [merchants, terminals, outcomes, verifications] = await Promise.all([
    merchantIds.length
      ? restSelect<Array<{ id: string; business_name: string; phone_number: string | null }>>(
          `merchants?select=id,business_name,phone_number&id=${encodeURIComponent(inFilter(merchantIds))}`,
          accessToken,
        )
      : Promise.resolve([]),
    terminalIds.length
      ? restSelect<Array<{ id: string; terminal_id: string; serial_number: string | null }>>(
          `terminals?select=id,terminal_id,serial_number&id=${encodeURIComponent(inFilter(terminalIds))}`,
          accessToken,
        )
      : Promise.resolve([]),
    restSelect<
      Array<{
        task_id: string;
        outcome_code: TaskOutcomeCode | null;
        postponement_reason: string | null;
        callback_at: string | null;
        notes: string | null;
        submitted_at: string;
        attempt_number: number;
      }>
    >(
      `task_outcomes?select=task_id,outcome_code,postponement_reason,callback_at,notes,submitted_at,attempt_number&task_id=${encodeURIComponent(inFilter(taskIds))}&order=submitted_at.desc`,
      accessToken,
    ),
    restSelect<
      Array<{
        task_id: string;
        state: "verified" | "discrepancy" | "deferred" | "unverifiable";
        rationale: string;
        verified_at: string;
      }>
    >(
      `task_verifications?select=task_id,state,rationale,verified_at&task_id=${encodeURIComponent(inFilter(taskIds))}&order=verified_at.desc`,
      accessToken,
    ),
  ]);

  const merchantMap = new Map(merchants.map((merchant) => [merchant.id, merchant]));
  const terminalMap = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const outcomeMap = new Map<string, (typeof outcomes)[number]>();
  const verificationMap = new Map<string, (typeof verifications)[number]>();

  outcomes.forEach((outcome) => {
    if (!outcomeMap.has(outcome.task_id)) outcomeMap.set(outcome.task_id, outcome);
  });
  verifications.forEach((verification) => {
    if (!verificationMap.has(verification.task_id)) {
      verificationMap.set(verification.task_id, verification);
    }
  });

  return tasks.map((task) => ({
    ...task,
    merchant: task.merchant_id ? merchantMap.get(task.merchant_id) : undefined,
    terminal: task.terminal_id ? terminalMap.get(task.terminal_id) : undefined,
    latestOutcome: outcomeMap.get(task.id),
    verification: verificationMap.get(task.id),
  }));
}

export async function startAssistantTask(taskId: string, accessToken: string) {
  return callRpc<AssistantTask>(
    "set_my_task_status",
    { p_task_id: taskId, p_status: "in_progress" },
    accessToken,
  );
}

export async function submitAssistantOutcome(input: SubmitOutcomeInput, accessToken: string) {
  return callRpc<AssistantTask>(
    "submit_my_task_outcome",
    {
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
    },
    accessToken,
  );
}
