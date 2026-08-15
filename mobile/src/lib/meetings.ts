import { supabase } from "./supabase";

export interface MobileProfile {
  id: string;
  full_name: string;
  role: "director" | "assistant";
  is_active: boolean;
}

export interface MeetingSeries {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  timezone: string;
  start_time: string;
  meeting_url: string | null;
  reminder_10_minutes: boolean;
  reminder_2_minutes: boolean;
  escalation_after_minutes: number;
  escalation_repeat_minutes: number;
}

export interface MeetingOccurrence {
  id: string;
  series_id: string;
  starts_at: string;
  status: "scheduled" | "joined" | "cancelled";
  acknowledged_at: string | null;
  series: MeetingSeries | null;
}

export async function loadMyProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as MobileProfile | null;
}

export async function loadUpcomingMeetings(limit = 24) {
  const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: occurrences, error } = await supabase
    .from("meeting_occurrences")
    .select("id,series_id,starts_at,status,acknowledged_at")
    .gte("starts_at", from)
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const seriesIds = [...new Set((occurrences ?? []).map((item) => item.series_id))];
  let series: MeetingSeries[] = [];
  if (seriesIds.length) {
    const { data, error: seriesError } = await supabase
      .from("meeting_series")
      .select(
        "id,slug,name,enabled,timezone,start_time,meeting_url,reminder_10_minutes,reminder_2_minutes,escalation_after_minutes,escalation_repeat_minutes",
      )
      .in("id", seriesIds);
    if (seriesError) throw seriesError;
    series = (data ?? []) as MeetingSeries[];
  }

  const seriesMap = new Map(series.map((item) => [item.id, item]));
  return (occurrences ?? []).map((item) => ({
    ...item,
    series: seriesMap.get(item.series_id) ?? null,
  })) as MeetingOccurrence[];
}

export async function acknowledgeJoined(occurrenceId: string) {
  const { data, error } = await supabase.rpc("acknowledge_meeting_occurrence", {
    p_occurrence_id: occurrenceId,
  });
  if (error) throw error;
  return data;
}

export async function registerMobileDevice(input: {
  token: string;
  platform: "ios" | "android";
  deviceLabel: string | null;
  notificationsGranted: boolean;
  exactAlarmCapable: boolean;
  appVersion: string | null;
}) {
  const { data, error } = await supabase.rpc("register_mobile_device", {
    p_expo_push_token: input.token,
    p_platform: input.platform,
    p_device_label: input.deviceLabel,
    p_notifications_granted: input.notificationsGranted,
    p_exact_alarm_capable: input.exactAlarmCapable,
    p_app_version: input.appVersion,
  });
  if (error) throw error;
  return data;
}
