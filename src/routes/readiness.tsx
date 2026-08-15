import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCheck2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { loadAssistantProfile } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";
import {
  loadReadinessAuditHistory,
  loadReadinessSnapshot,
  runReadinessAudit,
  type ReadinessCheck,
  type ReadinessCheckStatus,
  type ReadinessOverallStatus,
} from "@/lib/readiness-data";

export const Route = createFileRoute("/readiness")({
  head: () => ({
    meta: [
      { title: "Operational Readiness — Monie Ops Hub" },
      {
        name: "description",
        content: "Phase 6 operational readiness, acceptance gates, and live activation checklist.",
      },
    ],
  }),
  component: ReadinessPage,
});

function ReadinessPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token ?? "";

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, accessToken),
    enabled: Boolean(user?.id && accessToken),
  });
  const isDirector = profileQuery.data?.role === "director";

  const snapshotQuery = useQuery({
    queryKey: ["system-readiness"],
    queryFn: () => loadReadinessSnapshot(accessToken),
    enabled: Boolean(isDirector && accessToken),
    refetchInterval: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["readiness-audits"],
    queryFn: () => loadReadinessAuditHistory(accessToken),
    enabled: Boolean(isDirector && accessToken),
  });

  const auditMutation = useMutation({
    mutationFn: () => runReadinessAudit(accessToken),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["system-readiness"] }),
        queryClient.invalidateQueries({ queryKey: ["readiness-audits"] }),
      ]);
    },
  });

  if (profileQuery.isLoading) {
    return <LoadingState label="Checking Director access…" />;
  }

  if (!isDirector) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Director access required</AlertTitle>
        <AlertDescription>
          Operational readiness includes privileged security and activation checks and is not
          exposed to the Human Operations Assistant.
        </AlertDescription>
      </Alert>
    );
  }

  if (snapshotQuery.isLoading) {
    return <LoadingState label="Running the live readiness checks…" />;
  }

  if (snapshotQuery.isError || !snapshotQuery.data) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-4xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Readiness check failed</AlertTitle>
        <AlertDescription>
          {snapshotQuery.error instanceof Error
            ? snapshotQuery.error.message
            : "The readiness service did not return a snapshot."}
        </AlertDescription>
      </Alert>
    );
  }

  const snapshot = snapshotQuery.data;
  const passed = snapshot.checks.filter((check) => check.status === "pass").length;
  const blockers = snapshot.checks.filter((check) => check.status === "blocker").length;
  const externalPending = snapshot.checks.filter(
    (check) => check.status === "pending_external",
  ).length;
  const score = Math.round((passed / Math.max(snapshot.checks.length, 1)) * 100);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>Phase 6</Badge>
            <Badge variant="secondary">Operational readiness</Badge>
            <Badge variant="outline">Automation remains Director-controlled</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Readiness & Acceptance</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            This page separates platform readiness, manual operating readiness, and live automation
            readiness. Missing Browser Use or Moniepoint credentials are shown as external activation
            items, not disguised as development failures.
          </p>
        </div>
        <Button onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending}>
          {auditMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Run readiness audit
        </Button>
      </section>

      <StatusBanner status={snapshot.overallStatus} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Platform"
          value={snapshot.platformReady ? "Ready" : "Blocked"}
          detail="Security, database, report engine, orchestration and recovery foundation"
          ok={snapshot.platformReady}
        />
        <SummaryCard
          title="Manual operations"
          value={snapshot.manualOperationsReady ? "Ready" : "Activation pending"}
          detail="Needs a Director, an Assistant and a processed official report"
          ok={snapshot.manualOperationsReady}
        />
        <SummaryCard
          title="Live automation"
          value={snapshot.liveAutomationReady ? "Ready" : "Credentials pending"}
          detail="Browser Use and Moniepoint credentials plus exact login scope"
          ok={snapshot.liveAutomationReady}
        />
        <SummaryCard
          title="Scheduled retrieval"
          value={snapshot.automationEnabled ? "Enabled" : "Disabled"}
          detail={snapshot.automationEnabled ? "Unattended retrieval can run" : "Safe default while activation is pending"}
          ok={!snapshot.automationEnabled || snapshot.liveAutomationReady}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Acceptance score</CardTitle>
          <CardDescription>
            {passed} of {snapshot.checks.length} checks currently pass. External credential items are
            tracked separately from platform blockers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={score} />
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Passed" value={String(passed)} />
            <MiniStat label="Blockers" value={String(blockers)} />
            <MiniStat label="External pending" value={String(externalPending)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Live system checks</CardTitle>
            <CardDescription>
              These checks are calculated server-side from the current production schema and state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Operational activation</CardTitle>
              <CardDescription>What must exist before the Human Assistant can work a real day.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ChecklistItem done={snapshot.counts.directors > 0} text="Active Director account" />
              <ChecklistItem done={snapshot.counts.assistants > 0} text="Active Human Operations Assistant account" />
              <ChecklistItem done={snapshot.latestReport?.status === "processed"} text="Processed official Moniepoint report" />
              <ChecklistItem done={snapshot.platformReady} text="Platform/security checks pass" />
              <Button asChild variant="outline" className="w-full">
                <Link to="/report-imports">
                  <FileCheck2 className="mr-2 h-4 w-4" /> Open Official Reports
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>First unattended run gate</CardTitle>
              <CardDescription>
                These items can remain pending while Phase 6 manual acceptance is completed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ChecklistItem
                done={snapshot.externalActivation.browserUseApiKeyConfigured}
                text="Browser Use API key stored in Vault"
              />
              <ChecklistItem
                done={snapshot.externalActivation.moniepointCredentialsConfigured}
                text="Moniepoint login credentials stored in Vault"
              />
              <ChecklistItem
                done={snapshot.externalActivation.loginScopeConfigured}
                text="Exact login URL and allowed domains configured"
              />
              <ChecklistItem done={snapshot.liveAutomationReady} text="Live automation readiness passes" />
              <Button asChild variant="outline" className="w-full">
                <Link to="/automation">
                  <Workflow className="mr-2 h-4 w-4" /> Open Automation
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest official report</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {snapshot.latestReport ? (
                <div className="space-y-2">
                  <div className="font-medium">{snapshot.latestReport.reportDate}</div>
                  <div className="text-muted-foreground">
                    Status: {snapshot.latestReport.status} · {snapshot.latestReport.ageDays} day(s) old
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">No production report has been imported yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-primary" /> Readiness audit history
          </CardTitle>
          <CardDescription>
            A Director-triggered audit stores only non-secret readiness results for accountability.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <LoadingState label="Loading audit history…" compact />
          ) : historyQuery.data?.length ? (
            <div className="space-y-3">
              {historyQuery.data.map((audit) => (
                <div
                  key={audit.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium">{statusLabel(audit.overall_status)}</div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(audit.created_at)}</div>
                  </div>
                  <Badge variant={audit.snapshot.platformReady ? "secondary" : "destructive"}>
                    {audit.snapshot.platformReady ? "Platform ready" : "Platform blocked"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No saved readiness audit yet. Run the audit to create the first production baseline.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBanner({ status }: { status: ReadinessOverallStatus }) {
  const copy = statusCopy(status);
  return (
    <Alert variant={status === "blocked" ? "destructive" : "default"}>
      {status === "blocked" ? (
        <TriangleAlert className="h-4 w-4" />
      ) : (
        <ShieldCheck className="h-4 w-4" />
      )}
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.detail}</AlertDescription>
    </Alert>
  );
}

function SummaryCard({
  title,
  value,
  detail,
  ok,
}: {
  title: string;
  value: string;
  detail: string;
  ok: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          {ok ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <CircleDot className="h-5 w-5 text-muted-foreground" />
          )}
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <div className="flex gap-3 rounded-xl border p-4">
      <CheckIcon status={check.status} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium">{check.label}</div>
          <Badge variant="outline">{check.category.replace(/_/g, " ")}</Badge>
          <StatusBadge status={check.status} />
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{check.detail}</p>
      </div>
    </div>
  );
}

function CheckIcon({ status }: { status: ReadinessCheckStatus }) {
  if (status === "pass") return <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />;
  if (status === "blocker") return <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />;
  if (status === "warning") return <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />;
  return <CircleDot className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: ReadinessCheckStatus }) {
  if (status === "pass") return <Badge variant="secondary">Pass</Badge>;
  if (status === "blocker") return <Badge variant="destructive">Blocker</Badge>;
  if (status === "pending_external") return <Badge variant="outline">External pending</Badge>;
  if (status === "warning") return <Badge variant="outline">Warning</Badge>;
  return <Badge variant="outline">Info</Badge>;
}

function ChecklistItem({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-start gap-2">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      ) : (
        <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{text}</span>
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
      className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-8" : "min-h-[260px]"}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function statusCopy(status: ReadinessOverallStatus) {
  if (status === "ready_for_live_automation") {
    return {
      title: "Ready for the first controlled live automation run",
      detail:
        "Platform, operational data, and external automation prerequisites are present. Scheduled automation still remains under Director control.",
    };
  }
  if (status === "manual_operations_ready") {
    return {
      title: "Manual operations are ready; unattended retrieval is pending external credentials",
      detail:
        "The Human Assistant and AI team can operate from official manually imported reports. Browser Use and Moniepoint credential setup remains the final automation gate.",
    };
  }
  if (status === "platform_ready_activation_pending") {
    return {
      title: "Platform is ready; operational activation data is still pending",
      detail:
        "The secured application foundation is healthy. Add the real team account(s) and a processed official report to begin manual acceptance; external credentials can wait.",
    };
  }
  return {
    title: "A platform blocker needs attention",
    detail:
      "One or more core security, database, report-engine, or orchestration checks failed. Resolve those before operational acceptance.",
  };
}

function statusLabel(status: ReadinessOverallStatus) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
