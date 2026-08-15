-- Extend the secure worker into report -> Team Management enrichment -> mirror finalisation.

create or replace function public.automation_run_context(p_token text,p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_run public.automation_runs;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.automation_runs where id=p_run_id;
  if v_run.id is null then raise exception 'Automation run not found'; end if;
  return jsonb_build_object(
    'runId',v_run.id,
    'reportId',v_run.report_id,
    'browserSessionId',v_run.browser_session_id,
    'workflowStage',coalesce(v_run.diagnostics->>'workflowStage','report')
  );
end;
$$;
revoke all on function public.automation_run_context(text,uuid) from public;
grant execute on function public.automation_run_context(text,uuid) to anon, authenticated;

create or replace function public.automation_stage_report(
  p_token text,
  p_run_id uuid,
  p_upload_nonce text,
  p_metadata jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run public.automation_runs;
  v_path text;
  v_sha text;
  v_result jsonb;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.automation_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'Automation run not found'; end if;
  if v_run.status <> 'polling' then raise exception 'Automation run is not in a report staging state'; end if;
  if v_run.lease_expires_at is null or v_run.lease_expires_at<=now() then raise exception 'Automation upload lease expired'; end if;
  if v_run.upload_nonce_hash<>encode(digest(p_upload_nonce,'sha256'),'hex') then raise exception 'Invalid automation upload nonce'; end if;

  v_path:=nullif(p_metadata->>'sourceStoragePath','');
  v_sha:=lower(nullif(p_metadata->>'sourceSha256',''));
  if v_path is null or v_path not like ('automation/'||p_run_id::text||'/'||p_upload_nonce||'/%') then
    raise exception 'Automation storage path is invalid';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then raise exception 'Automation source hash is invalid'; end if;

  perform set_config('app.automation_authorized','1',true);
  v_result:=public.ingest_moniepoint_report(p_metadata,p_rows);

  update public.automation_runs set
    report_id=(v_result->>'reportId')::uuid,
    source_storage_path=v_path,
    source_sha256=v_sha,
    lease_expires_at=null,
    upload_nonce_hash=null,
    diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('workflowStage','report_staged'),
    updated_at=now()
  where id=p_run_id;

  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(null,'automation','automation_report_staged','automation_run',p_run_id::text,
    jsonb_build_object('reportId',v_result->>'reportId','reportDate',v_result->>'reportDate','sourceSha256',v_sha));
  return v_result;
end;
$$;
revoke all on function public.automation_stage_report(text,uuid,text,jsonb,jsonb) from public;
grant execute on function public.automation_stage_report(text,uuid,text,jsonb,jsonb) to anon, authenticated;

create or replace function public.automation_mark_enrichment_dispatched(
  p_token text,
  p_run_id uuid,
  p_browser_task_id text,
  p_browser_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_poll integer;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select poll_interval_minutes into v_poll from public.automation_config where id=true;
  update public.automation_runs set
    status='browser_running',
    browser_task_id=nullif(p_browser_task_id,''),
    browser_session_id=coalesce(nullif(p_browser_session_id,''),browser_session_id),
    lease_expires_at=null,
    next_attempt_at=now()+make_interval(mins=>v_poll),
    diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('workflowStage','enrichment'),
    updated_at=now()
  where id=p_run_id and report_id is not null;
  if not found then raise exception 'Run cannot enter enrichment stage'; end if;
  return jsonb_build_object('ok',true,'runId',p_run_id,'workflowStage','enrichment');
end;
$$;
revoke all on function public.automation_mark_enrichment_dispatched(text,uuid,text,text) from public;
grant execute on function public.automation_mark_enrichment_dispatched(text,uuid,text,text) to anon, authenticated;

create or replace function public.finalize_moniepoint_enrichment(
  p_token text,
  p_run_id uuid,
  p_contacts jsonb,
  p_dashboard jsonb,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  v_result:=public.apply_moniepoint_enrichment(p_token,p_run_id,p_contacts,p_dashboard,p_source_url);
  update public.automation_runs set
    status='succeeded',
    lease_expires_at=null,
    upload_nonce_hash=null,
    last_error_code=null,
    last_error_message=null,
    diagnostics=coalesce(diagnostics,'{}'::jsonb)||jsonb_build_object('workflowStage','completed'),
    completed_at=now(),updated_at=now()
  where id=p_run_id;
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(null,'automation','automation_run_succeeded','automation_run',p_run_id::text,
    jsonb_build_object('reportId',v_result->>'reportId','contactsUpdated',v_result->>'contactsUpdated','enriched',true));
  return v_result||jsonb_build_object('succeeded',true);
end;
$$;
revoke all on function public.finalize_moniepoint_enrichment(text,uuid,jsonb,jsonb,text) from public;
grant execute on function public.finalize_moniepoint_enrichment(text,uuid,jsonb,jsonb,text) to anon, authenticated;
