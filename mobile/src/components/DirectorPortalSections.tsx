import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createStaffAccount,
  loadAutomationWorkspace,
  loadOperationsTeamWorkspace,
  loadReadinessWorkspace,
  loadStaffAccounts,
  queueAutomationRun,
  runOperationsTeam,
  runReadinessAudit,
  saveAutomationSecrets,
  submitAutomationCode,
  updateAutomationConfig,
  type AssistantOption,
  type AutomationConfig,
  type AutomationWorkspace,
  type OperationsTeamWorkspace,
  type ReadinessAudit,
  type ReadinessSnapshot,
  type RunOperationsResult,
  type StaffAccount,
} from "../lib/director-portal";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";
const ERROR = "#B42318";
const SUCCESS = "#027A48";

export function StaffAccountsSection({ refreshSignal = false }: { refreshSignal?: boolean }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStaff(await loadStaffAccounts());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh, refreshSignal]);

  const create = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createStaffAccount({ fullName, email, temporaryPassword });
      setNotice(
        result.requiresEmailConfirmation
          ? `Account created for ${result.email}. Email confirmation is required before first sign-in.`
          : `Account created for ${result.email}. The staff member can sign in now.`,
      );
      setFullName("");
      setEmail("");
      setTemporaryPassword("");
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionStack>
      <SectionIntro
        eyebrow="ADMIN ONLY"
        title="Staff Accounts"
        body="Create and review Human Operations Assistant accounts. Public signup remains blocked."
      />
      <Feedback error={error} notice={notice} />
      <Card>
        <CardTitle>Create Staff Support Agent</CardTitle>
        <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Staff full name" />
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="name@example.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Temporary password" value={temporaryPassword} onChangeText={setTemporaryPassword} placeholder="At least 8 characters" secureTextEntry />
        <ActionButton title={submitting ? "Creating account…" : "Create staff account"} disabled={submitting} onPress={() => void create()} />
      </Card>
      <RowHeader title="Staff Support Agents" detail={`${staff.length} account${staff.length === 1 ? "" : "s"}`} />
      {loading ? <Loading label="Loading staff accounts…" /> : null}
      {!loading && !staff.length ? <Empty text="No staff account exists yet." /> : null}
      {staff.map((member) => (
        <Card key={member.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <CardTitle>{member.fullName}</CardTitle>
              <Text style={styles.muted}>Staff Support Agent · Created {dateOnly(member.createdAt)}</Text>
            </View>
            <Pill label={member.isActive ? "ACTIVE" : "INACTIVE"} good={member.isActive} />
          </View>
        </Card>
      ))}
    </SectionStack>
  );
}

export function AutomationSection({ refreshSignal = false }: { refreshSignal?: boolean }) {
  const [workspace, setWorkspace] = useState<AutomationWorkspace | null>(null);
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [domains, setDomains] = useState("");
  const [browserUseKey, setBrowserUseKey] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadAutomationWorkspace();
      setWorkspace(next);
      setConfig(next.config);
      setDomains(next.config?.allowedDomains.join(", ") ?? "");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh, refreshSignal]);

  const execute = async (task: () => Promise<unknown>, success: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      setNotice(success);
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const secretsReady = Boolean(
    workspace?.secrets?.browserUseApiKeyConfigured &&
      workspace.secrets.moniepointUsernameConfigured &&
      workspace.secrets.moniepointPasswordConfigured &&
      workspace.secrets.bridgeConfigured,
  );
  const activeRun = workspace?.runs.find((run) =>
    ["queued", "dispatching", "browser_running", "polling", "retry_wait"].includes(run.status),
  );

  return (
    <SectionStack>
      <SectionIntro
        eyebrow="DIRECTOR CONTROLLED"
        title="Secure Automation"
        body="Manage scheduled Moniepoint report retrieval, secure credentials and the audited run history."
      />
      <Feedback error={error} notice={notice} />
      {loading && !workspace ? <Loading label="Loading secure automation…" /> : null}
      {config ? (
        <>
          <View style={styles.metricGrid}>
            <Metric label="Credential vault" value={secretsReady ? "Ready" : "Setup required"} good={secretsReady} />
            <Metric label="Current worker" value={activeRun ? humanize(activeRun.status) : "Idle"} good={!activeRun} />
            <Metric label="MonieCRM session" value={humanize(config.authState)} good={config.authState === "authenticated"} />
          </View>

          {workspace?.challenge?.pending ? (
            <Card tone="warning">
              <CardTitle>Verification code required</CardTitle>
              <Text style={styles.body}>{workspace.challenge.message ?? "Enter the current MonieCRM verification code."}</Text>
              <Field label="Verification code" value={verificationCode} onChangeText={(value) => setVerificationCode(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" placeholder="Enter code" />
              <ActionButton title={submitting ? "Submitting…" : "Submit code"} disabled={submitting || verificationCode.length < 4} onPress={() => void execute(() => submitAutomationCode(workspace.challenge!.challengeId!, verificationCode), "Verification code submitted securely.")} />
            </Card>
          ) : null}

          <Card>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <CardTitle>Scheduled retrieval</CardTitle>
                <Text style={styles.muted}>Manual runs remain Director-controlled.</Text>
              </View>
              <Switch value={config.enabled} onValueChange={(enabled) => setConfig({ ...config, enabled })} trackColor={{ false: "#D0D5DD", true: BLUE }} />
            </View>
            <Field label="Moniepoint login URL" value={config.moniepointLoginUrl ?? ""} onChangeText={(value) => setConfig({ ...config, moniepointLoginUrl: value || null })} placeholder="https://…" autoCapitalize="none" />
            <Field label="Allowed domains (comma separated)" value={domains} onChangeText={setDomains} placeholder="portal.example.com" autoCapitalize="none" />
            <Field label="Proxy country" value={config.proxyCountryCode ?? ""} onChangeText={(value) => setConfig({ ...config, proxyCountryCode: value || null })} placeholder="ng" autoCapitalize="none" />
            <View style={styles.twoColumns}>
              <CompactField label="Morning audit" value={config.morningAuditTime} onChangeText={(value) => setConfig({ ...config, morningAuditTime: value })} />
              <CompactField label="Morning refresh" value={config.morningRefreshTime} onChangeText={(value) => setConfig({ ...config, morningRefreshTime: value })} />
              <CompactField label="Evening refresh" value={config.eveningRefreshTime} onChangeText={(value) => setConfig({ ...config, eveningRefreshTime: value })} />
              <CompactField label="Retry minutes" value={String(config.retryBackoffMinutes)} onChangeText={(value) => setConfig({ ...config, retryBackoffMinutes: Number(value) || 10 })} keyboardType="number-pad" />
            </View>
            <ActionButton title={submitting ? "Saving…" : "Save configuration"} disabled={submitting} onPress={() => void execute(() => updateAutomationConfig({ ...config, allowedDomains: domains.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) }), "Automation configuration saved.")} />
            <SecondaryButton title={submitting ? "Working…" : "Run retrieval now"} disabled={submitting || Boolean(activeRun) || !secretsReady} onPress={() => void execute(queueAutomationRun, "Manual retrieval queued.")} />
          </Card>

          <Card>
            <CardTitle>Secure credentials</CardTitle>
            <Text style={styles.body}>Only enter values you want to change. Saved secrets are never displayed again.</Text>
            <Field label={`Browser Use API key · ${workspace?.secrets?.browserUseApiKeyConfigured ? "configured" : "missing"}`} value={browserUseKey} onChangeText={setBrowserUseKey} secureTextEntry placeholder="Leave blank to keep current" />
            <Field label={`Moniepoint username · ${workspace?.secrets?.moniepointUsernameConfigured ? "configured" : "missing"}`} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Leave blank to keep current" />
            <Field label={`Moniepoint password · ${workspace?.secrets?.moniepointPasswordConfigured ? "configured" : "missing"}`} value={password} onChangeText={setPassword} secureTextEntry placeholder="Leave blank to keep current" />
            <ActionButton title={submitting ? "Saving securely…" : "Save to Vault"} disabled={submitting || (!browserUseKey && !username && !password)} onPress={() => void execute(async () => {
              await saveAutomationSecrets({ browserUseKey, username, password });
              setBrowserUseKey(""); setUsername(""); setPassword("");
            }, "Secure credentials updated in Vault.")} />
          </Card>

          <RowHeader title="Retrieval history" detail={`${workspace?.runs.length ?? 0} recent`} />
          {workspace?.runs.map((run) => (
            <Card key={run.id}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <CardTitle>{humanize(run.triggerKind)}</CardTitle>
                  <Text style={styles.muted}>{dateTime(run.createdAt)} · Attempt {run.attemptCount}</Text>
                </View>
                <Pill label={humanize(run.status).toUpperCase()} good={run.status === "succeeded"} bad={run.status === "failed"} />
              </View>
              {run.lastErrorMessage ? <Text style={styles.errorText}>{run.lastErrorMessage}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}
    </SectionStack>
  );
}

export function ReadinessSection({ refreshSignal = false }: { refreshSignal?: boolean }) {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null);
  const [history, setHistory] = useState<ReadinessAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadReadinessWorkspace();
      setSnapshot(next.snapshot);
      setHistory(next.history);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh, refreshSignal]);

  const audit = async () => {
    setSubmitting(true); setError(null); setNotice(null);
    try { await runReadinessAudit(); setNotice("Readiness audit saved."); await refresh(); }
    catch (caught) { setError(messageOf(caught)); }
    finally { setSubmitting(false); }
  };

  const passed = snapshot?.checks.filter((check) => check.status === "pass").length ?? 0;
  const score = snapshot ? Math.round((passed / Math.max(snapshot.checks.length, 1)) * 100) : 0;

  return (
    <SectionStack>
      <SectionIntro eyebrow="LIVE ACCEPTANCE" title="Readiness & Acceptance" body="See platform, manual-operations and live-automation readiness without hiding external activation gaps." />
      <Feedback error={error} notice={notice} />
      {loading && !snapshot ? <Loading label="Running live readiness checks…" /> : null}
      {snapshot ? (
        <>
          <Card tone={snapshot.overallStatus === "blocked" ? "error" : "success"}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>OVERALL STATUS</Text>
                <CardTitle>{humanize(snapshot.overallStatus)}</CardTitle>
                <Text style={styles.body}>{score}% of checks pass · Generated {dateTime(snapshot.generatedAt)}</Text>
              </View>
              <Pill label={`${score}%`} good={snapshot.platformReady} bad={!snapshot.platformReady} />
            </View>
          </Card>
          <View style={styles.metricGrid}>
            <Metric label="Platform" value={snapshot.platformReady ? "Ready" : "Blocked"} good={snapshot.platformReady} />
            <Metric label="Manual operations" value={snapshot.manualOperationsReady ? "Ready" : "Pending"} good={snapshot.manualOperationsReady} />
            <Metric label="Live automation" value={snapshot.liveAutomationReady ? "Ready" : "Pending"} good={snapshot.liveAutomationReady} />
            <Metric label="Scheduled retrieval" value={snapshot.automationEnabled ? "Enabled" : "Disabled"} good={!snapshot.automationEnabled || snapshot.liveAutomationReady} />
          </View>
          <ActionButton title={submitting ? "Running audit…" : "Run readiness audit"} disabled={submitting} onPress={() => void audit()} />
          <RowHeader title="Live system checks" detail={`${passed}/${snapshot.checks.length} pass`} />
          {snapshot.checks.map((check) => (
            <Card key={check.key}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <CardTitle>{check.label}</CardTitle>
                  <Text style={styles.muted}>{humanize(check.category)}</Text>
                </View>
                <Pill label={humanize(check.status).toUpperCase()} good={check.status === "pass"} bad={check.status === "blocker"} />
              </View>
              <Text style={styles.body}>{check.detail}</Text>
            </Card>
          ))}
          <RowHeader title="Audit history" detail={`${history.length} saved`} />
          {history.map((auditItem) => (
            <Card key={auditItem.id}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <CardTitle>{humanize(auditItem.overallStatus)}</CardTitle>
                  <Text style={styles.muted}>{dateTime(auditItem.createdAt)}</Text>
                </View>
                <Pill label={auditItem.platformReady ? "PLATFORM READY" : "BLOCKED"} good={auditItem.platformReady} bad={!auditItem.platformReady} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </SectionStack>
  );
}

export function OperationsTeamSection({ refreshSignal = false }: { refreshSignal?: boolean }) {
  const [workspace, setWorkspace] = useState<OperationsTeamWorkspace | null>(null);
  const [assistantId, setAssistantId] = useState("");
  const [planDate, setPlanDate] = useState(lagosDateKey());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<RunOperationsResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await loadOperationsTeamWorkspace(planDate, assistantId || undefined);
      setWorkspace(next);
      setAssistantId((current) => current || next.assistants[0]?.id || "");
    } catch (caught) { setError(messageOf(caught)); }
    finally { setLoading(false); }
  }, [assistantId, planDate]);
  useEffect(() => void refresh(), [refresh, refreshSignal]);

  const run = async () => {
    if (!assistantId) return;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const next = await runOperationsTeam(assistantId, planDate);
      setResult(next);
      setNotice(next.mixCompliant ? "Amina's daily plan is ready." : "Amina produced a partial plan.");
      await refresh();
    } catch (caught) { setError(messageOf(caught)); }
    finally { setSubmitting(false); }
  };

  const latestRuns = useMemo(() => {
    const map = new Map<string, OperationsTeamWorkspace["runs"][number]>();
    for (const item of workspace?.runs ?? []) if (!map.has(item.agentKind)) map.set(item.agentKind, item);
    return map;
  }, [workspace?.runs]);

  return (
    <SectionStack>
      <SectionIntro eyebrow="AUDITABLE ORCHESTRATION" title="Operations Team" body="Run and inspect Amina, Emeka, Zainab and Tunde over the same secured evidence model used by the web portal." />
      <Feedback error={error} notice={notice} />
      <Card>
        <CardTitle>Run the operations team</CardTitle>
        <Text style={styles.body}>Re-running replaces only untouched Amina-generated tasks. Started and manual work is preserved.</Text>
        <Text style={styles.fieldLabel}>Human Operations Assistant</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          {(workspace?.assistants ?? []).map((assistant: AssistantOption) => (
            <Pressable key={assistant.id} style={[styles.selectPill, assistantId === assistant.id && styles.selectPillActive]} onPress={() => setAssistantId(assistant.id)}>
              <Text style={[styles.selectPillText, assistantId === assistant.id && styles.selectPillTextActive]}>{assistant.fullName}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field label="Plan date (YYYY-MM-DD)" value={planDate} onChangeText={setPlanDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <ActionButton title={submitting ? "Running team…" : "Run operations team"} disabled={submitting || !assistantId} onPress={() => void run()} />
      </Card>
      {result ? (
        <Card tone={result.mixCompliant ? "success" : "warning"}>
          <CardTitle>{result.totalCalls}/{result.dailyCallTarget} calls ready</CardTitle>
          <Text style={styles.body}>{result.taCalls} TA · {result.nonTaCalls} non-TA · {result.contactGaps} contact gaps</Text>
        </Card>
      ) : null}
      {loading && !workspace ? <Loading label="Loading the operations team…" /> : null}
      <View style={styles.twoColumns}>
        {["amina", "emeka", "zainab", "tunde"].map((agent) => {
          const latest = latestRuns.get(agent);
          return (
            <View style={styles.agentCard} key={agent}>
              <Text style={styles.eyebrow}>{humanize(agent).toUpperCase()}</Text>
              <Text style={styles.agentRole}>{agentRole(agent)}</Text>
              <Pill label={latest ? humanize(latest.status).toUpperCase() : "NO RUN"} good={latest?.status === "completed"} bad={latest?.status === "failed"} />
            </View>
          );
        })}
      </View>
      <RowHeader title="Recommendations" detail={`${workspace?.recommendations.length ?? 0} open`} />
      {!loading && !workspace?.recommendations.length ? <Empty text="No open recommendation for this plan date." /> : null}
      {workspace?.recommendations.map((recommendation) => (
        <Card key={recommendation.id}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>{humanize(recommendation.agentKind).toUpperCase()}</Text>
              <CardTitle>{recommendation.title}</CardTitle>
            </View>
            {recommendation.score !== null ? <Pill label={`${Math.round(recommendation.score)} SCORE`} /> : null}
          </View>
          {recommendation.merchantName ? <Text style={styles.itemStrong}>{recommendation.merchantName} · {recommendation.phoneNumber ?? "Phone missing"}</Text> : null}
          <Text style={styles.body}>{recommendation.rationale}</Text>
          {recommendation.talkingPoints ? <Text style={styles.muted}>Talking points: {recommendation.talkingPoints}</Text> : null}
        </Card>
      ))}
    </SectionStack>
  );
}

function SectionStack({ children }: { children: ReactNode }) { return <View style={styles.stack}>{children}</View>; }
function SectionIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text><Text style={styles.body}>{body}</Text></View>;
}
function Card({ children, tone }: { children: ReactNode; tone?: "success" | "warning" | "error" }) {
  return <View style={[styles.card, tone === "success" && styles.successCard, tone === "warning" && styles.warningCard, tone === "error" && styles.errorCard]}>{children}</View>;
}
function CardTitle({ children }: { children: ReactNode }) { return <Text style={styles.cardTitle}>{children}</Text>; }
function RowHeader({ title, detail }: { title: string; detail: string }) { return <View style={styles.rowBetween}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View>; }
function Feedback({ error, notice }: { error: string | null; notice: string | null }) { return <>{error ? <View style={[styles.feedback, styles.errorCard]}><Text style={styles.errorText}>{error}</Text></View> : null}{notice ? <View style={[styles.feedback, styles.successCard]}><Text style={styles.successText}>{notice}</Text></View> : null}</>; }
function Field(props: ComponentProps<typeof TextInput> & { label: string }) { const { label, ...input } = props; return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...input} placeholderTextColor="#98A2B3" style={styles.input} /></View>; }
function CompactField(props: ComponentProps<typeof TextInput> & { label: string }) { const { label, ...input } = props; return <View style={styles.compactField}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...input} placeholderTextColor="#98A2B3" style={styles.input} /></View>; }
function ActionButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable style={[styles.primaryButton, disabled && styles.disabled]} disabled={disabled} onPress={onPress}>{disabled && title.endsWith("…") ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{title}</Text>}</Pressable>; }
function SecondaryButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable style={[styles.secondaryButton, disabled && styles.disabled]} disabled={disabled} onPress={onPress}><Text style={styles.secondaryButtonText}>{title}</Text></Pressable>; }
function Metric({ label, value, good }: { label: string; value: string; good: boolean }) { return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={[styles.metricValue, good && styles.goodText]}>{value}</Text></View>; }
function Pill({ label, good = false, bad = false }: { label: string; good?: boolean; bad?: boolean }) { return <View style={[styles.pill, good && styles.goodPill, bad && styles.badPill]}><Text style={[styles.pillText, good && styles.goodText, bad && styles.badText]}>{label}</Text></View>; }
function Loading({ label }: { label: string }) { return <View style={styles.loading}><ActivityIndicator color={BLUE} /><Text style={styles.muted}>{label}</Text></View>; }
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.body}>{text}</Text></View>; }

function humanize(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "The secure request failed."; }
function dateOnly(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)); }
function dateTime(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function lagosDateKey(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function agentRole(agent: string) { if (agent === "amina") return "Operations Lead"; if (agent === "emeka") return "TA & Merchant Growth"; if (agent === "zainab") return "SME Lending"; return "Audit & Verification"; }

const styles = StyleSheet.create({
  stack: { gap: 14 },
  flex: { flex: 1 },
  title: { color: INK, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  body: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 4 },
  muted: { color: MUTED, fontSize: 11, lineHeight: 17 },
  eyebrow: { color: BLUE, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  sectionTitle: { color: INK, fontSize: 17, fontWeight: "900" },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { color: INK, fontSize: 16, fontWeight: "900" },
  successCard: { backgroundColor: "#ECFDF3", borderColor: "#ABEFC6" },
  warningCard: { backgroundColor: "#FFFAEB", borderColor: "#FEDF89" },
  errorCard: { backgroundColor: "#FEF3F2", borderColor: "#FECDCA" },
  feedback: { borderWidth: 1, borderRadius: 14, padding: 13 },
  errorText: { color: ERROR, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  successText: { color: SUCCESS, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  input: { minHeight: 46, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, color: INK, backgroundColor: "#FFFFFF", marginTop: 5 },
  fieldLabel: { color: MUTED, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  primaryButton: { minHeight: 48, backgroundColor: BLUE, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  secondaryButton: { minHeight: 46, borderWidth: 1, borderColor: BORDER, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 14, backgroundColor: "#FFFFFF" },
  secondaryButtonText: { color: INK, fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "47%", flexGrow: 1, minHeight: 82, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 12, backgroundColor: "#FFFFFF", justifyContent: "space-between" },
  metricValue: { color: INK, fontSize: 15, fontWeight: "900", marginTop: 8 },
  goodText: { color: SUCCESS },
  badText: { color: ERROR },
  pill: { alignSelf: "flex-start", backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  goodPill: { backgroundColor: "#ECFDF3" },
  badPill: { backgroundColor: "#FEF3F2" },
  pillText: { color: MUTED, fontSize: 8, fontWeight: "900" },
  twoColumns: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  compactField: { width: "47%", flexGrow: 1 },
  loading: { paddingVertical: 28, alignItems: "center", gap: 9 },
  empty: { borderWidth: 1, borderColor: BORDER, borderStyle: "dashed", borderRadius: 16, padding: 20 },
  pillRow: { gap: 8, paddingVertical: 5 },
  selectPill: { borderWidth: 1, borderColor: BORDER, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#FFFFFF" },
  selectPillActive: { borderColor: BLUE, backgroundColor: "#EAF1FF" },
  selectPillText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  selectPillTextActive: { color: BLUE },
  agentCard: { width: "47%", flexGrow: 1, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 13, gap: 7 },
  agentRole: { color: INK, fontSize: 12, fontWeight: "800" },
  itemStrong: { color: INK, fontSize: 12, fontWeight: "800" },
});
