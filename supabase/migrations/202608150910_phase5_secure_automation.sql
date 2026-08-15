-- Phase 5: Secure automation, retry/recovery and production hardening.
-- Automation is installed disabled. Secrets live only in Supabase Vault.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.automation_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  worker_url text not null default 'https://monie-ops-hub.lovable.app/api/automation-worker',
  moniepoint_login_url text,
  allowed_domains text[] not null default '{}'::text[],
  proxy_country_code text default 'ng',
  max_steps integer not null default 100 check (max_steps between 10 and 250),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  retry_backoff_minutes integer not null default 10 check (retry_backoff_minutes between 2 and 60),
  poll_interval_minutes integer not null default 2 check (poll_interval_minutes between 1 and 10),
  morning_audit_time time not null default '08:30',
  morning_refresh_time time not null default '09:00',
  evening_refresh_time time not null default '18:00',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_config_https_worker check (worker_url ~ '^https://'),
  constraint automation_config_https_login check (moniepoint_login_url is null or moniepoint_login_url ~ '^https://')
);

insert into public.automation_config(id) values(true) on conflict(id) do nothing;

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_kind text not null check (trigger_kind in ('morning_audit','morning_refresh','evening_refresh','manual')),
  status text not null default 'queued' check (status in ('queued','dispatching','browser_running','polling','retry_wait','succeeded','failed','cancelled','skipped')),
  scheduled_for timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  browser_task_id text,
  browser_session_id text,
  last_http_request_id bigint,
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  upload_nonce_hash text,
  report_id uuid references public.report_imports(id) on delete set null,
  source_storage_path text,
  source_sha256 text,
  last_error_code text,
  last_error_message text,
  diagnostics jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automation_runs_due_idx
  on public.automation_runs(status,next_attempt_at)
  where status in ('queued','dispatching','browser_running','polling','retry_wait');
create index if not exists automation_runs_created_idx on public.automation_runs(created_at desc);
create index if not exists automation_runs_report_idx on public.automation_runs(report_id) where report_id is not null;

alter table public.automation_config enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists automation_config_director_read on public.automation_config;
create policy automation_config_director_read on public.automation_config for select to authenticated using (public.is_director());
drop policy if exists automation_runs_director_read on public.automation_runs;
create policy automation_runs_director_read on public.automation_runs for select to authenticated using (public.is_director());

revoke all on public.automation_config from anon;
revoke all on public.automation_runs from anon;
grant select on public.automation_config to authenticated;
grant select on public.automation_runs to authenticated;

-- One private bridge token authenticates database cron -> server worker -> database RPC.
do $$
begin
  if not exists(select 1 from vault.secrets where name='monie_ops_automation_bridge_token') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),'monie_ops_automation_bridge_token','Monie Ops internal automation bridge token');
  end if;
end $$;

create or replace function public.automation_bridge_valid(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare v_expected text;
begin
  if nullif(p_token,'') is null then return false; end if;
  select decrypted_secret into v_expected from vault.decrypted_secrets where name='monie_ops_automation_bridge_token' limit 1;
  if v_expected is null then return false; end if;
  return encode(digest(p_token,'sha256'),'hex') = encode(digest(v_expected,'sha256'),'hex');
end;
$$;
revoke all on function public.automation_bridge_valid(text) from public, anon, authenticated;

create or replace function public.automation_secret_name(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'browser_use_api_key' then 'monie_ops_browser_use_api_key'
    when 'moniepoint_username' then 'monie_ops_moniepoint_username'
    when 'moniepoint_password' then 'monie_ops_moniepoint_password'
    else null end
$$;
revoke all on function public.automation_secret_name(text) from public, anon, authenticated;

create or replace function public.automation_secret_status()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  return jsonb_build_object(
    'browserUseApiKeyConfigured', exists(select 1 from vault.secrets where name='monie_ops_browser_use_api_key'),
    'moniepointUsernameConfigured', exists(select 1 from vault.secrets where name='monie_ops_moniepoint_username'),
    'moniepointPasswordConfigured', exists(select 1 from vault.secrets where name='monie_ops_moniepoint_password'),
    'bridgeConfigured', exists(select 1 from vault.secrets where name='monie_ops_automation_bridge_token')
  );
end;
$$;
revoke all on function public.automation_secret_status() from public, anon;
grant execute on function public.automation_secret_status() to authenticated;

create or replace function public.set_automation_secret(p_kind text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_name text; v_id uuid;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  if length(coalesce(p_value,'')) < 3 then raise exception 'Secret value is too short'; end if;
  v_name := public.automation_secret_name(p_kind);
  if v_name is null then raise exception 'Unsupported automation secret kind'; end if;
  select id into v_id from vault.secrets where name=v_name limit 1;
  if v_id is null then
    perform vault.create_secret(p_value,v_name,'Monie Ops Phase 5 secure automation secret');
  else
    perform vault.update_secret(v_id,p_value,v_name,'Monie Ops Phase 5 secure automation secret');
  end if;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(auth.uid(),'director','automation_secret_updated','automation_config',p_kind,jsonb_build_object('secretKind',p_kind,'valueStored',true));
  return public.automation_secret_status();
end;
$$;
revoke all on function public.set_automation_secret(text,text) from public, anon;
grant execute on function public.set_automation_secret(text,text) to authenticated;

create or replace function public.rotate_automation_bridge_token()
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare v_id uuid; v_token text;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  v_token := encode(gen_random_bytes(32),'hex');
  select id into v_id from vault.secrets where name='monie_ops_automation_bridge_token' limit 1;
  if v_id is null then
    perform vault.create_secret(v_token,'monie_ops_automation_bridge_token','Monie Ops internal automation bridge token');
  else
    perform vault.update_secret(v_id,v_token,'monie_ops_automation_bridge_token','Monie Ops internal automation bridge token');
  end if;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(auth.uid(),'director','automation_bridge_rotated','automation_config','bridge',jsonb_build_object('rotated',true));
  return jsonb_build_object('rotated',true);
end;
$$;
revoke all on function public.rotate_automation_bridge_token() from public, anon;
grant execute on function public.rotate_automation_bridge_token() to authenticated;

create or replace function public.lagos_time_to_cron(p_time time)
returns text
language plpgsql
immutable
as $$
declare v_minutes integer; v_hour integer; v_minute integer;
begin
  v_minutes := extract(hour from p_time)::integer * 60 + extract(minute from p_time)::integer - 60;
  if v_minutes < 0 then v_minutes := v_minutes + 1440; end if;
  v_hour := v_minutes / 60;
  v_minute := v_minutes % 60;
  return format('%s %s * * *',v_minute,v_hour);
end;
$$;

create or replace function public.apply_automation_schedule()
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare v_config public.automation_config;
begin
  select * into v_config from public.automation_config where id=true;
  perform cron.unschedule(jobname) from cron.job where jobname in ('monie-ops-morning-audit','monie-ops-morning-refresh','monie-ops-evening-refresh','monie-ops-automation-poller');
  perform cron.schedule('monie-ops-morning-audit',public.lagos_time_to_cron(v_config.morning_audit_time),$$select public.run_scheduled_automation('morning_audit')$$);
  perform cron.schedule('monie-ops-morning-refresh',public.lagos_time_to_cron(v_config.morning_refresh_time),$$select public.run_scheduled_automation('morning_refresh')$$);
  perform cron.schedule('monie-ops-evening-refresh',public.lagos_time_to_cron(v_config.evening_refresh_time),$$select public.run_scheduled_automation('evening_refresh')$$);
  perform cron.schedule('monie-ops-automation-poller',format('*/%s * * * *',v_config.poll_interval_minutes),$$select public.poll_automation_queue()$$);
end;
$$;
revoke all on function public.apply_automation_schedule() from public, anon, authenticated;

create or replace function public.update_automation_config(
  p_enabled boolean,
  p_moniepoint_login_url text,
  p_allowed_domains text[],
  p_proxy_country_code text,
  p_max_steps integer,
  p_max_attempts integer,
  p_retry_backoff_minutes integer,
  p_morning_audit_time time,
  p_morning_refresh_time time,
  p_evening_refresh_time time
)
returns public.automation_config
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_row public.automation_config; v_host text;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  if p_moniepoint_login_url is not null and p_moniepoint_login_url !~ '^https://' then raise exception 'Moniepoint login URL must use HTTPS'; end if;
  if p_allowed_domains is null or array_length(p_allowed_domains,1) is null then
    if p_enabled then raise exception 'At least one allowed domain is required before enabling automation'; end if;
    p_allowed_domains := '{}'::text[];
  end if;
  if p_enabled then
    if p_moniepoint_login_url is null then raise exception 'Moniepoint login URL is required before enabling automation'; end if;
    if not exists(select 1 from vault.secrets where name='monie_ops_browser_use_api_key') then raise exception 'Browser Use API key is not configured'; end if;
    if not exists(select 1 from vault.secrets where name='monie_ops_moniepoint_username') then raise exception 'Moniepoint username is not configured'; end if;
    if not exists(select 1 from vault.secrets where name='monie_ops_moniepoint_password') then raise exception 'Moniepoint password is not configured'; end if;
  end if;
  update public.automation_config set
    enabled=coalesce(p_enabled,false),
    moniepoint_login_url=nullif(btrim(p_moniepoint_login_url),''),
    allowed_domains=(select coalesce(array_agg(lower(btrim(x)) order by lower(btrim(x))),'{}'::text[]) from unnest(coalesce(p_allowed_domains,'{}'::text[])) x where nullif(btrim(x),'') is not null),
    proxy_country_code=nullif(lower(btrim(p_proxy_country_code)),''),
    max_steps=greatest(10,least(250,coalesce(p_max_steps,100))),
    max_attempts=greatest(1,least(5,coalesce(p_max_attempts,3))),
    retry_backoff_minutes=greatest(2,least(60,coalesce(p_retry_backoff_minutes,10))),
    morning_audit_time=coalesce(p_morning_audit_time,'08:30'::time),
    morning_refresh_time=coalesce(p_morning_refresh_time,'09:00'::time),
    evening_refresh_time=coalesce(p_evening_refresh_time,'18:00'::time),
    updated_by=auth.uid(),updated_at=now()
  where id=true returning * into v_row;
  perform public.apply_automation_schedule();
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(auth.uid(),'director','automation_config_updated','automation_config','primary',jsonb_build_object('enabled',v_row.enabled,'allowedDomains',v_row.allowed_domains,'proxyCountryCode',v_row.proxy_country_code,'maxAttempts',v_row.max_attempts));
  return v_row;
end;
$$;
revoke all on function public.update_automation_config(boolean,text,text[],text,integer,integer,integer,time,time,time) from public, anon;
grant execute on function public.update_automation_config(boolean,text,text[],text,integer,integer,integer,time,time,time) to authenticated;

create or replace function public.send_automation_worker(p_run_id uuid, p_action text)
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare v_url text; v_token text; v_request_id bigint;
begin
  select worker_url into v_url from public.automation_config where id=true;
  select decrypted_secret into v_token from vault.decrypted_secrets where name='monie_ops_automation_bridge_token' limit 1;
  if v_url is null or v_token is null then raise exception 'Automation worker is not configured'; end if;
  select net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-monie-automation-token',v_token),
    body:=jsonb_build_object('runId',p_run_id,'action',p_action),
    timeout_milliseconds:=5000
  ) into v_request_id;
  update public.automation_runs set last_http_request_id=v_request_id,updated_at=now() where id=p_run_id;
  return v_request_id;
end;
$$;
revoke all on function public.send_automation_worker(uuid,text) from public, anon, authenticated;

create or replace function public.queue_automation_run_internal(p_trigger_kind text, p_scheduled_for timestamptz default now(), p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_config public.automation_config; v_run_id uuid;
begin
  if p_trigger_kind not in ('morning_audit','morning_refresh','evening_refresh','manual') then raise exception 'Invalid automation trigger'; end if;
  select * into v_config from public.automation_config where id=true;
  if not p_force and not v_config.enabled then return jsonb_build_object('queued',false,'reason','automation_disabled'); end if;
  if v_config.moniepoint_login_url is null or array_length(v_config.allowed_domains,1) is null then
    return jsonb_build_object('queued',false,'reason','configuration_required');
  end if;
  if exists(select 1 from public.automation_runs where status in ('queued','dispatching','browser_running','polling','retry_wait')) then
    insert into public.automation_runs(trigger_kind,status,scheduled_for,last_error_code,last_error_message,completed_at)
      values(p_trigger_kind,'skipped',p_scheduled_for,'concurrency_guard','Another report retrieval is already active.',now()) returning id into v_run_id;
    return jsonb_build_object('queued',false,'reason','active_run_exists','runId',v_run_id);
  end if;
  insert into public.automation_runs(trigger_kind,status,scheduled_for,next_attempt_at)
    values(p_trigger_kind,'queued',p_scheduled_for,now()) returning id into v_run_id;
  perform public.send_automation_worker(v_run_id,'execute');
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(null,'automation','automation_run_queued','automation_run',v_run_id::text,jsonb_build_object('triggerKind',p_trigger_kind,'scheduledFor',p_scheduled_for));
  return jsonb_build_object('queued',true,'runId',v_run_id,'triggerKind',p_trigger_kind);
end;
$$;
revoke all on function public.queue_automation_run_internal(text,timestamptz,boolean) from public, anon, authenticated;

create or replace function public.queue_automation_run(p_trigger_kind text default 'manual')
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  if not exists(select 1 from vault.secrets where name='monie_ops_browser_use_api_key')
     or not exists(select 1 from vault.secrets where name='monie_ops_moniepoint_username')
     or not exists(select 1 from vault.secrets where name='monie_ops_moniepoint_password') then
    raise exception 'Secure automation credentials are incomplete';
  end if;
  return public.queue_automation_run_internal(coalesce(nullif(p_trigger_kind,''),'manual'),now(),true);
end;
$$;
revoke all on function public.queue_automation_run(text) from public, anon;
grant execute on function public.queue_automation_run(text) to authenticated;

create or replace function public.run_scheduled_automation(p_trigger_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.queue_automation_run_internal(p_trigger_kind,now(),false);
end;
$$;
revoke all on function public.run_scheduled_automation(text) from public, anon, authenticated;

create or replace function public.poll_automation_queue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_run record; v_count integer:=0; v_action text;
begin
  for v_run in
    select id,status from public.automation_runs
    where status in ('queued','dispatching','browser_running','polling','retry_wait')
      and next_attempt_at <= now()
      and (lease_expires_at is null or lease_expires_at <= now())
    order by created_at
    limit 4
  loop
    v_action := case when v_run.status in ('browser_running','polling') then 'poll' else 'execute' end;
    perform public.send_automation_worker(v_run.id,v_action);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.poll_automation_queue() from public, anon, authenticated;

create or replace function public.automation_claim_run(p_token text, p_run_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_run public.automation_runs; v_config public.automation_config;
  v_api_key text; v_username text; v_password text; v_nonce text;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.automation_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Automation run not found'; end if;
  select * into v_config from public.automation_config where id=true;
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name='monie_ops_browser_use_api_key' limit 1;
  if v_api_key is null then raise exception 'Browser Use API key is not configured'; end if;

  if p_action='execute' then
    if v_run.status not in ('queued','dispatching','retry_wait') then raise exception 'Run is not dispatchable'; end if;
    if v_run.lease_expires_at is not null and v_run.lease_expires_at>now() then raise exception 'Run is already leased'; end if;
    if v_run.attempt_count>=v_config.max_attempts then raise exception 'Maximum attempts reached'; end if;
    select decrypted_secret into v_username from vault.decrypted_secrets where name='monie_ops_moniepoint_username' limit 1;
    select decrypted_secret into v_password from vault.decrypted_secrets where name='monie_ops_moniepoint_password' limit 1;
    if v_username is null or v_password is null then raise exception 'Moniepoint credentials are not configured'; end if;
    update public.automation_runs set status='dispatching',attempt_count=attempt_count+1,lease_expires_at=now()+interval '2 minutes',started_at=coalesce(started_at,now()),last_error_code=null,last_error_message=null,updated_at=now() where id=p_run_id returning * into v_run;
    return jsonb_build_object(
      'runId',v_run.id,'action','execute','triggerKind',v_run.trigger_kind,
      'browserUseApiKey',v_api_key,'moniepointUsername',v_username,'moniepointPassword',v_password,
      'loginUrl',v_config.moniepoint_login_url,'allowedDomains',v_config.allowed_domains,
      'proxyCountryCode',v_config.proxy_country_code,'maxSteps',v_config.max_steps,
      'pollIntervalMinutes',v_config.poll_interval_minutes
    );
  elsif p_action='poll' then
    if v_run.status not in ('browser_running','polling') or v_run.browser_task_id is null then raise exception 'Run is not pollable'; end if;
    if v_run.lease_expires_at is not null and v_run.lease_expires_at>now() then raise exception 'Run is already leased'; end if;
    v_nonce:=encode(gen_random_bytes(24),'hex');
    update public.automation_runs set status='polling',lease_expires_at=now()+interval '2 minutes',upload_nonce_hash=encode(digest(v_nonce,'sha256'),'hex'),updated_at=now() where id=p_run_id returning * into v_run;
    return jsonb_build_object(
      'runId',v_run.id,'action','poll','triggerKind',v_run.trigger_kind,
      'browserUseApiKey',v_api_key,'browserTaskId',v_run.browser_task_id,
      'uploadNonce',v_nonce,'pollIntervalMinutes',v_config.poll_interval_minutes
    );
  else
    raise exception 'Unsupported automation action';
  end if;
end;
$$;
revoke all on function public.automation_claim_run(text,uuid,text) from public;
grant execute on function public.automation_claim_run(text,uuid,text) to anon, authenticated;

create or replace function public.automation_mark_dispatched(p_token text,p_run_id uuid,p_browser_task_id text,p_browser_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_poll integer;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select poll_interval_minutes into v_poll from public.automation_config where id=true;
  update public.automation_runs set status='browser_running',browser_task_id=nullif(p_browser_task_id,''),browser_session_id=nullif(p_browser_session_id,''),lease_expires_at=null,next_attempt_at=now()+make_interval(mins=>v_poll),updated_at=now()
    where id=p_run_id and status='dispatching';
  if not found then raise exception 'Run cannot be marked dispatched'; end if;
  return jsonb_build_object('ok',true,'runId',p_run_id);
end;
$$;
revoke all on function public.automation_mark_dispatched(text,uuid,text,text) from public;
grant execute on function public.automation_mark_dispatched(text,uuid,text,text) to anon, authenticated;

create or replace function public.automation_mark_pending(p_token text,p_run_id uuid,p_diagnostics jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_poll integer;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select poll_interval_minutes into v_poll from public.automation_config where id=true;
  update public.automation_runs set status='browser_running',lease_expires_at=null,upload_nonce_hash=null,next_attempt_at=now()+make_interval(mins=>v_poll),diagnostics=coalesce(diagnostics,'{}'::jsonb)||coalesce(p_diagnostics,'{}'::jsonb),updated_at=now()
    where id=p_run_id and status='polling';
  if not found then raise exception 'Run cannot be returned to polling state'; end if;
  return jsonb_build_object('ok',true,'runId',p_run_id);
end;
$$;
revoke all on function public.automation_mark_pending(text,uuid,jsonb) from public;
grant execute on function public.automation_mark_pending(text,uuid,jsonb) to anon, authenticated;

create or replace function public.automation_fail_run(p_token text,p_run_id uuid,p_error_code text,p_error_message text,p_retryable boolean,p_diagnostics jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_config public.automation_config; v_run public.automation_runs; v_delay integer; v_retry boolean;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_config from public.automation_config where id=true;
  select * into v_run from public.automation_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Automation run not found'; end if;
  v_retry := coalesce(p_retryable,false) and v_run.attempt_count < v_config.max_attempts;
  v_delay := least(240,v_config.retry_backoff_minutes * greatest(1,power(2,greatest(v_run.attempt_count-1,0))::integer));
  update public.automation_runs set
    status=case when v_retry then 'retry_wait' else 'failed' end,
    browser_task_id=case when v_retry then null else browser_task_id end,
    browser_session_id=case when v_retry then null else browser_session_id end,
    lease_expires_at=null,upload_nonce_hash=null,
    next_attempt_at=case when v_retry then now()+make_interval(mins=>v_delay) else now() end,
    last_error_code=left(coalesce(p_error_code,'automation_error'),100),
    last_error_message=left(coalesce(p_error_message,'Automation worker failed.'),1000),
    diagnostics=coalesce(diagnostics,'{}'::jsonb)||coalesce(p_diagnostics,'{}'::jsonb),
    completed_at=case when v_retry then null else now() end,updated_at=now()
  where id=p_run_id;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(null,'automation',case when v_retry then 'automation_run_retry_scheduled' else 'automation_run_failed' end,'automation_run',p_run_id::text,jsonb_build_object('errorCode',p_error_code,'retryable',v_retry,'attemptCount',v_run.attempt_count,'retryDelayMinutes',case when v_retry then v_delay else null end));
  return jsonb_build_object('ok',true,'retryScheduled',v_retry,'retryDelayMinutes',case when v_retry then v_delay else null end);
end;
$$;
revoke all on function public.automation_fail_run(text,uuid,text,text,boolean,jsonb) from public;
grant execute on function public.automation_fail_run(text,uuid,text,text,boolean,jsonb) to anon, authenticated;

create or replace function public.is_valid_automation_upload_path(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_run_id uuid; v_nonce text;
begin
  if split_part(p_name,'/',1) <> 'automation' then return false; end if;
  begin v_run_id:=split_part(p_name,'/',2)::uuid; exception when others then return false; end;
  v_nonce:=split_part(p_name,'/',3);
  if length(v_nonce)<32 then return false; end if;
  return exists(
    select 1 from public.automation_runs r
    where r.id=v_run_id and r.status='polling' and r.lease_expires_at>now()
      and r.upload_nonce_hash=encode(digest(v_nonce,'sha256'),'hex')
  );
end;
$$;
revoke all on function public.is_valid_automation_upload_path(text) from public, anon, authenticated;

drop policy if exists moniepoint_report_automation_insert on storage.objects;
create policy moniepoint_report_automation_insert on storage.objects
  for insert to anon
  with check (bucket_id='moniepoint-reports' and public.is_valid_automation_upload_path(name));

-- Allow the existing official ingestion/reconciliation functions only after the bridge has
-- validated a worker request and set a transaction-local automation authorization flag.
create or replace function public.reconcile_ta_tasks_for_report(p_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_report_date date; v_local_date date; v_local_time time; v_final_time time; v_is_final boolean;
  v_task public.tasks; v_snapshot public.terminal_performance_snapshots; v_state public.verification_state; v_rationale text; v_count integer:=0;
begin
  if not public.is_director() and coalesce(current_setting('app.automation_authorized',true),'')<>'1' then raise exception 'Director role required'; end if;
  select report_date into v_report_date from public.report_imports where id=p_report_id and processing_status='processed';
  if v_report_date is null then raise exception 'Processed report not found'; end if;
  select next_day_verification_time into v_final_time from public.operating_config where id=true;
  v_local_date:=(now() at time zone 'Africa/Lagos')::date; v_local_time:=(now() at time zone 'Africa/Lagos')::time;
  v_is_final:=(v_local_date>v_report_date+1 or (v_local_date=v_report_date+1 and v_local_time>=v_final_time));
  for v_task in select t.* from public.tasks t where t.task_type='TA'::public.task_type and t.task_date=v_report_date and t.terminal_id is not null and t.status in ('completed'::public.task_status,'pending_verification'::public.task_status,'deferred'::public.task_status)
  loop
    select s.* into v_snapshot from public.terminal_performance_snapshots s where s.report_id=p_report_id and s.terminal_id=v_task.terminal_id and s.period_kind='rolling_7_day' limit 1;
    if v_snapshot.id is null then
      if v_is_final then v_state:='unverifiable'::public.verification_state; v_rationale:=format('Tunde could not find this terminal in the official rolling 7-day section for %s.',v_report_date);
      else v_state:='deferred'::public.verification_state; v_rationale:=format('Official evidence is not final until the next-day verification window for %s.',v_report_date); end if;
    elsif not v_is_final then v_state:='deferred'::public.verification_state; v_rationale:=format('Official report captured for %s; Tunde is holding final judgment until the next-day verification window.',v_report_date);
    elsif v_snapshot.official_target_met then v_state:='verified'::public.verification_state; v_rationale:=format('Official Moniepoint rolling 7-day data for %s marks Target Met = True (official target ₦%s).',v_report_date,trim(to_char(v_snapshot.official_target_value,'FM999,999,999,990.00')));
    else v_state:='discrepancy'::public.verification_state; v_rationale:=format('Official Moniepoint rolling 7-day data for %s marks Target Met = False (official target ₦%s).',v_report_date,trim(to_char(v_snapshot.official_target_value,'FM999,999,999,990.00'))); end if;
    insert into public.task_verifications(task_id,state,verified_against_report_id,evidence_snapshot_id,rationale,verified_at,verified_by)
      values(v_task.id,v_state,p_report_id,v_snapshot.id,v_rationale,now(),null)
      on conflict(task_id,verified_against_report_id) do update set state=excluded.state,evidence_snapshot_id=excluded.evidence_snapshot_id,rationale=excluded.rationale,verified_at=excluded.verified_at,verified_by=null;
    update public.tasks set status=v_state::text::public.task_status where id=v_task.id;
    insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
      values(null,'tunde','ta_task_reconciled','task',v_task.id::text,jsonb_build_object('report_id',p_report_id,'report_date',v_report_date,'state',v_state,'final_window_reached',v_is_final,'official_target_met',v_snapshot.official_target_met));
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('reportId',p_report_id,'reportDate',v_report_date,'finalWindowReached',v_is_final,'tasksReconciled',v_count);
end;
$function$;

-- Patch the ingestion gate and actor attribution while preserving Phase 3 semantics.
create or replace function public.ingest_moniepoint_report(p_metadata jsonb,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $function$
declare
  v_report_id uuid; v_existing_report_id uuid; v_report_date date; v_source_filename text; v_source_sha256 text; v_source_storage_path text; v_brm_name text; v_parser_version text;
  v_row jsonb; v_section public.report_terminal_section; v_business_name text; v_normalized_business_name text; v_terminal_external_id text; v_terminal_serial text; v_merchant_id uuid; v_terminal_id uuid; v_source_row_id uuid; v_period_kind text;
  v_daily_count integer:=0; v_rolling_count integer:=0; v_non_transacting_count integer:=0; v_daily_target_met_count integer:=0; v_rolling_target_met_count integer:=0; v_total_rows integer:=0; v_reconciliation jsonb;
  v_automation boolean:=coalesce(current_setting('app.automation_authorized',true),'')='1';
begin
  if not public.is_director() and not v_automation then raise exception 'Director role required'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'Parsed report rows must be a JSON array'; end if;
  v_report_date:=nullif(p_metadata->>'reportDate','')::date; v_source_filename:=nullif(btrim(p_metadata->>'sourceFilename'),''); v_source_sha256:=lower(nullif(btrim(p_metadata->>'sourceSha256'),'')); v_source_storage_path:=nullif(btrim(p_metadata->>'sourceStoragePath'),''); v_brm_name:=nullif(btrim(p_metadata->>'brmName'),''); v_parser_version:=nullif(btrim(p_metadata->>'parserVersion'),'');
  if v_report_date is null or v_source_filename is null or v_source_sha256 is null or v_source_storage_path is null or v_brm_name is null or v_parser_version is null then raise exception 'Report metadata is incomplete'; end if;
  if v_source_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid SHA-256 digest'; end if;
  select id into v_existing_report_id from public.report_imports where report_date=v_report_date and source_sha256=v_source_sha256 limit 1;
  if v_existing_report_id is not null then return jsonb_build_object('duplicate',true,'reportId',v_existing_report_id,'reportDate',v_report_date); end if;
  insert into public.report_imports(report_date,imported_by,source_filename,source_sha256,source_kind,source_storage_path,brm_name,parser_version,parsed_summary,row_count,processing_status)
    values(v_report_date,case when v_automation then null else auth.uid() end,v_source_filename,v_source_sha256,'moniepoint_pdf',v_source_storage_path,v_brm_name,v_parser_version,coalesce(p_metadata->'summary','{}'::jsonb),jsonb_array_length(p_rows),'processing') returning id into v_report_id;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_total_rows:=v_total_rows+1; v_section:=(v_row->>'section')::public.report_terminal_section; v_terminal_external_id:=nullif(upper(btrim(v_row->>'terminalId')),''); v_terminal_serial:=nullif(upper(btrim(v_row->>'terminalSerial')),''); v_business_name:=nullif(regexp_replace(btrim(v_row->>'businessName'),'\s+',' ','g'),'');
    if v_terminal_external_id is null or v_business_name is null then raise exception 'Row % is missing terminal or business identity',v_total_rows; end if;
    v_normalized_business_name:=public.normalize_business_name(v_business_name);
    select m.id into v_merchant_id from public.merchants m where public.normalize_business_name(m.business_name)=v_normalized_business_name order by m.created_at limit 1;
    if v_merchant_id is null then insert into public.merchants(business_name,external_business_ref,is_active) values(v_business_name,'name:'||encode(digest(v_normalized_business_name,'sha256'),'hex'),true) returning id into v_merchant_id; end if;
    insert into public.terminals(terminal_id,serial_number,merchant_id,assigned_at) values(v_terminal_external_id,v_terminal_serial,v_merchant_id,nullif(v_row->>'terminalAssignmentDate','')::date::timestamptz)
      on conflict(terminal_id) do update set serial_number=coalesce(excluded.serial_number,public.terminals.serial_number),merchant_id=excluded.merchant_id,assigned_at=coalesce(excluded.assigned_at,public.terminals.assigned_at) returning id into v_terminal_id;
    insert into public.report_terminal_rows(report_id,section_kind,row_number,terminal_external_id,terminal_serial,business_name,payment_value,payment_volume,transfer_value,transfer_volume,official_target_value,official_target_met,days_since_last_transaction,period_start,period_end,last_transaction_date,business_registration_date,terminal_assignment_date,raw_payload)
      values(v_report_id,v_section,(v_row->>'rowNumber')::integer,v_terminal_external_id,v_terminal_serial,v_business_name,nullif(v_row->>'paymentValue','')::numeric,nullif(v_row->>'paymentVolume','')::integer,nullif(v_row->>'transferValue','')::numeric,nullif(v_row->>'transferVolume','')::integer,nullif(v_row->>'officialTargetValue','')::numeric,nullif(v_row->>'officialTargetMet','')::boolean,nullif(v_row->>'daysSinceLastTransaction','')::integer,nullif(v_row->>'periodStart','')::date,nullif(v_row->>'periodEnd','')::date,nullif(v_row->>'lastTransactionDate','')::date,nullif(v_row->>'businessRegistrationDate','')::date,nullif(v_row->>'terminalAssignmentDate','')::date,v_row) returning id into v_source_row_id;
    if v_section in ('daily'::public.report_terminal_section,'rolling_7_day'::public.report_terminal_section) then
      if v_section='daily'::public.report_terminal_section then v_period_kind:='daily'; v_daily_count:=v_daily_count+1; if coalesce((v_row->>'officialTargetMet')::boolean,false) then v_daily_target_met_count:=v_daily_target_met_count+1; end if;
      else v_period_kind:='rolling_7_day'; v_rolling_count:=v_rolling_count+1; if coalesce((v_row->>'officialTargetMet')::boolean,false) then v_rolling_target_met_count:=v_rolling_target_met_count+1; end if; end if;
      insert into public.terminal_performance_snapshots(terminal_id,report_id,report_date,period_start,period_end,period_kind,payment_value,payment_volume,transfer_value,transfer_volume,official_target_value,official_target_met,days_since_last_transaction,source_row_id)
        values(v_terminal_id,v_report_id,v_report_date,(v_row->>'periodStart')::date,(v_row->>'periodEnd')::date,v_period_kind,coalesce((v_row->>'paymentValue')::numeric,0),coalesce((v_row->>'paymentVolume')::integer,0),coalesce((v_row->>'transferValue')::numeric,0),coalesce((v_row->>'transferVolume')::integer,0),coalesce((v_row->>'officialTargetValue')::numeric,0),coalesce((v_row->>'officialTargetMet')::boolean,false),coalesce((v_row->>'daysSinceLastTransaction')::integer,0),v_source_row_id);
    else v_non_transacting_count:=v_non_transacting_count+1; end if;
  end loop;
  if v_daily_count=0 or v_rolling_count=0 then raise exception 'Report does not contain both daily and rolling 7-day terminal sections'; end if;
  insert into public.portfolio_performance_snapshots(report_id,report_date,top_bo_retention_rate,terminal_activity_rate,assigned_terminal_growth,total_terminal_count,assigned_terminal_count,active_terminal_count,unassigned_terminal_count,assigned_7_plus_days_count,active_assigned_7_plus_days_count,payment_value,payment_volume,transfer_value,transfer_volume,daily_target_met_count,rolling_target_met_count,parsed_daily_row_count,parsed_rolling_row_count,parsed_non_transacting_row_count)
    values(v_report_id,v_report_date,nullif(p_metadata#>>'{summary,topBoRetentionRate}','')::numeric,(p_metadata#>>'{summary,terminalActivityRate}')::numeric,nullif(p_metadata#>>'{summary,assignedTerminalGrowth}','')::integer,nullif(p_metadata#>>'{summary,totalTerminalCount}','')::integer,nullif(p_metadata#>>'{summary,assignedTerminalCount}','')::integer,nullif(p_metadata#>>'{summary,activeTerminalCount}','')::integer,nullif(p_metadata#>>'{summary,unassignedTerminalCount}','')::integer,nullif(p_metadata#>>'{summary,assignedSevenPlusDaysCount}','')::integer,nullif(p_metadata#>>'{summary,activeAssignedSevenPlusDaysCount}','')::integer,nullif(p_metadata#>>'{summary,paymentValue}','')::numeric,nullif(p_metadata#>>'{summary,paymentVolume}','')::integer,nullif(p_metadata#>>'{summary,transferValue}','')::numeric,nullif(p_metadata#>>'{summary,transferVolume}','')::integer,v_daily_target_met_count,v_rolling_target_met_count,v_daily_count,v_rolling_count,v_non_transacting_count);
  update public.report_imports set processing_status='processed',row_count=v_total_rows,processing_error=null where id=v_report_id;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(case when v_automation then null else auth.uid() end,case when v_automation then 'automation' else 'director' end,'official_report_ingested','report_import',v_report_id::text,jsonb_build_object('report_date',v_report_date,'source_sha256',v_source_sha256,'daily_rows',v_daily_count,'rolling_rows',v_rolling_count,'non_transacting_rows',v_non_transacting_count,'rolling_target_met_count',v_rolling_target_met_count));
  v_reconciliation:=public.reconcile_ta_tasks_for_report(v_report_id);
  return jsonb_build_object('duplicate',false,'reportId',v_report_id,'reportDate',v_report_date,'rowsImported',v_total_rows,'dailyRows',v_daily_count,'rollingRows',v_rolling_count,'nonTransactingRows',v_non_transacting_count,'dailyTargetMetCount',v_daily_target_met_count,'rollingTargetMetCount',v_rolling_target_met_count,'reconciliation',v_reconciliation);
end;
$function$;

create or replace function public.automation_complete_run(p_token text,p_run_id uuid,p_upload_nonce text,p_metadata jsonb,p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_run public.automation_runs; v_result jsonb; v_path text; v_sha text;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.automation_runs where id=p_run_id for update;
  if v_run.id is null or v_run.status<>'polling' then raise exception 'Automation run is not awaiting completion'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at<=now() then raise exception 'Automation upload lease expired'; end if;
  if v_run.upload_nonce_hash<>encode(digest(p_upload_nonce,'sha256'),'hex') then raise exception 'Invalid automation upload nonce'; end if;
  v_path:=nullif(p_metadata->>'sourceStoragePath',''); v_sha:=lower(nullif(p_metadata->>'sourceSha256',''));
  if v_path is null or v_path not like ('automation/'||p_run_id::text||'/'||p_upload_nonce||'/%') then raise exception 'Automation storage path is invalid'; end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then raise exception 'Automation source hash is invalid'; end if;
  perform set_config('app.automation_authorized','1',true);
  v_result:=public.ingest_moniepoint_report(p_metadata,p_rows);
  update public.automation_runs set status='succeeded',report_id=(v_result->>'reportId')::uuid,source_storage_path=v_path,source_sha256=v_sha,lease_expires_at=null,upload_nonce_hash=null,last_error_code=null,last_error_message=null,completed_at=now(),updated_at=now() where id=p_run_id;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
    values(null,'automation','automation_run_succeeded','automation_run',p_run_id::text,jsonb_build_object('reportId',v_result->>'reportId','reportDate',v_result->>'reportDate','duplicate',coalesce((v_result->>'duplicate')::boolean,false),'sourceSha256',v_sha));
  return v_result;
end;
$$;
revoke all on function public.automation_complete_run(text,uuid,text,jsonb,jsonb) from public;
grant execute on function public.automation_complete_run(text,uuid,text,jsonb,jsonb) to anon, authenticated;

-- Install/update cron jobs. They remain harmless while automation_config.enabled=false.
select public.apply_automation_schedule();
