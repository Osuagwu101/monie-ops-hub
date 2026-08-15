import { restSelect } from "@/lib/cloud-api";

export interface MirrorMetric {
  label: string;
  value: string;
  section: string | null;
}

export interface DashboardMirrorSnapshot {
  id: string;
  captured_at: string;
  source_url: string | null;
  report_id: string | null;
  payload: {
    capturedAt?: string | null;
    metrics?: MirrorMetric[];
  };
}

export interface AttentionQueueItem {
  id: string;
  queue_rank: number;
  priority_score: number;
  report_id: string;
  merchant_id: string | null;
  terminal_id: string;
  snapshot_id: string;
  merchant?: {
    business_name: string;
    phone_number: string | null;
    account_number: string | null;
    contact_synced_at: string | null;
  };
  terminal?: {
    terminal_id: string;
    serial_number: string | null;
  };
  performance?: {
    report_date: string;
    period_start: string;
    period_end: string;
    payment_value: number;
    transfer_value: number;
    official_target_value: number;
    official_target_met: boolean;
    days_since_last_transaction: number;
  };
}

function inFilter(ids: string[]) {
  return `in.(${ids.join(",")})`;
}

export async function loadLatestDashboardMirror(accessToken: string) {
  const rows = await restSelect<DashboardMirrorSnapshot[]>(
    "dashboard_mirror_snapshots?select=id,captured_at,source_url,report_id,payload&order=captured_at.desc&limit=1",
    accessToken,
  );
  return rows[0] ?? null;
}

export async function loadAttentionQueue(date: string, accessToken: string) {
  const rows = await restSelect<AttentionQueueItem[]>(
    `bo_attention_queue?select=id,queue_rank,priority_score,report_id,merchant_id,terminal_id,snapshot_id&plan_date=eq.${encodeURIComponent(date)}&order=queue_rank.asc`,
    accessToken,
  );
  if (!rows.length) return rows;

  const merchantIds = [...new Set(rows.map((row) => row.merchant_id).filter(Boolean))] as string[];
  const terminalIds = [...new Set(rows.map((row) => row.terminal_id))];
  const snapshotIds = [...new Set(rows.map((row) => row.snapshot_id))];

  const [merchants, terminals, snapshots] = await Promise.all([
    merchantIds.length
      ? restSelect<
          Array<{
            id: string;
            business_name: string;
            phone_number: string | null;
            account_number: string | null;
            contact_synced_at: string | null;
          }>
        >(
          `merchants?select=id,business_name,phone_number,account_number,contact_synced_at&id=${encodeURIComponent(inFilter(merchantIds))}`,
          accessToken,
        )
      : Promise.resolve([]),
    restSelect<Array<{ id: string; terminal_id: string; serial_number: string | null }>>(
      `terminals?select=id,terminal_id,serial_number&id=${encodeURIComponent(inFilter(terminalIds))}`,
      accessToken,
    ),
    restSelect<
      Array<{
        id: string;
        report_date: string;
        period_start: string;
        period_end: string;
        payment_value: number;
        transfer_value: number;
        official_target_value: number;
        official_target_met: boolean;
        days_since_last_transaction: number;
      }>
    >(
      `terminal_performance_snapshots?select=id,report_date,period_start,period_end,payment_value,transfer_value,official_target_value,official_target_met,days_since_last_transaction&id=${encodeURIComponent(inFilter(snapshotIds))}`,
      accessToken,
    ),
  ]);

  const merchantMap = new Map(merchants.map((merchant) => [merchant.id, merchant]));
  const terminalMap = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));

  return rows.map((row) => ({
    ...row,
    merchant: row.merchant_id ? merchantMap.get(row.merchant_id) : undefined,
    terminal: terminalMap.get(row.terminal_id),
    performance: snapshotMap.get(row.snapshot_id),
  }));
}
