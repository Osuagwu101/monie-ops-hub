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
      .select("id,task_date,task_type,status,priority,queue_rank,reason")
      .eq("task_date", today)
      .order("queue_rank", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(12),
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

  return {
    portfolio: (portfolioResult.data as PortfolioSnapshot | null) ?? null,
    todayTasks: (tasksResult.data ?? []) as MobileTaskSummary[],
    scorecards: (scorecardsResult.data ?? []) as MobileScorecard[],
    recommendations: (recommendationsResult.data ?? []) as MobileAgentRecommendation[],
  };
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
