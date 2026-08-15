import { createFileRoute } from "@tanstack/react-router";
import { Bot, Fingerprint, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/ai-logs")({
  head: () => ({
    meta: [
      { title: "Audit & Agents — Monie Ops Hub" },
      { name: "description", content: "Audit and AI teammate foundation." },
    ],
  }),
  component: AuditAgentsPage,
});

const teammates = [
  ["Amina Bello", "Operations Lead", "Owns orchestration, workload and team rhythm."],
  [
    "Emeka Nwosu",
    "TA & Merchant Growth",
    "Owns terminal recovery prioritisation and merchant growth insight.",
  ],
  ["Zainab Aliyu", "SME Lending", "Owns selective, responsible lending opportunities."],
  [
    "Tunde Bakare",
    "Audit & Verification",
    "Owns source-of-truth reconciliation and evidence states.",
  ],
] as const;

function AuditAgentsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">Phase 1</Badge>
          <Badge variant="secondary">Audit ledger ready</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Audit & Agents</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          The four teammates will share one operational truth model. Phase 1 establishes identities
          and an audit ledger; agent reasoning and automation are connected later rather than being
          faked in the interface.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {teammates.map(([name, role, purpose]) => (
          <Card key={name}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="h-4 w-4 text-primary" /> {name}
                  </CardTitle>
                  <CardDescription className="mt-1">{role}</CardDescription>
                </div>
                <Badge variant="outline">Not activated</Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">{purpose}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" /> Audit event ledger
          </CardTitle>
          <CardDescription>
            Accountability is designed into the data model before automation begins.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <AuditItem
            label="Actor"
            detail="Director, assistant, system, Amina, Emeka, Zainab or Tunde"
          />
          <AuditItem label="Timestamp" detail="Every event records when it occurred" />
          <AuditItem
            label="Entity"
            detail="Task, terminal, merchant, report or verification record"
          />
          <AuditItem label="Payload" detail="Structured context for later forensic review" />
        </CardContent>
      </Card>

      <div className="flex gap-3 rounded-lg border bg-card p-4 text-sm leading-6 text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p>
          AI teammates do not own independent copies of merchant truth. They will operate over the
          same secured database, with Tunde&apos;s verification outcomes kept separate from human
          claims and AI recommendations.
        </p>
      </div>
    </div>
  );
}

function AuditItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
    </div>
  );
}
