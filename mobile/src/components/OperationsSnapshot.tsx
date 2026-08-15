import { StyleSheet, Text, View } from "react-native";

import type { MobileOperationsSnapshot } from "../lib/operations";

const BLUE = "#0357EE";
const INK = "#111827";
const MUTED = "#667085";
const BORDER = "#E4E7EC";
const SURFACE = "#F7F9FC";

export function OperationsSnapshot({ data }: { data: MobileOperationsSnapshot | null }) {
  if (!data) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>Operations snapshot unavailable</Text>
        <Text style={styles.emptyText}>Pull down to refresh the shared portal data.</Text>
      </View>
    );
  }

  const latestScore = data.scorecards[0];
  const latestRecommendation = data.recommendations[0];

  return (
    <View style={styles.stack}>
      <View style={styles.metricsGrid}>
        <Metric
          label="Team TA"
          value={data.portfolio ? `${round(data.portfolio.terminal_activity_rate)}%` : "—"}
          detail={data.portfolio ? `Report ${data.portfolio.report_date}` : "No official report yet"}
        />
        <Metric
          label="Active terminals"
          value={data.portfolio?.active_terminal_count?.toString() ?? "—"}
          detail={
            data.portfolio?.assigned_terminal_count !== null &&
            data.portfolio?.assigned_terminal_count !== undefined
              ? `${data.portfolio.assigned_terminal_count} assigned`
              : "Awaiting report"
          }
        />
        <Metric
          label="Today's tasks"
          value={String(data.todayTasks.length)}
          detail={`${data.todayTasks.filter((task) => task.task_type === "TA").length} TA`}
        />
        <Metric
          label="Amina rating"
          value={latestScore?.rating ?? "—"}
          detail={latestScore ? `${round(latestScore.individual_score_percent)}% score` : "No scorecard yet"}
        />
      </View>

      {data.todayTasks.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today's operating queue</Text>
          <Text style={styles.cardSub}>Synced from the same task ledger as the web portal.</Text>
          <View style={styles.list}>
            {data.todayTasks.slice(0, 7).map((task, index) => (
              <View key={task.id} style={styles.row}>
                <View style={styles.rankBox}>
                  <Text style={styles.rank}>{task.queue_rank ?? index + 1}</Text>
                </View>
                <View style={styles.rowText}>
                  <View style={styles.rowTop}>
                    <Text style={styles.rowTitle}>{task.task_type}</Text>
                    <Text style={styles.status}>{humanize(task.status)}</Text>
                  </View>
                  <Text style={styles.reason} numberOfLines={2}>
                    {task.reason}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.emptyTitle}>No tasks for today</Text>
          <Text style={styles.emptyText}>Amina's generated work will appear here automatically.</Text>
        </View>
      )}

      {latestScore ? (
        <View style={styles.card}>
          <View style={styles.rowTop}>
            <Text style={styles.cardTitle}>Amina management</Text>
            <View style={styles.modePill}>
              <Text style={styles.modePillText}>{humanize(latestScore.management_mode)}</Text>
            </View>
          </View>
          <Text style={styles.scoreLine}>
            Personal {round(latestScore.individual_score_percent)}% · Team {round(latestScore.team_performance_percent)}%
          </Text>
          <Text style={styles.message}>{latestScore.amina_message}</Text>
        </View>
      ) : null}

      {latestRecommendation ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Latest team intelligence</Text>
          <Text style={styles.agentLabel}>{latestRecommendation.agent_kind.toUpperCase()}</Text>
          <Text style={styles.recommendationTitle}>{latestRecommendation.title}</Text>
          <Text style={styles.message} numberOfLines={4}>
            {latestRecommendation.rationale}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function round(value: number) {
  return Math.round(Number(value) * 10) / 10;
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 14,
    minHeight: 112,
  },
  metricLabel: { color: MUTED, fontSize: 10, fontWeight: "700" },
  metricValue: { color: INK, fontSize: 23, fontWeight: "900", marginTop: 7 },
  metricDetail: { color: MUTED, fontSize: 10, marginTop: 5 },
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { color: INK, fontSize: 15, fontWeight: "900" },
  cardSub: { color: MUTED, fontSize: 11, lineHeight: 17, marginTop: -4 },
  list: { marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  rankBox: { width: 32, height: 32, borderRadius: 9, backgroundColor: "#EAF1FF", alignItems: "center", justifyContent: "center" },
  rank: { color: BLUE, fontSize: 12, fontWeight: "900" },
  rowText: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowTitle: { color: INK, fontSize: 12, fontWeight: "900" },
  status: { color: BLUE, fontSize: 9, fontWeight: "800" },
  reason: { color: MUTED, fontSize: 10, lineHeight: 15, marginTop: 3 },
  modePill: { backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  modePillText: { color: INK, fontSize: 9, fontWeight: "900" },
  scoreLine: { color: BLUE, fontSize: 12, fontWeight: "800" },
  message: { color: MUTED, fontSize: 11, lineHeight: 18 },
  agentLabel: { color: BLUE, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  recommendationTitle: { color: INK, fontSize: 13, fontWeight: "800" },
  emptyTitle: { color: INK, fontSize: 13, fontWeight: "800" },
  emptyText: { color: MUTED, fontSize: 11, lineHeight: 17 },
});
