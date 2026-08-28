-- Verified business-contact cache for the manual BRM report bootstrap flow.
-- Only a server process using the Supabase service role may read or write these tables.

create extension if not exists pgcrypto;

create table if not exists public.business_contacts (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  phone_number text not null,
  verification_status text not null default 'VERIFIED'
    check (verification_status in ('VERIFIED', 'REVIEW', 'NOT_FOUND', 'STALE')),
  verified_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_name, phone_number)
);

create table if not exists public.business_contact_terminal_links (
  id uuid primary key default gen_random_uuid(),
  business_contact_id uuid not null references public.business_contacts(id) on delete cascade,
  terminal_id text not null,
  terminal_serial text not null,
  pos_account_number text not null,
  match_method text not null
    check (match_method in ('EXACT_NAME_AND_TERMINAL', 'EXACT_NAME_SINGLE_POS', 'MANUAL_VERIFIED')),
  crm_source_path text,
  source_report_date date not null,
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (terminal_id, terminal_serial, pos_account_number)
);

create table if not exists public.business_contact_lookup_audit (
  id uuid primary key default gen_random_uuid(),
  terminal_id text not null,
  terminal_serial text not null,
  requested_business_name text not null,
  outcome text not null check (outcome in ('VERIFIED', 'REVIEW', 'NOT_FOUND', 'STALE')),
  business_contact_id uuid references public.business_contacts(id) on delete set null,
  source_report_date date,
  source_reference text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.business_contacts enable row level security;
alter table public.business_contact_terminal_links enable row level security;
alter table public.business_contact_lookup_audit enable row level security;

revoke all on public.business_contacts, public.business_contact_terminal_links,
  public.business_contact_lookup_audit from anon, authenticated;
create or replace function public.business_contacts_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists business_contacts_updated_at on public.business_contacts;
create trigger business_contacts_updated_at
before update on public.business_contacts
for each row execute function public.business_contacts_set_updated_at();

create or replace function public.upsert_verified_business_contacts(
  p_contacts jsonb,
  p_source_report_date date,
  p_source_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  contact_id uuid;
  inserted_count integer := 0;
begin
  if jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'p_contacts must be an array';
  end if;

  for item in select value from jsonb_array_elements(p_contacts)
  loop
    if coalesce(item->>'businessName', '') = ''
      or coalesce(item->>'phoneNumber', '') = ''
      or coalesce(item->>'posAccountNumber', '') = ''
      or coalesce(item->>'terminalId', '') = ''
      or coalesce(item->>'terminalSerial', '') = '' then
      raise exception 'verified contact is missing identity, phone, POS account, or terminal evidence';
    end if;

    if coalesce(item->>'matchMethod', '') not in
      ('EXACT_NAME_AND_TERMINAL', 'EXACT_NAME_SINGLE_POS', 'MANUAL_VERIFIED') then
      raise exception 'invalid match method';
    end if;

    insert into public.business_contacts (
      canonical_name, phone_number, verification_status, verified_at, last_seen_at
    ) values (
      item->>'businessName', item->>'phoneNumber', 'VERIFIED', now(), now()
    )
    on conflict (canonical_name, phone_number) do update
      set verification_status = 'VERIFIED',
          verified_at = excluded.verified_at,
          last_seen_at = excluded.last_seen_at
    returning id into contact_id;

    insert into public.business_contact_terminal_links (
      business_contact_id, terminal_id, terminal_serial, pos_account_number,
      match_method, crm_source_path, source_report_date, verified_at, last_seen_at
    ) values (
      contact_id, item->>'terminalId', item->>'terminalSerial', item->>'posAccountNumber',
      item->>'matchMethod', nullif(item->>'crmSourcePath', ''), p_source_report_date, now(), now()
    )
    on conflict (terminal_id, terminal_serial, pos_account_number) do update
      set business_contact_id = excluded.business_contact_id,
          match_method = excluded.match_method,
          crm_source_path = excluded.crm_source_path,
          source_report_date = excluded.source_report_date,
          verified_at = excluded.verified_at,
          last_seen_at = excluded.last_seen_at;

    insert into public.business_contact_lookup_audit (
      terminal_id, terminal_serial, requested_business_name, outcome,
      business_contact_id, source_report_date, source_reference, details
    ) values (
      item->>'terminalId', item->>'terminalSerial', item->>'businessName', 'VERIFIED',
      contact_id, p_source_report_date, p_source_reference,
      jsonb_build_object('matchMethod', item->>'matchMethod')
    );

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('verified', inserted_count);
end;
$$;

grant execute on function public.upsert_verified_business_contacts(jsonb, date, text) to service_role;
