import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Database,
  Gauge,
  Loader2,
  PhoneCall,
  ShieldCheck,
  Target,
} from "lucide-react";

import { AminaPerformancePanel } from "@/components/amina-performance-panel";
import { LiveMirrorPanel } from "@/components/live-mirror-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPANY_TARGET_PERCENT,
  DAILY_CONTACT_CAPACITY,
  DAILY_REQUIRED_CONTACTS,
  ROLLING_WEEKLY_TA_TARGET_NAIRA,
  TEAM_STANDARD_PERCENT,
} from "@/domain/models";
import { loadAssistantProfile, loadAssistantTasks, localDateKey } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";
import { loadLatestPortfolioPerformance } from "@/lib/report-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Monie Ops Hub" },
      {
        name: "description",
        content: "Amina's daily BRM operations brief and official portfolio performance.",
      },
    ],
  }),
  component: OverviewPage,
});

const finalStates = new Set([
  "completed",
  "pending_verification",
  "verified",
  "discrepancy",
  "deferred",
  "unverifiable",
]);

function OverviewPage() {
  const { session, user } = useAuth();
  const date = localDateKey();
  const accessToken = session?.access_token ?? "";
  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, accessToken),
    enabled: Boolean(user?.id && accessToken),
  });
  const tasksQuery = useQuery({
    queryKey: ["assistant-tasks", date, user?.id],
    queryFn: () => loadAssistantTasks(date, accessToken),
    enabled: Boolean(session?.access_token),
  });
  const performanceQuery = useQuery({
    queryKey: ["portfolio-performance"],
    queryFn: () => loadLatestPortfolioPerformance(accessToken),
    enabled: Boolean(session?.access_token),
  });

  const tasks = tasksQuery.data ?? [];
  const completed = tasks.filter((task) => finalStates.has(task.status)).length;
  const taTasks = tasks.filter((task) => task.task_type === "TA").length;
  const unresolved = tasks.filter((task) => !finalStates.has(task.status)).length;
  const nextTask = tasks.find((task) => !finalStates.has(task.status));
  const performance = performanceQuery.data;
  const terminalActivityRate = performance?.terminal_activity_rate ?? null;
  const companyGap =
    terminalActivityRate === null ? null : terminalActivityRate - COMPANY_TARGET_PERCENT;
  const teamGap =
    terminalActivityRate === null ? null : terminalActivityRate - TEAM_STANDARD_PERCENT;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Phase 4</Badge>
            <Badge variant="secondary">Amina morning brief</Badge>
            {performance && <Badge>Official report · {performance.report_date}</Badge>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Operations Command Centre
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Amina keeps the human work focused while the performance cards below come from the
            latest successfully ingested official Moniepoint report. Human completion and Tunde
            verification remain separate.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
          <div className="font-medium text-foreground">Daily operating rule</div>
          <div className="mt-1 text-muted-foreground">
            {DAILY_REQUIRED_CONTACTS} required contacts · up to {DAILY_CONTACT_CAPACITY} ranked ·
            60–80% TA focus · ₦{ROLLING_WEEKLY_TA_TARGET_NAIRA.toLocaleString()} rolling weekly TA
            target
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Assigned today"
          value={tasksQuery.isLoading ? "…" : `${tasks.length}`}
          description={`${DAILY_REQUIRED_CONTACTS} required; up to ${DAILY_CONTACT_CAPACITY} available when BOs are unreachable`}
          icon={PhoneCall}
        />
        <MetricCard
          title="Human work completed"
          value={tasksQuery.isLoading ? "…" : `${completed}`}
          description={`${unresolved} unresolved task${unresolved === 1 ? "" : "s"} remain`}
          icon={BadgeCheck}
        />
        <MetricCard
          title="Official terminal activity"
          value={
            performanceQuery.isLoading
              ? "…"
              : terminalActivityRate === null
                ? "—"
                : `${terminalActivityRate}%`
          }
          description={
            performance
              ? `${performance.active_assigned_7_plus_days_count ?? 0}/${performance.assigned_7_plus_days_count ?? 0} active terminals assigned for 7+ days`
              : "No official report imported yet"
          }
          icon={Activity}
        />
        <MetricCard
          title="Team standard"
          value={`${TEAM_STANDARD_PERCENT}%`}
          description={`Company benchmark remains ${COMPANY_TARGET_PERCENT}%`}
          icon={Gauge}
        />
      </section>

      {profileQuery.data?.role === "director" && accessToken && (
        <LiveMirrorPanel accessToken={accessToken} date={date} />
      )}

      {profileQuery.data?.role === "assistant" && user?.id && accessToken && (
        <AminaPerformancePanel
          assistantId={user.id}
          accessToken={accessToken}
          isDirector={false}
          compact
        />
      )}

      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-primary/20">
          <CardHeader>
            <CardDescription className="font-medium uppercase tracking-[0.14em]">
              Amina's next action
            </CardDescription>
            <CardTitle>
              {tasksQuery.isLoading
                ? "Loading today's priority…"
                : (nextTask?.merchant?.business_name ?? "No unresolved task assigned")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tasksQuery.isLoading ? (
              <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading secure task data…
              </div>
            ) : nextTask ? (
              <div className="space-y-4">
                <p className="text-sm leading-6 text-muted-foreground">{nextTask.reason}</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge>{nextTask.task_type}</Badge>
                  <Badge variant="outline">Priority {nextTask.priority}/5</Badge>
                  <Badge variant="outline">TID {nextTask.terminal?.terminal_id ?? "—"}</Badge>
                </div>
                <Button asChild>
                  <Link to="/daily-tasks">
                    Open daily workspace <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Amina has no unresolved work in the current queue.</p>
                <Button asChild variant="outline">
                  <Link to="/daily-tasks">View daily workspace</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Accountability rule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>The assistant records what happened.</p>
            <p>The official report records what Moniepoint measured.</p>
            <p>Tunde decides the verification state from that official evidence.</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" /> Official portfolio performance
          </CardTitle>
          <CardDescription>
            These figures are populated only from successfully validated Moniepoint PDF imports. No
            reference or mock portfolio numbers are used here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {performanceQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading official
              performance…
            </div>
          ) : performance ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SnapshotItem label="Report date" value={performance.report_date} />
              <SnapshotItem
                label="Terminal activity"
                value={`${performance.terminal_activity_rate}%`}
                detail={gapText(companyGap, "company target")}
              />
              <SnapshotItem
                label="Gap to 77%"
                value={teamGap === null ? "—" : `${Math.abs(teamGap).toFixed(1)} pts`}
                detail={
                  teamGap !== null && teamGap >= 0
                    ? "Team standard reached"
                    : "Internal standard not yet reached"
                }
              />
              <SnapshotItem
                label="Rolling targets met"
                value={`${performance.rolling_target_met_count ?? 0}`}
                detail={`${performance.parsed_rolling_row_count ?? 0} terminals parsed from the official 7-day section`}
              />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No official report has been imported yet. The dashboard will remain empty rather than
              display fake performance data.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function gapText(gap: number | null, targetLabel: string) {
  if (gap === null) return "No official comparison available";
  return `${Math.abs(gap).toFixed(1)} pts ${gap >= 0 ? "above" : "below"} ${targetLabel}`;
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <CardDescription className="font-medium">{title}</CardDescription>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function SnapshotItem({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
