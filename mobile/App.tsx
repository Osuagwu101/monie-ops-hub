import type { Session } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { OperationsSnapshot } from "./src/components/OperationsSnapshot";
import {
  acknowledgeJoined,
  loadMyProfile,
  loadUpcomingMeetings,
  registerMobileDevice,
  type MeetingOccurrence,
  type MobileProfile,
} from "./src/lib/meetings";
import {
  cancelLocalMeetingAlerts,
  listenForMeetingActions,
  prepareNotificationReadiness,
  syncLocalMeetingBackups,
  type NotificationReadiness,
} from "./src/lib/notifications";
import { loadOperationsSnapshot, type MobileOperationsSnapshot } from "./src/lib/operations";
import { mobileCloudConfigured, supabase } from "./src/lib/supabase";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [meetings, setMeetings] = useState<MeetingOccurrence[]>([]);
  const [operations, setOperations] = useState<MobileOperationsSnapshot | null>(null);
  const [notificationReadiness, setNotificationReadiness] = useState<NotificationReadiness | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (currentSession: Session, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const currentProfile = await loadMyProfile(currentSession.user.id);
      setProfile(currentProfile);
      if (!currentProfile || currentProfile.role !== "director" || !currentProfile.is_active) {
        setMeetings([]);
        setOperations(null);
        return;
      }

      const [upcoming, operationsData] = await Promise.all([
        loadUpcomingMeetings(),
        loadOperationsSnapshot(),
      ]);
      setMeetings(upcoming);
      setOperations(operationsData);

      const readiness = await prepareNotificationReadiness();
      setNotificationReadiness(readiness);
      if (readiness.pushToken) {
        await registerMobileDevice({
          token: readiness.pushToken,
          platform: Device.osName?.toLowerCase().includes("ios") ? "ios" : "android",
          deviceLabel: Device.deviceName ?? Device.modelName ?? null,
          notificationsGranted: readiness.permissionGranted,
          exactAlarmCapable: readiness.exactAlarmCapable,
          appVersion: Constants.expoConfig?.version ?? null,
        });
      }
      if (readiness.permissionGranted) {
        await syncLocalMeetingBackups(upcoming);
      }
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  const acknowledge = useCallback(
    async (occurrenceId: string) => {
      try {
        await acknowledgeJoined(occurrenceId);
        await cancelLocalMeetingAlerts(occurrenceId);
        if (session) await loadData(session, true);
      } catch (caught) {
        Alert.alert("Could not acknowledge", messageOf(caught));
      }
    },
    [loadData, session],
  );

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setMeetings([]);
        setOperations(null);
        setNotificationReadiness(null);
        setLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadData(session);
  }, [loadData, session]);

  useEffect(() => {
    if (!session || profile?.role !== "director") return;
    const subscription = listenForMeetingActions(acknowledge);
    return () => subscription.remove();
  }, [acknowledge, profile?.role, session]);

  useEffect(() => {
    if (!session) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadData(session, true);
    });
    return () => subscription.remove();
  }, [loadData, session]);

  if (!mobileCloudConfigured) {
    return <ConfigurationScreen />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (loading) {
    return <LoadingScreen label="Synchronising Moniepoint BRM…" />;
  }

  if (!profile || profile.role !== "director" || !profile.is_active) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <BrandMark />
          <Text style={styles.centerTitle}>Director account required</Text>
          <Text style={styles.centerBody}>
            This first Moniepoint BRM mobile release is the Director companion. Your account is not
            currently an active Director profile.
          </Text>
          <PrimaryButton title="Sign out" onPress={() => void supabase.auth.signOut()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <DirectorHome
      profile={profile}
      meetings={meetings}
      operations={operations}
      notificationReadiness={notificationReadiness}
      refreshing={refreshing}
      error={error}
      onRefresh={() => void loadData(session, true)}
      onAcknowledge={(id) => void acknowledge(id)}
    />
  );
}

function DirectorHome({
  profile,
  meetings,
  operations,
  notificationReadiness,
  refreshing,
  error,
  onRefresh,
  onAcknowledge,
}: {
  profile: MobileProfile;
  meetings: MeetingOccurrence[];
  operations: MobileOperationsSnapshot | null;
  notificationReadiness: NotificationReadiness | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onAcknowledge: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const nextMeeting = useMemo(
    () =>
      meetings.find(
        (item) => item.status === "scheduled" && new Date(item.starts_at).getTime() > now,
      ),
    [meetings, now],
  );
  const activeMeeting = useMemo(
    () =>
      meetings.find((item) => {
        const start = new Date(item.starts_at).getTime();
        return item.status === "scheduled" && start <= now && now <= start + 6 * 60 * 60_000;
      }),
    [meetings, now],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <BrandMark small />
            <View>
              <Text style={styles.brandTitle}>Moniepoint BRM</Text>
              <Text style={styles.brandSubtitle}>Director mobile companion</Text>
            </View>
          </View>
          <Pressable style={styles.signOutButton} onPress={() => void supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.greeting}>Good day, {firstName(profile.full_name)}</Text>
        <Text style={styles.greetingSub}>
          Your operations and meeting alerts stay synced with the web portal.
        </Text>

        {error ? (
          <View style={[styles.notice, styles.noticeError]}>
            <Text style={styles.noticeTitle}>Sync needs attention</Text>
            <Text style={styles.noticeBody}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Portal snapshot</Text>
          <Text style={styles.sectionHint}>Same live backend</Text>
        </View>
        <OperationsSnapshot data={operations} />

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Meetings</Text>
          <Text style={styles.sectionHint}>Acknowledgement synced</Text>
        </View>

        {activeMeeting ? (
          <View style={[styles.card, styles.activeCard]}>
            <View style={styles.cardTopRow}>
              <Pill text="MEETING STARTED" strong />
              <Text style={styles.timeText}>{timeOnly(activeMeeting.starts_at)}</Text>
            </View>
            <Text style={styles.heroTitle}>{activeMeeting.series?.name ?? "Meeting"}</Text>
            <Text style={styles.heroBody}>
              Acknowledge as soon as you have joined. This stops the repeating alarm cycle.
            </Text>
            {activeMeeting.series?.meeting_url ? (
              <PrimaryButton
                title="Join meeting"
                onPress={() => void Linking.openURL(activeMeeting.series!.meeting_url!)}
              />
            ) : null}
            <Pressable style={styles.ackButton} onPress={() => onAcknowledge(activeMeeting.id)}>
              <Text style={styles.ackButtonText}>Yes, I have joined</Text>
            </Pressable>
          </View>
        ) : nextMeeting ? (
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Pill text="NEXT MEETING" />
              <Text style={styles.timeText}>{timeOnly(nextMeeting.starts_at)}</Text>
            </View>
            <Text style={styles.heroTitle}>{nextMeeting.series?.name ?? "Meeting"}</Text>
            <Text style={styles.meetingDate}>{dateOnly(nextMeeting.starts_at)}</Text>
            <Text style={styles.countdown}>
              {countdownText(new Date(nextMeeting.starts_at).getTime() - now)}
            </Text>
            {nextMeeting.series?.meeting_url ? (
              <PrimaryButton
                title="Open meeting link"
                onPress={() => void Linking.openURL(nextMeeting.series!.meeting_url!)}
              />
            ) : (
              <Text style={styles.mutedSmall}>
                A meeting URL can be added from the web Meeting Centre.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.card}>
            <Pill text="CALENDAR" />
            <Text style={styles.heroTitle}>No upcoming meeting is currently materialized.</Text>
            <Text style={styles.heroBody}>
              Pull down to refresh after the Director Meeting Centre is updated.
            </Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Notification readiness</Text>
          <Text style={styles.sectionHint}>Local + push</Text>
        </View>
        <View style={styles.card}>
          <ReadinessRow
            title="Notification permission"
            ready={notificationReadiness?.permissionGranted ?? false}
            detail={notificationReadiness?.permissionGranted ? "Granted" : "Permission needed"}
          />
          <Divider />
          <ReadinessRow
            title="Local backup alarms"
            ready={notificationReadiness?.permissionGranted ?? false}
            detail="Nearest meeting is pre-scheduled on this phone"
          />
          <Divider />
          <ReadinessRow
            title="Server push registration"
            ready={Boolean(notificationReadiness?.pushToken)}
            detail={notificationReadiness?.pushToken ? "Registered" : "Activation pending"}
          />
          {notificationReadiness ? (
            <Text style={styles.readinessNote}>{notificationReadiness.note}</Text>
          ) : null}
          {notificationReadiness && !notificationReadiness.exactAlarmCapable ? (
            <Text style={styles.readinessWarning}>
              Android: enable “Alarms & reminders” for the strongest exact-timing behavior.
            </Text>
          ) : null}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Upcoming meetings</Text>
          <Text style={styles.sectionHint}>Africa/Lagos schedule</Text>
        </View>
        <View style={styles.cardList}>
          {meetings
            .filter((item) => new Date(item.starts_at).getTime() >= now - 30 * 60_000)
            .slice(0, 8)
            .map((meeting) => (
              <MeetingRow
                key={meeting.id}
                meeting={meeting}
                onAcknowledge={onAcknowledge}
                now={now}
              />
            ))}
          {!meetings.length ? <Text style={styles.emptyText}>No meetings loaded yet.</Text> : null}
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>Reminder pattern</Text>
          <Text style={styles.footerBody}>10 minutes before: short preparation bing.</Text>
          <Text style={styles.footerBody}>2 minutes before: urgent drop-everything reminder.</Text>
          <Text style={styles.footerBody}>
            4 minutes after start: repeated alarms until you acknowledge joining.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MeetingRow({
  meeting,
  onAcknowledge,
  now,
}: {
  meeting: MeetingOccurrence;
  onAcknowledge: (id: string) => void;
  now: number;
}) {
  const started = new Date(meeting.starts_at).getTime() <= now;
  return (
    <View style={styles.meetingRow}>
      <View style={styles.meetingDateBox}>
        <Text style={styles.meetingDateDay}>{dayNumber(meeting.starts_at)}</Text>
        <Text style={styles.meetingDateMonth}>{monthShort(meeting.starts_at)}</Text>
      </View>
      <View style={styles.meetingInfo}>
        <Text style={styles.meetingName}>{meeting.series?.name ?? "Meeting"}</Text>
        <Text style={styles.meetingMeta}>
          {weekdayLong(meeting.starts_at)} · {timeOnly(meeting.starts_at)}
        </Text>
        <Text style={styles.meetingStatus}>
          {meeting.status === "joined" ? "Joined acknowledged" : started ? "Started" : "Scheduled"}
        </Text>
      </View>
      {meeting.status === "scheduled" && started ? (
        <Pressable style={styles.smallAck} onPress={() => onAcknowledge(meeting.id)}>
          <Text style={styles.smallAckText}>Joined</Text>
        </Pressable>
      ) : meeting.series?.meeting_url ? (
        <Pressable onPress={() => void Linking.openURL(meeting.series!.meeting_url!)}>
          <Text style={styles.linkText}>Open</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) setError(authError.message);
    setBusy(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.loginPage}>
        <BrandMark />
        <Text style={styles.loginTitle}>Moniepoint BRM</Text>
        <Text style={styles.loginSubtitle}>Use the same Director account as the web portal.</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="director@example.com"
            placeholderTextColor="#98A2B3"
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor="#98A2B3"
            onSubmitEditing={() => void signIn()}
          />
        </View>
        {error ? <Text style={styles.loginError}>{error}</Text> : null}
        <PrimaryButton
          title={busy ? "Signing in…" : "Sign in"}
          disabled={busy}
          onPress={() => void signIn()}
        />
      </View>
    </SafeAreaView>
  );
}

function ConfigurationScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.centeredPage}>
        <BrandMark />
        <Text style={styles.centerTitle}>Mobile environment not configured</Text>
        <Text style={styles.centerBody}>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to the same Supabase
          project used by the web portal. For remote push, also set EXPO_PUBLIC_EAS_PROJECT_ID.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.centeredPage}>
        <BrandMark />
        <ActivityIndicator size="large" color={BLUE} />
        <Text style={styles.centerBody}>{label}</Text>
      </View>
    </SafeAreaView>
  );
}

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <View style={[styles.brandMark, small && styles.brandMarkSmall]}>
      <Image
        source={require("./assets/icon.png")}
        resizeMode="contain"
        style={[styles.brandMarkImage, small && styles.brandMarkImageSmall]}
      />
    </View>
  );
}

function Pill({ text, strong = false }: { text: string; strong?: boolean }) {
  return (
    <View style={[styles.pill, strong && styles.pillStrong]}>
      <Text style={[styles.pillText, strong && styles.pillTextStrong]}>{text}</Text>
    </View>
  );
}

function PrimaryButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.primaryButton, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      {disabled ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.primaryButtonText}>{title}</Text>
      )}
    </Pressable>
  );
}

function ReadinessRow({ title, ready, detail }: { title: string; ready: boolean; detail: string }) {
  return (
    <View style={styles.readinessRow}>
      <View style={[styles.dot, ready ? styles.dotReady : styles.dotPending]} />
      <View style={styles.readinessText}>
        <Text style={styles.readinessTitle}>{title}</Text>
        <Text style={styles.readinessDetail}>{detail}</Text>
      </View>
      <Text style={[styles.readinessState, ready ? styles.readyText : styles.pendingText]}>
        {ready ? "READY" : "PENDING"}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function countdownText(ms: number) {
  if (ms <= 0) return "Starting now";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} away`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours < 24) return `${hours}h ${remaining}m away`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} away`;
}

function timeOnly(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}
function dateOnly(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}
function weekdayLong(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(value));
}
function dayNumber(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(new Date(value));
}
function monthShort(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short" })
    .format(new Date(value))
    .toUpperCase();
}
function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "Director";
}
function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong while synchronising the app.";
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  page: { padding: 20, paddingBottom: 48, gap: 18 },
  centeredPage: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 18 },
  loginPage: { flex: 1, justifyContent: "center", padding: 28, gap: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: {
    width: 112,
    height: 72,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    padding: 5,
  },
  brandMarkSmall: { width: 76, height: 48, borderRadius: 13, padding: 3 },
  brandMarkImage: { width: "100%", height: "100%" },
  brandMarkImageSmall: { width: "100%", height: "100%" },
  brandTitle: { color: INK, fontSize: 18, fontWeight: "800" },
  brandSubtitle: { color: MUTED, fontSize: 11, marginTop: 2 },
  signOutButton: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  greeting: { color: INK, fontSize: 27, fontWeight: "900", letterSpacing: -0.8, marginTop: 4 },
  greetingSub: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: -12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  activeCard: { borderColor: BLUE, borderWidth: 2, backgroundColor: "#F4F8FF" },
  cardList: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    overflow: "hidden",
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: "#EAF1FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillStrong: { backgroundColor: BLUE },
  pillText: { color: BLUE, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  pillTextStrong: { color: "#FFFFFF" },
  timeText: { color: INK, fontSize: 14, fontWeight: "800" },
  heroTitle: { color: INK, fontSize: 25, fontWeight: "900", letterSpacing: -0.5 },
  heroBody: { color: MUTED, fontSize: 13, lineHeight: 20 },
  meetingDate: { color: MUTED, fontSize: 14, marginTop: -5 },
  countdown: { color: BLUE, fontSize: 18, fontWeight: "800" },
  mutedSmall: { color: MUTED, fontSize: 12, lineHeight: 18 },
  primaryButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  buttonDisabled: { opacity: 0.65 },
  ackButton: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: BLUE,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  ackButtonText: { color: BLUE, fontSize: 15, fontWeight: "900" },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sectionTitle: { color: INK, fontSize: 18, fontWeight: "900" },
  sectionHint: { color: MUTED, fontSize: 11, fontWeight: "600" },
  readinessRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotReady: { backgroundColor: "#12B76A" },
  dotPending: { backgroundColor: "#F79009" },
  readinessText: { flex: 1 },
  readinessTitle: { color: INK, fontSize: 13, fontWeight: "800" },
  readinessDetail: { color: MUTED, fontSize: 11, marginTop: 2 },
  readinessState: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  readyText: { color: "#039855" },
  pendingText: { color: "#DC6803" },
  readinessNote: { color: MUTED, fontSize: 11, lineHeight: 17, paddingTop: 4 },
  readinessWarning: {
    color: "#B54708",
    fontSize: 11,
    lineHeight: 17,
    backgroundColor: "#FFFAEB",
    padding: 10,
    borderRadius: 10,
  },
  divider: { height: 1, backgroundColor: BORDER },
  meetingRow: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  meetingDateBox: {
    width: 48,
    height: 52,
    borderRadius: 12,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },
  meetingDateDay: { color: INK, fontSize: 18, fontWeight: "900" },
  meetingDateMonth: { color: MUTED, fontSize: 9, fontWeight: "800", marginTop: 1 },
  meetingInfo: { flex: 1 },
  meetingName: { color: INK, fontSize: 14, fontWeight: "800" },
  meetingMeta: { color: MUTED, fontSize: 11, marginTop: 3 },
  meetingStatus: { color: BLUE, fontSize: 10, fontWeight: "800", marginTop: 4 },
  smallAck: { backgroundColor: BLUE, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  smallAckText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  linkText: { color: BLUE, fontSize: 12, fontWeight: "800" },
  footerCard: { backgroundColor: "#F4F8FF", borderRadius: 18, padding: 16, gap: 7 },
  footerTitle: { color: INK, fontSize: 14, fontWeight: "900" },
  footerBody: { color: MUTED, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: 14, padding: 14 },
  noticeError: { backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA" },
  noticeTitle: { color: "#B42318", fontSize: 13, fontWeight: "900" },
  noticeBody: { color: "#B42318", fontSize: 11, lineHeight: 17, marginTop: 3 },
  emptyText: { color: MUTED, fontSize: 12, textAlign: "center", padding: 28 },
  loginTitle: { color: INK, fontSize: 32, fontWeight: "900", letterSpacing: -1, marginTop: 10 },
  loginSubtitle: { color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 8 },
  inputGroup: { gap: 7 },
  inputLabel: { color: INK, fontSize: 12, fontWeight: "800" },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 15,
    color: INK,
    backgroundColor: "#FFFFFF",
    fontSize: 15,
  },
  loginError: { color: "#B42318", fontSize: 12, lineHeight: 18 },
  centerTitle: { color: INK, fontSize: 24, fontWeight: "900", textAlign: "center" },
  centerBody: { color: MUTED, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 360 },
});
