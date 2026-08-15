import { supabase } from "./supabase";

export interface PortfolioSnapshot {
  report_date: string;
  terminal_activity_rate: number;
  top_bo_retention_rate: number | null;
  total_terminal_count: number | null;
  assigned_terminal_count: number | null;
  active_terminal_count: number | null;
  rolling_target_met_count: number | null;
}

export interface MobileTaskSummary {
  id: string;
  task_date: string;
  task_type: "TA" | "LOAN" | "FOLLOW_UP";
  status: string;
  priority: number;
  queue_rank: number | null;
  reason: string;
  merchant_id: string | null;
  terminal_id: string | null;
  merchant?: {
    business_name: string;
    phone_number: string | null;
    account_number: string | null;
  };
  terminal?: {
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
}

export interface MobileScorecard {
  id: string;
  score_date: string;
  subject_kind: string;
  subject_key: string;
  team_performance_percent: number;
  individual_score_percent: number;
  management_mode: string;
  rating: string;
  amina_message: string;
}

export interface MobileAgentRecommendation {
  id: string;
  agent_kind: "amina" | "emeka" | "zainab" | "tunde";
  recommendation_kind: string;
  title: string;
  rationale: string;
  score: number | null;
  status: string;
  created_at: string;
}

export interface MobileOperationsSnapshot {
  portfolio: PortfolioSnapshot | null;
  todayTasks: MobileTaskSummary[];
  scorecards: MobileScorecard[];
  recommendations: MobileAgentRecommendation[];
}

export async function loadOperationsSnapshot(): Promise<MobileOperationsSnapshot> {
  const today = lagosDateKey();
  const [portfolioResult, tasksResult, scorecardsResult, recommendationsResult] = await Promise.all([
    supabase
      .from("portfolio_performance_snapshots")
      .select(
        "report_date,terminal_activity_rate,top_bo_retention_rate,total_terminal_count,assigned_terminal_count,active_terminal_count,rolling_target_met_count",
      )
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id,task_date,task_type,status,priority,queue_rank,reason,merchant_id,terminal_id")
      .eq("task_date", today)
      .order("queue_rank", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(15),
    supabase
      .from("performance_scorecards")
      .select(
        "id,score_date,subject_kind,subject_key,team_performance_percent,individual_score_percent,management_mode,rating,amina_message",
      )
      .order("score_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(8),
    supabase
      .from("agent_recommendations")
      .select("id,agent_kind,recommendation_kind,title,rationale,score,status,created_at")
      .in("status", ["open", "accepted"])
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const firstError =
    portfolioResult.error ??
    tasksResult.error ??
    scorecardsResult.error ??
    recommendationsResult.error;
  if (firstError) throw firstError;

  const taskRows = (tasksResult.data ?? []) as MobileTaskSummary[];
  const merchantIds = unique(taskRows.map((task) => task.merchant_id));
  const terminalIds = unique(taskRows.map((task) => task.terminal_id));

  const [merchantResult, terminalResult, weeklyResult] = await Promise.all([
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
  ]);

  const contextError = merchantResult.error ?? terminalResult.error ?? weeklyResult.error;
  if (contextError) throw contextError;

  const merchantMap = new Map(
    (merchantResult.data ?? []).map((merchant) => [merchant.id, merchant] as const),
  );
  const terminalMap = new Map(
    (terminalResult.data ?? []).map((terminal) => [terminal.id, terminal] as const),
  );
  const weeklyMap = new Map<string, NonNullable<MobileTaskSummary["weekly"]>>();
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

  const tasks = taskRows.map((task) => ({
    ...task,
    merchant: task.merchant_id ? merchantMap.get(task.merchant_id) : undefined,
    terminal: task.terminal_id ? terminalMap.get(task.terminal_id) : undefined,
    weekly: task.terminal_id ? weeklyMap.get(task.terminal_id) : undefined,
  }));

  return {
    portfolio: (portfolioResult.data as PortfolioSnapshot | null) ?? null,
    todayTasks: tasks,
    scorecards: (scorecardsResult.data ?? []) as MobileScorecard[],
    recommendations: (recommendationsResult.data ?? []) as MobileAgentRecommendation[],
  };
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function lagosDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}
