import { createFileRoute } from "@tanstack/react-router";
import { Clock3, ListTodo, RotateCcw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DAILY_CALL_TARGET } from "@/domain/models";

export const Route = createFileRoute("/daily-tasks")({
  head: () => ({
    meta: [
      { title: "Daily Tasks — Monie Ops Hub" },
      { name: "description", content: "Daily merchant operations task queue." },
    ],
  }),
  component: DailyTasksPage,
});

const taskStates = [
  ["Assigned", "Amina places a priority task into the assistant queue."],
  ["In progress", "The assistant has started the merchant interaction."],
  ["Postponed", "A reason and callback context are required."],
  ["Completed", "The human interaction is finished; performance is not yet verified."],
  ["Pending verification", "Tunde is waiting for official report evidence."],
  ["Verified / Discrepancy / Deferred / Unverifiable", "Only the verification layer determines the final evidence state."],
] as const;

function DailyTasksPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">Phase 1</Badge>
          <Badge variant="secondary">Queue model secured</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Daily Tasks</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Amina will assign {DAILY_CALL_TARGET} priority calls each workday. The live queue will be connected
          after Supabase is attached; this phase establishes the safe state machine first.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListTodo className="h-4 w-4 text-primary" /> Daily workload
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <div className="text-3xl font-bold text-foreground">{DAILY_CALL_TARGET}</div>
            <p className="mt-1">Priority merchant calls per day, with 60–80% normally focused on TA.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RotateCcw className="h-4 w-4 text-primary" /> Rollover
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Urgent unresolved work can return the next morning when the official report still shows that the
            underlying issue remains open.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-primary" /> Verification cutoff
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Deferred same-day outcomes are re-audited from the next official report around 8:30 AM.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Controlled task state machine
          </CardTitle>
          <CardDescription>
            The assistant cannot directly convert their own work into a Verified result.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {taskStates.map(([state, description], index) => (
            <div key={state} className="flex gap-3 rounded-lg border p-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                {index + 1}
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">{state}</div>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
