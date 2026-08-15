import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Award,
  Bot,
  CheckCircle2,
  Crown,
  Gauge,
  ShieldAlert,
  Sparkles,
  UserRound,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  loadCompensationRecommendations,
  loadManagementConfig,
  loadPerformanceScorecards,
  reviewCompensationRecommendation,
  type CompensationRecommendationRecord,
  type ManagementMode,
  type PerformanceScorecardRecord,
  type PerformanceSubjectKind,
} from "@/lib/performance-data";

interface AminaPerformancePanelProps {
  assistantId: string;
  accessToken: string;
  isDirector: boolean;
  compact?: boolean;
}

const subjectMeta: Record<
  PerformanceSubjectKind,
  { label: string; role: string; icon: typeof UserRound }
> = {
  assistant: {
    label: "Human Operations Assistant",
    role: "Field Voice & Relationship Partner",
    icon: UserRound,
  },
  emeka: { label: "Emeka Nwosu", role: "TA & Merchant Growth", icon: Bot },
  zainab: { label: "Zainab Aliyu", role: "SME Lending", icon: Bot },
  tunde: { label: "Tunde Bakare", role: "Audit & Verification", icon: Bot },
};

export function AminaPerformancePanel({
  assistantId,
  accessToken,
  isDirector,
  compact = false,
}: AminaPerformancePanelProps) {
  const queryClient = useQueryClient();
  const scorecardsQuery = useQuery({
    queryKey: ["performance-scorecards", assistantId],
    queryFn: () => loadPerformanceScorecards(assistantId, accessToken),
    enabled: Boolean(assistantId && accessToken),
    refetchInterval: 60_000,
  });
  const configQuery = useQuery({
    queryKey: ["management-config"],
    queryFn: () => loadManagementConfig(accessToken),
    enabled: Boolean(accessToken),
  });
  const recommendationsQuery = useQuery({
    queryKey: ["compensation-recommendations", assistantId],
    queryFn: () => loadCompensationRecommendations(assistantId, accessToken),
    enabled: Boolean(assistantId && accessToken),
    refetchInterval: 60_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected" | "cancelled";
    }) => reviewCompensationRecommendation(id, status, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["compensation-recommendations", assistantId],
      });
    },
  });

  const latestBySubject = useMemo(() => {
    const map = new Map<PerformanceSubjectKind, PerformanceScorecardRecord>();
    for (const scorecard of scorecardsQuery.data ?? []) {
      if (!map.has(scorecard.subject_kind)) map.set(scorecard.subject_kind, scorecard);
    }
    return map;
  }, [scorecardsQuery.data]);

  const assistantScore = latestBySubject.get("assistant");
  const config = configQuery.data;
  const streak = useMemo(() => {
    if (!config) return 0;
    const history = (scorecardsQuery.data ?? []).filter(
      (scorecard) => scorecard.subject_kind === "assistant",
    );
    let count = 0;
    for (const scorecard of history) {
      if (
        scorecard.individual_score_percent >= config.bonus_threshold_percent &&
        (scorecard.team_performance_percent ?? 0) >= config.bonus_threshold_percent
      ) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }, [config, scorecardsQuery.data]);

  const recommendations = recommendationsQuery.data ?? [];
  const pendingRecommendations = recommendations.filter(
    (recommendation) => recommendation.status === "pending_director",
  );

  if (scorecardsQuery.isLoading || configQuery.isLoading) {
    return (
      <Card>
        <CardContent className="flex min-h-36 items-center justify-center text-sm text-muted-foreground">
          Loading Amina's performance management…
        </CardContent>
      </Card>
    );
  }

  if (!assistantScore || !config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-primary" /> Amina — Level 2 Manager
          </CardTitle>
          <CardDescription>Individual scorecards begin after an official report and team run.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No performance scorecard exists yet. Amina will score the Human Assistant and specialist
            agents from official evidence once report-backed operations are running.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" /> My performance
              </CardTitle>
              <CardDescription>Amina's evidence-backed personal score, separate from team performance.</CardDescription>
            </div>
            <ManagementModeBadge mode={assistantScore.management_mode} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <ScoreMiniStat label="My score" value={`${assistantScore.individual_score_percent}%`} />
            <ScoreMiniStat
              label="Team performance"
              value={
                assistantScore.team_performance_percent === null
                  ? "—"
                  : `${assistantScore.team_performance_percent}%`
              }
            />
            <ScoreMiniStat label="Amina rating" value={humanize(assistantScore.rating)} />
          </div>
          <AminaMessage scorecard={assistantScore} />
          <BonusProgress
            streak={streak}
            requiredDays={config.bonus_streak_days}
            threshold={config.bonus_threshold_percent}
            bonusPercent={config.bonus_percent}
          />
          {pendingRecommendations.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Amina has {pendingRecommendations.length} recommendation(s) pending</AlertTitle>
              <AlertDescription>
                You can see the recommendation, but only the Director can approve or reject a
                financial consequence or reward.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Crown className="h-5 w-5 text-primary" /> Amina Bello — Level 2 Operations Manager
              </CardTitle>
              <CardDescription className="mt-1 max-w-3xl leading-6">
                Amina changes management style with the evidence: supportive when standards are
                sustained, firm when performance slips, and uncompromising when measurable work is
                failing.
              </CardDescription>
            </div>
            <ManagementModeBadge mode={assistantScore.management_mode} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ScoreMiniStat
              label="Team performance"
              value={
                assistantScore.team_performance_percent === null
                  ? "—"
                  : `${assistantScore.team_performance_percent}%`
              }
            />
            <ScoreMiniStat
              label="Human Assistant"
              value={`${assistantScore.individual_score_percent}%`}
            />
            <ScoreMiniStat label="Warning line" value={`< ${config.management_warning_threshold_percent}%`} />
            <ScoreMiniStat label="Penalty review" value={`< ${config.penalty_trigger_percent}%`} />
          </div>
          <AminaMessage scorecard={assistantScore} />
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <BonusProgress
              streak={streak}
              requiredDays={config.bonus_streak_days}
              threshold={config.bonus_threshold_percent}
              bonusPercent={config.bonus_percent}
            />
            <div className="rounded-lg border p-4 text-sm leading-6 text-muted-foreground">
              <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <ShieldAlert className="h-4 w-4 text-primary" /> Financial-control rule
              </div>
              Amina may recommend a warning, penalty review or bonus. A recommendation is recorded
              and auditable, but it does not deduct or add money automatically. The Director decides
              whether to enforce it.
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(["assistant", "emeka", "zainab", "tunde"] as PerformanceSubjectKind[]).map((subject) => (
          <PerformanceCard
            key={subject}
            subject={subject}
            scorecard={latestBySubject.get(subject)}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" /> Warnings, penalties & rewards
          </CardTitle>
          <CardDescription>
            Below 72% can trigger a penalty review only when the team and the Human Assistant's own
            attributable score are both below the benchmark. Bonus eligibility defaults to the 77%
            Sacred Standard for {config.bonus_streak_days} consecutive report days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recommendationsQuery.isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading recommendations…</div>
          ) : recommendations.length ? (
            <div className="space-y-3">
              {recommendations.slice(0, 12).map((recommendation) => (
                <RecommendationDecision
                  key={recommendation.id}
                  recommendation={recommendation}
                  isDirector={isDirector}
                  busy={reviewMutation.isPending}
                  onReview={(status) =>
                    reviewMutation.mutate({ id: recommendation.id, status })
                  }
                />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No performance warning, penalty review or bonus recommendation has been created yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PerformanceCard({
  subject,
  scorecard,
}: {
  subject: PerformanceSubjectKind;
  scorecard: PerformanceScorecardRecord | undefined;
}) {
  const meta = subjectMeta[subject];
  const Icon = meta.icon;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="h-4 w-4 text-primary" /> {meta.label}
            </CardTitle>
            <CardDescription className="mt-1">{meta.role}</CardDescription>
          </div>
          {scorecard && <ManagementModeBadge mode={scorecard.management_mode} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {scorecard ? (
          <>
            <div className="text-3xl font-bold tracking-tight">
              {scorecard.individual_score_percent}%
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{humanize(scorecard.rating)}</Badge>
              <Badge variant="outline">{scorecard.score_date}</Badge>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{scorecard.amina_message}</p>
          </>
        ) : (
          <div className="py-4 text-sm text-muted-foreground">No score available yet.</div>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationDecision({
  recommendation,
  isDirector,
  busy,
  onReview,
}: {
  recommendation: CompensationRecommendationRecord;
  isDirector: boolean;
  busy: boolean;
  onReview: (status: "approved" | "rejected") => void;
}) {
  const isPenalty = recommendation.recommendation_type === "penalty_review";
  const isBonus = recommendation.recommendation_type === "bonus";
  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isPenalty ? "default" : isBonus ? "secondary" : "outline"}>
              {humanize(recommendation.recommendation_type)}
            </Badge>
            <Badge variant="outline">{humanize(recommendation.status)}</Badge>
            {recommendation.recommendation_percent !== null && (
              <Badge variant="secondary">{recommendation.recommendation_percent}%</Badge>
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{recommendation.rationale}</p>
          <div className="mt-1 text-xs text-muted-foreground">
            Period {recommendation.period_start} → {recommendation.period_end}
          </div>
        </div>
        {isDirector && recommendation.status === "pending_director" && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => onReview("approved")} disabled={busy}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReview("rejected")}
              disabled={busy}
            >
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function BonusProgress({
  streak,
  requiredDays,
  threshold,
  bonusPercent,
}: {
  streak: number;
  requiredDays: number;
  threshold: number;
  bonusPercent: number;
}) {
  const progress = Math.min(100, (streak / requiredDays) * 100);
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-primary" /> Bonus track
        </div>
        <Badge variant="outline">
          {streak}/{requiredDays} days
        </Badge>
      </div>
      <Progress value={progress} className="mt-3" />
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Maintain both team and personal performance at or above {threshold}% for {requiredDays}
        consecutive report days for Amina to recommend a {bonusPercent}% performance bonus.
      </p>
    </div>
  );
}

function AminaMessage({ scorecard }: { scorecard: PerformanceScorecardRecord }) {
  return (
    <Alert variant={scorecard.management_mode === "critical" ? "destructive" : "default"}>
      {scorecard.management_mode === "supportive" ? (
        <Gauge className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      <AlertTitle>Amina — {humanize(scorecard.management_mode)} mode</AlertTitle>
      <AlertDescription>{scorecard.amina_message}</AlertDescription>
    </Alert>
  );
}

function ManagementModeBadge({ mode }: { mode: ManagementMode }) {
  return (
    <Badge variant={mode === "critical" || mode === "very_strict" ? "default" : "secondary"}>
      {humanize(mode)}
    </Badge>
  );
}

function ScoreMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
