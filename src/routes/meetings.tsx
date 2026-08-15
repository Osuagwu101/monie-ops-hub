import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlarmClock,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { loadAssistantProfile } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";
import {
  acknowledgeMeetingOccurrence,
  loadMeetingDeliveries,
  loadMeetingOccurrences,
  loadMeetingSeries,
  loadMobileDevices,
  refreshMeetingCalendar,
  updateMeetingSeries,
  type MeetingSeries,
} from "@/lib/meeting-data";

export const Route = createFileRoute("/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings & Alerts — Monie Ops Hub" },
      {
        name: "description",
        content: "Director meeting schedules, mobile reminders, alarms and acknowledgements.",
      },
    ],
  }),
  component: MeetingCentrePage,
});

interface SeriesDraft {
  enabled: boolean;
  startTime: string;
  meetingUrl: string;
  reminder10: boolean;
  reminder2: boolean;
  escalationAfterMinutes: number;
  escalationRepeatMinutes: number;
}

function MeetingCentrePage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token ?? "";
  const [drafts, setDrafts] = useState<Record<string, SeriesDraft>>({});

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, accessToken),
    enabled: Boolean(user?.id && accessToken),
  });
  const isDirector = profileQuery.data?.role === "director";

  const seriesQuery = useQuery({
    queryKey: ["meeting-series"],
    queryFn: () => loadMeetingSeries(accessToken),
    enabled: Boolean(isDirector && accessToken),
  });
  const occurrencesQuery = useQuery({
    queryKey: ["meeting-occurrences"],
    queryFn: () => loadMeetingOccurrences(accessToken),
    enabled: Boolean(isDirector && accessToken),
    refetchInterval: 60_000,
  });
  const devicesQuery = useQuery({
    queryKey: ["mobile-devices"],
    queryFn: () => loadMobileDevices(accessToken),
    enabled: Boolean(isDirector && accessToken),
    refetchInterval: 60_000,
  });
  const deliveriesQuery = useQuery({
    queryKey: ["meeting-deliveries"],
    queryFn: () => loadMeetingDeliveries(accessToken),
    enabled: Boolean(isDirector && accessToken),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!seriesQuery.data) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const series of seriesQuery.data) {
        if (!next[series.id]) next[series.id] = draftFromSeries(series);
      }
      return next;
    });
  }, [seriesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => {
      const draft = drafts[id];
      if (!draft) throw new Error("Meeting settings are not loaded.");
      return updateMeetingSeries(
        {
          id,
          enabled: draft.enabled,
          startTime: draft.startTime,
          meetingUrl: draft.meetingUrl.trim() || null,
          reminder10: draft.reminder10,
          reminder2: draft.reminder2,
          escalationAfterMinutes: draft.escalationAfterMinutes,
          escalationRepeatMinutes: draft.escalationRepeatMinutes,
        },
        accessToken,
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting-series"] }),
        queryClient.invalidateQueries({ queryKey: ["meeting-occurrences"] }),
      ]);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshMeetingCalendar(accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["meeting-occurrences"] });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (occurrenceId: string) => acknowledgeMeetingOccurrence(occurrenceId, accessToken),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting-occurrences"] }),
        queryClient.invalidateQueries({ queryKey: ["meeting-deliveries"] }),
      ]);
    },
  });

  const nextOccurrence = useMemo(
    () => occurrencesQuery.data?.find((item) => item.status === "scheduled" && new Date(item.starts_at) > new Date()),
    [occurrencesQuery.data],
  );
  const activeDevices = devicesQuery.data?.filter((device) => device.enabled && device.notifications_granted) ?? [];
  const recentFailures = deliveriesQuery.data?.filter((delivery) => delivery.status === "failed").slice(0, 5) ?? [];

  if (profileQuery.isLoading) return <LoadingState label="Checking Director access…" />;

  if (!isDirector) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Director access required</AlertTitle>
        <AlertDescription>
          Meeting schedules and acknowledgement alarms are private Director controls.
        </AlertDescription>
      </Alert>
    );
  }

  if (seriesQuery.isLoading) return <LoadingState label="Loading meeting schedules…" />;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge>Phase 7</Badge>
            <Badge variant="secondary">Mobile alerts</Badge>
            <Badge variant="outline">Africa/Lagos</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Meetings & Alerts</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            The web portal and Moniepoint BRM mobile app share one meeting calendar. The phone gets
            the 10-minute reminder, the 2-minute drop-everything reminder, and repeated post-start
            alerts until the Director acknowledges joining.
          </p>
        </div>
        <Button variant="outline" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
          {refreshMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh calendar
        </Button>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={CalendarClock}
          label="Meeting series"
          value={String(seriesQuery.data?.length ?? 0)}
          detail="Cluster + zonal recurrence rules"
        />
        <SummaryCard
          icon={Smartphone}
          label="Alert-ready phones"
          value={String(activeDevices.length)}
          detail="Registered mobile devices with notifications granted"
        />
        <SummaryCard
          icon={Clock3}
          label="Next meeting"
          value={nextOccurrence ? formatShort(nextOccurrence.starts_at) : "Not scheduled"}
          detail={nextOccurrence?.series?.name ?? "Refresh the calendar after changing a schedule"}
        />
        <SummaryCard
          icon={BellRing}
          label="Delivery issues"
          value={String(recentFailures.length)}
          detail="Recent failed push attempts"
        />
      </div>

      {!activeDevices.length && (
        <Alert>
          <Smartphone className="h-4 w-4" />
          <AlertTitle>No alert-ready phone is registered yet</AlertTitle>
          <AlertDescription>
            The schedules are active in the shared backend, but push alerts begin only after the
            Moniepoint BRM mobile app is installed, signed in, and notification permission is granted.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        {(seriesQuery.data ?? []).map((series) => (
          <SeriesCard
            key={series.id}
            series={series}
            draft={drafts[series.id] ?? draftFromSeries(series)}
            onDraft={(draft) => setDrafts((current) => ({ ...current, [series.id]: draft }))}
            saving={saveMutation.isPending && saveMutation.variables?.id === series.id}
            onSave={() => saveMutation.mutate({ id: series.id })}
          />
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5 text-primary" /> Upcoming occurrences
          </CardTitle>
          <CardDescription>
            Acknowledging “Yes, I have joined” stops future escalation pushes for that occurrence on
            every registered device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {occurrencesQuery.isLoading ? (
            <LoadingState compact label="Loading upcoming meetings…" />
          ) : occurrencesQuery.data?.length ? (
            <div className="space-y-3">
              {occurrencesQuery.data.slice(0, 16).map((occurrence) => {
                const hasStarted = new Date(occurrence.starts_at) <= new Date();
                return (
                  <div
                    key={occurrence.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{occurrence.series?.name ?? "Meeting"}</span>
                        <Badge variant={occurrence.status === "joined" ? "secondary" : "outline"}>
                          {occurrence.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {formatLong(occurrence.starts_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {occurrence.series?.meeting_url && (
                        <Button asChild variant="outline" size="sm">
                          <a href={occurrence.series.meeting_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" /> Join link
                          </a>
                        </Button>
                      )}
                      {occurrence.status === "scheduled" && hasStarted && (
                        <Button
                          size="sm"
                          onClick={() => acknowledgeMutation.mutate(occurrence.id)}
                          disabled={acknowledgeMutation.isPending}
                        >
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Yes, I have joined
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState text="No meeting occurrences are materialized yet." />
          )}
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registered phones</CardTitle>
            <CardDescription>Push tokens are never displayed. Only safe device health is shown.</CardDescription>
          </CardHeader>
          <CardContent>
            {devicesQuery.data?.length ? (
              <div className="space-y-3">
                {devicesQuery.data.map((device) => (
                  <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <div className="font-medium">{device.device_label ?? `${device.platform} device`}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {device.platform.toUpperCase()} · App {device.app_version ?? "unknown"} · Last seen {formatLong(device.last_seen_at)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={device.enabled && device.notifications_granted ? "secondary" : "outline"}>
                        {device.enabled && device.notifications_granted ? "Alert ready" : "Needs attention"}
                      </Badge>
                      {device.platform === "android" && (
                        <span className="text-[10px] text-muted-foreground">
                          Exact alarms: {device.exact_alarm_capable ? "ready" : "not confirmed"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No mobile device has registered yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent notification delivery</CardTitle>
            <CardDescription>Server push attempts for meeting reminders and escalation alarms.</CardDescription>
          </CardHeader>
          <CardContent>
            {deliveriesQuery.data?.length ? (
              <div className="space-y-3">
                {deliveriesQuery.data.slice(0, 12).map((delivery) => (
                  <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{delivery.stage}</span>
                        {delivery.stage === "escalation" && <Badge variant="outline">#{delivery.sequence_no + 1}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatLong(delivery.queued_at)}</div>
                      {delivery.last_error && <div className="mt-1 text-xs text-destructive">{delivery.last_error}</div>}
                    </div>
                    <Badge variant={delivery.status === "sent" ? "secondary" : delivery.status === "failed" ? "destructive" : "outline"}>
                      {delivery.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No meeting notification has been dispatched yet." />
            )}
          </CardContent>
        </Card>
      </section>

      <Alert>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Phone operating-system rules still apply</AlertTitle>
        <AlertDescription>
          Android exact alarms require the phone’s Alarms & reminders permission. iPhone notifications
          use Time Sensitive delivery; bypassing mute/Focus as a true critical alarm requires Apple’s
          separately approved Critical Alerts entitlement.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function SeriesCard({
  series,
  draft,
  onDraft,
  saving,
  onSave,
}: {
  series: MeetingSeries;
  draft: SeriesDraft;
  onDraft: (draft: SeriesDraft) => void;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{series.name}</CardTitle>
            <CardDescription className="mt-1">{recurrenceLabel(series)}</CardDescription>
          </div>
          <Switch checked={draft.enabled} onCheckedChange={(enabled) => onDraft({ ...draft, enabled })} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${series.id}-time`}>Meeting time</Label>
            <Input
              id={`${series.id}-time`}
              type="time"
              value={draft.startTime.slice(0, 5)}
              onChange={(event) => onDraft({ ...draft, startTime: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${series.id}-url`}>Join URL (optional)</Label>
            <Input
              id={`${series.id}-url`}
              type="url"
              placeholder="https://…"
              value={draft.meetingUrl}
              onChange={(event) => onDraft({ ...draft, meetingUrl: event.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow
            title="10-minute reminder"
            detail={`“It's 10 minutes to ${series.name}.”`}
            checked={draft.reminder10}
            onChecked={(reminder10) => onDraft({ ...draft, reminder10 })}
          />
          <ToggleRow
            title="2-minute urgent reminder"
            detail={`“2 minutes to ${series.name} — drop everything…”`}
            checked={draft.reminder2}
            onChecked={(reminder2) => onDraft({ ...draft, reminder2 })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${series.id}-after`}>Escalate after start (minutes)</Label>
            <Input
              id={`${series.id}-after`}
              type="number"
              min={1}
              max={30}
              value={draft.escalationAfterMinutes}
              onChange={(event) => onDraft({ ...draft, escalationAfterMinutes: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${series.id}-repeat`}>Repeat alarm every (minutes)</Label>
            <Input
              id={`${series.id}-repeat`}
              type="number"
              min={1}
              max={30}
              value={draft.escalationRepeatMinutes}
              onChange={(event) => onDraft({ ...draft, escalationRepeatMinutes: Number(event.target.value) })}
            />
          </div>
        </div>

        <div className="rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
          Default escalation: {draft.escalationAfterMinutes} minutes after start, then every {draft.escalationRepeatMinutes} minutes until “Yes, I have joined” is acknowledged.
        </div>

        <Button onClick={onSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Save {series.name}
        </Button>
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  title,
  detail,
  checked,
  onChecked,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChecked: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChecked} />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CalendarClock;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {label}
        </CardDescription>
        <CardTitle className="text-xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function draftFromSeries(series: MeetingSeries): SeriesDraft {
  return {
    enabled: series.enabled,
    startTime: series.start_time.slice(0, 5),
    meetingUrl: series.meeting_url ?? "",
    reminder10: series.reminder_10_minutes,
    reminder2: series.reminder_2_minutes,
    escalationAfterMinutes: series.escalation_after_minutes,
    escalationRepeatMinutes: series.escalation_repeat_minutes,
  };
}

function recurrenceLabel(series: MeetingSeries) {
  if (series.recurrence_kind === "weekly" && series.weekday === 2) {
    return `Every Tuesday at ${displayTime(series.start_time)} · ${series.timezone}`;
  }
  if (series.recurrence_kind === "monthly_weekday_set" && series.weekday === 4) {
    return `Second and last Thursday of every month at ${displayTime(series.start_time)} · ${series.timezone}`;
  }
  return `Recurring meeting at ${displayTime(series.start_time)} · ${series.timezone}`;
}

function displayTime(value: string) {
  const [hourText = "0", minuteText = "00"] = value.split(":");
  const hour = Number(hourText);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minuteText} ${period}`;
}

function formatLong(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatShort(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-8" : "min-h-[280px]"}`}>
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}
