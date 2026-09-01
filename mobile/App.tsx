import type { Session } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AgentWorkspace } from "./src/components/AgentWorkspace";
import {
  DirectorMerchantsTerminals,
  DirectorOverviewStatus,
  DirectorReports,
} from "./src/components/DirectorOperations";
import { DirectorTaskAssignment } from "./src/components/DirectorTaskAssignment";
import {
  AutomationSection,
  OperationsTeamSection,
  ReadinessSection,
  StaffAccountsSection,
} from "./src/components/DirectorPortalSections";
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

type DirectorSection =
  | "overview"
  | "assignments"
  | "reports"
  | "merchants"
  | "meetings"
  | "staff"
  | "automation"
  | "readiness"
  | "operations-team"
  | "profile";

interface DirectorMenuGroup {
  label: "WORKSPACE" | "OPERATIONS" | "ADMINISTRATION" | "ACCOUNT";
  directorOnly?: boolean;
  items: Array<{ key: DirectorSection; label: string; short: string }>;
}

const DIRECTOR_MENU_GROUPS: DirectorMenuGroup[] = [
  {
    label: "WORKSPACE",
    items: [
      { key: "overview", label: "Overview", short: "OV" },
      { key: "assignments", label: "Daily Tasks", short: "DT" },
      { key: "reports", label: "Official Reports", short: "RP" },
    ],
  },
  {
    label: "OPERATIONS",
    items: [
      { key: "merchants", label: "Merchants & Terminals", short: "MT" },
      { key: "meetings", label: "Meetings & Alerts", short: "ME" },
      { key: "operations-team", label: "Operations Team", short: "OT" },
    ],
  },
  {
    label: "ADMINISTRATION",
    directorOnly: true,
    items: [
      { key: "staff", label: "Staff Accounts", short: "ST" },
      { key: "automation", label: "Automation", short: "AU" },
      { key: "readiness", label: "Readiness", short: "RD" },
    ],
  },
  {
    label: "ACCOUNT",
    items: [{ key: "profile", label: "Profile", short: "PR" }],
  },
];

const DIRECTOR_MENU = DIRECTOR_MENU_GROUPS.flatMap((group) => group.items);

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
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const hadSessionRef = useRef(false);
  const manualSignOutRef = useRef(false);

  const signOut = useCallback(async () => {
    manualSignOutRef.current = true;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      manualSignOutRef.current = false;
      Alert.alert("Could not sign out", signOutError.message);
    }
  }, []);

  const loadData = useCallback(async (currentSession: Session, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const currentProfile = await loadMyProfile(currentSession.user.id);
      setProfile(currentProfile);
      if (!currentProfile || !currentProfile.is_active) {
        setMeetings([]);
        setOperations(null);
        return;
      }
      if (currentProfile.role !== "director") {
        setMeetings([]);
        setOperations(null);
        setNotificationReadiness(null);
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
      hadSessionRef.current = Boolean(data.session);
      if (!data.session) setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const hadSession = hadSessionRef.current;
      setSession(nextSession);
      hadSessionRef.current = Boolean(nextSession);
      if (nextSession) setAuthNotice(null);
      if (!nextSession) {
        if (manualSignOutRef.current) {
          setAuthNotice("Signed out successfully.");
          manualSignOutRef.current = false;
        } else if (hadSession && event === "SIGNED_OUT") {
          setAuthNotice("Your session expired. Sign in again.");
        }
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
    return <LoginScreen notice={authNotice} />;
  }

  if (loading) {
    return <LoadingScreen label="Synchronising Moniepoint BRM…" />;
  }

  if (!profile || !profile.is_active) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.centeredPage}>
          <BrandMark />
          <Text style={styles.centerTitle}>Active account required</Text>
          <Text style={styles.centerBody}>
            This account is not currently active in Monie Ops Hub. Contact the Admin if access
            should be restored.
          </Text>
          <PrimaryButton title="Sign out" onPress={() => void signOut()} />
        </View>
      </SafeAreaView>
    );
  }

  if (profile.role === "assistant") {
    return <AgentWorkspace profile={profile} onSignOut={() => void signOut()} />;
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
      onSignOut={() => void signOut()}
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
  onSignOut,
}: {
  profile: MobileProfile;
  meetings: MeetingOccurrence[];
  operations: MobileOperationsSnapshot | null;
  notificationReadiness: NotificationReadiness | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onAcknowledge: (id: string) => void;
  onSignOut: () => void;
}) {
  const [section, setSection] = useState<DirectorSection>("overview");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDirector = profile.role === "director";
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
  const sectionLabel = DIRECTOR_MENU.find((item) => item.key === section)?.label ?? "Overview";
  const chooseSection = (next: DirectorSection) => {
    setSection(next);
    setDrawerOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.mobileHeader}>
        <Pressable
          style={styles.menuButton}
          onPress={() => setDrawerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
        >
          <Text style={styles.menuGlyph}>☰</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.mobileHeaderTitle}>{sectionLabel}</Text>
          <Text style={styles.mobileHeaderSubtitle}>Monie Ops Hub</Text>
        </View>
        <Pressable
          style={styles.refreshButton}
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh portal data"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={BLUE} />
          ) : (
            <Text style={styles.refreshGlyph}>↻</Text>
          )}
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} />
        }
      >
        {section === "overview" ? (
          <View>
            <Text style={styles.greeting}>Good day, {firstName(profile.full_name)}</Text>
            <Text style={styles.overviewSub}>
              Your full Director workspace stays synchronized with the web portal.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.notice, styles.noticeError]}>
            <Text style={styles.noticeTitle}>Sync needs attention</Text>
            <Text style={styles.noticeBody}>{error}</Text>
          </View>
        ) : null}

        {section === "overview" ? (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Portal snapshot</Text>
              <Text style={styles.sectionHint}>Same live backend</Text>
            </View>
            <DirectorOverviewStatus operations={operations} refreshSignal={refreshing} />
            <OperationsSnapshot data={operations} />
          </View>
        ) : null}

        {section === "reports" ? <DirectorReports onPortalRefresh={onRefresh} /> : null}
        {section === "merchants" ? <DirectorMerchantsTerminals /> : null}
        {section === "assignments" ? (
          <DirectorTaskAssignment
            directorId={profile.id}
            canEditContacts={isDirector}
            refreshSignal={refreshing}
          />
        ) : null}
        {isDirector && section === "staff" ? (
          <StaffAccountsSection refreshSignal={refreshing} />
        ) : null}
        {isDirector && section === "automation" ? (
          <AutomationSection refreshSignal={refreshing} />
        ) : null}
        {isDirector && section === "readiness" ? (
          <ReadinessSection refreshSignal={refreshing} />
        ) : null}
        {section === "operations-team" ? (
          <OperationsTeamSection refreshSignal={refreshing} />
        ) : null}

        <View style={section === "meetings" ? styles.sectionHeaderRow : styles.hidden}>
          <Text style={styles.sectionTitle}>Meetings</Text>
          <Text style={styles.sectionHint}>Acknowledgement synced</Text>
        </View>

        {section === "meetings" && activeMeeting ? (
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
        ) : section === "meetings" && nextMeeting ? (
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
        ) : section === "meetings" ? (
          <View style={styles.card}>
            <Pill text="CALENDAR" />
            <Text style={styles.heroTitle}>No upcoming meeting is currently materialized.</Text>
            <Text style={styles.heroBody}>
              Pull down to refresh after the Director Meeting Centre is updated.
            </Text>
          </View>
        ) : null}

        <View style={section === "meetings" ? styles.sectionHeaderRow : styles.hidden}>
          <Text style={styles.sectionTitle}>Notification readiness</Text>
          <Text style={styles.sectionHint}>Local + push</Text>
        </View>
        <View style={[styles.card, section !== "meetings" && styles.hidden]}>
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

        <View style={section === "meetings" ? styles.sectionHeaderRow : styles.hidden}>
          <Text style={styles.sectionTitle}>Upcoming meetings</Text>
          <Text style={styles.sectionHint}>Africa/Lagos schedule</Text>
        </View>
        <View style={[styles.cardList, section !== "meetings" && styles.hidden]}>
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

        <View style={[styles.footerCard, section !== "meetings" && styles.hidden]}>
          <Text style={styles.footerTitle}>Reminder pattern</Text>
          <Text style={styles.footerBody}>10 minutes before: short preparation bing.</Text>
          <Text style={styles.footerBody}>2 minutes before: urgent drop-everything reminder.</Text>
          <Text style={styles.footerBody}>
            4 minutes after start: repeated alarms until you acknowledge joining.
          </Text>
        </View>

        {section === "profile" ? (
          <View style={styles.card}>
            <Pill text="DIRECTOR" strong />
            <Text style={styles.heroTitle}>{profile.full_name}</Text>
            <Text style={styles.heroBody}>
              This mobile session uses the same active Director account and production Supabase
              permissions as the web portal.
            </Text>
            <PrimaryButton title="Sign out" onPress={onSignOut} />
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={drawerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawerOpen(false)}
      >
        <View style={styles.drawerBackdrop}>
          <View style={styles.drawerPanel}>
            <View style={styles.drawerBrand}>
              <BrandMark small />
              <View style={styles.flexOne}>
                <Text style={styles.drawerTitle}>Monie Ops Hub</Text>
                <Text style={styles.drawerSubtitle}>Director workspace</Text>
              </View>
              <Pressable style={styles.drawerClose} onPress={() => setDrawerOpen(false)}>
                <Text style={styles.drawerCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.drawerMenu}>
              {DIRECTOR_MENU_GROUPS.filter((group) => !group.directorOnly || isDirector).map(
                (group) => (
                  <View key={group.label} style={styles.drawerGroup}>
                    <Text style={styles.drawerGroupLabel}>{group.label}</Text>
                    {group.items.map((item) => (
                      <Pressable
                        key={item.key}
                        style={[
                          styles.drawerItem,
                          section === item.key && styles.drawerItemActive,
                        ]}
                        onPress={() => chooseSection(item.key)}
                      >
                        <View
                          style={[
                            styles.drawerIcon,
                            section === item.key && styles.drawerIconActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.drawerIconText,
                              section === item.key && styles.drawerIconTextActive,
                            ]}
                          >
                            {item.short}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.drawerItemText,
                            section === item.key && styles.drawerItemTextActive,
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ),
              )}
            </ScrollView>
            <View style={styles.drawerFooter}>
              <Text style={styles.drawerProfileName}>{profile.full_name}</Text>
              <Text style={styles.drawerProfileRole}>Director / Admin</Text>
              <Pressable style={styles.drawerSignOut} onPress={onSignOut}>
                <Text style={styles.drawerSignOutText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
          <Pressable style={styles.drawerScrim} onPress={() => setDrawerOpen(false)} />
        </View>
      </Modal>
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

function LoginScreen({ notice }: { notice: string | null }) {
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
        <Text style={styles.loginSubtitle}>
          Use the same Director or Staff Support Agent account as the web portal.
        </Text>
        {notice ? <Text style={styles.loginNotice}>{notice}</Text> : null}
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
  mobileHeader: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: "#FFFFFF",
  },
  menuButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },
  menuGlyph: { color: INK, fontSize: 22, fontWeight: "700" },
  headerTitleBlock: { flex: 1 },
  mobileHeaderTitle: { color: INK, fontSize: 16, fontWeight: "900" },
  mobileHeaderSubtitle: { color: MUTED, fontSize: 10, marginTop: 1 },
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshGlyph: { color: BLUE, fontSize: 25, fontWeight: "600" },
  overviewSub: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 4 },
  drawerBackdrop: { flex: 1, flexDirection: "row", backgroundColor: "rgba(17,24,39,0.46)" },
  drawerPanel: { width: "84%", maxWidth: 340, backgroundColor: "#FFFFFF" },
  drawerScrim: { flex: 1 },
  drawerBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  flexOne: { flex: 1 },
  drawerTitle: { color: INK, fontSize: 16, fontWeight: "900" },
  drawerSubtitle: { color: MUTED, fontSize: 10, marginTop: 2 },
  drawerClose: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerCloseText: { color: INK, fontSize: 17, fontWeight: "700" },
  drawerMenu: { flex: 1, padding: 12 },
  drawerGroup: { marginBottom: 8 },
  drawerGroupLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    marginHorizontal: 11,
    marginTop: 7,
    marginBottom: 4,
  },
  drawerItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    paddingHorizontal: 11,
    marginBottom: 3,
  },
  drawerItemActive: { backgroundColor: "#EAF1FF" },
  drawerIcon: {
    width: 31,
    height: 31,
    borderRadius: 9,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerIconActive: { backgroundColor: BLUE },
  drawerIconText: { color: MUTED, fontSize: 9, fontWeight: "900" },
  drawerIconTextActive: { color: "#FFFFFF" },
  drawerItemText: { color: INK, fontSize: 13, fontWeight: "700" },
  drawerItemTextActive: { color: BLUE, fontWeight: "900" },
  drawerFooter: {
    padding: 18,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  drawerProfileName: { color: INK, fontSize: 13, fontWeight: "900" },
  drawerProfileRole: { color: MUTED, fontSize: 10, marginBottom: 9 },
  drawerSignOut: {
    minHeight: 42,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  drawerSignOutText: { color: "#B42318", fontSize: 12, fontWeight: "800" },
  sectionContainer: { gap: 18 },
  hidden: { display: "none" },
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
  loginNotice: {
    color: "#175CD3",
    backgroundColor: "#EFF8FF",
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  centerTitle: { color: INK, fontSize: 24, fontWeight: "900", textAlign: "center" },
  centerBody: { color: MUTED, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 360 },
});
