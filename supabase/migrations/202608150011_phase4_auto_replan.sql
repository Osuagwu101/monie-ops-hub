-- Phase 4 automatic reprioritisation.
-- A fresh processed report can refresh untouched Amina-generated work for every
-- active assistant. The trigger only auto-runs for an authenticated Director;
-- later machine-to-machine report retrieval can call run_operations_team explicitly.

create or replace function public.phase4_after_report_processed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assistant record;
  v_plan_date date;
begin
  if new.processing_status <> 'processed'
     or old.processing_status = 'processed'
     or not public.is_director() then
    return new;
  end if;

  v_plan_date := (now() at time zone 'Africa/Lagos')::date;

  -- Reconcile first so Tunde's Phase 4 attention run sees the newest evidence state.
  perform public.reconcile_ta_tasks_for_report(new.id);

  for v_assistant in
    select id
    from public.profiles
    where role = 'assistant'::public.app_role
      and is_active = true
    order by created_at
  loop
    perform public.run_operations_team(v_assistant.id, v_plan_date, new.id);
  end loop;

  return new;
exception
  when others then
    -- Report ingestion must remain authoritative even if operational planning fails.
    insert into public.audit_events (
      actor_user_id,
      actor_kind,
      event_type,
      entity_type,
      entity_id,
      payload
    ) values (
      null,
      'system',
      'phase4_auto_replan_failed',
      'report_import',
      new.id::text,
      jsonb_build_object('error', sqlerrm)
    );
    return new;
end;
$$;

create trigger report_imports_phase4_auto_replan
after update of processing_status on public.report_imports
for each row execute function public.phase4_after_report_processed();
