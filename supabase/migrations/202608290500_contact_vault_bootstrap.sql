-- One-time/resumable MonieCRM contact-vault bootstrap.
-- Raw phone/POS-account values remain server-side and are persisted only after
-- exact business + terminal ID + terminal serial verification.

create table if not exists public.contact_bootstrap_runs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.report_imports(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','browser_running','polling','completed','failed')),
  batch_size integer not null default 20 check (batch_size between 5 and 30),
  next_offset integer not null default 0 check (next_offset >= 0),
  total_items integer not null default 0 check (total_items >= 0),
  verified_count integer not null default 0 check (verified_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  not_found_count integer not null default 0 check (not_found_count >= 0),
  browser_session_id uuid,
  browser_task_id uuid,
  last_error_code text,
  last_error_message text,
  diagnostics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contact_bootstrap_runs_status_idx
  on public.contact_bootstrap_runs(status, updated_at desc);

alter table public.contact_bootstrap_runs enable row level security;
drop policy if exists contact_bootstrap_director_read on public.contact_bootstrap_runs;
create policy contact_bootstrap_director_read on public.contact_bootstrap_runs
  for select to authenticated using (public.is_director());
revoke all on public.contact_bootstrap_runs from anon;
grant select on public.contact_bootstrap_runs to authenticated;
grant all on public.contact_bootstrap_runs to service_role;

create or replace function public.contact_bootstrap_batch(p_report_id uuid, p_offset integer, p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with report_terminals as (
    select
      r.terminal_external_id,
      max(r.terminal_serial) as terminal_serial
    from public.report_terminal_rows r
    where r.report_id = p_report_id
    group by r.terminal_external_id
  ), canonical as (
    select
      rt.terminal_external_id,
      rt.terminal_serial,
      m.business_name,
      row_number() over(order by rt.terminal_external_id) - 1 as zero_index
    from report_terminals rt
    join public.terminals t
      on upper(btrim(t.terminal_id)) = upper(btrim(rt.terminal_external_id))
    join public.merchants m on m.id = t.merchant_id
    where rt.terminal_serial is not null
      and t.serial_number is not null
      and upper(btrim(t.serial_number)) = upper(btrim(rt.terminal_serial))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'businessName', business_name,
    'terminalId', terminal_external_id,
    'terminalSerial', terminal_serial
  ) order by zero_index), '[]'::jsonb)
  from canonical
  where zero_index >= greatest(coalesce(p_offset,0),0)
    and zero_index < greatest(coalesce(p_offset,0),0) + greatest(1,least(coalesce(p_limit,20),30));
$$;
revoke all on function public.contact_bootstrap_batch(uuid,integer,integer) from public, anon;

create or replace function public.contact_bootstrap_claim(
  p_token text,
  p_run_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_run public.contact_bootstrap_runs;
  v_config public.automation_config;
  v_api_key text;
  v_username text;
  v_password text;
  v_batch jsonb;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.contact_bootstrap_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Contact bootstrap run not found'; end if;
  select * into v_config from public.automation_config where id=true;
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name='monie_ops_browser_use_api_key' limit 1;
  if v_api_key is null then raise exception 'Browser Use API key is not configured'; end if;

  if p_action='start' then
    if v_run.status <> 'queued' then raise exception 'Contact bootstrap run is not startable'; end if;
    select decrypted_secret into v_username from vault.decrypted_secrets where name='monie_ops_moniepoint_username' limit 1;
    select decrypted_secret into v_password from vault.decrypted_secrets where name='monie_ops_moniepoint_password' limit 1;
    if v_username is null or v_password is null then raise exception 'Moniepoint credentials are not configured'; end if;
    v_batch := public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size);
    update public.contact_bootstrap_runs
      set status='polling', started_at=coalesce(started_at,now()), updated_at=now()
      where id=v_run.id;
    return jsonb_build_object(
      'runId',v_run.id,'action','start','reportId',v_run.report_id,
      'reportDate',(select report_date from public.report_imports where id=v_run.report_id),
      'browserUseApiKey',v_api_key,'moniepointUsername',v_username,'moniepointPassword',v_password,
      'loginUrl',v_config.moniepoint_login_url,'allowedDomains',v_config.allowed_domains,
      'proxyCountryCode',v_config.proxy_country_code,'browserProfileId',v_config.browser_profile_id,
      'batch',v_batch,'batchSize',v_run.batch_size,'offset',v_run.next_offset,'totalItems',v_run.total_items
    );
  elsif p_action='poll' then
    if v_run.status not in ('browser_running','polling') or v_run.browser_task_id is null then
      raise exception 'Contact bootstrap run is not pollable';
    end if;
    v_batch := public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size);
    update public.contact_bootstrap_runs set status='polling',updated_at=now() where id=v_run.id;
    return jsonb_build_object(
      'runId',v_run.id,'action','poll','reportId',v_run.report_id,
      'reportDate',(select report_date from public.report_imports where id=v_run.report_id),
      'browserUseApiKey',v_api_key,'allowedDomains',v_config.allowed_domains,
      'browserSessionId',v_run.browser_session_id,'browserTaskId',v_run.browser_task_id,
      'batch',v_batch,'batchSize',v_run.batch_size,'offset',v_run.next_offset,'totalItems',v_run.total_items
    );
  else
    raise exception 'Unsupported contact bootstrap action';
  end if;
end;
$$;
revoke all on function public.contact_bootstrap_claim(text,uuid,text) from public;
grant execute on function public.contact_bootstrap_claim(text,uuid,text) to anon, authenticated;

create or replace function public.contact_bootstrap_mark_dispatched(
  p_token text,
  p_run_id uuid,
  p_browser_session_id uuid,
  p_browser_task_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  update public.contact_bootstrap_runs
    set status='browser_running',browser_session_id=p_browser_session_id,browser_task_id=p_browser_task_id,updated_at=now()
    where id=p_run_id;
  if not found then raise exception 'Contact bootstrap run not found'; end if;
end;
$$;
revoke all on function public.contact_bootstrap_mark_dispatched(text,uuid,uuid,uuid) from public;
grant execute on function public.contact_bootstrap_mark_dispatched(text,uuid,uuid,uuid) to anon,authenticated;

create or replace function public.contact_bootstrap_mark_pending(
  p_token text,
  p_run_id uuid,
  p_diagnostics jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  update public.contact_bootstrap_runs
    set status='browser_running',diagnostics=coalesce(p_diagnostics,'{}'::jsonb),updated_at=now()
    where id=p_run_id;
end;
$$;
revoke all on function public.contact_bootstrap_mark_pending(text,uuid,jsonb) from public;
grant execute on function public.contact_bootstrap_mark_pending(text,uuid,jsonb) to anon,authenticated;

create or replace function public.contact_bootstrap_apply_batch(
  p_token text,
  p_run_id uuid,
  p_results jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.contact_bootstrap_runs;
  v_report_date date;
  v_expected jsonb;
  v_item jsonb;
  v_verified_payload jsonb := '[]'::jsonb;
  v_verified integer := 0;
  v_review integer := 0;
  v_not_found integer := 0;
  v_processed integer := 0;
  v_expected_match boolean;
  v_outcome text;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  if jsonb_typeof(p_results) <> 'array' then raise exception 'p_results must be an array'; end if;
  select * into v_run from public.contact_bootstrap_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Contact bootstrap run not found'; end if;
  select report_date into v_report_date from public.report_imports where id=v_run.report_id;
  v_expected := public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size);

  for v_item in select value from jsonb_array_elements(p_results) loop
    select exists(
      select 1 from jsonb_array_elements(v_expected) e
      where upper(btrim(e->>'terminalId'))=upper(btrim(v_item->>'terminalId'))
        and upper(btrim(e->>'terminalSerial'))=upper(btrim(v_item->>'terminalSerial'))
        and lower(btrim(e->>'businessName'))=lower(btrim(v_item->>'businessName'))
    ) into v_expected_match;
    if not v_expected_match then
      continue;
    end if;

    v_processed := v_processed + 1;
    v_outcome := lower(coalesce(v_item->>'status','review'));
    if v_outcome='verified'
       and nullif(btrim(coalesce(v_item->>'phoneNumber','')),'') is not null
       and nullif(btrim(coalesce(v_item->>'posAccountNumber','')),'') is not null then
      v_verified_payload := v_verified_payload || jsonb_build_array(jsonb_build_object(
        'businessName',btrim(v_item->>'businessName'),
        'phoneNumber',btrim(v_item->>'phoneNumber'),
        'posAccountNumber',btrim(v_item->>'posAccountNumber'),
        'terminalId',btrim(v_item->>'terminalId'),
        'terminalSerial',btrim(v_item->>'terminalSerial'),
        'matchMethod','EXACT_NAME_AND_TERMINAL',
        'crmSourcePath',nullif(v_item->>'sourcePath','')
      ));
      v_verified := v_verified + 1;
    else
      if v_outcome='not_found' then v_not_found:=v_not_found+1; else v_review:=v_review+1; end if;
      insert into public.business_contact_lookup_audit(
        terminal_id,terminal_serial,requested_business_name,outcome,source_report_date,source_reference,details
      ) values(
        btrim(v_item->>'terminalId'),btrim(v_item->>'terminalSerial'),btrim(v_item->>'businessName'),
        case when v_outcome='not_found' then 'NOT_FOUND' else 'REVIEW' end,
        v_report_date,'contact_vault_bootstrap',jsonb_build_object('status',v_outcome)
      );
    end if;
  end loop;

  if jsonb_array_length(v_verified_payload)>0 then
    perform public.upsert_verified_business_contacts(v_verified_payload,v_report_date,'contact_vault_bootstrap');
  end if;

  -- Advance by the expected batch size rather than model-return count, preventing one bad item from stalling forever.
  update public.contact_bootstrap_runs
  set next_offset = least(total_items,next_offset+jsonb_array_length(v_expected)),
      verified_count=verified_count+v_verified,
      review_count=review_count+v_review,
      not_found_count=not_found_count+v_not_found,
      browser_task_id=null,
      status=case when next_offset+jsonb_array_length(v_expected) >= total_items then 'completed' else 'polling' end,
      completed_at=case when next_offset+jsonb_array_length(v_expected) >= total_items then now() else null end,
      diagnostics=jsonb_build_object('lastBatchExpected',jsonb_array_length(v_expected),'lastBatchReturned',v_processed),
      updated_at=now()
  where id=v_run.id
  returning * into v_run;

  return jsonb_build_object(
    'done',v_run.status='completed','nextOffset',v_run.next_offset,'totalItems',v_run.total_items,
    'verifiedTotal',v_run.verified_count,'reviewTotal',v_run.review_count,'notFoundTotal',v_run.not_found_count,
    'nextBatch',case when v_run.status='completed' then '[]'::jsonb else public.contact_bootstrap_batch(v_run.report_id,v_run.next_offset,v_run.batch_size) end
  );
end;
$$;
revoke all on function public.contact_bootstrap_apply_batch(text,uuid,jsonb) from public;
grant execute on function public.contact_bootstrap_apply_batch(text,uuid,jsonb) to anon,authenticated;

create or replace function public.contact_bootstrap_fail_run(
  p_token text,
  p_run_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  update public.contact_bootstrap_runs
    set status='failed',last_error_code=left(coalesce(p_error_code,'bootstrap_failed'),100),
        last_error_message=left(coalesce(p_error_message,'Contact bootstrap failed.'),800),
        completed_at=now(),updated_at=now()
    where id=p_run_id;
end;
$$;
revoke all on function public.contact_bootstrap_fail_run(text,uuid,text,text) from public;
grant execute on function public.contact_bootstrap_fail_run(text,uuid,text,text) to anon,authenticated;

create or replace function public.queue_contact_bootstrap_internal(
  p_report_id uuid,
  p_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=public,vault,net
as $$
declare
  v_run_id uuid;
  v_total integer;
  v_worker text;
  v_token text;
  v_request_id bigint;
begin
  if not exists(select 1 from public.report_imports where id=p_report_id and processing_status='processed') then
    raise exception 'Processed report not found';
  end if;
  if exists(select 1 from public.contact_bootstrap_runs where status in ('queued','browser_running','polling')) then
    raise exception 'A contact bootstrap run is already active';
  end if;
  select count(distinct r.terminal_external_id) into v_total
  from public.report_terminal_rows r where r.report_id=p_report_id;
  insert into public.contact_bootstrap_runs(report_id,batch_size,total_items)
    values(p_report_id,greatest(5,least(coalesce(p_batch_size,20),30)),v_total)
    returning id into v_run_id;

  select replace(worker_url,'/api/moniecrm-worker','/api/contact-bootstrap-worker') into v_worker
  from public.automation_config where id=true;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='monie_ops_automation_bridge_token' limit 1;
  if v_worker is null or v_token is null then raise exception 'Contact bootstrap worker is not configured'; end if;
  select net.http_post(
    url:=v_worker,
    headers:=jsonb_build_object('Content-Type','application/json','x-monie-automation-token',v_token),
    body:=jsonb_build_object('runId',v_run_id,'action','start'),
    timeout_milliseconds:=5000
  ) into v_request_id;
  update public.contact_bootstrap_runs
    set diagnostics=jsonb_build_object('startRequestId',v_request_id),updated_at=now()
    where id=v_run_id;
  return jsonb_build_object('queued',true,'runId',v_run_id,'totalItems',v_total,'batchSize',greatest(5,least(coalesce(p_batch_size,20),30)));
end;
$$;
revoke all on function public.queue_contact_bootstrap_internal(uuid,integer) from public,anon,authenticated;

create or replace function public.queue_contact_bootstrap(
  p_report_id uuid default null,
  p_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_report_id uuid;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  v_report_id:=p_report_id;
  if v_report_id is null then
    select id into v_report_id from public.report_imports
      where processing_status='processed' order by report_date desc, imported_at desc limit 1;
  end if;
  return public.queue_contact_bootstrap_internal(v_report_id,p_batch_size);
end;
$$;
revoke all on function public.queue_contact_bootstrap(uuid,integer) from public,anon;
grant execute on function public.queue_contact_bootstrap(uuid,integer) to authenticated;

create or replace function public.send_contact_bootstrap_poll(p_run_id uuid)
returns bigint
language plpgsql
security definer
set search_path=public,vault,net
as $$
declare v_worker text; v_token text; v_request_id bigint;
begin
  if not exists(select 1 from public.contact_bootstrap_runs where id=p_run_id and status in ('browser_running','polling')) then
    raise exception 'Contact bootstrap run is not active';
  end if;
  select replace(worker_url,'/api/moniecrm-worker','/api/contact-bootstrap-worker') into v_worker
  from public.automation_config where id=true;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='monie_ops_automation_bridge_token' limit 1;
  select net.http_post(
    url:=v_worker,
    headers:=jsonb_build_object('Content-Type','application/json','x-monie-automation-token',v_token),
    body:=jsonb_build_object('runId',p_run_id,'action','poll'),
    timeout_milliseconds:=5000
  ) into v_request_id;
  update public.contact_bootstrap_runs
    set diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('pollRequestId',v_request_id),updated_at=now()
    where id=p_run_id;
  return v_request_id;
end;
$$;
revoke all on function public.send_contact_bootstrap_poll(uuid) from public,anon,authenticated;
