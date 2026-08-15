-- Phase 3: Moniepoint PDF report engine.
-- Preserves the uploaded official report as immutable evidence, stores raw parsed rows,
-- normalises terminal performance, exposes only safe portfolio aggregates to assistants,
-- and gives Tunde a report-backed reconciliation path.

create type public.report_terminal_section as enum (
  'daily',
  'rolling_7_day',
  'non_transacting'
);

alter table public.report_imports
  add column source_storage_path text,
  add column brm_name text,
  add column parser_version text,
  add column parsed_summary jsonb not null default '{}'::jsonb;

create table public.report_terminal_rows (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.report_imports(id) on delete cascade,
  section_kind public.report_terminal_section not null,
  row_number integer not null check (row_number > 0),
  terminal_external_id text not null,
  terminal_serial text,
  business_name text not null,
  payment_value numeric(18,2),
  payment_volume integer,
  transfer_value numeric(18,2),
  transfer_volume integer,
  official_target_value numeric(18,2),
  official_target_met boolean,
  days_since_last_transaction integer,
  period_start date,
  period_end date,
  last_transaction_date date,
  business_registration_date date,
  terminal_assignment_date date,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (report_id, section_kind, row_number),
  unique (report_id, section_kind, terminal_external_id)
);

alter table public.terminal_performance_snapshots
  add column source_row_id uuid references public.report_terminal_rows(id) on delete set null;

create table public.portfolio_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.report_imports(id) on delete cascade,
  report_date date not null,
  top_bo_retention_rate numeric(5,2),
  terminal_activity_rate numeric(5,2) not null,
  assigned_terminal_growth integer,
  total_terminal_count integer,
  assigned_terminal_count integer,
  active_terminal_count integer,
  unassigned_terminal_count integer,
  assigned_7_plus_days_count integer,
  active_assigned_7_plus_days_count integer,
  payment_value numeric(18,2),
  payment_volume integer,
  transfer_value numeric(18,2),
  transfer_volume integer,
  daily_target_met_count integer,
  rolling_target_met_count integer,
  parsed_daily_row_count integer,
  parsed_rolling_row_count integer,
  parsed_non_transacting_row_count integer,
  captured_at timestamptz not null default now()
);

create index report_rows_report_section_idx
  on public.report_terminal_rows (report_id, section_kind, row_number);
create index report_rows_terminal_idx
  on public.report_terminal_rows (terminal_external_id, report_id);
create index portfolio_performance_date_idx
  on public.portfolio_performance_snapshots (report_date desc, captured_at desc);
create index merchants_normalized_name_idx
  on public.merchants (lower(regexp_replace(btrim(business_name), '\s+', ' ', 'g')));
create unique index task_verifications_task_report_idx
  on public.task_verifications (task_id, verified_against_report_id);

alter table public.report_terminal_rows enable row level security;
alter table public.portfolio_performance_snapshots enable row level security;

create policy report_rows_director_only on public.report_terminal_rows
for all to authenticated
using (public.is_director())
with check (public.is_director());

create policy portfolio_performance_authenticated_read on public.portfolio_performance_snapshots
for select to authenticated using (true);

create policy portfolio_performance_director_manage on public.portfolio_performance_snapshots
for all to authenticated
using (public.is_director())
with check (public.is_director());

-- Phase 1 originally allowed every authenticated user to read every merchant/terminal.
-- Once real portfolio data arrives, assistants must only see entities connected to their work.
drop policy if exists merchants_authenticated_read on public.merchants;
create policy merchants_read_assigned_or_director on public.merchants
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.merchant_id = merchants.id
      and t.assigned_to = auth.uid()
  )
);

drop policy if exists terminals_authenticated_read on public.terminals;
create policy terminals_read_assigned_or_director on public.terminals
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.terminal_id = terminals.id
      and t.assigned_to = auth.uid()
  )
);

drop policy if exists performance_authenticated_read on public.terminal_performance_snapshots;
create policy performance_read_assigned_or_director on public.terminal_performance_snapshots
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.terminal_id = terminal_performance_snapshots.terminal_id
      and t.assigned_to = auth.uid()
  )
);

-- Private, append-only source evidence bucket. No UPDATE or DELETE policy is granted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'moniepoint-reports',
  'moniepoint-reports',
  false,
  15728640,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy moniepoint_report_source_director_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'moniepoint-reports' and public.is_director());

create policy moniepoint_report_source_director_read on storage.objects
for select to authenticated
using (bucket_id = 'moniepoint-reports' and public.is_director());

create or replace function public.normalize_business_name(p_name text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.reconcile_ta_tasks_for_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_date date;
  v_local_date date;
  v_local_time time;
  v_final_time time;
  v_is_final boolean;
  v_task public.tasks;
  v_snapshot public.terminal_performance_snapshots;
  v_state public.verification_state;
  v_rationale text;
  v_count integer := 0;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  select report_date
  into v_report_date
  from public.report_imports
  where id = p_report_id
    and processing_status = 'processed';

  if v_report_date is null then
    raise exception 'Processed report not found';
  end if;

  select next_day_verification_time
  into v_final_time
  from public.operating_config
  where id = true;

  v_local_date := (now() at time zone 'Africa/Lagos')::date;
  v_local_time := (now() at time zone 'Africa/Lagos')::time;
  v_is_final := (
    v_local_date > v_report_date + 1
    or (v_local_date = v_report_date + 1 and v_local_time >= v_final_time)
  );

  for v_task in
    select t.*
    from public.tasks t
    where t.task_type = 'TA'::public.task_type
      and t.task_date = v_report_date
      and t.terminal_id is not null
      and t.status in (
        'completed'::public.task_status,
        'pending_verification'::public.task_status,
        'deferred'::public.task_status
      )
  loop
    select s.*
    into v_snapshot
    from public.terminal_performance_snapshots s
    where s.report_id = p_report_id
      and s.terminal_id = v_task.terminal_id
      and s.period_kind = 'rolling_7_day'
    limit 1;

    if v_snapshot.id is null then
      if v_is_final then
        v_state := 'unverifiable'::public.verification_state;
        v_rationale := format(
          'Tunde could not find this terminal in the official rolling 7-day section for %s.',
          v_report_date
        );
      else
        v_state := 'deferred'::public.verification_state;
        v_rationale := format(
          'Official evidence is not final until the next-day verification window for %s.',
          v_report_date
        );
      end if;
    elsif not v_is_final then
      v_state := 'deferred'::public.verification_state;
      v_rationale := format(
        'Official report captured for %s; Tunde is holding final judgment until the next-day verification window.',
        v_report_date
      );
    elsif v_snapshot.official_target_met then
      v_state := 'verified'::public.verification_state;
      v_rationale := format(
        'Official Moniepoint rolling 7-day data for %s marks Target Met = True (official target ₦%s).',
        v_report_date,
        trim(to_char(v_snapshot.official_target_value, 'FM999,999,999,990.00'))
      );
    else
      v_state := 'discrepancy'::public.verification_state;
      v_rationale := format(
        'Official Moniepoint rolling 7-day data for %s marks Target Met = False (official target ₦%s).',
        v_report_date,
        trim(to_char(v_snapshot.official_target_value, 'FM999,999,999,990.00'))
      );
    end if;

    insert into public.task_verifications (
      task_id,
      state,
      verified_against_report_id,
      evidence_snapshot_id,
      rationale,
      verified_at,
      verified_by
    ) values (
      v_task.id,
      v_state,
      p_report_id,
      v_snapshot.id,
      v_rationale,
      now(),
      null
    )
    on conflict (task_id, verified_against_report_id)
    do update set
      state = excluded.state,
      evidence_snapshot_id = excluded.evidence_snapshot_id,
      rationale = excluded.rationale,
      verified_at = excluded.verified_at,
      verified_by = null;

    update public.tasks
    set status = v_state::text::public.task_status
    where id = v_task.id;

    insert into public.audit_events (
      actor_user_id,
      actor_kind,
      event_type,
      entity_type,
      entity_id,
      payload
    ) values (
      null,
      'tunde',
      'ta_task_reconciled',
      'task',
      v_task.id::text,
      jsonb_build_object(
        'report_id', p_report_id,
        'report_date', v_report_date,
        'state', v_state,
        'final_window_reached', v_is_final,
        'official_target_met', v_snapshot.official_target_met
      )
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'reportId', p_report_id,
    'reportDate', v_report_date,
    'finalWindowReached', v_is_final,
    'tasksReconciled', v_count
  );
end;
$$;

revoke all on function public.reconcile_ta_tasks_for_report(uuid) from public;
grant execute on function public.reconcile_ta_tasks_for_report(uuid) to authenticated;

create or replace function public.ingest_moniepoint_report(
  p_metadata jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_id uuid;
  v_existing_report_id uuid;
  v_report_date date;
  v_source_filename text;
  v_source_sha256 text;
  v_source_storage_path text;
  v_brm_name text;
  v_parser_version text;
  v_row jsonb;
  v_section public.report_terminal_section;
  v_business_name text;
  v_normalized_business_name text;
  v_terminal_external_id text;
  v_terminal_serial text;
  v_merchant_id uuid;
  v_terminal_id uuid;
  v_source_row_id uuid;
  v_period_kind text;
  v_daily_count integer := 0;
  v_rolling_count integer := 0;
  v_non_transacting_count integer := 0;
  v_daily_target_met_count integer := 0;
  v_rolling_target_met_count integer := 0;
  v_total_rows integer := 0;
  v_reconciliation jsonb;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Parsed report rows must be a JSON array';
  end if;

  v_report_date := nullif(p_metadata->>'reportDate', '')::date;
  v_source_filename := nullif(btrim(p_metadata->>'sourceFilename'), '');
  v_source_sha256 := lower(nullif(btrim(p_metadata->>'sourceSha256'), ''));
  v_source_storage_path := nullif(btrim(p_metadata->>'sourceStoragePath'), '');
  v_brm_name := nullif(btrim(p_metadata->>'brmName'), '');
  v_parser_version := nullif(btrim(p_metadata->>'parserVersion'), '');

  if v_report_date is null
     or v_source_filename is null
     or v_source_sha256 is null
     or v_source_storage_path is null
     or v_brm_name is null
     or v_parser_version is null then
    raise exception 'Report metadata is incomplete';
  end if;

  if v_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid SHA-256 digest';
  end if;

  select id
  into v_existing_report_id
  from public.report_imports
  where report_date = v_report_date
    and source_sha256 = v_source_sha256
  limit 1;

  if v_existing_report_id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'reportId', v_existing_report_id,
      'reportDate', v_report_date
    );
  end if;

  insert into public.report_imports (
    report_date,
    imported_by,
    source_filename,
    source_sha256,
    source_kind,
    source_storage_path,
    brm_name,
    parser_version,
    parsed_summary,
    row_count,
    processing_status
  ) values (
    v_report_date,
    auth.uid(),
    v_source_filename,
    v_source_sha256,
    'moniepoint_pdf',
    v_source_storage_path,
    v_brm_name,
    v_parser_version,
    coalesce(p_metadata->'summary', '{}'::jsonb),
    jsonb_array_length(p_rows),
    'processing'
  ) returning id into v_report_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_total_rows := v_total_rows + 1;
    v_section := (v_row->>'section')::public.report_terminal_section;
    v_terminal_external_id := nullif(upper(btrim(v_row->>'terminalId')), '');
    v_terminal_serial := nullif(upper(btrim(v_row->>'terminalSerial')), '');
    v_business_name := nullif(regexp_replace(btrim(v_row->>'businessName'), '\s+', ' ', 'g'), '');

    if v_terminal_external_id is null or v_business_name is null then
      raise exception 'Row % is missing terminal or business identity', v_total_rows;
    end if;

    v_normalized_business_name := public.normalize_business_name(v_business_name);

    select m.id
    into v_merchant_id
    from public.merchants m
    where public.normalize_business_name(m.business_name) = v_normalized_business_name
    order by m.created_at
    limit 1;

    if v_merchant_id is null then
      insert into public.merchants (
        business_name,
        external_business_ref,
        is_active
      ) values (
        v_business_name,
        'name:' || encode(digest(v_normalized_business_name, 'sha256'), 'hex'),
        true
      ) returning id into v_merchant_id;
    end if;

    insert into public.terminals (
      terminal_id,
      serial_number,
      merchant_id,
      assigned_at
    ) values (
      v_terminal_external_id,
      v_terminal_serial,
      v_merchant_id,
      nullif(v_row->>'terminalAssignmentDate', '')::date::timestamptz
    )
    on conflict (terminal_id)
    do update set
      serial_number = coalesce(excluded.serial_number, public.terminals.serial_number),
      merchant_id = excluded.merchant_id,
      assigned_at = coalesce(excluded.assigned_at, public.terminals.assigned_at)
    returning id into v_terminal_id;

    insert into public.report_terminal_rows (
      report_id,
      section_kind,
      row_number,
      terminal_external_id,
      terminal_serial,
      business_name,
      payment_value,
      payment_volume,
      transfer_value,
      transfer_volume,
      official_target_value,
      official_target_met,
      days_since_last_transaction,
      period_start,
      period_end,
      last_transaction_date,
      business_registration_date,
      terminal_assignment_date,
      raw_payload
    ) values (
      v_report_id,
      v_section,
      (v_row->>'rowNumber')::integer,
      v_terminal_external_id,
      v_terminal_serial,
      v_business_name,
      nullif(v_row->>'paymentValue', '')::numeric,
      nullif(v_row->>'paymentVolume', '')::integer,
      nullif(v_row->>'transferValue', '')::numeric,
      nullif(v_row->>'transferVolume', '')::integer,
      nullif(v_row->>'officialTargetValue', '')::numeric,
      nullif(v_row->>'officialTargetMet', '')::boolean,
      nullif(v_row->>'daysSinceLastTransaction', '')::integer,
      nullif(v_row->>'periodStart', '')::date,
      nullif(v_row->>'periodEnd', '')::date,
      nullif(v_row->>'lastTransactionDate', '')::date,
      nullif(v_row->>'businessRegistrationDate', '')::date,
      nullif(v_row->>'terminalAssignmentDate', '')::date,
      v_row
    ) returning id into v_source_row_id;

    if v_section in ('daily'::public.report_terminal_section, 'rolling_7_day'::public.report_terminal_section) then
      if v_section = 'daily'::public.report_terminal_section then
        v_period_kind := 'daily';
        v_daily_count := v_daily_count + 1;
        if coalesce((v_row->>'officialTargetMet')::boolean, false) then
          v_daily_target_met_count := v_daily_target_met_count + 1;
        end if;
      else
        v_period_kind := 'rolling_7_day';
        v_rolling_count := v_rolling_count + 1;
        if coalesce((v_row->>'officialTargetMet')::boolean, false) then
          v_rolling_target_met_count := v_rolling_target_met_count + 1;
        end if;
      end if;

      insert into public.terminal_performance_snapshots (
        terminal_id,
        report_id,
        report_date,
        period_start,
        period_end,
        period_kind,
        payment_value,
        payment_volume,
        transfer_value,
        transfer_volume,
        official_target_value,
        official_target_met,
        days_since_last_transaction,
        source_row_id
      ) values (
        v_terminal_id,
        v_report_id,
        v_report_date,
        (v_row->>'periodStart')::date,
        (v_row->>'periodEnd')::date,
        v_period_kind,
        coalesce((v_row->>'paymentValue')::numeric, 0),
        coalesce((v_row->>'paymentVolume')::integer, 0),
        coalesce((v_row->>'transferValue')::numeric, 0),
        coalesce((v_row->>'transferVolume')::integer, 0),
        coalesce((v_row->>'officialTargetValue')::numeric, 0),
        coalesce((v_row->>'officialTargetMet')::boolean, false),
        coalesce((v_row->>'daysSinceLastTransaction')::integer, 0),
        v_source_row_id
      );
    else
      v_non_transacting_count := v_non_transacting_count + 1;
    end if;
  end loop;

  if v_daily_count = 0 or v_rolling_count = 0 then
    raise exception 'Report does not contain both daily and rolling 7-day terminal sections';
  end if;

  insert into public.portfolio_performance_snapshots (
    report_id,
    report_date,
    top_bo_retention_rate,
    terminal_activity_rate,
    assigned_terminal_growth,
    total_terminal_count,
    assigned_terminal_count,
    active_terminal_count,
    unassigned_terminal_count,
    assigned_7_plus_days_count,
    active_assigned_7_plus_days_count,
    payment_value,
    payment_volume,
    transfer_value,
    transfer_volume,
    daily_target_met_count,
    rolling_target_met_count,
    parsed_daily_row_count,
    parsed_rolling_row_count,
    parsed_non_transacting_row_count
  ) values (
    v_report_id,
    v_report_date,
    nullif(p_metadata #>> '{summary,topBoRetentionRate}', '')::numeric,
    (p_metadata #>> '{summary,terminalActivityRate}')::numeric,
    nullif(p_metadata #>> '{summary,assignedTerminalGrowth}', '')::integer,
    nullif(p_metadata #>> '{summary,totalTerminalCount}', '')::integer,
    nullif(p_metadata #>> '{summary,assignedTerminalCount}', '')::integer,
    nullif(p_metadata #>> '{summary,activeTerminalCount}', '')::integer,
    nullif(p_metadata #>> '{summary,unassignedTerminalCount}', '')::integer,
    nullif(p_metadata #>> '{summary,assignedSevenPlusDaysCount}', '')::integer,
    nullif(p_metadata #>> '{summary,activeAssignedSevenPlusDaysCount}', '')::integer,
    nullif(p_metadata #>> '{summary,paymentValue}', '')::numeric,
    nullif(p_metadata #>> '{summary,paymentVolume}', '')::integer,
    nullif(p_metadata #>> '{summary,transferValue}', '')::numeric,
    nullif(p_metadata #>> '{summary,transferVolume}', '')::integer,
    v_daily_target_met_count,
    v_rolling_target_met_count,
    v_daily_count,
    v_rolling_count,
    v_non_transacting_count
  );

  update public.report_imports
  set processing_status = 'processed',
      row_count = v_total_rows,
      processing_error = null
  where id = v_report_id;

  insert into public.audit_events (
    actor_user_id,
    actor_kind,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'director',
    'official_report_ingested',
    'report_import',
    v_report_id::text,
    jsonb_build_object(
      'report_date', v_report_date,
      'source_sha256', v_source_sha256,
      'daily_rows', v_daily_count,
      'rolling_rows', v_rolling_count,
      'non_transacting_rows', v_non_transacting_count,
      'rolling_target_met_count', v_rolling_target_met_count
    )
  );

  v_reconciliation := public.reconcile_ta_tasks_for_report(v_report_id);

  return jsonb_build_object(
    'duplicate', false,
    'reportId', v_report_id,
    'reportDate', v_report_date,
    'rowsImported', v_total_rows,
    'dailyRows', v_daily_count,
    'rollingRows', v_rolling_count,
    'nonTransactingRows', v_non_transacting_count,
    'dailyTargetMetCount', v_daily_target_met_count,
    'rollingTargetMetCount', v_rolling_target_met_count,
    'reconciliation', v_reconciliation
  );
end;
$$;

revoke all on function public.ingest_moniepoint_report(jsonb, jsonb) from public;
grant execute on function public.ingest_moniepoint_report(jsonb, jsonb) to authenticated;
