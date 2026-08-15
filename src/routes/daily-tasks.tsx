import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
  Phone,
  Play,
  RotateCcw,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { DAILY_CALL_TARGET, TA_CALL_SHARE_MAX, TA_CALL_SHARE_MIN } from "@/domain/models";
import {
  loadAssistantProfile,
  loadAssistantTasks,
  localDateKey,
  startAssistantTask,
  submitAssistantOutcome,
  type AssistantTask,
  type TaskOutcomeCode,
} from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/daily-tasks")({
  head: () => ({
    meta: [
      { title: "Daily Tasks — Monie Ops Hub" },
      { name: "description", content: "Amina-guided merchant operations task queue." },
    ],
  }),
  component: DailyTasksPage,
});

const finishedStates = new Set([
  "completed",
  "pending_verification",
  "verified",
  "discrepancy",
  "deferred",
  "unverifiable",
]);

const outcomeOptions: Array<{ value: TaskOutcomeCode; label: string }> = [
  { value: "reached_commitment", label: "Reached — commitment received" },
  { value: "reached_no_commitment", label: "Reached — no commitment" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "no_answer", label: "No answer" },
  { value: "merchant_busy", label: "Merchant busy" },
  { value: "terminal_issue", label: "Terminal issue identified" },
  { value: "merchant_declined", label: "Merchant declined" },
  { value: "loan_interest", label: "Loan interest" },
  { value: "escalation_required", label: "Escalation required" },
];

function DailyTasksPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTask, setSelectedTask] = useState<AssistantTask | null>(null);
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
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: (taskId: string) => startAssistantTask(taskId, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assistant-tasks", date] }),
  });

  const tasks = tasksQuery.data ?? [];
  const profile = profileQuery.data;
  const isAssistant = profile?.role === "assistant";

  const stats = useMemo(() => {
    const completed = tasks.filter((task) => finishedStates.has(task.status)).length;
    const taTasks = tasks.filter((task) => task.task_type === "TA").length;
    const taShare = tasks.length ? taTasks / tasks.length : 0;
    const progress = DAILY_CALL_TARGET ? Math.min((completed / DAILY_CALL_TARGET) * 100, 100) : 0;
    return { completed, taTasks, taShare, progress };
  }, [tasks]);

  const nowTask = tasks.find((task) => !finishedStates.has(task.status)) ?? null;
  const taMixHealthy =
    tasks.length === 0 ||
    (stats.taShare >= TA_CALL_SHARE_MIN && stats.taShare <= TA_CALL_SHARE_MAX);

  if (tasksQuery.isError || profileQuery.isError) {
    const error = tasksQuery.error ?? profileQuery.error;
    return (
      <Alert variant="destructive" className="mx-auto max-w-4xl">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Unable to load the assistant workspace</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "The secure data request failed."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">Phase 2</Badge>
            <Badge variant="secondary">Amina daily workspace</Badge>
            {profile?.role && <Badge variant="outline">{profile.role}</Badge>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {profile?.full_name
              ? `Good day, ${profile.full_name.split(" ")[0]}`
              : "Daily Operations"}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Amina keeps the day focused: one next action, seven priority calls, clear outcomes and
            no self-verification.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 text-primary" /> {date}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={<Target className="h-4 w-4 text-primary" />}
          label="Daily progress"
          value={`${stats.completed}/${DAILY_CALL_TARGET}`}
          detail="Completed human interactions"
        />
        <MetricCard
          icon={<Phone className="h-4 w-4 text-primary" />}
          label="TA call mix"
          value={tasks.length ? `${Math.round(stats.taShare * 100)}%` : "—"}
          detail={`${stats.taTasks} of ${tasks.length} assigned tasks`}
          warning={!taMixHealthy}
        />
        <MetricCard
          icon={<ShieldCheck className="h-4 w-4 text-primary" />}
          label="Verification"
          value="Separated"
          detail="Tunde owns official result states"
        />
      </div>

      <Card className="overflow-hidden border-primary/20 shadow-sm">
        <CardHeader className="border-b bg-primary/[0.04]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardDescription className="font-medium uppercase tracking-[0.16em]">
                Amina says: work on this now
              </CardDescription>
              <CardTitle className="mt-1 text-xl">
                {tasksQuery.isLoading
                  ? "Loading today's priority…"
                  : nowTask
                    ? (nowTask.merchant?.business_name ?? "Assigned merchant")
                    : "Today's queue is clear"}
              </CardTitle>
            </div>
            {nowTask && <PriorityBadge priority={nowTask.priority} />}
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          {tasksQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading secure task data…
            </div>
          ) : nowTask ? (
            <NowTask
              task={nowTask}
              canAct={Boolean(isAssistant)}
              starting={startMutation.isPending}
              onStart={() => startMutation.mutate(nowTask.id)}
              onOutcome={() => setSelectedTask(nowTask)}
            />
          ) : (
            <div className="flex items-start gap-3 py-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">No unresolved task is assigned for today.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  New or reprioritised work will appear here when it is assigned.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Today's queue</CardTitle>
              <CardDescription>
                The queue is ordered by priority. Postponed work remains visible with its callback
                context.
              </CardDescription>
            </div>
            <div className="min-w-48">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>Daily completion</span>
                <span>{Math.round(stats.progress)}%</span>
              </div>
              <Progress value={stats.progress} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 && !tasksQuery.isLoading ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Amina has not assigned tasks for this workday yet.
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map((task, index) => (
                <QueueRow
                  key={task.id}
                  task={task}
                  number={index + 1}
                  canAct={Boolean(isAssistant)}
                  onOutcome={() => setSelectedTask(task)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!isAssistant && profile && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Director view</AlertTitle>
          <AlertDescription>
            You can inspect the assistant queue, but assistant activity buttons stay disabled so
            task accountability remains attached to the person actually assigned the work.
          </AlertDescription>
        </Alert>
      )}

      <OutcomeDialog
        task={selectedTask}
        accessToken={accessToken}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        onSaved={async () => {
          setSelectedTask(null);
          await queryClient.invalidateQueries({ queryKey: ["assistant-tasks", date] });
        }}
      />
    </div>
  );
}

function NowTask({
  task,
  canAct,
  starting,
  onStart,
  onOutcome,
}: {
  task: AssistantTask;
  canAct: boolean;
  starting: boolean;
  onStart: () => void;
  onOutcome: () => void;
}) {
  const phoneNumber = task.merchant?.phone_number;
  const started = task.status === "in_progress";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Detail label="Task" value={task.task_type} />
          <Detail label="Terminal" value={task.terminal?.terminal_id ?? "Not linked"} />
          <Detail label="Status" value={humanizeStatus(task.status)} />
        </div>

        <div className="rounded-lg bg-muted/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why now
          </p>
          <p className="mt-1.5 text-sm leading-6 text-foreground">{task.reason}</p>
        </div>

        {task.recommended_talking_points && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Talking points
            </p>
            <p className="mt-1.5 text-sm leading-6 text-foreground">
              {task.recommended_talking_points}
            </p>
          </div>
        )}

        {task.latestOutcome?.postponement_reason && (
          <div className="flex gap-3 rounded-lg border border-dashed p-3 text-sm">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="font-medium">Previous postponement</div>
              <div className="mt-1 text-muted-foreground">
                {task.latestOutcome.postponement_reason}
              </div>
              {task.latestOutcome.callback_at && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Callback: {formatDateTime(task.latestOutcome.callback_at)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-w-48 flex-col gap-2 lg:border-l lg:pl-5">
        {phoneNumber ? (
          <Button asChild size="lg">
            <a href={`tel:${phoneNumber}`}>
              <Phone className="mr-2 h-4 w-4" /> Call merchant
            </a>
          </Button>
        ) : (
          <Button size="lg" disabled>
            <Phone className="mr-2 h-4 w-4" /> No phone number
          </Button>
        )}
        {!started && (
          <Button variant="outline" onClick={onStart} disabled={!canAct || starting}>
            {starting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Start task
          </Button>
        )}
        <Button variant={started ? "default" : "secondary"} onClick={onOutcome} disabled={!canAct}>
          Record outcome
        </Button>
      </div>
    </div>
  );
}

function QueueRow({
  task,
  number,
  canAct,
  onOutcome,
}: {
  task: AssistantTask;
  number: number;
  canAct: boolean;
  onOutcome: () => void;
}) {
  const final = finishedStates.has(task.status);

  return (
    <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {number}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">
            {task.merchant?.business_name ?? "Assigned merchant"}
          </span>
          <Badge variant={task.task_type === "TA" ? "default" : "secondary"}>
            {task.task_type}
          </Badge>
          <StatusBadge status={task.status} />
          {task.rolled_from_task_id && <Badge variant="outline">Rolled over</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>TID: {task.terminal?.terminal_id ?? "—"}</span>
          <span>Priority {task.priority}/5</span>
          {task.latestOutcome?.callback_at && (
            <span>Callback {formatDateTime(task.latestOutcome.callback_at)}</span>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        {final ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" /> Human work recorded
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={onOutcome} disabled={!canAct}>
            Update
          </Button>
        )}
      </div>
    </div>
  );
}

function OutcomeDialog({
  task,
  accessToken,
  onOpenChange,
  onSaved,
}: {
  task: AssistantTask | null;
  accessToken: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof submitAssistantOutcome>[0]) =>
      submitAssistantOutcome(input, accessToken),
    onSuccess: () => onSaved(),
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to save outcome."),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const outcomeCode = String(form.get("outcomeCode")) as TaskOutcomeCode;
    const finalStatus = String(form.get("finalStatus")) as "postponed" | "completed";
    const expectedAmountRaw = String(form.get("expectedAmount") ?? "").trim();
    const expectedByRaw = String(form.get("expectedBy") ?? "").trim();
    const callbackAtRaw = String(form.get("callbackAt") ?? "").trim();

    mutation.mutate({
      taskId: task.id,
      outcomeCode,
      finalStatus,
      reachedMerchant: reachedFromOutcome(outcomeCode),
      commitmentReceived: outcomeCode === "reached_commitment" ? true : null,
      expectedAmount: expectedAmountRaw ? Number(expectedAmountRaw) : null,
      expectedBy: expectedByRaw ? new Date(expectedByRaw).toISOString() : null,
      postponementReason: String(form.get("postponementReason") ?? "").trim() || null,
      callbackAt: callbackAtRaw ? new Date(callbackAtRaw).toISOString() : null,
      notes: String(form.get("notes") ?? "").trim() || null,
    });
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Record merchant outcome</DialogTitle>
          <DialogDescription>
            Record what happened. This closes or postpones the human task; it does not mark the
            result Verified.
          </DialogDescription>
        </DialogHeader>

        {task && (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <div className="font-medium">
                {task.merchant?.business_name ?? "Assigned merchant"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {task.task_type} · TID {task.terminal?.terminal_id ?? "not linked"}
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Outcome not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="outcomeCode">Structured outcome</Label>
              <select
                id="outcomeCode"
                name="outcomeCode"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="reached_commitment"
                required
              >
                {outcomeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="finalStatus">What happens to this task?</Label>
              <select
                id="finalStatus"
                name="finalStatus"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="completed"
                required
              >
                <option value="completed">Completed — human interaction finished</option>
                <option value="postponed">Postponed — return/callback required</option>
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expected amount (₦)" name="expectedAmount" type="number" min="0" />
              <Field label="Expected by" name="expectedBy" type="datetime-local" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Callback time" name="callbackAt" type="datetime-local" />
              <Field label="Postponement reason" name="postponementReason" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Human notes</Label>
              <Textarea
                id="notes"
                name="notes"
                placeholder="What did the merchant say? What should the team know next?"
                rows={5}
              />
            </div>

            <div className="flex gap-2 rounded-lg border border-dashed p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Tunde will verify measurable results separately against official Moniepoint reporting.
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save outcome
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  warning = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {icon} {label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className={`mt-1 text-xs ${warning ? "text-destructive" : "text-muted-foreground"}`}>
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: number }) {
  const label =
    priority >= 5 ? "Critical" : priority >= 4 ? "High" : priority >= 3 ? "Priority" : "Standard";
  return (
    <Badge variant={priority >= 4 ? "default" : "secondary"}>
      {label} · {priority}/5
    </Badge>
  );
}

function StatusBadge({ status }: { status: AssistantTask["status"] }) {
  if (status === "postponed") {
    return (
      <Badge variant="outline" className="gap-1">
        <Clock3 className="h-3 w-3" /> Postponed
      </Badge>
    );
  }
  if (status === "in_progress") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleDashed className="h-3 w-3" /> In progress
      </Badge>
    );
  }
  if (finishedStates.has(status)) {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> {humanizeStatus(status)}
      </Badge>
    );
  }
  return <Badge variant="outline">Assigned</Badge>;
}

function Field({
  label,
  name,
  type = "text",
  min,
}: {
  label: string;
  name: string;
  type?: string;
  min?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} min={min} />
    </div>
  );
}

function reachedFromOutcome(outcome: TaskOutcomeCode) {
  if (["no_answer", "merchant_busy"].includes(outcome)) return false;
  if (
    [
      "reached_commitment",
      "reached_no_commitment",
      "callback_requested",
      "merchant_declined",
      "loan_interest",
    ].includes(outcome)
  )
    return true;
  return null;
}

function humanizeStatus(status: string) {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
