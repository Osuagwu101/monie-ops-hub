-- Re-run the existing Amina/operations-team planning after the permanent
-- contact vault has been populated. The bridge token authorizes only this
-- server-side replan; raw contact values are not returned.

create or replace function public.contact_bootstrap_finalize(
  p_token text,
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_run public.contact_bootstrap_runs;
  v_plan_date date := (now() at time zone 'Africa/Lagos')::date;
  v_assistant record;
  v_assistants integer := 0;
  v_tasks integer := 0;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.contact_bootstrap_runs where id=p_run_id;
  if v_run.id is null then raise exception 'Contact bootstrap run not found'; end if;
  if v_run.status <> 'completed' then raise exception 'Contact bootstrap run is not complete'; end if;

  perform set_config('app.automation_authorized','1',true);
  perform public.refresh_bo_attention_queue(v_run.report_id,v_plan_date);
  perform public.reconcile_ta_tasks_for_report(v_run.report_id);

  for v_assistant in
    select id from public.profiles
    where role='assistant'::public.app_role and is_active=true
    order by created_at
  loop
    perform public.run_operations_team(v_assistant.id,v_plan_date,v_run.report_id);
    perform public.extend_human_support_queue(v_assistant.id,v_plan_date,v_run.report_id);
    v_assistants := v_assistants + 1;
  end loop;

  select count(*) into v_tasks
  from public.tasks
  where planning_report_id=v_run.report_id and task_date=v_plan_date;

  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(null,'automation','contact_vault_bootstrap_completed','report_import',v_run.report_id::text,
    jsonb_build_object(
      'bootstrapRunId',v_run.id,
      'verifiedContacts',v_run.verified_count,
      'reviewRequired',v_run.review_count,
      'notFound',v_run.not_found_count,
      'planDate',v_plan_date,
      'assistantsReplanned',v_assistants,
      'tasksForReportAndDate',v_tasks
    ));

  return jsonb_build_object(
    'reportId',v_run.report_id,
    'planDate',v_plan_date,
    'verifiedContacts',v_run.verified_count,
    'reviewRequired',v_run.review_count,
    'notFound',v_run.not_found_count,
    'assistantsReplanned',v_assistants,
    'tasksForReportAndDate',v_tasks
  );
end;
$$;
revoke all on function public.contact_bootstrap_finalize(text,uuid) from public;
grant execute on function public.contact_bootstrap_finalize(text,uuid) to anon,authenticated;
