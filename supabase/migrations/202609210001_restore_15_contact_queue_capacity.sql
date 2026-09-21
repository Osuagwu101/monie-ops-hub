-- Restore the intended operating model:
--   * Amina may expose up to 15 ranked contacts for the day.
--   * The Human Operations Assistant still needs 7 successful outcomes.
--
-- The September 2 run_operations_team() rewrite re-ranked only positions 1..7.
-- That is correct for the success target, but not for the separate fallback
-- queue capacity introduced on August 15. This migration keeps those concepts
-- separate again and makes every queue-extension pass normalize all visible
-- ranks up to operating_config.daily_contact_capacity.

create or replace function public.extend_human_support_queue(
  p_assistant_id uuid,
  p_plan_date date,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_current integer;
  v_total integer;
  v_added integer := 0;
  v_ranked integer := 0;
  v_emeka_run uuid;
  v_rec record;
  v_reason text;
begin
  if not public.is_director()
     and coalesce(current_setting('app.automation_authorized', true), '') <> '1' then
    raise exception 'Director or automation authorization required';
  end if;

  select daily_contact_capacity
  into v_capacity
  from public.operating_config
  where id = true;

  v_capacity := greatest(7, least(15, coalesce(v_capacity, 15)));

  select count(*)
  into v_current
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = p_plan_date;

  if v_current < v_capacity then
    select id
    into v_emeka_run
    from public.agent_runs
    where agent_kind = 'emeka'
      and assistant_id = p_assistant_id
      and plan_date = p_plan_date
      and report_id = p_report_id
    order by created_at desc
    limit 1;

    if v_emeka_run is null then
      v_reason := 'emeka_run_missing';
    else
      for v_rec in
        select r.*
        from public.agent_recommendations r
        where r.run_id = v_emeka_run
          and r.recommendation_kind = 'ta_priority'
          and r.status = 'open'
          and coalesce((r.evidence ->> 'rollingValue')::numeric, 0)
              < coalesce((r.evidence ->> 'officialTargetValue')::numeric, 0)
          and not exists (
            select 1
            from public.tasks t
            where t.assigned_to = p_assistant_id
              and t.task_date = p_plan_date
              and t.terminal_id = r.terminal_id
          )
        order by r.score desc, r.created_at, r.id
        limit greatest(0, v_capacity - v_current)
      loop
        insert into public.tasks (
          task_date,
          task_type,
          status,
          priority,
          merchant_id,
          terminal_id,
          assigned_to,
          reason,
          recommended_talking_points,
          due_at,
          created_by,
          queue_rank,
          auto_generated,
          planning_report_id,
          source_agent_recommendation_id
        ) values (
          p_plan_date,
          'TA'::public.task_type,
          'assigned'::public.task_status,
          greatest(1, least(5, ceil(coalesce(v_rec.score, 50) / 20)::integer)),
          v_rec.merchant_id,
          v_rec.terminal_id,
          p_assistant_id,
          v_rec.rationale,
          v_rec.talking_points,
          (p_plan_date::timestamp + time '18:00') at time zone 'Africa/Lagos',
          null,
          null,
          true,
          p_report_id,
          v_rec.id
        );

        update public.agent_recommendations
        set status = 'accepted'
        where id = v_rec.id;

        v_added := v_added + 1;
      end loop;
    end if;
  end if;

  -- Normalize the whole visible queue after either a manual re-plan or an
  -- automated extension. This is deliberately capacity-based (up to 15), not
  -- success-target-based (7).
  update public.tasks
  set queue_rank = null
  where assigned_to = p_assistant_id
    and task_date = p_plan_date;

  with ranked as (
    select
      t.id,
      row_number() over (
        order by
          case
            when t.status = 'in_progress'::public.task_status then 0
            when t.status in ('assigned'::public.task_status, 'postponed'::public.task_status) then 1
            else 2
          end,
          case when t.task_type = 'TA'::public.task_type then 0 else 1 end,
          coalesce(r.score, t.priority * 20) desc,
          t.priority desc,
          t.created_at,
          t.id
      ) as position
    from public.tasks t
    left join public.agent_recommendations r
      on r.id = t.source_agent_recommendation_id
    where t.assigned_to = p_assistant_id
      and t.task_date = p_plan_date
  )
  update public.tasks t
  set queue_rank = ranked.position::smallint
  from ranked
  where t.id = ranked.id
    and ranked.position <= v_capacity;

  get diagnostics v_ranked = row_count;

  select count(*)
  into v_total
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = p_plan_date;

  return jsonb_strip_nulls(jsonb_build_object(
    'capacity', v_capacity,
    'requiredTarget', 7,
    'existing', v_current,
    'added', v_added,
    'total', v_total,
    'ranked', v_ranked,
    'contactsRequiredForCreation', false,
    'reason', v_reason
  ));
end;
$$;

revoke all on function public.extend_human_support_queue(uuid,date,uuid) from public, anon;
grant execute on function public.extend_human_support_queue(uuid,date,uuid) to authenticated;

-- One atomic Director-facing entry point for a manual "Run team" action.
-- run_operations_team() prepares the required seven-success plan; the extension
-- then restores fallback capacity and normalizes ranks through the configured
-- daily contact capacity.
create or replace function public.run_operations_team_with_capacity(
  p_assistant_id uuid,
  p_plan_date date default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_extension jsonb;
  v_effective_report_id uuid;
  v_effective_plan_date date;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  v_result := public.run_operations_team(
    p_assistant_id,
    p_plan_date,
    p_report_id
  );

  v_effective_report_id := nullif(v_result ->> 'reportId', '')::uuid;
  v_effective_plan_date := nullif(v_result ->> 'planDate', '')::date;

  if v_effective_report_id is null or v_effective_plan_date is null then
    raise exception 'Operations team did not return a usable report/date context';
  end if;

  v_extension := public.extend_human_support_queue(
    p_assistant_id,
    v_effective_plan_date,
    v_effective_report_id
  );

  return v_result || jsonb_build_object(
    'queueExtension', v_extension,
    'dailyContactCapacity', coalesce((v_extension ->> 'capacity')::integer, 15),
    'dailySuccessTarget', 7
  );
end;
$$;

revoke all on function public.run_operations_team_with_capacity(uuid,date,uuid)
from public, anon;
grant execute on function public.run_operations_team_with_capacity(uuid,date,uuid)
to authenticated;
