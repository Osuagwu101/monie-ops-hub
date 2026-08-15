import { createFileRoute } from "@tanstack/react-router";
import { Activity, BadgeCheck, Database, Gauge, ShieldCheck, Target, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPANY_TARGET_PERCENT,
  DAILY_CALL_TARGET,
  ROLLING_WEEKLY_TA_TARGET_NAIRA,
  TEAM_STANDARD_PERCENT,
} from "@/domain/models";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Monie Ops Hub" },
      {
        name: "description",
        content: "Secure operations mirror for BRM merchant and terminal workflows.",
      },
    ],
  }),
  component: OverviewPage,
});

const referenceSnapshot = {
  reportDate: "13 Aug 2026",
  terminalActivityRate: 69,
  totalTerminals: 125,
  assignedTerminals: 118,
  activeTerminals: 40,
  topBoRetentionRate: 85.4,
} as const;

function OverviewPage() {
  const companyGap = referenceSnapshot.terminalActivityRate - COMPANY_TARGET_PERCENT;
  const teamGap = referenceSnapshot.terminalActivityRate - TEAM_STANDARD_PERCENT;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Phase 1 foundation</Badge>
            <Badge variant="secondary">Reference snapshot · {referenceSnapshot.reportDate}</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Operations Command Centre
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            The portal foundation now separates company performance, our internal 77% standard,
            human work records, and source-of-truth verification. Live report ingestion is
            intentionally not simulated in this phase.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
          <div className="font-medium text-foreground">Daily operating rule</div>
          <div className="mt-1 text-muted-foreground">
            {DAILY_CALL_TARGET} priority calls · 60–80% TA focus · ₦
            {ROLLING_WEEKLY_TA_TARGET_NAIRA.toLocaleString()} rolling weekly TA target
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Terminal Activity"
          value={`${referenceSnapshot.terminalActivityRate}%`}
          description="Official report reference snapshot"
          icon={Activity}
        />
        <MetricCard
          title="Company Target"
          value={`${COMPANY_TARGET_PERCENT}%`}
          description={`${Math.abs(companyGap).toFixed(1)} pts ${companyGap >= 0 ? "above" : "below"} target`}
          icon={Gauge}
        />
        <MetricCard
          title="Team Standard"
          value={`${TEAM_STANDARD_PERCENT}%`}
          description={`${Math.abs(teamGap).toFixed(1)} pts ${teamGap >= 0 ? "above" : "below"} our standard`}
          icon={Target}
        />
        <MetricCard
          title="Assigned Terminals"
          value={`${referenceSnapshot.assignedTerminals}/${referenceSnapshot.totalTerminals}`}
          description={`${referenceSnapshot.activeTerminals} currently active in reference report`}
          icon={Users}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Truth & verification model
            </CardTitle>
            <CardDescription>
              Human activity and official terminal performance are deliberately kept separate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <WorkflowRow
              step="1"
              title="Assistant records the interaction"
              description="Structured outcome fields and free-text notes record what happened during the merchant contact."
            />
            <WorkflowRow
              step="2"
              title="Task waits for evidence"
              description="A completed call does not become a verified performance result merely because a human marked it done."
            />
            <WorkflowRow
              step="3"
              title="Tunde verifies against official data"
              description="Official Moniepoint reporting is the source of truth for Verified, Discrepancy, Deferred and Unverifiable states."
            />
            <WorkflowRow
              step="4"
              title="Audit history remains immutable"
              description="Report imports, task outcomes and verification decisions are stored as separate auditable records."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Phase 1 architecture
            </CardTitle>
            <CardDescription>
              Foundation implemented before live automation is connected.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FoundationItem label="Canonical merchant + terminal model" status="Ready" />
            <FoundationItem label="72% company / 77% team standards" status="Ready" />
            <FoundationItem label="Rolling weekly ₦100k TA rule" status="Ready" />
            <FoundationItem label="Director / assistant role model" status="Ready" />
            <FoundationItem label="RLS security policies" status="Ready" />
            <FoundationItem label="Task outcome + verification separation" status="Ready" />
            <FoundationItem label="Audit event ledger" status="Ready" />
            <FoundationItem
              label="Live Supabase project connection"
              status="Pending connection"
              muted
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-primary" />
            Reference portfolio snapshot
          </CardTitle>
          <CardDescription>
            These numbers are explicitly labelled as a reference snapshot and are not presented as
            live data.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SnapshotItem
            label="Total terminals"
            value={referenceSnapshot.totalTerminals.toString()}
          />
          <SnapshotItem
            label="Assigned terminals"
            value={referenceSnapshot.assignedTerminals.toString()}
          />
          <SnapshotItem
            label="Active terminals"
            value={referenceSnapshot.activeTerminals.toString()}
          />
          <SnapshotItem
            label="Top BO retention"
            value={`${referenceSnapshot.topBoRetentionRate}%`}
          />
        </CardContent>
      </Card>
    </div>
  );
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

function WorkflowRow({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {step}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FoundationItem({
  label,
  status,
  muted = false,
}: {
  label: string;
  status: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <span className="text-sm text-foreground">{label}</span>
      <Badge variant={muted ? "outline" : "secondary"}>{status}</Badge>
    </div>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}
