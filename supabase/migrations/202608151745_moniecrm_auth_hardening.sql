-- MonieCRM authentication hardening.
-- Root causes addressed:
-- 1) report automation had been pointed at the public ATM/business realm rather than MonieCRM;
-- 2) omitting proxyCountryCode makes Browser Use default to a US proxy;
-- 3) multi-attempt credential retries can trigger MonieCRM's temporary security lockout.

alter table public.automation_config
  add column if not exists browser_profile_id text null;

alter table public.automation_config
  drop constraint if exists automation_config_browser_profile_id_check;

alter table public.automation_config
  add constraint automation_config_browser_profile_id_check
  check (
    browser_profile_id is null
    or browser_profile_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

update public.automation_config
set worker_url='https://monie-ops-hub.lovable.app/api/moniecrm-worker',
    moniepoint_login_url='https://v2.mab.console.teamapt.com/login',
    allowed_domains=array[
      'v2.mab.console.teamapt.com',
      '*.mab.console.teamapt.com',
      '*.console.teamapt.com'
    ]::text[],
    proxy_country_code='ng',
    max_attempts=1,
    enabled=false,
    updated_at=now()
where id=true;

create or replace function public.automation_set_browser_profile(
  p_token text,
  p_profile_id text
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;
  if p_profile_id is null or p_profile_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid Browser Use profile id';
  end if;
  update public.automation_config
  set browser_profile_id=p_profile_id,
      updated_at=now()
  where id=true;
  return jsonb_build_object('ok',true,'profileConfigured',true);
end;
$$;

revoke all on function public.automation_set_browser_profile(text,text) from public;
grant execute on function public.automation_set_browser_profile(text,text) to anon, authenticated;

create or replace function public.automation_claim_run(
  p_token text,
  p_run_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path='public','vault','extensions'
as $$
declare
  v_run public.automation_runs;
  v_config public.automation_config;
  v_api_key text;
  v_username text;
  v_password text;
  v_nonce text;
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

    update public.automation_runs
    set status='dispatching',
        attempt_count=attempt_count+1,
        lease_expires_at=now()+interval '2 minutes',
        started_at=coalesce(started_at,now()),
        last_error_code=null,
        last_error_message=null,
        updated_at=now()
    where id=p_run_id
    returning * into v_run;

    return jsonb_build_object(
      'runId',v_run.id,
      'action','execute',
      'triggerKind',v_run.trigger_kind,
      'browserUseApiKey',v_api_key,
      'moniepointUsername',v_username,
      'moniepointPassword',v_password,
      'loginUrl',v_config.moniepoint_login_url,
      'allowedDomains',v_config.allowed_domains,
      'proxyCountryCode',v_config.proxy_country_code,
      'browserProfileId',v_config.browser_profile_id,
      'maxSteps',v_config.max_steps,
      'pollIntervalMinutes',v_config.poll_interval_minutes
    );
  elsif p_action='poll' then
    if v_run.status not in ('browser_running','polling') or v_run.browser_task_id is null then raise exception 'Run is not pollable'; end if;
    if v_run.lease_expires_at is not null and v_run.lease_expires_at>now() then raise exception 'Run is already leased'; end if;
    v_nonce:=encode(gen_random_bytes(24),'hex');
    update public.automation_runs
    set status='polling',
        lease_expires_at=now()+interval '2 minutes',
        upload_nonce_hash=encode(digest(v_nonce,'sha256'),'hex'),
        updated_at=now()
    where id=p_run_id
    returning * into v_run;
    return jsonb_build_object(
      'runId',v_run.id,
      'action','poll',
      'triggerKind',v_run.trigger_kind,
      'browserUseApiKey',v_api_key,
      'browserTaskId',v_run.browser_task_id,
      'uploadNonce',v_nonce,
      'pollIntervalMinutes',v_config.poll_interval_minutes
    );
  else
    raise exception 'Unsupported automation action';
  end if;
end;
$$;

-- Even if the Director UI submits a larger value, credential authentication is deliberately
-- single-attempt. A fresh run can be queued after a failure has been inspected.
create or replace function public.update_automation_config(
  p_enabled boolean,
  p_moniepoint_login_url text,
  p_allowed_domains text[],
  p_proxy_country_code text,
  p_max_steps integer,
  p_max_attempts integer,
  p_retry_backoff_minutes integer,
  p_morning_audit_time time without time zone,
  p_morning_refresh_time time without time zone,
  p_evening_refresh_time time without time zone
)
returns public.automation_config
language plpgsql
security definer
set search_path='public','vault'
as $$
declare
  v_row public.automation_config;
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
    allowed_domains=(
      select coalesce(array_agg(lower(btrim(x)) order by lower(btrim(x))),'{}'::text[])
      from unnest(coalesce(p_allowed_domains,'{}'::text[])) x
      where nullif(btrim(x),'') is not null
    ),
    proxy_country_code=nullif(lower(btrim(p_proxy_country_code)),''),
    max_steps=greatest(10,least(250,coalesce(p_max_steps,100))),
    max_attempts=1,
    retry_backoff_minutes=greatest(2,least(60,coalesce(p_retry_backoff_minutes,10))),
    morning_audit_time=coalesce(p_morning_audit_time,'08:30'::time),
    morning_refresh_time=coalesce(p_morning_refresh_time,'09:00'::time),
    evening_refresh_time=coalesce(p_evening_refresh_time,'18:00'::time),
    updated_by=auth.uid(),
    updated_at=now()
  where id=true
  returning * into v_row;

  perform public.apply_automation_schedule();
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(
    auth.uid(),
    'director',
    'automation_config_updated',
    'automation_config',
    'primary',
    jsonb_build_object(
      'enabled',v_row.enabled,
      'allowedDomains',v_row.allowed_domains,
      'proxyCountryCode',v_row.proxy_country_code,
      'maxAttempts',v_row.max_attempts
    )
  );
  return v_row;
end;
$$;
