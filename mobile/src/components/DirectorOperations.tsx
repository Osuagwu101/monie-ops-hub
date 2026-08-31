import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  importParsedMobileReport,
  loadRecentMobileReportImports,
  pickAndParseMoniepointReport,
  reconcileMobileReport,
  type MobileReportImportRecord,
  type MobileReportIngestResult,
  type ParsedMobileReport,
} from "../lib/director-reports";
import {
  loadDirectorTerminals,
  type DirectorTerminalRecord,
} from "../lib/director-operations";
import type { MobileOperationsSnapshot } from "../lib/operations";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";
const ERROR = "#B42318";
const SUCCESS = "#027A48";


export function DirectorOverviewStatus({
  operations,
  refreshSignal,
}: {
  operations: MobileOperationsSnapshot | null;
  refreshSignal: boolean;
}) {
  const [latest, setLatest] = useState<MobileReportImportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reports = await loadRecentMobileReportImports(1);
      setLatest(reports[0] ?? null);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  return (
    <View style={styles.stack}>
      <View style={styles.overviewGrid}>
        <View style={styles.overviewMetric}>
          <Text style={styles.detailLabel}>Latest report</Text>
          <Text style={styles.overviewValue}>{latest?.report_date ?? "—"}</Text>
          <Text style={styles.smallMuted}>
            {latest ? latest.processing_status.replace(/_/g, " ") : loading ? "Loading…" : "No import yet"}
          </Text>
        </View>
        <View style={styles.overviewMetric}>
          <Text style={styles.detailLabel}>Rolling Target Met</Text>
          <Text style={styles.overviewValue}>
            {operations?.portfolio?.rolling_target_met_count?.toString() ?? "—"}
          </Text>
          <Text style={styles.smallMuted}>Official report count</Text>
        </View>
      </View>
      {error ? <ErrorBox message={error} onRetry={() => void refresh()} /> : null}
    </View>
  );
}

export function DirectorReports({ onPortalRefresh }: { onPortalRefresh: () => void }) {
  const [recent, setRecent] = useState<MobileReportImportRecord[]>([]);
  const [parsed, setParsed] = useState<ParsedMobileReport | null>(null);
  const [result, setResult] = useState<MobileReportIngestResult | null>(null);
  const [busy, setBusy] = useState<"loading" | "parsing" | "importing" | "reconciling" | null>(
    "loading",
  );
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy((current) => current ?? "loading");
    try {
      setRecent(await loadRecentMobileReportImports());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy((current) => (current === "loading" ? null : current));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choosePdf = async () => {
    setBusy("parsing");
    setError(null);
    setResult(null);
    try {
      const next = await pickAndParseMoniepointReport();
      if (next) setParsed(next);
    } catch (caught) {
      setParsed(null);
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  const importReport = async () => {
    if (!parsed || !parsed.report.canImport) return;
    setBusy("importing");
    setError(null);
    setResult(null);
    try {
      const imported = await importParsedMobileReport(parsed);
      setResult(imported);
      await refresh();
      onPortalRefresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async (reportId: string) => {
    setBusy("reconciling");
    setReconcilingId(reportId);
    setError(null);
    try {
      await reconcileMobileReport(reportId);
      await refresh();
      onPortalRefresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setReconcilingId(null);
      setBusy(null);
    }
  };

  const rollingTargetMet = useMemo(
    () => parsed?.report.rollingRows.filter((row) => row.officialTargetMet).length ?? 0,
    [parsed],
  );

  return (
    <View style={styles.stack}>
      <View>
        <Text style={styles.title}>Official Reports</Text>
        <Text style={styles.body}>
          Select the official Moniepoint PDF, run the same parser validation used by the web portal,
          preserve the source PDF, and invoke the existing report-ingestion RPC.
        </Text>
      </View>

      {error ? <ErrorBox message={error} onRetry={() => void refresh()} /> : null}

      {result ? (
        <View style={styles.successBox}>
          <Text style={styles.successTitle}>
            {result.duplicate ? "Report already exists" : "Official report imported"}
          </Text>
          <Text style={styles.successBody}>
            {result.duplicate
              ? `The same report source is already stored for ${result.reportDate}. No duplicate rows were created.`
              : `${result.rowsImported ?? 0} source rows were imported. Tunde reconciled ${result.reconciliation?.tasksReconciled ?? 0} TA tasks.`}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Import official PDF</Text>
        <Text style={styles.smallMuted}>
          PDF only · maximum 15 MB · the original source remains immutable in the existing
          moniepoint-reports bucket.
        </Text>
        <PrimaryButton
          title={busy === "parsing" ? "Reading PDF…" : "Choose PDF from device"}
          disabled={Boolean(busy)}
          onPress={() => void choosePdf()}
        />

        {parsed ? (
          <View style={styles.subtleBlock}>
            <View style={styles.rowBetween}>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {parsed.name}
              </Text>
              <StatusPill
                label={parsed.report.canImport ? "VALIDATED" : "BLOCKED"}
                good={parsed.report.canImport}
              />
            </View>
            <Detail label="Report date" value={parsed.report.reportDate} />
            <Detail label="BRM" value={parsed.report.brmName} />
            <Detail label="Pages" value={String(parsed.report.pageCount)} />
            <Detail label="Daily rows" value={String(parsed.report.dailyRows.length)} />
            <Detail label="Rolling rows" value={String(parsed.report.rollingRows.length)} />
            <Detail label="Rolling Target Met" value={String(rollingTargetMet)} />
            <Detail label="SHA-256" value={`${parsed.sha256.slice(0, 12)}…`} />

            <Text style={styles.sectionLabel}>PARSER VALIDATION</Text>
            {parsed.report.checks.map((check, index) => (
              <View key={`${check.message}-${index}`} style={styles.checkRow}>
                <StatusPill
                  label={check.level.toUpperCase()}
                  good={check.level === "pass"}
                  warning={check.level === "warning"}
                />
                <Text style={styles.checkText}>{check.message}</Text>
              </View>
            ))}

            <PrimaryButton
              title={busy === "importing" ? "Importing…" : "Preserve source & import official data"}
              disabled={Boolean(busy) || !parsed.report.canImport}
              onPress={() => void importReport()}
            />
          </View>
        ) : (
          <Text style={styles.smallMuted}>
            Choose a report to see its validation checks before anything is imported.
          </Text>
        )}
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>Recent official imports</Text>
        <SmallButton
          title={busy === "loading" ? "Loading…" : "Refresh"}
          disabled={Boolean(busy)}
          onPress={() => void refresh()}
        />
      </View>

      {busy === "loading" && !recent.length ? (
        <Loading label="Loading report history…" />
      ) : !recent.length ? (
        <Empty
          title="No official imports"
          body="Imported reports from the shared production backend will appear here."
        />
      ) : (
        recent.map((report) => (
          <View style={styles.card} key={report.id}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.itemTitle}>{report.report_date}</Text>
                <Text style={styles.smallMuted} numberOfLines={1}>
                  {report.source_filename}
                </Text>
              </View>
              <StatusPill
                label={report.processing_status.toUpperCase()}
                good={report.processing_status === "processed"}
              />
            </View>
            <Detail label="BRM" value={report.brm_name ?? "Not available"} />
            <Detail label="Rows" value={report.row_count?.toString() ?? "Not available"} />
            {report.processing_error ? (
              <Text style={styles.errorInline}>{report.processing_error}</Text>
            ) : null}
            <SmallButton
              title={reconcilingId === report.id ? "Rechecking…" : "Recheck Tunde reconciliation"}
              disabled={
                Boolean(busy) ||
                report.processing_status !== "processed" ||
                reconcilingId === report.id
              }
              onPress={() => void reconcile(report.id)}
            />
          </View>
        ))
      )}
    </View>
  );
}

export function DirectorMerchantsTerminals() {
  const [records, setRecords] = useState<DirectorTerminalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await loadDirectorTerminals());
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <View style={styles.stack}>
      <View>
        <Text style={styles.title}>Merchants & Terminals</Text>
        <Text style={styles.body}>
          Portfolio-wide Director view from the same merchant, terminal and rolling-performance
          records used by the web portal.
        </Text>
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.smallMuted}>{records.length} terminals loaded</Text>
        <SmallButton
          title={loading ? "Loading…" : "Refresh"}
          disabled={loading}
          onPress={() => void refresh()}
        />
      </View>

      {error ? <ErrorBox message={error} onRetry={() => void refresh()} /> : null}
      {loading && !records.length ? (
        <Loading label="Loading merchant and terminal data…" />
      ) : !records.length ? (
        <Empty
          title="No terminals available"
          body="No terminal records are currently visible to this Director account."
        />
      ) : (
        records.map((record) => {
          const rollingValue = record.performance
            ? record.performance.payment_value + record.performance.transfer_value
            : null;
          return (
            <View style={styles.card} key={record.id}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>{record.businessName}</Text>
                  <Text style={styles.smallMuted}>TID {record.terminalId}</Text>
                </View>
                {record.performance ? (
                  <StatusPill
                    label={record.performance.official_target_met ? "TARGET MET" : "TARGET OPEN"}
                    good={record.performance.official_target_met}
                  />
                ) : null}
              </View>

              <Detail
                label="Phone number"
                value={record.phoneNumber ?? "Phone number not available"}
              />
              <Detail
                label="POS account"
                value={record.accountNumber ?? "POS account not available"}
              />
              <Detail
                label="Terminal serial"
                value={record.serialNumber ?? "Terminal serial not available"}
              />

              {record.performance ? (
                <View style={styles.subtleBlock}>
                  <Text style={styles.sectionLabel}>LATEST ROLLING PERFORMANCE</Text>
                  <Detail label="Report date" value={record.performance.report_date} />
                  <Detail
                    label="Rolling value"
                    value={money(rollingValue ?? 0)}
                  />
                  <Detail
                    label="Official target"
                    value={money(record.performance.official_target_value)}
                  />
                  <Detail
                    label="Days since last transaction"
                    value={String(record.performance.days_since_last_transaction)}
                  />
                </View>
              ) : (
                <Text style={styles.smallMuted}>Performance data not available.</Text>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Unable to load this Director section</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <SmallButton title="Retry" onPress={onRetry} />
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

function Loading({ label }: { label: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={BLUE} />
      <Text style={styles.smallMuted}>{label}</Text>
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

function StatusPill({
  label,
  good = false,
  warning = false,
}: {
  label: string;
  good?: boolean;
  warning?: boolean;
}) {
  return (
    <View
      style={[
        styles.pill,
        good && styles.pillGood,
        warning && styles.pillWarning,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          good && styles.pillTextGood,
          warning && styles.pillTextWarning,
        ]}
      >
        {label}
      </Text>
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
      style={[styles.primaryButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      {disabled && /…$/.test(title) ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.primaryButtonText}>{title}</Text>
      )}
    </Pressable>
  );
}

function SmallButton({
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
      style={[styles.smallButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.smallButtonText}>{title}</Text>
    </Pressable>
  );
}

function money(value: number) {
  return `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(value)}`;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The secure request failed.";
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  overviewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  overviewMetric: { flexGrow: 1, width: "47%", borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 14, backgroundColor: "#FFFFFF" },
  overviewValue: { color: INK, fontSize: 20, fontWeight: "900", marginTop: 5 },
  title: { color: INK, fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  body: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 4 },
  sectionTitle: { color: INK, fontSize: 17, fontWeight: "900" },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  cardTitle: { color: INK, fontSize: 16, fontWeight: "900" },
  itemTitle: { color: INK, fontSize: 14, fontWeight: "800" },
  smallMuted: { color: MUTED, fontSize: 11, lineHeight: 17 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  flex: { flex: 1 },
  subtleBlock: { backgroundColor: SURFACE, borderRadius: 13, padding: 12, gap: 8 },
  sectionLabel: { color: BLUE, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  detail: { borderWidth: 1, borderColor: BORDER, borderRadius: 11, padding: 10 },
  detailLabel: { color: MUTED, fontSize: 9, fontWeight: "700" },
  detailValue: { color: INK, fontSize: 12, fontWeight: "700", marginTop: 3 },
  primaryButton: {
    minHeight: 48,
    backgroundColor: BLUE,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  smallButton: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  smallButtonText: { color: INK, fontSize: 11, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: "#F2F4F7",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGood: { backgroundColor: "#ECFDF3" },
  pillWarning: { backgroundColor: "#FFFAEB" },
  pillText: { color: MUTED, fontSize: 8, fontWeight: "900" },
  pillTextGood: { color: SUCCESS },
  pillTextWarning: { color: "#B54708" },
  checkRow: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, paddingTop: 9 },
  checkText: { color: MUTED, fontSize: 10, lineHeight: 16 },
  errorBox: {
    backgroundColor: "#FEF3F2",
    borderWidth: 1,
    borderColor: "#FECDCA",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  errorTitle: { color: ERROR, fontSize: 13, fontWeight: "900" },
  errorBody: { color: ERROR, fontSize: 11, lineHeight: 17 },
  errorInline: { color: ERROR, fontSize: 10, lineHeight: 16 },
  successBox: {
    backgroundColor: "#ECFDF3",
    borderWidth: 1,
    borderColor: "#ABEFC6",
    borderRadius: 14,
    padding: 14,
    gap: 5,
  },
  successTitle: { color: SUCCESS, fontSize: 13, fontWeight: "900" },
  successBody: { color: SUCCESS, fontSize: 11, lineHeight: 17 },
  emptyBox: {
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 20,
    gap: 5,
  },
  loading: { paddingVertical: 28, alignItems: "center", gap: 9 },
});
