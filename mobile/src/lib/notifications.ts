import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { MeetingOccurrence } from "./meetings";

export const ACK_ACTION = "ACK_JOINED";
export const MEETING_CATEGORY = "MEETING_JOIN_ACK";
const SCHEDULE_STORAGE_KEY = "moniepoint-brm:meeting-local-schedules";

interface ScheduledMap {
  [occurrenceId: string]: string[];
}

export interface NotificationReadiness {
  permissionGranted: boolean;
  pushToken: string | null;
  projectIdConfigured: boolean;
  physicalDevice: boolean;
  exactAlarmCapable: boolean;
  note: string;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function configureNotificationExperience() {
  await Notifications.setNotificationCategoryAsync(MEETING_CATEGORY, [
    {
      identifier: ACK_ACTION,
      buttonTitle: "Yes, I have joined",
      options: { opensAppToForeground: true },
    },
  ]);

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("meeting-reminders", {
      name: "Meeting reminders",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "meeting-bing.wav",
      vibrationPattern: [0, 180, 100, 180],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    await Notifications.setNotificationChannelAsync("meeting-alarms", {
      name: "Meeting alarms",
      importance: Notifications.AndroidImportance.MAX,
      sound: "meeting-bing.wav",
      vibrationPattern: [0, 300, 120, 300, 120, 500],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    });
  }
}

export async function prepareNotificationReadiness(): Promise<NotificationReadiness> {
  await configureNotificationExperience();
  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
      ? existing
      : await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });

  const permissionGranted =
    permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.["eas"]?.projectId;

  let pushToken: string | null = null;
  let note = permissionGranted
    ? "Local meeting alarms are ready."
    : "Notification permission is not granted.";

  if (permissionGranted && Device.isDevice && projectId) {
    try {
      pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      note = "Push and local meeting reminders are ready.";
    } catch {
      note = "Local reminders are ready; push registration will retry when native push credentials are available.";
    }
  } else if (!Device.isDevice) {
    note = "Local UI can be tested here, but remote push registration requires a physical device.";
  } else if (!projectId) {
    note = "Local reminders are ready; set EXPO_PUBLIC_EAS_PROJECT_ID before remote push registration.";
  }

  return {
    permissionGranted,
    pushToken,
    projectIdConfigured: Boolean(projectId),
    physicalDevice: Device.isDevice,
    exactAlarmCapable: Platform.OS !== "android" ? true : false,
    note,
  };
}

export async function syncLocalMeetingBackups(occurrences: MeetingOccurrence[]) {
  const existing = await readScheduleMap();
  for (const ids of Object.values(existing)) {
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  }

  const next = occurrences.find(
    (occurrence) => occurrence.status === "scheduled" && new Date(occurrence.starts_at).getTime() > Date.now(),
  );
  if (!next?.series) {
    await AsyncStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify({}));
    return;
  }

  const ids: string[] = [];
  const startsAt = new Date(next.starts_at).getTime();

  if (next.series.reminder_10_minutes) {
    const id = await scheduleAt(
      startsAt - 10 * 60_000,
      `10 minutes to ${next.series.name}`,
      `It's 10 minutes to ${next.series.name}.`,
      next,
      "pre10",
      "meeting-reminders",
    );
    if (id) ids.push(id);
  }

  if (next.series.reminder_2_minutes) {
    const id = await scheduleAt(
      startsAt - 2 * 60_000,
      `2 minutes to ${next.series.name}`,
      `2 minutes to ${next.series.name} — drop everything you're doing and join now.`,
      next,
      "pre2",
      "meeting-reminders",
    );
    if (id) ids.push(id);
  }

  const firstEscalation = startsAt + next.series.escalation_after_minutes * 60_000;
  const repeatMs = Math.max(next.series.escalation_repeat_minutes, 1) * 60_000;
  for (let index = 0; index < 9; index += 1) {
    const id = await scheduleAt(
      firstEscalation + index * repeatMs,
      `${next.series.name} has started`,
      `${next.series.name} has started. Have you joined? Tap “Yes, I have joined” to stop these reminders.`,
      next,
      "escalation",
      "meeting-alarms",
    );
    if (id) ids.push(id);
  }

  await AsyncStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify({ [next.id]: ids }));
}

export async function cancelLocalMeetingAlerts(occurrenceId: string) {
  const map = await readScheduleMap();
  const ids = map[occurrenceId] ?? [];
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  delete map[occurrenceId];
  await AsyncStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(map));
  await Notifications.dismissAllNotificationsAsync();
}

export function listenForMeetingActions(onAcknowledge: (occurrenceId: string) => Promise<void>) {
  const handleResponse = async (response: Notifications.NotificationResponse | null) => {
    if (!response || response.actionIdentifier !== ACK_ACTION) return;
    const occurrenceId = response.notification.request.content.data?.["occurrenceId"];
    if (typeof occurrenceId === "string" && occurrenceId) {
      await onAcknowledge(occurrenceId);
      await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
    }
  };

  void Notifications.getLastNotificationResponseAsync().then(handleResponse);
  return Notifications.addNotificationResponseReceivedListener((response) => {
    void handleResponse(response);
  });
}

async function scheduleAt(
  timestamp: number,
  title: string,
  body: string,
  occurrence: MeetingOccurrence,
  stage: "pre10" | "pre2" | "escalation",
  channelId: string,
) {
  if (timestamp <= Date.now() + 5_000) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "meeting-bing.wav",
      categoryIdentifier: MEETING_CATEGORY,
      interruptionLevel: "timeSensitive",
      data: {
        type: "meeting_reminder",
        stage,
        occurrenceId: occurrence.id,
        startsAt: occurrence.starts_at,
        meetingUrl: occurrence.series?.meeting_url ?? null,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(timestamp),
      channelId,
    },
  });
}

async function readScheduleMap(): Promise<ScheduledMap> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ScheduledMap;
  } catch {
    return {};
  }
}
