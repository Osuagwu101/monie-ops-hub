-- Monie Ops Hub — Phase 1 foundation
-- Safe to apply to a new Supabase project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('director', 'assistant');
create type public.task_type as enum ('TA', 'LOAN', 'FOLLOW_UP');
create type public.task_status as enum (
  'assigned',
  'in_progress',
  'postponed',
  'completed',
  'pending_verification',
  'verified',
  'discrepancy',
  'deferred',
  'unverifiable'
);
create type public.verification_state as enum ('verified', 'discrepancy', 'deferred', 'unverifiable');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.operating_config (
  id boolean primary key default true check (id),
  company_target_percent numeric(5,2) not null default 72,
  team_standard_percent numeric(5,2) not null default 77,
  rolling_weekly_ta_target_naira numeric(14,2) not null default 100000,
  daily_call_target integer not null default 7,
  ta_call_share_min numeric(5,4) not null default 0.60,
  ta_call_share_max numeric(5,4) not null default 0.80,
  assistant_shift_start time not null default '08:00',
  assistant_shift_end time not null default '18:00',
  next_day_verification_time time not null default '08:30',
  monthly_loan_target integer not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.operating_config (id) values (true)
on conflict (id) do nothing;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  phone_number text,
  external_business_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.terminals (
  id uuid primary key default gen_random_uuid(),
  terminal_id text not null unique,
  serial_number text,
  merchant_id uuid references public.merchants(id) on delete set null,
  assigned_at timestamptz,
  is_faulty boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_imports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete set null,
  source_filename text not null,
  source_sha256 text not null,
  source_kind text not null default 'moniepoint_pdf',
  row_count integer,
  processing_status text not null default 'received' check (processing_status in ('received','processing','processed','failed')),
  processing_error text,
  unique (report_date, source_sha256)
);

create table public.terminal_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  terminal_id uuid not null references public.terminals(id) on delete cascade,
  report_id uuid not null references public.report_imports(id) on delete cascade,
  report_date date not null,
  period_start date not null,
  period_end date not null,
  period_kind text not null check (period_kind in ('daily','rolling_7_day')),
  payment_value numeric(18,2) not null default 0,
  payment_volume integer not null default 0,
  transfer_value numeric(18,2) not null default 0,
  transfer_volume integer not null default 0,
  official_target_value numeric(18,2) not null default 0,
  official_target_met boolean not null default false,
  days_since_last_transaction integer not null default 0,
  created_at timestamptz not null default now(),
  unique (terminal_id, report_id, period_kind)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_date date not null,
  task_type public.task_type not null,
  status public.task_status not null default 'assigned',
  priority smallint not null default 3 check (priority between 1 and 5),
  merchant_id uuid references public.merchants(id) on delete set null,
  terminal_id uuid references public.terminals(id) on delete set null,
  assigned_to uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  recommended_talking_points text,
  due_at timestamptz,
  rolled_from_task_id uuid references public.tasks(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_assigned_to_date_idx on public.tasks (assigned_to, task_date);
create index tasks_terminal_status_idx on public.tasks (terminal_id, status);

create table public.task_outcomes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  assistant_id uuid not null references public.profiles(id) on delete restrict,
  reached_merchant boolean,
  commitment_received boolean,
  expected_amount numeric(18,2),
  expected_by timestamptz,
  postponement_reason text,
  notes text,
  submitted_at timestamptz not null default now()
);

create table public.task_verifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  state public.verification_state not null,
  verified_against_report_id uuid references public.report_imports(id) on delete set null,
  evidence_snapshot_id uuid references public.terminal_performance_snapshots(id) on delete set null,
  rationale text not null,
  verified_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_kind text not null check (actor_kind in ('director','assistant','system','amina','emeka','zainab','tunde')),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb
);

create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc);
create index performance_terminal_period_idx on public.terminal_performance_snapshots (terminal_id, period_end desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger merchants_set_updated_at before update on public.merchants
for each row execute function public.set_updated_at();
create trigger terminals_set_updated_at before update on public.terminals
for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();
create trigger operating_config_set_updated_at before update on public.operating_config
for each row execute function public.set_updated_at();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_director()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'director', false);
$$;

alter table public.profiles enable row level security;
alter table public.operating_config enable row level security;
alter table public.merchants enable row level security;
alter table public.terminals enable row level security;
alter table public.report_imports enable row level security;
alter table public.terminal_performance_snapshots enable row level security;
alter table public.tasks enable row level security;
alter table public.task_outcomes enable row level security;
alter table public.task_verifications enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_read_self_or_director on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_director());

create policy profiles_director_manage on public.profiles
for all to authenticated
using (public.is_director())
with check (public.is_director());

create policy config_authenticated_read on public.operating_config
for select to authenticated using (true);
create policy config_director_manage on public.operating_config
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy merchants_authenticated_read on public.merchants
for select to authenticated using (true);
create policy merchants_director_manage on public.merchants
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy terminals_authenticated_read on public.terminals
for select to authenticated using (true);
create policy terminals_director_manage on public.terminals
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy reports_director_only on public.report_imports
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy performance_authenticated_read on public.terminal_performance_snapshots
for select to authenticated using (true);
create policy performance_director_manage on public.terminal_performance_snapshots
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy tasks_read_own_or_director on public.tasks
for select to authenticated
using (assigned_to = auth.uid() or public.is_director());

create policy tasks_director_create on public.tasks
for insert to authenticated
with check (public.is_director());

create policy tasks_director_manage on public.tasks
for update to authenticated
using (public.is_director())
with check (public.is_director());

create policy outcomes_read_own_or_director on public.task_outcomes
for select to authenticated
using (assistant_id = auth.uid() or public.is_director());

create policy outcomes_assistant_insert on public.task_outcomes
for insert to authenticated
with check (
  assistant_id = auth.uid()
  and exists (
    select 1 from public.tasks t
    where t.id = task_id and t.assigned_to = auth.uid()
  )
);

create policy verifications_read_assigned_or_director on public.task_verifications
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1 from public.tasks t
    where t.id = task_id and t.assigned_to = auth.uid()
  )
);

create policy verifications_director_manage on public.task_verifications
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy audit_director_read on public.audit_events
for select to authenticated using (public.is_director());
create policy audit_director_insert on public.audit_events
for insert to authenticated with check (public.is_director());

-- Deliberately no assistant UPDATE policy that can set task status to verified.
-- Verification state is written only by trusted server-side logic or a director path.
