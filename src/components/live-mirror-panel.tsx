import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Clock3, Database, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAttentionQueue, loadLatestDashboardMirror } from "@/lib/mirror-data";

export function LiveMirrorPanel({ accessToken, date }: { accessToken: string; date: string }) {
  const mirrorQuery = useQuery({
    queryKey: ["moniepoint-dashboard-mirror"],
    queryFn: () => loadLatestDashboardMirror(accessToken),
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
  });
  const attentionQuery = useQuery({
    queryKey: ["bo-attention-queue", date],
    queryFn: () => loadAttentionQueue(date, accessToken),
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
  });

  const mirror = mirrorQuery.data;
  const metrics = mirror?.payload?.metrics ?? [];
  const attention = attentionQuery.data ?? [];

  return (
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Primary dashboard mirror
          </CardTitle>
          <CardDescription>
            Values below are copied from the live Moniepoint dashboard exactly as displayed. Missing
            values remain absent rather than being inferred.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mirrorQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking the latest Moniepoint mirror…</p>
          ) : mirror && metrics.length ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Live browser capture</Badge>
                <span>Synced {formatDateTime(mirror.captured_at)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {metrics.map((metric, index) => (
                  <div key={`${metric.label}-${index}`} className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">
                      {metric.section ? `${metric.section} · ` : ""}
                      {metric.label}
                    </div>
                    <div className="mt-1 text-lg font-bold text-foreground">{metric.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
              No successful live dashboard capture has been stored yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" /> BOs needing weekly-target attention
          </CardTitle>
          <CardDescription>
            Up to 15 terminals ranked from the latest official rolling 7-day report where the
            numeric rolling value remains below the official target. Active underperformers appear
            before zero-transaction BOs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attentionQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading official BO attention queue…</p>
          ) : attention.length ? (
            <div className="space-y-3">
              {attention.map((item) => {
                const actual =
                  (item.performance?.payment_value ?? 0) + (item.performance?.transfer_value ?? 0);
                const target = item.performance?.official_target_value ?? null;
                const gap = target === null ? null : Math.max(0, target - actual);
                return (
                  <div key={item.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">
                          {item.queue_rank}. {item.merchant?.business_name ?? "BO name unavailable"}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>TID {item.terminal?.terminal_id ?? "—"}</span>
                          <span>Serial {item.terminal?.serial_number ?? "—"}</span>
                          <span>Account {item.merchant?.account_number ?? "Not confirmed"}</span>
                        </div>
                      </div>
                      <Badge variant="secondary">
                        Score {Number(item.priority_score).toFixed(0)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <Mini
                        label="Official weekly target"
                        value={target === null ? "—" : money(target)}
                      />
                      <Mini label="Actual rolling value" value={money(actual)} />
                      <Mini label="Remaining gap" value={gap === null ? "—" : money(gap)} />
                      <Mini
                        label="Last transacted"
                        value={
                          item.performance
                            ? `${item.performance.days_since_last_transaction} day${item.performance.days_since_last_transaction === 1 ? "" : "s"} ago`
                            : "—"
                        }
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {item.merchant?.phone_number ?? "Phone not yet confirmed"}
                      </span>
                      {item.merchant?.contact_synced_at && (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" /> Team Management synced{" "}
                          {formatDateTime(item.merchant.contact_synced_at)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex gap-3 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              No official BO attention queue is available for today yet.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function money(value: number) {
  return `₦${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(value)}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
