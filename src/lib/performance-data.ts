import { callRpc, restSelect } from "@/lib/cloud-api";

export type ManagementMode = "supportive" | "firm" | "strict" | "very_strict" | "critical";
export type PerformanceRating =
  "excellent" | "strong" | "acceptable" | "watch" | "underperforming" | "critical";
export type PerformanceSubjectKind = "assistant" | "emeka" | "zainab" | "tunde";
export type CompensationRecommendationType =
  "performance_warning" | "improvement_plan" | "penalty_review" | "bonus" | "recognition";
export type CompensationRecommendationStatus =
  "pending_director" | "approved" | "rejected" | "cancelled";

export interface PerformanceScorecardRecord {
  id: string;
  report_id: string;
  score_date: string;
  subject_kind: PerformanceSubjectKind;
  subject_key: string;
  subject_user_id: string | null;
  scope_assistant_id: string;
  team_performance_percent: number | null;
  individual_score_percent: number;
  management_mode: ManagementMode;
  rating: PerformanceRating;
  amina_message: string;
  evidence: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CompensationRecommendationRecord {
  id: string;
  assistant_id: string;
  scorecard_id: string | null;
  recommendation_type: CompensationRecommendationType;
  recommendation_percent: number | null;
  period_start: string;
  period_end: string;
  rationale: string;
  evidence: Record<string, unknown>;
  status: CompensationRecommendationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  director_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManagementConfigRecord {
  company_target_percent: number;
  team_standard_percent: number;
  management_warning_threshold_percent: number;
  penalty_trigger_percent: number;
  critical_threshold_percent: number;
  bonus_threshold_percent: number;
  bonus_streak_days: number;
  bonus_percent: number;
}

export interface RefreshManagementScoresResult {
  reportId: string;
  scoreDate: string;
  teamPerformancePercent: number | null;
  assistantScorePercent: number;
  managementMode: ManagementMode;
  rating: PerformanceRating;
  emekaScorePercent: number;
  zainabScorePercent: number;
  tundeScorePercent: number;
  bonusThresholdPercent: number;
  bonusStreakDays: number;
  bonusPercent: number;
}

export async function loadManagementConfig(accessToken: string) {
  const rows = await restSelect<ManagementConfigRecord[]>(
    "operating_config?select=company_target_percent,team_standard_percent,management_warning_threshold_percent,penalty_trigger_percent,critical_threshold_percent,bonus_threshold_percent,bonus_streak_days,bonus_percent&id=eq.true&limit=1",
    accessToken,
  );
  return rows[0] ?? null;
}

export async function loadPerformanceScorecards(
  assistantId: string,
  accessToken: string,
  limit = 40,
) {
  return restSelect<PerformanceScorecardRecord[]>(
    `performance_scorecards?select=id,report_id,score_date,subject_kind,subject_key,subject_user_id,scope_assistant_id,team_performance_percent,individual_score_percent,management_mode,rating,amina_message,evidence,created_at,updated_at&scope_assistant_id=eq.${encodeURIComponent(assistantId)}&order=score_date.desc,created_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function loadMyPerformanceHistory(userId: string, accessToken: string, limit = 30) {
  return restSelect<PerformanceScorecardRecord[]>(
    `performance_scorecards?select=id,report_id,score_date,subject_kind,subject_key,subject_user_id,scope_assistant_id,team_performance_percent,individual_score_percent,management_mode,rating,amina_message,evidence,created_at,updated_at&subject_kind=eq.assistant&subject_user_id=eq.${encodeURIComponent(userId)}&order=score_date.desc,created_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function loadCompensationRecommendations(
  assistantId: string,
  accessToken: string,
  limit = 30,
) {
  return restSelect<CompensationRecommendationRecord[]>(
    `compensation_recommendations?select=id,assistant_id,scorecard_id,recommendation_type,recommendation_percent,period_start,period_end,rationale,evidence,status,reviewed_by,reviewed_at,director_note,created_at,updated_at&assistant_id=eq.${encodeURIComponent(assistantId)}&order=created_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function refreshManagementScores(
  assistantId: string,
  reportId: string,
  accessToken: string,
) {
  return callRpc<RefreshManagementScoresResult>(
    "refresh_amaina_management_scores",
    {
      p_assistant_id: assistantId,
      p_report_id: reportId,
    },
    accessToken,
  );
}

export async function reviewCompensationRecommendation(
  recommendationId: string,
  status: "approved" | "rejected" | "cancelled",
  accessToken: string,
  directorNote: string | null = null,
) {
  return callRpc<CompensationRecommendationRecord>(
    "review_compensation_recommendation",
    {
      p_recommendation_id: recommendationId,
      p_status: status,
      p_director_note: directorNote,
    },
    accessToken,
  );
}
