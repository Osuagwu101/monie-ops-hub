import { supabase } from "./supabase";

export interface DirectorTerminalPerformance {
  report_date: string;
  payment_value: number;
  transfer_value: number;
  official_target_value: number;
  official_target_met: boolean;
  days_since_last_transaction: number;
}

export interface DirectorTerminalRecord {
  id: string;
  terminalId: string;
  serialNumber: string | null;
  merchantId: string | null;
  isFaulty: boolean;
  businessName: string;
  phoneNumber: string | null;
  accountNumber: string | null;
  performance: DirectorTerminalPerformance | null;
}

export async function loadDirectorTerminals(): Promise<DirectorTerminalRecord[]> {
  const { data: terminalRows, error: terminalError } = await supabase
    .from("terminals")
    .select("id,terminal_id,serial_number,merchant_id,is_faulty")
    .order("terminal_id", { ascending: true })
    .limit(1000);

  if (terminalError) throw terminalError;

  const terminals = terminalRows ?? [];
  if (!terminals.length) return [];

  const merchantIds = unique(terminals.map((terminal) => terminal.merchant_id));
  const terminalIds = terminals.map((terminal) => terminal.id);

  const merchantPromise = merchantIds.length
    ? supabase
        .from("merchants")
        .select("id,business_name,phone_number,account_number")
        .in("id", merchantIds)
    : Promise.resolve({ data: [], error: null });

  const [merchantResult, performanceRows] = await Promise.all([
    merchantPromise,
    loadLatestRollingPerformance(terminalIds),
  ]);

  if (merchantResult.error) throw merchantResult.error;

  const merchantMap = new Map(
    (merchantResult.data ?? []).map((merchant) => [merchant.id, merchant] as const),
  );
  const performanceMap = new Map<string, DirectorTerminalPerformance>();

  for (const row of performanceRows) {
    if (!performanceMap.has(row.terminal_id)) {
      performanceMap.set(row.terminal_id, {
        report_date: row.report_date,
        payment_value: Number(row.payment_value ?? 0),
        transfer_value: Number(row.transfer_value ?? 0),
        official_target_value: Number(row.official_target_value ?? 0),
        official_target_met: Boolean(row.official_target_met),
        days_since_last_transaction: Number(row.days_since_last_transaction ?? 0),
      });
    }
  }

  return terminals.map((terminal) => {
    const merchant = terminal.merchant_id ? merchantMap.get(terminal.merchant_id) : undefined;
    return {
      id: terminal.id,
      terminalId: terminal.terminal_id,
      serialNumber: blankToNull(terminal.serial_number),
      merchantId: terminal.merchant_id,
      isFaulty: Boolean(terminal.is_faulty),
      businessName: merchant?.business_name?.trim() || "Business name not available",
      phoneNumber: blankToNull(merchant?.phone_number),
      accountNumber: blankToNull(merchant?.account_number),
      performance: performanceMap.get(terminal.id) ?? null,
    };
  });
}

async function loadLatestRollingPerformance(terminalIds: string[]) {
  const rows: Array<{
    terminal_id: string;
    report_date: string;
    payment_value: number | string | null;
    transfer_value: number | string | null;
    official_target_value: number | string | null;
    official_target_met: boolean | null;
    days_since_last_transaction: number | null;
  }> = [];

  for (let index = 0; index < terminalIds.length; index += 100) {
    const batch = terminalIds.slice(index, index + 100);
    const { data, error } = await supabase
      .from("terminal_performance_snapshots")
      .select(
        "terminal_id,report_date,payment_value,transfer_value,official_target_value,official_target_met,days_since_last_transaction",
      )
      .in("terminal_id", batch)
      .eq("period_kind", "rolling_7_day")
      .order("report_date", { ascending: false });

    if (error) throw error;
    rows.push(...(data ?? []));
  }

  return rows;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
