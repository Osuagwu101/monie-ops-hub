import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { TaskType } from "../../../src/domain/models";
import { updateMerchantContact } from "../lib/director-portal";
import {
  canDirectorReassignTask,
  createDirectorTask,
  lagosDateKey,
  loadDirectorAssignmentWorkspace,
  reassignDirectorTask,
  type DirectorAssignmentWorkspace,
  type DirectorAssistantOption,
  type DirectorMerchantOption,
  type DirectorTaskQueueItem,
  type DirectorTerminalOption,
} from "../lib/director-task-assignment";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";
const ERROR = "#B42318";
const SUCCESS = "#027A48";

interface Props {
  directorId: string;
  canEditContacts: boolean;
  refreshSignal?: boolean;
}

type PickerKind = "assistant" | "merchant" | "terminal" | "reassign-assistant" | null;

export function DirectorTaskAssignment({
  directorId,
  canEditContacts,
  refreshSignal = false,
}: Props) {
  const [workspace, setWorkspace] = useState<DirectorAssignmentWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<PickerKind>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  const [assistantId, setAssistantId] = useState<string | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState<TaskType>("TA");
  const [priority, setPriority] = useState(3);
  const [reason, setReason] = useState("");
  const [reassignTask, setReassignTask] = useState<DirectorTaskQueueItem | null>(null);
  const [contactMerchant, setContactMerchant] = useState<DirectorMerchantOption | null>(null);
  const [contactPhone, setContactPhone] = useState("");
  const [contactAccount, setContactAccount] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadDirectorAssignmentWorkspace(lagosDateKey());
      setWorkspace(next);
      setAssistantId((current) => current ?? next.assistants[0]?.id ?? null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  const selectedAssistant = useMemo(
    () => workspace?.assistants.find((assistant) => assistant.id === assistantId) ?? null,
    [assistantId, workspace],
  );
  const selectedMerchant = useMemo(
    () => workspace?.merchants.find((merchant) => merchant.id === merchantId) ?? null,
    [merchantId, workspace],
  );
  const selectedTerminal = useMemo(
    () => selectedMerchant?.terminals.find((terminal) => terminal.id === terminalId) ?? null,
    [selectedMerchant, terminalId],
  );

  const openPicker = (kind: PickerKind, task: DirectorTaskQueueItem | null = null) => {
    setReassignTask(task);
    setPickerSearch("");
    setPicker(kind);
  };

  const openContactEditor = (merchant: DirectorMerchantOption) => {
    if (!canEditContacts) return;
    setContactMerchant(merchant);
    setContactPhone(merchant.phoneNumber ?? "");
    setContactAccount(merchant.accountNumber ?? "");
    setError(null);
    setNotice(null);
  };

  const saveContact = async () => {
    if (!canEditContacts || !contactMerchant || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateMerchantContact({
        merchantId: contactMerchant.id,
        phoneNumber: contactPhone,
        accountNumber: contactAccount,
      });
      setContactMerchant(null);
      setNotice(
        "BO phone and POS account details saved. They will appear automatically on future Amina assignments for this business.",
      );
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const selectMerchant = (merchant: DirectorMerchantOption) => {
    setMerchantId(merchant.id);
    setTerminalId(merchant.terminals.length === 1 ? merchant.terminals[0].id : null);
    setPicker(null);
    setDuplicateNotice(null);
    setNotice(null);
  };

  const confirmCreate = () => {
    if (!workspace || !selectedAssistant || !selectedMerchant) {
      setError("Choose a business and human agent before assigning the task.");
      return;
    }
    if (taskType === "TA" && selectedMerchant.terminals.length > 0 && !selectedTerminal) {
      setError("Choose the terminal for this TA task.");
      return;
    }
    if (!reason.trim()) {
      setError("Add a reason for the assignment.");
      return;
    }

    setError(null);
    Alert.alert(
      "Confirm task assignment",
      `${selectedMerchant.businessName} → ${selectedAssistant.fullName}\n${taskType} · Priority ${priority}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Assign", onPress: () => void submitCreate() },
      ],
    );
  };

  const submitCreate = async () => {
    if (submitting || !workspace || !assistantId || !merchantId) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setDuplicateNotice(null);
    try {
      const result = await createDirectorTask({
        directorId,
        taskDate: workspace.date,
        taskType,
        priority,
        merchantId,
        terminalId,
        assistantId,
        reason,
      });

      if (result.duplicate) {
        setDuplicateNotice(
          "This active assignment already exists for the same agent, business, task type and terminal. Nothing was submitted twice.",
        );
      } else {
        setNotice("Task assigned successfully. The same task will appear on web and in the agent's mobile queue after refresh.");
        setReason("");
      }
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const selectReassignmentAgent = (assistant: DirectorAssistantOption) => {
    const task = reassignTask;
    setPicker(null);
    if (!task) return;

    if (task.assignedTo === assistant.id) {
      setDuplicateNotice("That task is already assigned to the selected agent. No duplicate reassignment was submitted.");
      setReassignTask(null);
      return;
    }

    Alert.alert(
      "Confirm reassignment",
      `${task.merchant?.businessName ?? "Assigned business"} → ${assistant.fullName}\nOnly untouched Assigned tasks can be moved.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => setReassignTask(null) },
        { text: "Reassign", onPress: () => void submitReassignment(task, assistant) },
      ],
    );
  };

  const submitReassignment = async (
    task: DirectorTaskQueueItem,
    assistant: DirectorAssistantOption,
  ) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setDuplicateNotice(null);
    try {
      const result = await reassignDirectorTask(task, assistant.id);
      if (result.duplicate) {
        setDuplicateNotice(
          "The target agent already has the same active assignment, or the task is already assigned there. No duplicate change was made.",
        );
      } else {
        setNotice(`Task reassigned successfully to ${assistant.fullName}.`);
      }
      setReassignTask(null);
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !workspace) {
    return <Loading label="Loading today's Director task queue…" />;
  }

  if (!workspace) {
    return (
      <ErrorBox
        message={error ?? "The Director task workspace could not be loaded."}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <View style={styles.stack}>
      <View>
        <Text style={styles.title}>Daily Tasks & Assignment</Text>
        <Text style={styles.body}>
          Assign or reassign today's human-agent work using the same production tasks, profiles,
          merchants and terminals used by the web portal. Started work remains with the person who
          owns it.
        </Text>
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.smallMuted}>{workspace.date} · {workspace.tasks.length} queued tasks</Text>
        <SmallButton title={loading ? "Refreshing…" : "Refresh"} disabled={loading || submitting} onPress={() => void refresh()} />
      </View>

      {error ? <ErrorBox message={error} onRetry={() => void refresh()} /> : null}
      {notice ? <SuccessBox message={notice} /> : null}
      {duplicateNotice ? <DuplicateBox message={duplicateNotice} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>New assignment</Text>
        <Text style={styles.smallMuted}>
          Manual Director assignments stay in the shared task table and respect existing Supabase RLS.
        </Text>

        <FieldButton
          label="Human agent"
          value={selectedAssistant?.fullName ?? "Choose an active agent"}
          onPress={() => openPicker("assistant")}
        />
        <FieldButton
          label="Business"
          value={selectedMerchant?.businessName ?? "Choose an available business"}
          onPress={() => openPicker("merchant")}
        />
        <FieldButton
          label="Terminal"
          value={
            selectedTerminal
              ? `${selectedTerminal.terminalId} · ${selectedTerminal.serialNumber ?? "Serial not available"}`
              : selectedMerchant?.terminals.length
                ? "Choose terminal"
                : "No linked terminal available"
          }
          disabled={!selectedMerchant || selectedMerchant.terminals.length === 0}
          onPress={() => openPicker("terminal")}
        />

        <Text style={styles.sectionLabel}>TASK TYPE</Text>
        <View style={styles.choiceRow}>
          {(["TA", "LOAN", "FOLLOW_UP"] as TaskType[]).map((type) => (
            <ChoiceButton key={type} label={type} active={taskType === type} onPress={() => setTaskType(type)} />
          ))}
        </View>

        <Text style={styles.sectionLabel}>PRIORITY</Text>
        <View style={styles.choiceRow}>
          {[1, 2, 3, 4, 5].map((value) => (
            <ChoiceButton key={value} label={String(value)} active={priority === value} onPress={() => setPriority(value)} />
          ))}
        </View>

        <View>
          <Text style={styles.fieldLabel}>Reason</Text>
          <TextInput
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              setDuplicateNotice(null);
              setNotice(null);
            }}
            placeholder="Why should this agent contact this business?"
            placeholderTextColor="#98A2B3"
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>

        <PrimaryButton
          title={submitting ? "Submitting…" : "Review & assign"}
          disabled={submitting || !workspace.assistants.length || !workspace.merchants.length}
          onPress={confirmCreate}
        />
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Today's task queue</Text>
        <Text style={styles.smallMuted}>Agent + status visible</Text>
      </View>

      {!workspace.tasks.length ? (
        <Empty title="No tasks in today's queue" body="Create an assignment above or refresh when web assignments are available." />
      ) : (
        workspace.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            disabled={submitting}
            onReassign={() => openPicker("reassign-assistant", task)}
            onEditContact={
              canEditContacts && task.merchant
                ? () => openContactEditor(task.merchant!)
                : undefined
            }
          />
        ))
      )}

      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Available businesses</Text>
        <Text style={styles.smallMuted}>{workspace.merchants.length} active</Text>
      </View>

      {!workspace.merchants.length ? (
        <Empty title="No available businesses" body="No active merchant records are currently visible to this Director account." />
      ) : (
        workspace.merchants.slice(0, 25).map((merchant) => (
          <View style={styles.card} key={merchant.id}>
            <Text style={styles.itemTitle}>{merchant.businessName}</Text>
            <Text style={styles.smallMuted}>
              {merchant.phoneNumber ?? "Phone number not available"} · {merchant.accountNumber ?? "POS account not available"}
            </Text>
            <Text style={styles.smallMuted}>
              {merchant.terminals.length
                ? `${merchant.terminals.length} linked terminal${merchant.terminals.length === 1 ? "" : "s"}`
                : "No linked terminal available"}
            </Text>
            {canEditContacts ? (
              <SmallButton title="Edit BO details" onPress={() => openContactEditor(merchant)} />
            ) : null}
          </View>
        ))
      )}
      {workspace.merchants.length > 25 ? (
        <Text style={styles.smallMuted}>
          Showing the first 25 businesses here. Use “Choose an available business” to search the complete active list.
        </Text>
      ) : null}

      <PickerModal
        kind={picker}
        search={pickerSearch}
        setSearch={setPickerSearch}
        assistants={workspace.assistants}
        merchants={workspace.merchants}
        terminals={selectedMerchant?.terminals ?? []}
        onClose={() => {
          setPicker(null);
          if (picker === "reassign-assistant") setReassignTask(null);
        }}
        onAssistant={(assistant) => {
          if (picker === "reassign-assistant") selectReassignmentAgent(assistant);
          else {
            setAssistantId(assistant.id);
            setPicker(null);
            setDuplicateNotice(null);
            setNotice(null);
          }
        }}
        onMerchant={selectMerchant}
        onTerminal={(terminal) => {
          setTerminalId(terminal.id);
          setPicker(null);
          setDuplicateNotice(null);
          setNotice(null);
        }}
      />
      <ContactEditorModal
        merchant={contactMerchant}
        phone={contactPhone}
        account={contactAccount}
        saving={submitting}
        onPhone={setContactPhone}
        onAccount={setContactAccount}
        onClose={() => setContactMerchant(null)}
        onSave={() => void saveContact()}
      />
    </View>
  );
}

function TaskCard({
  task,
  disabled,
  onReassign,
  onEditContact,
}: {
  task: DirectorTaskQueueItem;
  disabled: boolean;
  onReassign: () => void;
  onEditContact?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>{task.merchant?.businessName ?? "Business not available"}</Text>
          <Text style={styles.smallMuted}>
            {task.taskType} · Priority {task.priority} · {humanize(task.status)}
          </Text>
        </View>
        <StatusPill label={humanize(task.status).toUpperCase()} />
      </View>
      <Detail label="Assigned agent" value={task.assistant?.fullName ?? "Assigned agent not available"} />
      <Detail label="Reason" value={task.reason} />
      <Detail label="Terminal ID" value={task.terminal?.terminalId ?? "Terminal ID not available"} />
      <Detail label="Terminal serial" value={task.terminal?.serialNumber ?? "Terminal serial not available"} />
      <Detail label="BO phone number" value={task.merchant?.phoneNumber ?? "Phone number not available"} />
      <Detail label="POS account number" value={task.merchant?.accountNumber ?? "POS account not available"} />
      {onEditContact ? <SmallButton title="Edit BO details" disabled={disabled} onPress={onEditContact} /> : null}
      <SmallButton
        title={canDirectorReassignTask(task) ? "Reassign" : "Reassignment locked after work starts"}
        disabled={disabled || !canDirectorReassignTask(task)}
        onPress={onReassign}
      />
    </View>
  );
}

function ContactEditorModal({
  merchant,
  phone,
  account,
  saving,
  onPhone,
  onAccount,
  onClose,
  onSave,
}: {
  merchant: DirectorMerchantOption | null;
  phone: string;
  account: string;
  saving: boolean;
  onPhone: (value: string) => void;
  onAccount: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal visible={Boolean(merchant)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.contactModalCard}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>BO contact details</Text>
              <Text style={styles.smallMuted}>{merchant?.businessName}</Text>
            </View>
            <SmallButton title="Close" disabled={saving} onPress={onClose} />
          </View>
          <Text style={styles.body}>
            Saved details stay with this business and are included whenever Amina assigns it again.
          </Text>
          <View>
            <Text style={styles.fieldLabel}>BO phone number</Text>
            <TextInput
              value={phone}
              onChangeText={onPhone}
              keyboardType="phone-pad"
              placeholder="Enter phone number"
              placeholderTextColor="#98A2B3"
              style={styles.input}
            />
          </View>
          <View>
            <Text style={styles.fieldLabel}>POS account number</Text>
            <TextInput
              value={account}
              onChangeText={onAccount}
              keyboardType="number-pad"
              placeholder="Enter POS account number"
              placeholderTextColor="#98A2B3"
              style={styles.input}
            />
          </View>
          <PrimaryButton
            title={saving ? "Saving…" : "Save BO details"}
            disabled={saving || (!phone.trim() && !account.trim())}
            onPress={onSave}
          />
        </View>
      </View>
    </Modal>
  );
}

function PickerModal({
  kind,
  search,
  setSearch,
  assistants,
  merchants,
  terminals,
  onClose,
  onAssistant,
  onMerchant,
  onTerminal,
}: {
  kind: PickerKind;
  search: string;
  setSearch: (value: string) => void;
  assistants: DirectorAssistantOption[];
  merchants: DirectorMerchantOption[];
  terminals: DirectorTerminalOption[];
  onClose: () => void;
  onAssistant: (assistant: DirectorAssistantOption) => void;
  onMerchant: (merchant: DirectorMerchantOption) => void;
  onTerminal: (terminal: DirectorTerminalOption) => void;
}) {
  const normalized = search.trim().toLowerCase();
  const filteredAssistants = assistants.filter((assistant) => assistant.fullName.toLowerCase().includes(normalized));
  const filteredMerchants = merchants.filter((merchant) =>
    `${merchant.businessName} ${merchant.phoneNumber ?? ""} ${merchant.accountNumber ?? ""}`.toLowerCase().includes(normalized),
  );
  const filteredTerminals = terminals.filter((terminal) =>
    `${terminal.terminalId} ${terminal.serialNumber ?? ""}`.toLowerCase().includes(normalized),
  );

  const title =
    kind === "merchant"
      ? "Choose business"
      : kind === "terminal"
        ? "Choose terminal"
        : kind === "reassign-assistant"
          ? "Choose new agent"
          : "Choose human agent";

  return (
    <Modal visible={Boolean(kind)} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{title}</Text>
            <SmallButton title="Close" onPress={onClose} />
          </View>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor="#98A2B3"
            style={styles.input}
          />
          <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent} keyboardShouldPersistTaps="handled">
            {(kind === "assistant" || kind === "reassign-assistant") &&
              filteredAssistants.map((assistant) => (
                <PickerRow key={assistant.id} title={assistant.fullName} subtitle="Active human agent" onPress={() => onAssistant(assistant)} />
              ))}
            {kind === "merchant" &&
              filteredMerchants.map((merchant) => (
                <PickerRow
                  key={merchant.id}
                  title={merchant.businessName}
                  subtitle={`${merchant.phoneNumber ?? "Phone not available"} · ${merchant.terminals.length} terminal${merchant.terminals.length === 1 ? "" : "s"}`}
                  onPress={() => onMerchant(merchant)}
                />
              ))}
            {kind === "terminal" &&
              filteredTerminals.map((terminal) => (
                <PickerRow
                  key={terminal.id}
                  title={terminal.terminalId}
                  subtitle={terminal.serialNumber ?? "Serial not available"}
                  onPress={() => onTerminal(terminal)}
                />
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PickerRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable style={styles.pickerRow} onPress={onPress}>
      <Text style={styles.itemTitle}>{title}</Text>
      <Text style={styles.smallMuted}>{subtitle}</Text>
    </Pressable>
  );
}

function FieldButton({
  label,
  value,
  onPress,
  disabled = false,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable style={[styles.fieldButton, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </Pressable>
  );
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.choiceButton, active && styles.choiceButtonActive]} onPress={onPress}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
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

function StatusPill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function PrimaryButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.primaryButton, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      {disabled && title.endsWith("…") ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

function SmallButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.smallButton, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.smallButtonText}>{title}</Text>
    </Pressable>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={BLUE} />
      <Text style={styles.smallMuted}>{label}</Text>
    </View>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Unable to load or save Director assignments</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <SmallButton title="Retry" onPress={onRetry} />
    </View>
  );
}

function SuccessBox({ message }: { message: string }) {
  return (
    <View style={styles.successBox}>
      <Text style={styles.successTitle}>Saved</Text>
      <Text style={styles.successBody}>{message}</Text>
    </View>
  );
}

function DuplicateBox({ message }: { message: string }) {
  return (
    <View style={styles.duplicateBox}>
      <Text style={styles.duplicateTitle}>Duplicate submission prevented</Text>
      <Text style={styles.duplicateBody}>{message}</Text>
    </View>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

function humanize(value: string) {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The secure request failed.";
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  title: { color: INK, fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  body: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 4 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  flex: { flex: 1 },
  smallMuted: { color: MUTED, fontSize: 11, lineHeight: 17 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { color: INK, fontSize: 16, fontWeight: "900" },
  itemTitle: { color: INK, fontSize: 14, fontWeight: "800" },
  sectionTitle: { color: INK, fontSize: 17, fontWeight: "900" },
  sectionLabel: { color: BLUE, fontSize: 9, fontWeight: "900", letterSpacing: 0.8, marginTop: 2 },
  fieldButton: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, gap: 4 },
  fieldLabel: { color: MUTED, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  fieldValue: { color: INK, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 44, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, color: INK, backgroundColor: "#FFFFFF" },
  textarea: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choiceButton: { borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#FFFFFF" },
  choiceButtonActive: { borderColor: BLUE, backgroundColor: "#EAF1FF" },
  choiceText: { color: MUTED, fontSize: 10, fontWeight: "800" },
  choiceTextActive: { color: BLUE },
  primaryButton: { minHeight: 48, backgroundColor: BLUE, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  smallButton: { minHeight: 38, borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  smallButtonText: { color: INK, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  detail: { borderWidth: 1, borderColor: BORDER, borderRadius: 11, padding: 10 },
  detailLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  detailValue: { color: INK, fontSize: 12, fontWeight: "700", marginTop: 3 },
  pill: { alignSelf: "flex-start", backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  pillText: { color: MUTED, fontSize: 8, fontWeight: "900" },
  errorBox: { backgroundColor: "#FEF3F2", borderWidth: 1, borderColor: "#FECDCA", borderRadius: 14, padding: 14, gap: 8 },
  errorTitle: { color: ERROR, fontSize: 13, fontWeight: "900" },
  errorBody: { color: ERROR, fontSize: 11, lineHeight: 17 },
  successBox: { backgroundColor: "#ECFDF3", borderWidth: 1, borderColor: "#ABEFC6", borderRadius: 14, padding: 14, gap: 5 },
  successTitle: { color: SUCCESS, fontSize: 13, fontWeight: "900" },
  successBody: { color: SUCCESS, fontSize: 11, lineHeight: 17 },
  duplicateBox: { backgroundColor: "#FFFAEB", borderWidth: 1, borderColor: "#FEDF89", borderRadius: 14, padding: 14, gap: 5 },
  duplicateTitle: { color: "#B54708", fontSize: 13, fontWeight: "900" },
  duplicateBody: { color: "#B54708", fontSize: 11, lineHeight: 17 },
  emptyBox: { borderWidth: 1, borderColor: BORDER, borderStyle: "dashed", borderRadius: 16, padding: 20, gap: 5 },
  loading: { paddingVertical: 28, alignItems: "center", gap: 9 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(17,24,39,0.35)" },
  modalCard: { maxHeight: "82%", backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  contactModalCard: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30, gap: 14 },
  modalList: { maxHeight: 480 },
  modalListContent: { gap: 8, paddingBottom: 28 },
  pickerRow: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, gap: 3 },
});
