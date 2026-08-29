-- Bridge verified MonieCRM contacts into the merchant records used by Amina.
-- The RPC remains service-role only; contact values never become client-importable.

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
  terminal_record_id uuid;
  merchant_record_id uuid;
  source_report_id uuid;
  terminal_match_count integer;
  merchant_match_count integer;
  inserted_count integer := 0;
  merchant_update_count integer := 0;
  resolution_update_count integer := 0;
begin
  if jsonb_typeof(p_contacts) <> 'array' then
    raise exception 'p_contacts must be an array';
  end if;

  select id into source_report_id
  from public.report_imports
  where report_date = p_source_report_date
    and processing_status = 'processed'
  order by imported_at desc
  limit 1;

  if source_report_id is null then
    raise exception 'processed source report not found for %', p_source_report_date;
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

    select count(*)
      into terminal_match_count
    from public.terminals t
    where upper(btrim(t.terminal_id)) = upper(btrim(item->>'terminalId'))
      and upper(btrim(coalesce(t.serial_number, ''))) = upper(btrim(item->>'terminalSerial'));

    if terminal_match_count <> 1 then
      raise exception 'terminal identity did not resolve to exactly one merchant';
    end if;

    select t.id, t.merchant_id
      into terminal_record_id, merchant_record_id
    from public.terminals t
    where upper(btrim(t.terminal_id)) = upper(btrim(item->>'terminalId'))
      and upper(btrim(coalesce(t.serial_number, ''))) = upper(btrim(item->>'terminalSerial'));

    if merchant_record_id is null then
      raise exception 'terminal identity is not linked to a merchant';
    end if;

    select count(*) into merchant_match_count
    from public.merchants m
    where m.id = merchant_record_id
      and lower(btrim(m.business_name)) = lower(btrim(item->>'businessName'));

    if merchant_match_count <> 1 then
      raise exception 'business name does not match the terminal merchant';
    end if;

    insert into public.business_contacts (
      canonical_name, phone_number, verification_status, verified_at, last_seen_at
    ) values (
      btrim(item->>'businessName'), btrim(item->>'phoneNumber'), 'VERIFIED', now(), now()
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
      contact_id, btrim(item->>'terminalId'), btrim(item->>'terminalSerial'),
      btrim(item->>'posAccountNumber'), item->>'matchMethod',
      nullif(item->>'crmSourcePath', ''), p_source_report_date, now(), now()
    )
    on conflict (terminal_id, terminal_serial, pos_account_number) do update
      set business_contact_id = excluded.business_contact_id,
          match_method = excluded.match_method,
          crm_source_path = excluded.crm_source_path,
          source_report_date = excluded.source_report_date,
          verified_at = excluded.verified_at,
          last_seen_at = excluded.last_seen_at;

    update public.merchants
    set phone_number = btrim(item->>'phoneNumber'),
        account_number = btrim(item->>'posAccountNumber'),
        contact_source = 'moniepoint_team_management',
        contact_synced_at = now()
    where id = merchant_record_id;
    merchant_update_count := merchant_update_count + 1;

    insert into public.report_contact_resolutions (
      report_id, terminal_external_id, terminal_serial, terminal_id, merchant_id,
      business_name, resolution_status, resolution_reason, phone_number, account_number,
      task_created
    ) values (
      source_report_id, btrim(item->>'terminalId'), btrim(item->>'terminalSerial'),
      terminal_record_id, merchant_record_id, btrim(item->>'businessName'), 'verified',
      'Exact MonieCRM business and terminal match with confirmed contact data.',
      btrim(item->>'phoneNumber'), btrim(item->>'posAccountNumber'), false
    )
    on conflict (report_id, terminal_external_id) do update
      set terminal_serial = excluded.terminal_serial,
          terminal_id = excluded.terminal_id,
          merchant_id = excluded.merchant_id,
          business_name = excluded.business_name,
          resolution_status = 'verified',
          resolution_reason = excluded.resolution_reason,
          phone_number = excluded.phone_number,
          account_number = excluded.account_number,
          updated_at = now();
    resolution_update_count := resolution_update_count + 1;

    insert into public.business_contact_lookup_audit (
      terminal_id, terminal_serial, requested_business_name, outcome,
      business_contact_id, source_report_date, source_reference, details
    ) values (
      btrim(item->>'terminalId'), btrim(item->>'terminalSerial'),
      btrim(item->>'businessName'), 'VERIFIED', contact_id,
      p_source_report_date, p_source_reference,
      jsonb_build_object('matchMethod', item->>'matchMethod')
    );

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'verified', inserted_count,
    'merchantsUpdated', merchant_update_count,
    'resolutionsUpdated', resolution_update_count,
    'reportId', source_report_id
  );
end;
$$;

revoke all on function public.upsert_verified_business_contacts(jsonb, date, text)
  from public, anon, authenticated;
grant execute on function public.upsert_verified_business_contacts(jsonb, date, text)
  to service_role;
