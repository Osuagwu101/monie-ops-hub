import { callRpc, restSelect } from "@/lib/cloud-api";
import type { AssistantProfile } from "@/lib/assistant-data";
import type { TaskType } from "@/domain/models";

export type AgentKind = "amina" | "emeka" | "zainab" | "tunde";
export type AgentRecommendationKind =
  | "ta_priority"
  | "loan_opportunity"
  | "relationship_follow_up"
  | "verification_attention"
  | "operations_brief";
export type OperationalState =
  "healthy" | "watch" | "at_risk" | "critical" | "recovery_in_progress";

export interface AgentRunRecord {
  id: string;
  agent_kind: AgentKind;
  report_id: string | null;
  plan_date: string;
  assistant_id: string | null;
  status: "running" | "completed" | "failed";
  input_snapshot: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface AgentRecommendationRecord {
  id: string;
  run_id: string;
  agent_kind: AgentKind;
  recommendation_kind: AgentRecommendationKind;
  plan_date: string;
  report_id: string | null;
  assigned_to: string | null;
  merchant_id: string | null;
  terminal_id: string | null;
  evidence_snapshot_id: string | null;
  score: number | null;
  operational_state: OperationalState | null;
  title: string;
  rationale: string;
  talking_points: string | null;
  suggested_task_type: TaskType | null;
  status: "open" | "accepted" | "dismissed" | "superseded";
  evidence: Record<string, unknown>;
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
}

export interface AgentAuditEvent {
  id: number;
  occurred_at: string;
  actor_kind: AgentKind | "director" | "assistant" | "system";
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
}

export interface RunOperationsTeamResult {
  reportId: string;
  reportDate: string;
  planDate: string;
  assistantId: string;
  assistantName: string;
  runs: Record<AgentKind, string>;
  emekaPriorities: number;
  zainabCandidates: number;
  tundeAttentionItems: number;
  monthlySuccessfulLoansRecorded: number;
  contactGaps: number;
  dailyCallTarget: number;
  totalCalls: number;
  taCalls: number;
  nonTaCalls: number;
  taShare: number;
  taMinCalls: number;
  taMaxCalls: number;
  mixCompliant: boolean;
  replacedUntouchedAutoTasks: number;
  briefRecommendationId: string;
}

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

function assistantFilter(assistantId?: string | null) {
  return assistantId ? `&assistant_id=eq.${encodeURIComponent(assistantId)}` : "";
}

export async function loadActiveAssistants(accessToken: string) {
  return restSelect<AssistantProfile[]>(
    "profiles?select=id,full_name,role,is_active&role=eq.assistant&is_active=eq.true&order=full_name.asc",
    accessToken,
  );
}

export async function loadAgentRuns(accessToken: string, assistantId?: string | null, limit = 24) {
  return restSelect<AgentRunRecord[]>(
    `agent_runs?select=id,agent_kind,report_id,plan_date,assistant_id,status,input_snapshot,output_summary,created_at,completed_at${assistantFilter(assistantId)}&order=created_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function loadAgentRecommendations(
  planDate: string,
  accessToken: string,
  assistantId?: string | null,
  limit = 60,
) {
  const assignedTo = assistantId ? `&assigned_to=eq.${encodeURIComponent(assistantId)}` : "";
  const rows = await restSelect<AgentRecommendationRecord[]>(
    `agent_recommendations?select=id,run_id,agent_kind,recommendation_kind,plan_date,report_id,assigned_to,merchant_id,terminal_id,evidence_snapshot_id,score,operational_state,title,rationale,talking_points,suggested_task_type,status,evidence,created_at&plan_date=eq.${encodeURIComponent(planDate)}${assignedTo}&status=in.(open,accepted)&order=score.desc.nullslast,created_at.desc&limit=${limit}`,
    accessToken,
  );

  const merchantIds = [...new Set(rows.map((row) => row.merchant_id).filter(Boolean))] as string[];
  const terminalIds = [...new Set(rows.map((row) => row.terminal_id).filter(Boolean))] as string[];

  const [merchants, terminals] = await Promise.all([
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
  ]);

  const merchantMap = new Map(merchants.map((merchant) => [merchant.id, merchant]));
  const terminalMap = new Map(terminals.map((terminal) => [terminal.id, terminal]));

  return rows.map((row) => ({
    ...row,
    merchant: row.merchant_id ? merchantMap.get(row.merchant_id) : undefined,
    terminal: row.terminal_id ? terminalMap.get(row.terminal_id) : undefined,
  }));
}

export async function loadAgentAuditEvents(accessToken: string, limit = 40) {
  return restSelect<AgentAuditEvent[]>(
    `audit_events?select=id,occurred_at,actor_kind,event_type,entity_type,entity_id,payload&actor_kind=in.(amina,emeka,zainab,tunde)&order=occurred_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function runOperationsTeam(
  assistantId: string,
  planDate: string,
  accessToken: string,
  reportId: string | null = null,
) {
  return callRpc<RunOperationsTeamResult>(
    "run_operations_team",
    {
      p_assistant_id: assistantId,
      p_plan_date: planDate,
      p_report_id: reportId,
    },
    accessToken,
  );
}
