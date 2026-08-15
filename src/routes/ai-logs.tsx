import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Fingerprint,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  loadActiveAssistants,
  loadAgentAuditEvents,
  loadAgentRecommendations,
  loadAgentRuns,
  runOperationsTeam,
  type AgentKind,
  type AgentRecommendationRecord,
  type AgentRunRecord,
} from "@/lib/agent-data";
import { loadAssistantProfile, localDateKey } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/ai-logs")({
  head: () => ({
    meta: [
      { title: "Operations Team — Monie Ops Hub" },
      {
        name: "description",
        content: "Amina, Emeka, Zainab and Tunde operations intelligence and audit trail.",
      },
    ],
  }),
  component: OperationsTeamPage,
});

const agentMeta: Record<
  AgentKind,
  { name: string; role: string; purpose: string; boundary: string }
> = {
  amina: {
    name: "Amina Bello",
    role: "Operations Lead",
    purpose: "Builds and reprioritises the seven-call day from the shared evidence model.",
    boundary: "May organise work, but never marks a result Verified.",
  },
  emeka: {
    name: "Emeka Nwosu",
    role: "TA & Merchant Growth",
    purpose: "Ranks recovery opportunities using official rolling terminal performance.",
    boundary: "Internal risk scores never replace Moniepoint's official Target Met flag.",
  },
  zainab: {
    name: "Zainab Aliyu",
    role: "SME Lending",
    purpose: "Surfaces cautious lending conversations only after repeated inflow evidence.",
    boundary: "A recommendation is never a credit approval or promise of a loan.",
  },
  tunde: {
    name: "Tunde Bakare",
    role: "Audit & Verification",
    purpose: "Surfaces unresolved evidence states from official report reconciliation.",
    boundary: "Verification remains separate from human notes and AI recommendations.",
  },
};

function OperationsTeamPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [planDate, setPlanDate] = useState(localDateKey());
  const [selectedAssistantId, setSelectedAssistantId] = useState("");
  const accessToken = session?.access_token ?? "";

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, accessToken),
    enabled: Boolean(user?.id && accessToken),
  });
  const profile = profileQuery.data;
  const isDirector = profile?.role === "director";

  const assistantsQuery = useQuery({
    queryKey: ["active-assistants"],
    queryFn: () => loadActiveAssistants(accessToken),
    enabled: Boolean(isDirector && accessToken),
  });
  const assistants = assistantsQuery.data ?? [];
  const effectiveAssistantId = isDirector
    ? selectedAssistantId || assistants[0]?.id || ""
    : user?.id || "";

  const runsQuery = useQuery({
    queryKey: ["agent-runs", effectiveAssistantId],
    queryFn: () => loadAgentRuns(accessToken, effectiveAssistantId),
    enabled: Boolean(accessToken && effectiveAssistantId),
    refetchInterval: 60_000,
  });

  const recommendationsQuery = useQuery({
    queryKey: ["agent-recommendations", planDate, effectiveAssistantId],
    queryFn: () => loadAgentRecommendations(planDate, accessToken, effectiveAssistantId),
    enabled: Boolean(accessToken && effectiveAssistantId),
    refetchInterval: 60_000,
  });

  const auditQuery = useQuery({
    queryKey: ["agent-audit-events"],
    queryFn: () => loadAgentAuditEvents(accessToken),
    enabled: Boolean(isDirector && accessToken),
    refetchInterval: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: () => runOperationsTeam(effectiveAssistantId, planDate, accessToken),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agent-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-recommendations"] }),
        queryClient.invalidateQueries({ queryKey: ["agent-audit-events"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-tasks"] }),
      ]);
    },
  });

  const latestRuns = useMemo(() => {
    const map = new Map<AgentKind, AgentRunRecord>();
    for (const run of runsQuery.data ?? []) {
      if (!map.has(run.agent_kind)) map.set(run.agent_kind, run);
    }
    return map;
  }, [runsQuery.data]);

  const recommendations = recommendationsQuery.data ?? [];
  const brief = recommendations.find(
    (item) => item.agent_kind === "amina" && item.recommendation_kind === "operations_brief",
  );
  const result = runMutation.data;
  const runError = runMutation.error instanceof Error ? runMutation.error.message : null;

  if (profileQuery.isLoading) {
    return <LoadingState label="Loading the operations team…" />;
  }

  if (profileQuery.isError) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-4xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Unable to load Phase 4</AlertTitle>
        <AlertDescription>
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : "The secure profile request failed."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>Phase 4</Badge>
            <Badge variant="secondary">Team activated</Badge>
            <Badge variant="outline">Auditable orchestration</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Operations Team</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Amina, Emeka, Zainab and Tunde work over one secured data model. Specialist scores guide
            attention; official Moniepoint reporting remains the source of truth and human work
            remains attributable to the Human Operations Assistant.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <Clock3 className="h-4 w-4 text-primary" /> Plan date {planDate}
        </div>
      </section>

      {runError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Team run failed</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          {result.mixCompliant ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle>
            {result.mixCompliant ? "Amina's daily plan is ready" : "Amina produced a partial plan"}
          </AlertTitle>
          <AlertDescription>
            {result.totalCalls}/{result.dailyCallTarget} calls are ready: {result.taCalls} TA and{" "}
            {result.nonTaCalls} non-TA. Emeka found {result.emekaPriorities} TA priorities; Zainab
            found {result.zainabCandidates} responsible lending conversation candidates; Tunde has{" "}
            {result.tundeAttentionItems} evidence items needing attention. {result.contactGaps} TA
            priorities currently lack a phone number.
          </AlertDescription>
        </Alert>
      )}

      {isDirector && (
        <Card className="border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" /> Run the operations team
            </CardTitle>
            <CardDescription>
              Uses the latest successfully processed Moniepoint report. Re-running only replaces
              untouched Amina-generated tasks; started, completed and manually assigned work is
              kept.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[1fr_220px_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="assistant">Human Operations Assistant</Label>
              <select
                id="assistant"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={effectiveAssistantId}
                onChange={(event) => setSelectedAssistantId(event.target.value)}
                disabled={!assistants.length || runMutation.isPending}
              >
                {!assistants.length && <option value="">No active assistant account</option>}
                {assistants.map((assistant) => (
                  <option key={assistant.id} value={assistant.id}>
                    {assistant.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="planDate">Plan date</Label>
              <Input
                id="planDate"
                type="date"
                value={planDate}
                onChange={(event) => setPlanDate(event.target.value)}
                disabled={runMutation.isPending}
              />
            </div>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={!effectiveAssistantId || !planDate || runMutation.isPending}
            >
              {runMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Bot className="mr-2 h-4 w-4" />
              )}
              Run team
            </Button>
          </CardContent>
        </Card>
      )}

      {!isDirector && profile?.role === "assistant" && (
        <Alert>
          <UserRound className="h-4 w-4" />
          <AlertTitle>Your support team is evidence-limited</AlertTitle>
          <AlertDescription>
            You see recommendations connected to your work. Raw report imports, portfolio-wide
            source rows and Director controls remain hidden.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(agentMeta) as AgentKind[]).map((agent) => (
          <AgentCard key={agent} agent={agent} run={latestRuns.get(agent)} />
        ))}
      </div>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" /> Amina daily brief
            </CardTitle>
            <CardDescription>
              The 7-call target and TA mix are checked server-side, not inferred from the screen.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recommendationsQuery.isLoading ? (
              <LoadingState label="Loading Amina's brief…" compact />
            ) : brief ? (
              <AminaBrief recommendation={brief} />
            ) : (
              <EmptyState text="No Amina plan exists for this assistant and date yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Specialist recommendations</CardTitle>
            <CardDescription>
              Ranked operational signals with their evidence boundary visible.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recommendationsQuery.isLoading ? (
              <LoadingState label="Loading specialist recommendations…" compact />
            ) : recommendations.length ? (
              <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                {recommendations
                  .filter((item) => item.recommendation_kind !== "operations_brief")
                  .slice(0, 20)
                  .map((item) => (
                    <RecommendationRow key={item.id} recommendation={item} />
                  ))}
              </div>
            ) : (
              <EmptyState text="No specialist recommendations are available for this date." />
            )}
          </CardContent>
        </Card>
      </section>

      {isDirector && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-5 w-5 text-primary" /> Agent audit ledger
            </CardTitle>
            <CardDescription>
              Every team run is written to the same immutable-style operational event trail used by
              the rest of the portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <LoadingState label="Loading agent audit events…" compact />
            ) : auditQuery.data?.length ? (
              <div className="space-y-3">
                {auditQuery.data.slice(0, 16).map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{agentDisplayName(event.actor_kind)}</Badge>
                        <span className="text-sm font-medium">{humanize(event.event_type)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {event.entity_type} · {formatDateTime(event.occurred_at)}
                      </div>
                    </div>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No Phase 4 agent events have been recorded yet." />
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm leading-6 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p>
          Team rule: the human owns the relationship, official data owns the truth, the agents own
          the heavy lifting, and the Director owns the decisions. Amina can reorder untouched work;
          she cannot erase human activity or Tunde's verification history.
        </p>
      </div>
    </div>
  );
}

function AgentCard({ agent, run }: { agent: AgentKind; run: AgentRunRecord | undefined }) {
  const meta = agentMeta[agent];
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" /> {meta.name}
            </CardTitle>
            <CardDescription className="mt-1">{meta.role}</CardDescription>
          </div>
          <Badge variant={run?.status === "completed" ? "secondary" : "outline"}>
            {run?.status === "completed" ? "Active" : "Ready"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="leading-5 text-muted-foreground">{meta.purpose}</p>
        <div className="rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
          {meta.boundary}
        </div>
        <div className="text-xs text-muted-foreground">
          {run ? `Last run ${formatDateTime(run.completed_at ?? run.created_at)}` : "No run yet"}
        </div>
      </CardContent>
    </Card>
  );
}

function AminaBrief({ recommendation }: { recommendation: AgentRecommendationRecord }) {
  const evidence = recommendation.evidence;
  const total = numberValue(evidence["totalCalls"]);
  const target = numberValue(evidence["dailyCallTarget"]);
  const ta = numberValue(evidence["taCalls"]);
  const nonTa = numberValue(evidence["nonTaCalls"]);
  const taShare = numberValue(evidence["taShare"]);
  const compliant = evidence["mixCompliant"] === true;
  const progress = target ? Math.min((total / target) * 100, 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={compliant ? "secondary" : "outline"}>
          {compliant ? "Mix compliant" : "Needs attention"}
        </Badge>
        <Badge variant="outline">{recommendation.status}</Badge>
      </div>
      <div>
        <div className="text-lg font-semibold">{recommendation.title}</div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{recommendation.rationale}</p>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Plan readiness</span>
          <span>
            {total}/{target || 7}
          </span>
        </div>
        <Progress value={progress} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="TA calls" value={String(ta)} />
        <MiniStat label="Non-TA" value={String(nonTa)} />
        <MiniStat label="TA share" value={total ? `${Math.round(taShare * 100)}%` : "—"} />
      </div>
      {recommendation.talking_points && (
        <div className="rounded-lg border border-dashed p-3 text-sm leading-6">
          {recommendation.talking_points}
        </div>
      )}
    </div>
  );
}

function RecommendationRow({ recommendation }: { recommendation: AgentRecommendationRecord }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{agentDisplayName(recommendation.agent_kind)}</Badge>
            {recommendation.operational_state && (
              <Badge
                variant={recommendation.operational_state === "critical" ? "default" : "secondary"}
              >
                {humanize(recommendation.operational_state)}
              </Badge>
            )}
            {recommendation.suggested_task_type && (
              <Badge variant="secondary">{recommendation.suggested_task_type}</Badge>
            )}
          </div>
          <div className="mt-2 font-medium">{recommendation.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {recommendation.merchant?.business_name ?? "Portfolio evidence"}
            {recommendation.terminal?.terminal_id
              ? ` · TID ${recommendation.terminal.terminal_id}`
              : ""}
          </div>
        </div>
        {recommendation.score !== null && (
          <div className="text-right">
            <div className="text-lg font-semibold">{Math.round(recommendation.score)}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              priority
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{recommendation.rationale}</p>
      {recommendation.talking_points && (
        <p className="mt-2 text-xs leading-5 text-foreground">{recommendation.talking_points}</p>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-8" : "min-h-[240px]"}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function agentDisplayName(agent: AgentAuditActor) {
  if (agent === "amina") return "Amina";
  if (agent === "emeka") return "Emeka";
  if (agent === "zainab") return "Zainab";
  if (agent === "tunde") return "Tunde";
  return humanize(agent);
}

type AgentAuditActor = AgentKind | "director" | "assistant" | "system";

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
