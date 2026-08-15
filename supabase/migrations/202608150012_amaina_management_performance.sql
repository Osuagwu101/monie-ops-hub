-- Amina Level 2 management layer.
-- Scores the Human Operations Assistant and specialist agents, adapts management tone,
-- and creates Director-reviewable warnings, penalty recommendations and bonus recommendations.
-- No financial recommendation changes earned pay automatically.

alter table public.operating_config
  add column management_warning_threshold_percent numeric(5,2) not null default 75
    check (management_warning_threshold_percent between 0 and 100),
  add column penalty_trigger_percent numeric(5,2) not null default 72
    check (penalty_trigger_percent between 0 and 100),
  add column critical_threshold_percent numeric(5,2) not null default 70
    check (critical_threshold_percent between 0 and 100),
  add column bonus_threshold_percent numeric(5,2) not null default 77
    check (bonus_threshold_percent between 0 and 100),
  add column bonus_streak_days integer not null default 14
    check (bonus_streak_days between 1 and 90),
  add column bonus_percent numeric(5,2) not null default 5
    check (bonus_percent > 0 and bonus_percent <= 100);

create table public.performance_scorecards (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.report_imports(id) on delete cascade,
  score_date date not null,
  subject_kind text not null check (subject_kind in ('assistant', 'emeka', 'zainab', 'tunde')),
  subject_key text not null,
  subject_user_id uuid references public.profiles(id) on delete cascade,
  team_performance_percent numeric(5,2) check (
    team_performance_percent is null or team_performance_percent between 0 and 100
  ),
  individual_score_percent numeric(5,2) not null check (individual_score_percent between 0 and 100),
  management_mode text not null check (
    management_mode in ('supportive', 'firm', 'strict', 'very_strict', 'critical')
  ),
  rating text not null check (
    rating in ('excellent', 'strong', 'acceptable', 'watch', 'underperforming', 'critical')
  ),
  amina_message text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, subject_key),
  check (
    (subject_kind = 'assistant' and subject_user_id is not null)
    or (subject_kind <> 'assistant' and subject_user_id is null)
  )
);

create table public.compensation_recommendations (
  id uuid primary key default gen_random_uuid(),
  assistant_id uuid not null references public.profiles(id) on delete cascade,
  scorecard_id uuid references public.performance_scorecards(id) on delete set null,
  recommendation_type text not null check (
    recommendation_type in (
      'performance_warning',
      'improvement_plan',
      'penalty_review',
      'bonus',
      'recognition'
    )
  ),
  recommendation_percent numeric(5,2) check (
    recommendation_percent is null or recommendation_percent between 0 and 100
  ),
  period_start date not null,
  period_end date not null,
  rationale text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending_director' check (
    status in ('pending_director', 'approved', 'rejected', 'cancelled')
  ),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  director_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (assistant_id, recommendation_type, period_end)
);

create index performance_scorecards_subject_date_idx
  on public.performance_scorecards (subject_key, score_date desc, created_at desc);
create index performance_scorecards_report_idx
  on public.performance_scorecards (report_id, subject_kind);
create index compensation_recommendations_assistant_idx
  on public.compensation_recommendations (assistant_id, status, created_at desc);

create trigger performance_scorecards_set_updated_at
before update on public.performance_scorecards
for each row execute function public.set_updated_at();

create trigger compensation_recommendations_set_updated_at
before update on public.compensation_recommendations
for each row execute function public.set_updated_at();

alter table public.performance_scorecards enable row level security;
alter table public.compensation_recommendations enable row level security;

create policy performance_scorecards_director_manage on public.performance_scorecards
for all to authenticated
using (public.is_director())
with check (public.is_director());

create policy performance_scorecards_assistant_read on public.performance_scorecards
for select to authenticated
using (
  subject_kind <> 'assistant'
  or subject_user_id = auth.uid()
);

create policy compensation_recommendations_director_manage on public.compensation_recommendations
for all to authenticated
using (public.is_director())
with check (public.is_director());

create policy compensation_recommendations_assistant_read on public.compensation_recommendations
for select to authenticated
using (assistant_id = auth.uid());

create or replace function public.amina_management_mode(p_percent numeric)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when p_percent is null then 'firm'
    when p_percent < (select critical_threshold_percent from public.operating_config where id = true)
      then 'critical'
    when p_percent < (select penalty_trigger_percent from public.operating_config where id = true)
      then 'very_strict'
    when p_percent < (select management_warning_threshold_percent from public.operating_config where id = true)
      then 'strict'
    when p_percent < (select team_standard_percent from public.operating_config where id = true)
      then 'firm'
    else 'supportive'
  end;
$$;

create or replace function public.amina_performance_rating(p_percent numeric)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_percent >= 90 then 'excellent'
    when p_percent >= 77 then 'strong'
    when p_percent >= 72 then 'acceptable'
    when p_percent >= 65 then 'watch'
    when p_percent >= 50 then 'underperforming'
    else 'critical'
  end;
$$;

create or replace function public.amina_message_for(
  p_subject_name text,
  p_team_percent numeric,
  p_individual_percent numeric,
  p_mode text
)
returns text
language plpgsql
immutable
security invoker
set search_path = public
as $$
begin
  return case p_mode
    when 'supportive' then format(
      '%s: Good work. The standard is being met. Keep the discipline, protect what is working, and fix weak signals before they become tomorrow''s problem. Team: %s%%. Individual: %s%%.',
      p_subject_name,
      coalesce(round(p_team_percent, 2)::text, 'n/a'),
      round(p_individual_percent, 2)::text
    )
    when 'firm' then format(
      '%s: We are close, but close is not the 77%% standard. Tighten execution today and remove the gaps that are still holding the team back. Team: %s%%. Individual: %s%%.',
      p_subject_name,
      coalesce(round(p_team_percent, 2)::text, 'n/a'),
      round(p_individual_percent, 2)::text
    )
    when 'strict' then format(
      '%s: This is below the internal standard. I expect corrective action, not explanations. Finish the assigned work, close follow-ups, and document every outcome properly. Team: %s%%. Individual: %s%%.',
      p_subject_name,
      coalesce(round(p_team_percent, 2)::text, 'n/a'),
      round(p_individual_percent, 2)::text
    )
    when 'very_strict' then format(
      '%s: OPERATIONAL WARNING. Performance is below the company benchmark. No drifting and no avoidable backlog. Every measurable gap needs an owner and a recovery action today. Team: %s%%. Individual: %s%%.',
      p_subject_name,
      coalesce(round(p_team_percent, 2)::text, 'n/a'),
      round(p_individual_percent, 2)::text
    )
    else format(
      '%s: CRITICAL. No excuses, no padding, no pretending this is acceptable. Fix the measurable failures now, close overdue work, and escalate anything blocking recovery. Team: %s%%. Individual: %s%%.',
      p_subject_name,
      coalesce(round(p_team_percent, 2)::text, 'n/a'),
      round(p_individual_percent, 2)::text
    )
  end;
end;
$$;

create or replace function public.refresh_amaina_management_scores(
  p_assistant_id uuid,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_date date;
  v_team_percent numeric;
  v_assistant_name text;
  v_warning_threshold numeric;
  v_penalty_threshold numeric;
  v_bonus_threshold numeric;
  v_bonus_days integer;
  v_bonus_percent numeric;
  v_total_tasks integer := 0;
  v_completed_tasks integer := 0;
  v_outcome_tasks integer := 0;
  v_documented_tasks integer := 0;
  v_due_callbacks integer := 0;
  v_unresolved_callbacks integer := 0;
  v_verified_items integer := 0;
  v_verification_points numeric := 0;
  v_completion_rate numeric := 0;
  v_outcome_rate numeric := 0;
  v_documentation_rate numeric := 0;
  v_followthrough_rate numeric := 1;
  v_verification_rate numeric := 0.75;
  v_assistant_score numeric := 0;
  v_pressure_percent numeric;
  v_mode text;
  v_rating text;
  v_message text;
  v_assistant_scorecard_id uuid;
  v_emeka_score numeric := 0;
  v_zainab_score numeric := 0;
  v_tunde_score numeric := 0;
  v_emeka_summary jsonb := '{}'::jsonb;
  v_zainab_summary jsonb := '{}'::jsonb;
  v_tunde_summary jsonb := '{}'::jsonb;
  v_emeka_priorities integer := 0;
  v_emeka_contact_gaps integer := 0;
  v_zainab_candidates integer := 0;
  v_monthly_loan_successes integer := 0;
  v_tunde_attention integer := 0;
  v_ta_tasks integer := 0;
  v_ta_verified integer := 0;
  v_bonus_team_days integer := 0;
  v_bonus_assistant_days integer := 0;
  v_bonus_span integer := 0;
  v_result jsonb;
begin
  if auth.uid() is not null and not public.is_director() then
    raise exception 'Director role required';
  end if;

  select r.report_date, p.terminal_activity_rate
  into v_report_date, v_team_percent
  from public.report_imports r
  left join public.portfolio_performance_snapshots p on p.report_id = r.id
  where r.id = p_report_id
    and r.processing_status = 'processed';

  if v_report_date is null then
    raise exception 'Processed report not found';
  end if;

  select full_name
  into v_assistant_name
  from public.profiles
  where id = p_assistant_id
    and role = 'assistant'::public.app_role
    and is_active = true;

  if v_assistant_name is null then
    raise exception 'Active assistant profile not found';
  end if;

  select
    management_warning_threshold_percent,
    penalty_trigger_percent,
    bonus_threshold_percent,
    bonus_streak_days,
    bonus_percent
  into
    v_warning_threshold,
    v_penalty_threshold,
    v_bonus_threshold,
    v_bonus_days,
    v_bonus_percent
  from public.operating_config
  where id = true;

  select
    count(*),
    count(*) filter (
      where status in (
        'completed'::public.task_status,
        'pending_verification'::public.task_status,
        'verified'::public.task_status,
        'discrepancy'::public.task_status,
        'deferred'::public.task_status,
        'unverifiable'::public.task_status
      )
    )
  into v_total_tasks, v_completed_tasks
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = v_report_date;

  select count(distinct o.task_id)
  into v_outcome_tasks
  from public.task_outcomes o
  join public.tasks t on t.id = o.task_id
  where t.assigned_to = p_assistant_id
    and t.task_date = v_report_date;

  with latest_outcome as (
    select distinct on (o.task_id)
      o.task_id,
      o.outcome_code,
      o.notes
    from public.task_outcomes o
    join public.tasks t on t.id = o.task_id
    where t.assigned_to = p_assistant_id
      and t.task_date = v_report_date
    order by o.task_id, o.submitted_at desc
  )
  select count(*) filter (
    where outcome_code is not null
      and nullif(trim(coalesce(notes, '')), '') is not null
  )
  into v_documented_tasks
  from latest_outcome;

  with latest_outcome as (
    select distinct on (o.task_id)
      o.task_id,
      o.callback_at
    from public.task_outcomes o
    join public.tasks t on t.id = o.task_id
    where t.assigned_to = p_assistant_id
      and t.task_date <= v_report_date
    order by o.task_id, o.submitted_at desc
  ), due as (
    select t.id, lo.callback_at
    from public.tasks t
    join latest_outcome lo on lo.task_id = t.id
    where t.assigned_to = p_assistant_id
      and t.status = 'postponed'::public.task_status
      and lo.callback_at is not null
      and (lo.callback_at at time zone 'Africa/Lagos')::date <= v_report_date
  )
  select
    count(*),
    count(*) filter (
      where not exists (
        select 1
        from public.tasks child
        where child.rolled_from_task_id = due.id
          and child.task_date > v_report_date
      )
    )
  into v_due_callbacks, v_unresolved_callbacks
  from due;

  select
    count(*),
    coalesce(sum(
      case v.state
        when 'verified'::public.verification_state then 1.0
        when 'deferred'::public.verification_state then 0.70
        when 'unverifiable'::public.verification_state then 0.50
        else 0.0
      end
    ), 0)
  into v_verified_items, v_verification_points
  from public.task_verifications v
  join public.tasks t on t.id = v.task_id
  where t.assigned_to = p_assistant_id
    and t.task_date = v_report_date
    and v.verified_against_report_id = p_report_id;

  if v_total_tasks > 0 then
    v_completion_rate := v_completed_tasks::numeric / v_total_tasks;
    v_outcome_rate := least(1, v_outcome_tasks::numeric / v_total_tasks);
    v_documentation_rate := least(1, v_documented_tasks::numeric / v_total_tasks);
  end if;

  if v_due_callbacks > 0 then
    v_followthrough_rate := greatest(
      0,
      1 - (v_unresolved_callbacks::numeric / v_due_callbacks)
    );
  end if;

  if v_verified_items > 0 then
    v_verification_rate := v_verification_points / v_verified_items;
  end if;

  v_assistant_score := round(
    greatest(
      0,
      least(
        100,
        100 * (
          (0.35 * v_completion_rate)
          + (0.20 * v_outcome_rate)
          + (0.15 * v_documentation_rate)
          + (0.15 * v_followthrough_rate)
          + (0.15 * v_verification_rate)
        )
      )
    ),
    2
  );

  v_pressure_percent := case
    when v_team_percent is null then v_assistant_score
    else least(v_team_percent, v_assistant_score)
  end;
  v_mode := public.amina_management_mode(v_pressure_percent);
  v_rating := public.amina_performance_rating(v_assistant_score);
  v_message := public.amina_message_for(
    v_assistant_name,
    v_team_percent,
    v_assistant_score,
    v_mode
  );

  insert into public.performance_scorecards (
    report_id,
    score_date,
    subject_kind,
    subject_key,
    subject_user_id,
    team_performance_percent,
    individual_score_percent,
    management_mode,
    rating,
    amina_message,
    evidence
  ) values (
    p_report_id,
    v_report_date,
    'assistant',
    'assistant:' || p_assistant_id::text,
    p_assistant_id,
    v_team_percent,
    v_assistant_score,
    v_mode,
    v_rating,
    v_message,
    jsonb_build_object(
      'assignedTasks', v_total_tasks,
      'completedTasks', v_completed_tasks,
      'completionRate', round(v_completion_rate, 4),
      'tasksWithOutcomes', v_outcome_tasks,
      'outcomeRate', round(v_outcome_rate, 4),
      'fullyDocumentedTasks', v_documented_tasks,
      'documentationRate', round(v_documentation_rate, 4),
      'dueCallbacks', v_due_callbacks,
      'unresolvedCallbacks', v_unresolved_callbacks,
      'followthroughRate', round(v_followthrough_rate, 4),
      'verificationItems', v_verified_items,
      'verificationRate', round(v_verification_rate, 4)
    )
  )
  on conflict (report_id, subject_key) do update
  set team_performance_percent = excluded.team_performance_percent,
      individual_score_percent = excluded.individual_score_percent,
      management_mode = excluded.management_mode,
      rating = excluded.rating,
      amina_message = excluded.amina_message,
      evidence = excluded.evidence,
      updated_at = now()
  returning id into v_assistant_scorecard_id;

  select output_summary
  into v_emeka_summary
  from public.agent_runs
  where agent_kind = 'emeka'
    and report_id = p_report_id
    and assistant_id = p_assistant_id
    and status = 'completed'
  order by completed_at desc nulls last, created_at desc
  limit 1;

  v_emeka_priorities := coalesce((v_emeka_summary ->> 'taPriorities')::integer, 0);
  v_emeka_contact_gaps := coalesce((v_emeka_summary ->> 'contactGaps')::integer, 0);
  v_emeka_score := case
    when v_emeka_priorities = 0 and coalesce(v_team_percent, 0) >= 77 then 100
    when v_emeka_priorities = 0 then 75
    else round(
      greatest(
        60,
        100 - least(40, (v_emeka_contact_gaps::numeric / v_emeka_priorities) * 40)
      ),
      2
    )
  end;

  select output_summary
  into v_zainab_summary
  from public.agent_runs
  where agent_kind = 'zainab'
    and report_id = p_report_id
    and assistant_id = p_assistant_id
    and status = 'completed'
  order by completed_at desc nulls last, created_at desc
  limit 1;

  v_zainab_candidates := coalesce((v_zainab_summary ->> 'loanConversationCandidates')::integer, 0);
  v_monthly_loan_successes := coalesce(
    (v_zainab_summary ->> 'monthlySuccessfulLoansRecorded')::integer,
    0
  );
  v_zainab_score := case
    when v_monthly_loan_successes >= 1 then 100
    when v_zainab_candidates > 0 then 90
    else 80
  end;

  select output_summary
  into v_tunde_summary
  from public.agent_runs
  where agent_kind = 'tunde'
    and report_id = p_report_id
    and assistant_id = p_assistant_id
    and status = 'completed'
  order by completed_at desc nulls last, created_at desc
  limit 1;

  v_tunde_attention := coalesce((v_tunde_summary ->> 'attentionItems')::integer, 0);

  select count(*)
  into v_ta_tasks
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = v_report_date
    and task_type = 'TA'::public.task_type
    and status in (
      'completed'::public.task_status,
      'pending_verification'::public.task_status,
      'verified'::public.task_status,
      'discrepancy'::public.task_status,
      'deferred'::public.task_status,
      'unverifiable'::public.task_status
    );

  select count(distinct v.task_id)
  into v_ta_verified
  from public.task_verifications v
  join public.tasks t on t.id = v.task_id
  where t.assigned_to = p_assistant_id
    and t.task_date = v_report_date
    and t.task_type = 'TA'::public.task_type
    and v.verified_against_report_id = p_report_id;

  v_tunde_score := case
    when v_ta_tasks = 0 then 100
    else round(least(100, (v_ta_verified::numeric / v_ta_tasks) * 100), 2)
  end;

  perform public.upsert_agent_performance_scorecard(
    p_report_id,
    v_report_date,
    'emeka',
    v_team_percent,
    v_emeka_score,
    jsonb_build_object(
      'taPriorities', v_emeka_priorities,
      'contactGaps', v_emeka_contact_gaps
    )
  );

  perform public.upsert_agent_performance_scorecard(
    p_report_id,
    v_report_date,
    'zainab',
    v_team_percent,
    v_zainab_score,
    jsonb_build_object(
      'loanConversationCandidates', v_zainab_candidates,
      'monthlySuccessfulLoansRecorded', v_monthly_loan_successes,
      'creditApproval', false
    )
  );

  perform public.upsert_agent_performance_scorecard(
    p_report_id,
    v_report_date,
    'tunde',
    v_team_percent,
    v_tunde_score,
    jsonb_build_object(
      'completedTaTasks', v_ta_tasks,
      'verifiedTaTasks', v_ta_verified,
      'attentionItems', v_tunde_attention
    )
  );

  if v_team_percent is not null
     and (v_team_percent < v_warning_threshold or v_assistant_score < v_warning_threshold) then
    insert into public.compensation_recommendations (
      assistant_id,
      scorecard_id,
      recommendation_type,
      period_start,
      period_end,
      rationale,
      evidence
    ) values (
      p_assistant_id,
      v_assistant_scorecard_id,
      'performance_warning',
      v_report_date,
      v_report_date,
      format(
        'Amina warning: team performance is %s%% and the assistant score is %s%%. Corrective action is required, but no financial penalty is automatic.',
        round(v_team_percent, 2),
        round(v_assistant_score, 2)
      ),
      jsonb_build_object(
        'teamPerformancePercent', v_team_percent,
        'assistantScorePercent', v_assistant_score,
        'warningThresholdPercent', v_warning_threshold
      )
    )
    on conflict (assistant_id, recommendation_type, period_end) do update
    set scorecard_id = excluded.scorecard_id,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        updated_at = now();
  end if;

  if v_team_percent is not null
     and v_team_percent < v_penalty_threshold
     and v_assistant_score < v_penalty_threshold then
    insert into public.compensation_recommendations (
      assistant_id,
      scorecard_id,
      recommendation_type,
      period_start,
      period_end,
      rationale,
      evidence
    ) values (
      p_assistant_id,
      v_assistant_scorecard_id,
      'penalty_review',
      v_report_date,
      v_report_date,
      format(
        'Amina recommends Director review for a performance penalty because both team performance (%s%%) and attributable assistant execution (%s%%) are below the %s%% company benchmark. This recommendation does not deduct pay automatically.',
        round(v_team_percent, 2),
        round(v_assistant_score, 2),
        round(v_penalty_threshold, 2)
      ),
      jsonb_build_object(
        'teamPerformancePercent', v_team_percent,
        'assistantScorePercent', v_assistant_score,
        'penaltyTriggerPercent', v_penalty_threshold,
        'automaticDeduction', false
      )
    )
    on conflict (assistant_id, recommendation_type, period_end) do update
    set scorecard_id = excluded.scorecard_id,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        updated_at = now();
  end if;

  with recent_team as (
    select report_date, terminal_activity_rate
    from public.portfolio_performance_snapshots
    where report_date <= v_report_date
    order by report_date desc
    limit v_bonus_days
  )
  select
    count(*) filter (where terminal_activity_rate >= v_bonus_threshold),
    coalesce(max(report_date) - min(report_date), 0)
  into v_bonus_team_days, v_bonus_span
  from recent_team;

  select count(*)
  into v_bonus_assistant_days
  from (
    select score_date, individual_score_percent
    from public.performance_scorecards
    where subject_key = 'assistant:' || p_assistant_id::text
      and score_date <= v_report_date
    order by score_date desc
    limit v_bonus_days
  ) recent_scores
  where individual_score_percent >= v_bonus_threshold;

  if v_bonus_team_days = v_bonus_days
     and v_bonus_assistant_days = v_bonus_days
     and v_bonus_span >= v_bonus_days - 1 then
    insert into public.compensation_recommendations (
      assistant_id,
      scorecard_id,
      recommendation_type,
      recommendation_percent,
      period_start,
      period_end,
      rationale,
      evidence
    ) values (
      p_assistant_id,
      v_assistant_scorecard_id,
      'bonus',
      v_bonus_percent,
      v_report_date - (v_bonus_days - 1),
      v_report_date,
      format(
        'Amina recommends a %s%% performance bonus after %s consecutive report days at or above the %s%% bonus threshold, with the assistant also sustaining that individual standard.',
        round(v_bonus_percent, 2),
        v_bonus_days,
        round(v_bonus_threshold, 2)
      ),
      jsonb_build_object(
        'bonusPercent', v_bonus_percent,
        'bonusThresholdPercent', v_bonus_threshold,
        'requiredDays', v_bonus_days,
        'teamDaysMet', v_bonus_team_days,
        'assistantDaysMet', v_bonus_assistant_days
      )
    )
    on conflict (assistant_id, recommendation_type, period_end) do update
    set scorecard_id = excluded.scorecard_id,
        recommendation_percent = excluded.recommendation_percent,
        rationale = excluded.rationale,
        evidence = excluded.evidence,
        updated_at = now();
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_kind,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    null,
    'amina',
    'performance_scorecards_refreshed',
    'profile',
    p_assistant_id::text,
    jsonb_build_object(
      'reportId', p_report_id,
      'scoreDate', v_report_date,
      'teamPerformancePercent', v_team_percent,
      'assistantScorePercent', v_assistant_score,
      'managementMode', v_mode,
      'emekaScorePercent', v_emeka_score,
      'zainabScorePercent', v_zainab_score,
      'tundeScorePercent', v_tunde_score
    )
  );

  v_result := jsonb_build_object(
    'reportId', p_report_id,
    'scoreDate', v_report_date,
    'teamPerformancePercent', v_team_percent,
    'assistantScorePercent', v_assistant_score,
    'managementMode', v_mode,
    'rating', v_rating,
    'emekaScorePercent', v_emeka_score,
    'zainabScorePercent', v_zainab_score,
    'tundeScorePercent', v_tunde_score,
    'bonusThresholdPercent', v_bonus_threshold,
    'bonusStreakDays', v_bonus_days,
    'bonusPercent', v_bonus_percent
  );

  return v_result;
end;
$$;

create or replace function public.upsert_agent_performance_scorecard(
  p_report_id uuid,
  p_score_date date,
  p_agent_kind text,
  p_team_percent numeric,
  p_individual_score numeric,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_rating text;
  v_message text;
  v_id uuid;
  v_display_name text;
begin
  if p_agent_kind not in ('emeka', 'zainab', 'tunde') then
    raise exception 'Unsupported specialist agent';
  end if;

  v_display_name := case p_agent_kind
    when 'emeka' then 'Emeka'
    when 'zainab' then 'Zainab'
    else 'Tunde'
  end;
  v_mode := public.amina_management_mode(
    case when p_team_percent is null then p_individual_score else least(p_team_percent, p_individual_score) end
  );
  v_rating := public.amina_performance_rating(p_individual_score);
  v_message := public.amina_message_for(
    v_display_name,
    p_team_percent,
    p_individual_score,
    v_mode
  );

  insert into public.performance_scorecards (
    report_id,
    score_date,
    subject_kind,
    subject_key,
    team_performance_percent,
    individual_score_percent,
    management_mode,
    rating,
    amina_message,
    evidence
  ) values (
    p_report_id,
    p_score_date,
    p_agent_kind,
    'agent:' || p_agent_kind,
    p_team_percent,
    p_individual_score,
    v_mode,
    v_rating,
    v_message,
    p_evidence
  )
  on conflict (report_id, subject_key) do update
  set team_performance_percent = excluded.team_performance_percent,
      individual_score_percent = excluded.individual_score_percent,
      management_mode = excluded.management_mode,
      rating = excluded.rating,
      amina_message = excluded.amina_message,
      evidence = excluded.evidence,
      updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.amina_score_after_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.agent_kind = 'amina'
     and new.status = 'completed'
     and old.status is distinct from new.status
     and new.assistant_id is not null
     and new.report_id is not null then
    begin
      perform public.refresh_amaina_management_scores(new.assistant_id, new.report_id);
    exception
      when others then
        insert into public.audit_events (
          actor_user_id,
          actor_kind,
          event_type,
          entity_type,
          entity_id,
          payload
        ) values (
          null,
          'amina',
          'performance_scoring_failed',
          'agent_run',
          new.id::text,
          jsonb_build_object('error', sqlerrm)
        );
    end;
  end if;
  return new;
end;
$$;

create trigger agent_runs_amaina_score_after_completion
after update of status on public.agent_runs
for each row execute function public.amina_score_after_run();

create or replace function public.review_compensation_recommendation(
  p_recommendation_id uuid,
  p_status text,
  p_director_note text default null
)
returns public.compensation_recommendations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.compensation_recommendations;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  if p_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Unsupported recommendation review status';
  end if;

  update public.compensation_recommendations
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      director_note = nullif(trim(coalesce(p_director_note, '')), '')
  where id = p_recommendation_id
    and status = 'pending_director'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Pending recommendation not found';
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_kind,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'director',
    'compensation_recommendation_reviewed',
    'compensation_recommendation',
    v_row.id::text,
    jsonb_build_object(
      'recommendationType', v_row.recommendation_type,
      'reviewStatus', v_row.status,
      'recommendationPercent', v_row.recommendation_percent
    )
  );

  return v_row;
end;
$$;

revoke all on function public.refresh_amaina_management_scores(uuid, uuid) from public;
grant execute on function public.refresh_amaina_management_scores(uuid, uuid) to authenticated;

revoke all on function public.review_compensation_recommendation(uuid, text, text) from public;
grant execute on function public.review_compensation_recommendation(uuid, text, text) to authenticated;

revoke all on function public.upsert_agent_performance_scorecard(uuid, date, text, numeric, numeric, jsonb) from public;
