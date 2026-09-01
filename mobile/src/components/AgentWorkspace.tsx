import * as Linking from "expo-linking";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import type { MobileProfile } from "../lib/meetings";
import { friendlyErrorMessage } from "../lib/errors";
import {
  buildAssignedMerchants,
  DAILY_REQUIRED_CONTACTS,
  dialablePhoneNumber,
  FINISHED_TASK_STATES,
  lagosDateKey,
  loadAgentTasks,
  reachedFromOutcome,
  startAgentTask,
  submitAgentOutcome,
  TASK_OUTCOME_OPTIONS,
  type AgentTask,
  type TaskOutcomeCode,
} from "../lib/agent-workspace";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";
const ERROR = "#B42318";

type Tab = "overview" | "tasks" | "merchants" | "profile";

export function AgentWorkspace({
  profile,
  onSignOut,
}: {
  profile: MobileProfile;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setTasks(await loadAgentTasks());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      if (refresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completed = useMemo(
    () => tasks.filter((task) => FINISHED_TASK_STATES.has(task.status)).length,
    [tasks],
  );
  const nextTask = useMemo(
    () => tasks.find((task) => !FINISHED_TASK_STATES.has(task.status)) ?? null,
    [tasks],
  );
  const merchants = useMemo(() => buildAssignedMerchants(tasks), [tasks]);

  const startTask = useCallback(
    async (task: AgentTask) => {
      setStartingTaskId(task.id);
      setError(null);
      try {
        await startAgentTask(task.id);
        await load(true);
      } catch (caught) {
        setError(messageOf(caught));
      } finally {
        setStartingTaskId(null);
      }
    },
    [load],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Moniepoint BRM</Text>
          <Text style={styles.headerSubtitle}>Staff Support workspace</Text>
        </View>
        <Text style={styles.date}>{lagosDateKey()}</Text>
      </View>

      <View style={styles.tabs}>
        <TabButton
          label="Overview"
          active={tab === "overview"}
          onPress={() => setTab("overview")}
        />
        <TabButton label="Daily Tasks" active={tab === "tasks"} onPress={() => setTab("tasks")} />
        <TabButton
          label="Merchants"
          active={tab === "merchants"}
          onPress={() => setTab("merchants")}
        />
        <TabButton label="Profile" active={tab === "profile"} onPress={() => setTab("profile")} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={BLUE}
          />
        }
      >
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <LoadingState />
        ) : tab === "overview" ? (
          <Overview
            profile={profile}
            tasks={tasks}
            completed={completed}
            nextTask={nextTask}
            onOpenTasks={() => setTab("tasks")}
            onStart={startTask}
            startingTaskId={startingTaskId}
          />
        ) : tab === "tasks" ? (
          <DailyTasks
            tasks={tasks}
            completed={completed}
            startingTaskId={startingTaskId}
            onStart={startTask}
            onOutcome={setSelectedTask}
          />
        ) : tab === "merchants" ? (
          <AssignedMerchants merchants={merchants} />
        ) : (
          <ProfileScreen profile={profile} onSignOut={onSignOut} />
        )}
      </ScrollView>

      <OutcomeModal
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onSaved={async () => {
          setSelectedTask(null);
          await load(true);
        }}
      />
    </SafeAreaView>
  );
}

function Overview({
  profile,
  tasks,
  completed,
  nextTask,
  onOpenTasks,
  onStart,
  startingTaskId,
}: {
  profile: MobileProfile;
  tasks: AgentTask[];
  completed: number;
  nextTask: AgentTask | null;
  onOpenTasks: () => void;
  onStart: (task: AgentTask) => Promise<void>;
  startingTaskId: string | null;
}) {
  return (
    <View style={styles.sectionGap}>
      <View>
        <Text style={styles.title}>Good day, {firstName(profile.full_name)}</Text>
        <Text style={styles.body}>
          Your assigned work is synchronized with the same Monie Ops Hub task queue used on the web.
        </Text>
      </View>

      <ProgressCard
        completed={completed}
        total={DAILY_REQUIRED_CONTACTS}
        available={tasks.length}
      />

      {nextTask ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>WORK ON THIS NOW</Text>
          <Text style={styles.cardTitle}>
            {nextTask.merchant?.business_name ?? "Assigned merchant"}
          </Text>
          <View style={styles.rowWrap}>
            <Tag text={`Rank ${nextTask.queue_rank ?? "—"}`} />
            <Tag text={`Priority ${nextTask.priority}/5`} />
            <Tag text={nextTask.task_type} />
          </View>
          <Text style={styles.body}>{nextTask.reason}</Text>
          {nextTask.status !== "in_progress" ? (
            <PrimaryAction
              label={startingTaskId === nextTask.id ? "Starting…" : "Start task"}
              disabled={startingTaskId === nextTask.id}
              onPress={() => void onStart(nextTask)}
            />
          ) : (
            <Text style={styles.successText}>Task is in progress.</Text>
          )}
          <SecondaryAction label="Open Daily Tasks" onPress={onOpenTasks} />
        </View>
      ) : (
        <EmptyState
          title="Today's queue is clear"
          body="No unresolved task is assigned for today. Pull down to refresh for newly assigned work."
        />
      )}
    </View>
  );
}

function DailyTasks({
  tasks,
  completed,
  startingTaskId,
  onStart,
  onOutcome,
}: {
  tasks: AgentTask[];
  completed: number;
  startingTaskId: string | null;
  onStart: (task: AgentTask) => Promise<void>;
  onOutcome: (task: AgentTask) => void;
}) {
  return (
    <View style={styles.sectionGap}>
      <View>
        <Text style={styles.title}>Daily Tasks</Text>
        <Text style={styles.body}>
          Work the ranked queue. Starting and recording outcomes update the same tasks visible on
          the web portal.
        </Text>
      </View>
      <ProgressCard
        completed={completed}
        total={DAILY_REQUIRED_CONTACTS}
        available={tasks.length}
      />

      {!tasks.length ? (
        <EmptyState
          title="No assigned tasks"
          body="Amina has not assigned work for this workday yet. Pull down to refresh."
        />
      ) : (
        tasks.map((task, index) => {
          const finished = FINISHED_TASK_STATES.has(task.status);
          return (
            <View style={styles.card} key={task.id}>
              <View style={styles.rowBetween}>
                <View style={styles.rankCircle}>
                  <Text style={styles.rankText}>{task.queue_rank ?? index + 1}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>
                    {task.merchant?.business_name ?? "Assigned merchant"}
                  </Text>
                  <Text style={styles.smallMuted}>
                    {task.task_type} · Priority {task.priority}/5 · {humanize(task.status)}
                  </Text>
                </View>
              </View>

              <Text style={styles.body}>{task.reason}</Text>

              <View style={styles.detailGrid}>
                <Detail label="Terminal ID" value={task.terminal?.terminal_id ?? "Not linked"} />
                <Detail label="Serial" value={task.terminal?.serial_number ?? "Not available"} />
                <Detail
                  label="POS account"
                  value={task.merchant?.account_number?.trim() || "POS account not available"}
                />
                <Detail
                  label="Phone"
                  value={task.merchant?.phone_number?.trim() || "Phone number not available"}
                />
              </View>

              {task.latestOutcome?.callback_at ? (
                <Text style={styles.smallMuted}>
                  Callback: {formatDateTime(task.latestOutcome.callback_at)}
                </Text>
              ) : null}

              {!finished ? (
                <View style={styles.actionStack}>
                  {task.status !== "in_progress" ? (
                    <SecondaryAction
                      label={startingTaskId === task.id ? "Starting…" : "Start task"}
                      disabled={startingTaskId === task.id}
                      onPress={() => void onStart(task)}
                    />
                  ) : null}
                  <PrimaryAction label="Record outcome" onPress={() => onOutcome(task)} />
                </View>
              ) : (
                <Text style={styles.successText}>
                  Human work recorded · {humanize(task.status)}
                </Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function AssignedMerchants({
  merchants,
}: {
  merchants: ReturnType<typeof buildAssignedMerchants>;
}) {
  const call = async (phone: string) => {
    const dialable = dialablePhoneNumber(phone);
    if (!dialable) return;
    await Linking.openURL(`tel:${dialable}`);
  };

  return (
    <View style={styles.sectionGap}>
      <View>
        <Text style={styles.title}>Assigned Merchants</Text>
        <Text style={styles.body}>
          Only businesses linked to your assigned task queue are shown. Missing contact values are
          never guessed.
        </Text>
      </View>

      {!merchants.length ? (
        <EmptyState
          title="No assigned merchants"
          body="No business is linked to today's assigned queue yet."
        />
      ) : (
        merchants.map((merchant) => {
          const dialable = dialablePhoneNumber(merchant.phoneNumber);
          return (
            <View style={styles.card} key={merchant.key}>
              <Text style={styles.cardTitle}>{merchant.businessName}</Text>
              <Detail label="Phone" value={merchant.phoneNumber ?? "Phone number not available"} />
              {dialable ? (
                <PrimaryAction label="Call" onPress={() => void call(dialable)} />
              ) : (
                <Text style={styles.missingText}>Phone number not available</Text>
              )}
              <Detail
                label="POS account"
                value={merchant.accountNumber ?? "POS account not available"}
              />
              <Detail label="Terminal ID" value={merchant.terminalId ?? "Not available"} />
              <Detail label="Terminal serial" value={merchant.serialNumber ?? "Not available"} />

              <View style={styles.subtleBlock}>
                <Text style={styles.eyebrow}>LINKED TASK CONTEXT</Text>
                {merchant.taskContexts.map((context) => (
                  <Text key={context.taskId} style={styles.smallMuted}>
                    Rank {context.queueRank ?? "—"} · {context.taskType} ·{" "}
                    {humanize(context.status)}
                    {"\n"}
                    {context.reason}
                  </Text>
                ))}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

function ProfileScreen({ profile, onSignOut }: { profile: MobileProfile; onSignOut: () => void }) {
  return (
    <View style={styles.sectionGap}>
      <View>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.body}>
          This mobile session uses the same production account as the web portal.
        </Text>
      </View>
      <View style={styles.card}>
        <Detail label="Name" value={profile.full_name} />
        <Detail label="Role" value="Staff Support Agent" />
        <Detail label="Account state" value={profile.is_active ? "Active" : "Inactive"} />
        <SecondaryAction label="Sign out" onPress={onSignOut} />
      </View>
    </View>
  );
}

function OutcomeModal({
  task,
  onClose,
  onSaved,
}: {
  task: AgentTask | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [outcomeCode, setOutcomeCode] = useState<TaskOutcomeCode>("reached_commitment");
  const [finalStatus, setFinalStatus] = useState<"completed" | "postponed">("completed");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [expectedBy, setExpectedBy] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [postponementReason, setPostponementReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setOutcomeCode("reached_commitment");
    setFinalStatus("completed");
    setExpectedAmount("");
    setExpectedBy("");
    setCallbackAt("");
    setPostponementReason("");
    setNotes("");
    setError(null);
  }, [task]);

  if (!task) return null;

  const options = TASK_OUTCOME_OPTIONS.filter(
    (option) => option.value !== "loan_disbursed" || task.task_type === "LOAN",
  );

  const save = async () => {
    setError(null);
    const reason = postponementReason.trim();
    if (finalStatus === "postponed" && !reason) {
      setError("A postponement reason is required.");
      return;
    }

    const amountText = expectedAmount.trim();
    const amount = amountText ? Number(amountText) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Expected amount must be a valid non-negative number.");
      return;
    }

    const expectedByIso = parseOptionalDateTime(expectedBy);
    if (expectedBy.trim() && !expectedByIso) {
      setError("Expected by must be a valid date/time, for example 2026-08-31 14:30.");
      return;
    }

    const callbackIso = parseOptionalDateTime(callbackAt);
    if (callbackAt.trim() && !callbackIso) {
      setError("Callback time must be a valid date/time, for example 2026-08-31 16:00.");
      return;
    }

    setSaving(true);
    try {
      await submitAgentOutcome({
        taskId: task.id,
        outcomeCode,
        finalStatus,
        reachedMerchant: reachedFromOutcome(outcomeCode),
        commitmentReceived: outcomeCode === "reached_commitment" ? true : null,
        expectedAmount: amount,
        expectedBy: expectedByIso,
        postponementReason: reason || null,
        callbackAt: callbackIso,
        notes: notes.trim() || null,
      });
      await onSaved();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.modalPage}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.title}>Record outcome</Text>
              <Text style={styles.body}>{task.merchant?.business_name ?? "Assigned merchant"}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>

          {error ? <ErrorState message={error} /> : null}

          <Text style={styles.inputLabel}>Structured outcome</Text>
          <View style={styles.optionList}>
            {options.map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                selected={outcomeCode === option.value}
                onPress={() => setOutcomeCode(option.value)}
              />
            ))}
          </View>

          <Text style={styles.inputLabel}>Task result</Text>
          <View style={styles.optionList}>
            <Choice
              label="Completed — human interaction finished"
              selected={finalStatus === "completed"}
              onPress={() => setFinalStatus("completed")}
            />
            <Choice
              label="Postponed — return/callback required"
              selected={finalStatus === "postponed"}
              onPress={() => setFinalStatus("postponed")}
            />
          </View>

          <LabeledInput
            label="Expected amount (₦)"
            value={expectedAmount}
            onChangeText={setExpectedAmount}
            keyboardType="decimal-pad"
            placeholder="Optional"
          />
          <LabeledInput
            label="Expected by"
            value={expectedBy}
            onChangeText={setExpectedBy}
            placeholder="Optional · YYYY-MM-DD HH:mm"
          />
          <LabeledInput
            label="Callback time"
            value={callbackAt}
            onChangeText={setCallbackAt}
            placeholder="Optional · YYYY-MM-DD HH:mm"
          />
          <LabeledInput
            label="Postponement reason"
            value={postponementReason}
            onChangeText={setPostponementReason}
            placeholder={finalStatus === "postponed" ? "Required when postponed" : "Optional"}
          />
          <LabeledInput
            label="Human notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="What did the merchant say?"
            multiline
          />

          <Text style={styles.smallMuted}>
            This records the human outcome only. Verification remains separate in the existing
            backend.
          </Text>

          <PrimaryAction
            label={saving ? "Saving…" : "Save outcome"}
            disabled={saving}
            onPress={() => void save()}
          />
          <SecondaryAction label="Cancel" disabled={saving} onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ProgressCard({
  completed,
  total,
  available,
}: {
  completed: number;
  total: number;
  available: number;
}) {
  const percent = Math.min(100, Math.round((completed / total) * 100));
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>Daily completion</Text>
        <Text style={styles.progressNumber}>
          {completed}/{total}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.smallMuted}>
        {available} assigned contact{available === 1 ? "" : "s"} available today.
      </Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Something needs attention</Text>
      <Text style={styles.errorBody}>{message}</Text>
      {onRetry ? <SecondaryAction label="Retry" onPress={onRetry} /> : null}
    </View>
  );
}

function LoadingState() {
  return (
    <View style={styles.loadingBox}>
      <ActivityIndicator color={BLUE} />
      <Text style={styles.body}>Loading your assigned work…</Text>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.primaryAction, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.primaryActionText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.secondaryAction, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.secondaryActionText}>{label}</Text>
    </Pressable>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.choice, selected && styles.choiceSelected]} onPress={onPress}>
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <Text style={styles.choiceText}>{label}</Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: "default" | "decimal-pad";
  multiline?: boolean;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#98A2B3"
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

function parseOptionalDateTime(value: string) {
  const text = value.trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text)
    ? text.replace(/\s+/, "T")
    : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "Agent";
}

function humanize(value: string) {
  return value
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

function messageOf(error: unknown) {
  return friendlyErrorMessage(error, "The secure data request failed. Please try again.");
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  brand: { color: INK, fontSize: 18, fontWeight: "900" },
  headerSubtitle: { color: MUTED, fontSize: 11, marginTop: 2 },
  date: { color: MUTED, fontSize: 11, fontWeight: "700" },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: "#FFFFFF",
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: "center",
  },
  tabActive: { backgroundColor: "#EAF1FF" },
  tabText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  tabTextActive: { color: BLUE },
  content: { flex: 1 },
  page: { padding: 16, paddingBottom: 40 },
  sectionGap: { gap: 14 },
  title: { color: INK, fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  body: { color: MUTED, fontSize: 13, lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 16,
    backgroundColor: "#FFFFFF",
    gap: 12,
  },
  cardTitle: { color: INK, fontSize: 17, fontWeight: "900" },
  eyebrow: { color: BLUE, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  flex: { flex: 1 },
  tag: { backgroundColor: "#EAF1FF", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  tagText: { color: BLUE, fontSize: 10, fontWeight: "800" },
  detailGrid: { gap: 8 },
  detail: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 11 },
  detailLabel: { color: MUTED, fontSize: 10, fontWeight: "700" },
  detailValue: { color: INK, fontSize: 13, fontWeight: "700", marginTop: 4 },
  subtleBlock: { backgroundColor: SURFACE, borderRadius: 12, padding: 12, gap: 7 },
  smallMuted: { color: MUTED, fontSize: 11, lineHeight: 17 },
  missingText: { color: MUTED, fontSize: 12, fontWeight: "700" },
  successText: { color: "#027A48", fontSize: 12, fontWeight: "800" },
  actionStack: { gap: 8 },
  primaryAction: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: BLUE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryActionText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  secondaryAction: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
  },
  secondaryActionText: { color: INK, fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  progressNumber: { color: BLUE, fontSize: 20, fontWeight: "900" },
  progressTrack: { height: 8, borderRadius: 99, backgroundColor: "#EAECF0", overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 99, backgroundColor: BLUE },
  rankCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SURFACE,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { color: INK, fontSize: 12, fontWeight: "900" },
  loadingBox: { paddingVertical: 50, alignItems: "center", gap: 12 },
  emptyBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: BORDER,
    borderRadius: 16,
    padding: 22,
    gap: 6,
  },
  errorBox: {
    backgroundColor: "#FEF3F2",
    borderWidth: 1,
    borderColor: "#FECDCA",
    borderRadius: 14,
    padding: 14,
    gap: 7,
    marginBottom: 14,
  },
  errorTitle: { color: ERROR, fontSize: 13, fontWeight: "900" },
  errorBody: { color: ERROR, fontSize: 12, lineHeight: 18 },
  modalPage: { padding: 18, paddingBottom: 44, gap: 14 },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: SURFACE,
  },
  closeText: { color: MUTED, fontSize: 12, fontWeight: "800" },
  optionList: { gap: 7 },
  choice: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 11,
  },
  choiceSelected: { borderColor: BLUE, backgroundColor: "#F4F8FF" },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: "#98A2B3" },
  radioSelected: { borderColor: BLUE, backgroundColor: BLUE },
  choiceText: { flex: 1, color: INK, fontSize: 12, fontWeight: "700" },
  inputGroup: { gap: 6 },
  inputLabel: { color: INK, fontSize: 12, fontWeight: "800" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 13,
    color: INK,
    backgroundColor: "#FFFFFF",
  },
  textarea: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
});
