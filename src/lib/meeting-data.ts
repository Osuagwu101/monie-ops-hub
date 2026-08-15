import { callRpc, restSelect } from "@/lib/cloud-api";

export interface MeetingSeries {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  timezone: string;
  recurrence_kind: "weekly" | "monthly_weekday_set";
  weekday: number;
  month_ordinals: number[];
  start_time: string;
  meeting_url: string | null;
  reminder_10_minutes: boolean;
  reminder_2_minutes: boolean;
  escalation_after_minutes: number;
  escalation_repeat_minutes: number;
  escalation_max_hours: number;
  updated_at: string;
}

export interface MeetingOccurrence {
  id: string;
  series_id: string;
  starts_at: string;
  status: "scheduled" | "joined" | "cancelled";
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  series?: MeetingSeries | undefined;
}

export interface MobileDevice {
  id: string;
  user_id: string;
  platform: "ios" | "android";
  device_label: string | null;
  notifications_granted: boolean;
  exact_alarm_capable: boolean;
  app_version: string | null;
  enabled: boolean;
  last_seen_at: string;
}

export interface MeetingDelivery {
  id: string;
  occurrence_id: string;
  stage: "pre10" | "pre2" | "escalation";
  sequence_no: number;
  status: "queued" | "sent" | "failed" | "cancelled";
  last_error: string | null;
  queued_at: string;
  sent_at: string | null;
}

export interface UpdateMeetingSeriesInput {
  id: string;
  enabled: boolean;
  startTime: string;
  meetingUrl: string | null;
  reminder10: boolean;
  reminder2: boolean;
  escalationAfterMinutes: number;
  escalationRepeatMinutes: number;
}

export async function loadMeetingSeries(accessToken: string) {
  return restSelect<MeetingSeries[]>(
    "meeting_series?select=id,slug,name,enabled,timezone,recurrence_kind,weekday,month_ordinals,start_time,meeting_url,reminder_10_minutes,reminder_2_minutes,escalation_after_minutes,escalation_repeat_minutes,escalation_max_hours,updated_at&order=name.asc",
    accessToken,
  );
}

export async function loadMeetingOccurrences(accessToken: string, limit = 40) {
  const now = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const rows = await restSelect<MeetingOccurrence[]>(
    `meeting_occurrences?select=id,series_id,starts_at,status,acknowledged_at,acknowledged_by&starts_at=gte.${encodeURIComponent(now)}&order=starts_at.asc&limit=${limit}`,
    accessToken,
  );
  if (!rows.length) return rows;
  const series = await loadMeetingSeries(accessToken);
  const seriesMap = new Map(series.map((item) => [item.id, item]));
  return rows.map((row) => ({ ...row, series: seriesMap.get(row.series_id) }));
}

export async function loadMobileDevices(accessToken: string) {
  return restSelect<MobileDevice[]>(
    "mobile_devices?select=id,user_id,platform,device_label,notifications_granted,exact_alarm_capable,app_version,enabled,last_seen_at&order=last_seen_at.desc",
    accessToken,
  );
}

export async function loadMeetingDeliveries(accessToken: string, limit = 60) {
  return restSelect<MeetingDelivery[]>(
    `meeting_notification_deliveries?select=id,occurrence_id,stage,sequence_no,status,last_error,queued_at,sent_at&order=queued_at.desc&limit=${limit}`,
    accessToken,
  );
}

export async function updateMeetingSeries(input: UpdateMeetingSeriesInput, accessToken: string) {
  return callRpc<MeetingSeries>(
    "update_meeting_series",
    {
      p_id: input.id,
      p_enabled: input.enabled,
      p_start_time: input.startTime,
      p_meeting_url: input.meetingUrl,
      p_reminder_10_minutes: input.reminder10,
      p_reminder_2_minutes: input.reminder2,
      p_escalation_after_minutes: input.escalationAfterMinutes,
      p_escalation_repeat_minutes: input.escalationRepeatMinutes,
    },
    accessToken,
  );
}

export async function refreshMeetingCalendar(accessToken: string) {
  return callRpc<{ occurrencesCreated: number }>("refresh_meeting_calendar", {}, accessToken);
}

export async function acknowledgeMeetingOccurrence(occurrenceId: string, accessToken: string) {
  return callRpc<MeetingOccurrence>(
    "acknowledge_meeting_occurrence",
    { p_occurrence_id: occurrenceId },
    accessToken,
  );
}
