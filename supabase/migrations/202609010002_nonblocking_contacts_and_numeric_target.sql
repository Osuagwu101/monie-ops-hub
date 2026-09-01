-- Amina must create the daily plan even when merchant contact details are
-- incomplete. Numeric target achievement also wins over a contradictory
-- report flag: a BO at or above the official target is not a recovery task.

do $$
declare
  v_definition text;
  v_original text;
begin
  select pg_get_functiondef('public.run_operations_team(uuid,date,uuid)'::regprocedure)
  into v_definition;
  v_original := v_definition;

  v_definition := replace(
    v_definition,
    'where s.report_id=v_report_id and s.period_kind=''rolling_7_day'' and s.official_target_value>0 and s.official_target_met=false',
    'where s.report_id=v_report_id and s.period_kind=''rolling_7_day'' and s.official_target_value>0 and s.official_target_met=false and (coalesce(s.payment_value,0)+coalesce(s.transfer_value,0)) < s.official_target_value'
  );
  v_definition := replace(
    v_definition,
    'where nullif(trim(coalesce(m.phone_number,'''')),'''') is not null',
    'where true'
  );
  v_definition := replace(
    v_definition,
    'where r.run_id=v_emeka_run and r.status=''open'' and nullif(trim(coalesce(m.phone_number,'''')),'''') is not null',
    'where r.run_id=v_emeka_run and r.status=''open'''
  );
  v_definition := replace(
    v_definition,
    'where s.report_id=v_report_id and s.period_kind=''rolling_7_day'' and s.official_target_met=true and nullif(trim(coalesce(m.phone_number,'''')),'''') is not null',
    'where s.report_id=v_report_id and s.period_kind=''rolling_7_day'' and (s.official_target_met=true or (coalesce(s.payment_value,0)+coalesce(s.transfer_value,0)) >= s.official_target_value)'
  );
  v_definition := replace(
    v_definition,
    'high-priority TA records currently lack phone numbers.',
    'assigned tasks currently lack phone numbers.'
  );
  v_definition := replace(
    v_definition,
    'The plan is intentionally not padded with fake contacts. Add missing merchant phone details or resolve excess manual tasks, then run the team again.',
    'Work the ranked queue. The Director can add missing phone and POS details directly from Daily Tasks.'
  );
  v_definition := replace(
    v_definition,
    'official_target_met_is_authoritative',
    'numeric_target_and_official_flag_confirm_underperformance'
  );

  if v_definition = v_original then
    raise exception 'run_operations_team baseline did not match the guarded deployment patch';
  end if;

  execute v_definition;
end;
$$;

create or replace function public.refresh_bo_attention_queue(
  p_report_id uuid,
  p_plan_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_date date := coalesce(p_plan_date, (now() at time zone 'Africa/Lagos')::date);
  v_count integer := 0;
begin
  if not public.is_director()
     and coalesce(current_setting('app.automation_authorized', true),'') <> '1' then
    raise exception 'Director or automation authorization required';
  end if;

  if not exists (
    select 1 from public.report_imports
    where id = p_report_id and processing_status = 'processed'
  ) then
    raise exception 'Processed report not found';
  end if;

  delete from public.bo_attention_queue where plan_date = v_plan_date;

  insert into public.bo_attention_queue (
    plan_date, queue_rank, report_id, merchant_id, terminal_id, snapshot_id, priority_score
  )
  select
    v_plan_date,
    ranked.position::smallint,
    p_report_id,
    ranked.merchant_id,
    ranked.terminal_id,
    ranked.snapshot_id,
    greatest(0.01, 100 - ((ranked.position - 1) * 0.01))
  from (
    select
      s.id as snapshot_id,
      s.terminal_id,
      t.merchant_id,
      t.terminal_id as terminal_external_id,
      coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0) as rolling_value,
      s.official_target_value,
      row_number() over (
        order by
          case when (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) > 0 then 0 else 1 end,
          (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) desc,
          coalesce(s.days_since_last_transaction, 2147483647),
          t.terminal_id
      ) as position
    from public.terminal_performance_snapshots s
    join public.terminals t on t.id = s.terminal_id
    where s.report_id = p_report_id
      and s.period_kind = 'rolling_7_day'
      and s.official_target_value > 0
      and (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) < s.official_target_value
  ) ranked
  where ranked.position <= 15
  order by ranked.position;

  get diagnostics v_count = row_count;
  return jsonb_build_object('queueDate', v_plan_date, 'candidateCount', v_count, 'capacity', 15);
end;
$$;

revoke all on function public.refresh_bo_attention_queue(uuid,date) from public, anon;
grant execute on function public.refresh_bo_attention_queue(uuid,date) to authenticated;

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
  v_added integer := 0;
  v_emeka_run uuid;
  v_rec record;
  v_rank integer;
begin
  if not public.is_director()
     and coalesce(current_setting('app.automation_authorized', true),'') <> '1' then
    raise exception 'Director or automation authorization required';
  end if;

  select daily_contact_capacity into v_capacity from public.operating_config where id = true;
  v_capacity := greatest(7, least(15, coalesce(v_capacity, 15)));

  select count(*) into v_current
  from public.tasks
  where assigned_to = p_assistant_id and task_date = p_plan_date;

  if v_current >= v_capacity then
    return jsonb_build_object('capacity', v_capacity, 'existing', v_current, 'added', 0);
  end if;

  select id into v_emeka_run
  from public.agent_runs
  where agent_kind = 'emeka'
    and assistant_id = p_assistant_id
    and plan_date = p_plan_date
    and report_id = p_report_id
  order by created_at desc
  limit 1;

  if v_emeka_run is null then
    return jsonb_build_object('capacity', v_capacity, 'existing', v_current, 'added', 0, 'reason', 'emeka_run_missing');
  end if;

  v_rank := v_current;
  for v_rec in
    select r.*
    from public.agent_recommendations r
    where r.run_id = v_emeka_run
      and r.recommendation_kind = 'ta_priority'
      and r.status = 'open'
      and coalesce((r.evidence ->> 'rollingValue')::numeric, 0)
          < coalesce((r.evidence ->> 'officialTargetValue')::numeric, 0)
      and not exists (
        select 1 from public.tasks t
        where t.assigned_to = p_assistant_id
          and t.task_date = p_plan_date
          and t.terminal_id = r.terminal_id
      )
    order by r.score desc, r.created_at
    limit greatest(0, v_capacity - v_current)
  loop
    v_rank := v_rank + 1;
    insert into public.tasks (
      task_date, task_type, status, priority, merchant_id, terminal_id, assigned_to,
      reason, recommended_talking_points, due_at, created_by, queue_rank, auto_generated,
      planning_report_id, source_agent_recommendation_id
    ) values (
      p_plan_date, 'TA'::public.task_type, 'assigned'::public.task_status,
      greatest(1, least(5, ceil(coalesce(v_rec.score, 50) / 20)::integer)),
      v_rec.merchant_id, v_rec.terminal_id, p_assistant_id,
      v_rec.rationale, v_rec.talking_points,
      (p_plan_date::timestamp + time '18:00') at time zone 'Africa/Lagos',
      null, v_rank::smallint, true, p_report_id, v_rec.id
    );
    update public.agent_recommendations set status = 'accepted' where id = v_rec.id;
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object(
    'capacity', v_capacity,
    'requiredTarget', 7,
    'existing', v_current,
    'added', v_added,
    'total', v_current + v_added,
    'contactsRequiredForCreation', false
  );
end;
$$;

revoke all on function public.extend_human_support_queue(uuid,date,uuid) from public, anon;
grant execute on function public.extend_human_support_queue(uuid,date,uuid) to authenticated;

create or replace function public.reject_numeric_target_met_recommendation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.agent_kind = 'emeka'
     and new.recommendation_kind = 'ta_priority'
     and coalesce((new.evidence ->> 'officialTargetValue')::numeric, 0) > 0
     and coalesce((new.evidence ->> 'rollingValue')::numeric, 0)
         >= coalesce((new.evidence ->> 'officialTargetValue')::numeric, 0) then
    update public.agent_recommendations
    set status = 'superseded'
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_recommendations_reject_numeric_target_met
  on public.agent_recommendations;
create trigger agent_recommendations_reject_numeric_target_met
after insert or update of evidence, recommendation_kind
on public.agent_recommendations
for each row execute function public.reject_numeric_target_met_recommendation();

-- Contacts do not gate task creation. They remain Director-editable task data.
