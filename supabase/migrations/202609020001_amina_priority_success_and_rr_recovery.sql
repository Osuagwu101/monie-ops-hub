-- Amina task-assignment update: daily success target, TA-priority gate, and
-- churned Top BO (RR recovery) ordering.
--
-- Scope note on how this migration is written: run_operations_team() has, since
-- 202609010002/202609010003, been evolved via `replace()` patches applied to its
-- own pg_get_functiondef() text rather than a plain CREATE OR REPLACE. Testing
-- that approach against a clean local replay of every migration in order shows
-- several of those replace() targets (written against a differently-formatted
-- copy of the function body) do not match and so silently do not apply, while
-- the migration's own guard does not catch it (multiple independent replace()
-- calls mean at least one nearly always matches, so the "did anything change"
-- check passes even when some individual replacements did not). This is a
-- pre-existing fragility in that pattern, not something introduced here -- it
-- is called out in the accompanying report for the Director/auditor to verify
-- against the real database independently. Because this change already has to
-- touch large parts of the same function, it is issued here as a single
-- ordinary CREATE OR REPLACE with the complete function body, which is not
-- subject to that class of bug. No behaviour is intentionally changed beyond
-- what is called out in inline comments below.

alter table public.operating_config
  add column if not exists top_bo_expected_transaction_count integer not null default 60
    check (top_bo_expected_transaction_count > 0),
  add column if not exists top_bo_retention_target_percent numeric(5,2) not null default 92
    check (top_bo_retention_target_percent between 0 and 100);

comment on column public.operating_config.top_bo_expected_transaction_count is
  'RR (retention) recovery: the transaction count a Top BO is expected to sustain. Used only to identify churned Top BOs and their transaction gap for recovery-queue ordering.';
comment on column public.operating_config.top_bo_retention_target_percent is
  'North-star target for Top BO Retention Rate (portfolio_performance_snapshots.top_bo_retention_rate). Informational; RR recovery ordering works to improve this metric but does not read it directly.';

CREATE OR REPLACE FUNCTION public.run_operations_team(p_assistant_id uuid, p_plan_date date DEFAULT NULL::date, p_report_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan_date date;
  v_report_id uuid;
  v_report_date date;
  v_assistant_name text;
  v_daily_target integer;
  v_ta_share_min numeric;
  v_ta_share_max numeric;
  v_ta_min_calls integer;
  v_ta_max_calls integer;
  v_ta_target integer;
  v_company_target numeric;
  v_team_standard numeric;
  v_emeka_run uuid;
  v_zainab_run uuid;
  v_tunde_run uuid;
  v_amina_run uuid;
  v_candidate record;
  v_rec record;
  v_previous record;
  v_recovery boolean;
  v_total_value numeric;
  v_gap_ratio numeric;
  v_score numeric;
  v_state text;
  v_emeka_count integer := 0;
  v_zainab_count integer := 0;
  v_tunde_attention integer := 0;
  v_monthly_loan_successes integer := 0;
  v_removed_unstarted integer := 0;
  v_locked_total integer := 0;
  v_locked_ta integer := 0;
  v_remaining integer := 0;
  v_ta_needed integer := 0;
  v_non_ta_needed integer := 0;
  v_ta_created integer := 0;
  v_non_ta_created integer := 0;
  v_loan_created integer := 0;
  v_contact_gap integer := 0;
  v_total_count integer := 0;
  v_ta_count integer := 0;
  v_non_ta_count integer := 0;
  v_ta_share numeric := 0;
  v_mix_compliant boolean := false;
  v_brief_id uuid;
  v_task_id uuid;
  v_previous_task_id uuid;
  v_ranked integer;
  v_top_bo_expected_count integer;
  v_terminal_activity_rate numeric;
  v_ta_below_standard boolean := false;
  v_ta_topup_created integer := 0;
begin
  if not public.is_director() then
    raise exception 'Director role required';
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

  v_plan_date := coalesce(p_plan_date, (now() at time zone 'Africa/Lagos')::date);

  select
    daily_call_target,
    ta_call_share_min,
    ta_call_share_max,
    company_target_percent,
    team_standard_percent,
    top_bo_expected_transaction_count
  into
    v_daily_target,
    v_ta_share_min,
    v_ta_share_max,
    v_company_target,
    v_team_standard,
    v_top_bo_expected_count
  from public.operating_config
  where id = true;

  if v_daily_target is null or v_daily_target <= 0 then
    raise exception 'Operating configuration is missing a valid daily call target';
  end if;

  v_ta_min_calls := ceil(v_daily_target * v_ta_share_min)::integer;
  v_ta_max_calls := floor(v_daily_target * v_ta_share_max)::integer;
  if v_ta_min_calls > v_ta_max_calls then
    raise exception 'TA share configuration cannot be satisfied with % daily calls', v_daily_target;
  end if;
  v_ta_target := floor((v_ta_min_calls + v_ta_max_calls) / 2.0)::integer;

  if p_report_id is not null then
    select id, report_date
    into v_report_id, v_report_date
    from public.report_imports
    where id = p_report_id
      and processing_status = 'processed';
  else
    select id, report_date
    into v_report_id, v_report_date
    from public.report_imports
    where processing_status = 'processed'
    order by report_date desc, imported_at desc
    limit 1;
  end if;

  if v_report_id is null then
    raise exception 'A processed Moniepoint report is required before the operations team can run';
  end if;

  -- Business-priority gate: TA (Terminal Activity) is the company's #1 metric.
  -- When the portfolio is below the team standard (operating_config.team_standard_percent,
  -- 77% by default), Amina focuses the whole day on TA and Loan recovery only and does
  -- not spend slots on other non-TA relationship work. Missing/uncaptured TA% for this
  -- report is treated as below standard (fail-safe: do not relax the restriction on
  -- incomplete data).
  select p.terminal_activity_rate
  into v_terminal_activity_rate
  from public.portfolio_performance_snapshots p
  where p.report_id = v_report_id;

  v_ta_below_standard := coalesce(v_terminal_activity_rate, 0) < v_team_standard;

  -- Replanning only removes untouched tasks that Amina created automatically.
  update public.agent_recommendations r
  set status = 'superseded'
  where r.id in (
    select t.source_agent_recommendation_id
    from public.tasks t
    where t.assigned_to = p_assistant_id
      and t.task_date = v_plan_date
      and t.auto_generated = true
      and t.status = 'assigned'::public.task_status
      and t.source_agent_recommendation_id is not null
  );

  delete from public.tasks
  where assigned_to = p_assistant_id
    and task_date = v_plan_date
    and auto_generated = true
    and status = 'assigned'::public.task_status;
  get diagnostics v_removed_unstarted = row_count;

  update public.agent_recommendations
  set status = 'superseded'
  where assigned_to = p_assistant_id
    and plan_date = v_plan_date
    and status = 'open';

  insert into public.agent_runs (
    agent_kind, report_id, plan_date, assistant_id, status, input_snapshot
  ) values (
    'emeka', v_report_id, v_plan_date, p_assistant_id, 'running',
    jsonb_build_object('reportDate', v_report_date, 'source', 'official_rolling_7_day')
  ) returning id into v_emeka_run;

  -- Emeka: score only terminals for which the official report gives a positive target.
  -- Official Target Met remains the truth; the internal gap/state only prioritises human effort.
  for v_candidate in
    -- Churned Top BO / RR (Retention Recovery) baseline: a terminal that has, at any
    -- point in the last 90 days, actually reached operating_config.top_bo_expected_
    -- transaction_count total transactions (payment + transfer volume, i.e. transaction
    -- COUNT, not currency value) is a proven Top BO. If it is now underperforming
    -- (already the condition for being an Emeka candidate at all), it is a churned Top
    -- BO and gets RR-recovery priority. This reuses the existing snapshot table only;
    -- it does not introduce a new "Top BO" table/flag.
    with top_bo_history as (
      select h.terminal_id
      from public.terminal_performance_snapshots h
      where h.period_kind = 'rolling_7_day'
        and h.report_date < v_report_date
        and h.report_date >= v_report_date - 90
        and (coalesce(h.payment_volume, 0) + coalesce(h.transfer_volume, 0)) >= v_top_bo_expected_count
      group by h.terminal_id
    )
    select
      s.id as snapshot_id,
      s.terminal_id,
      t.merchant_id,
      m.business_name,
      m.phone_number,
      s.payment_value,
      s.transfer_value,
      s.payment_volume,
      s.transfer_volume,
      s.official_target_value,
      s.official_target_met,
      s.days_since_last_transaction,
      (b.terminal_id is not null) as is_churned_top_bo,
      case when b.terminal_id is not null
        then greatest(0, v_top_bo_expected_count - (coalesce(s.payment_volume, 0) + coalesce(s.transfer_volume, 0)))
        else null
      end as rr_transaction_gap
    from public.terminal_performance_snapshots s
    join public.terminals t on t.id = s.terminal_id
    join public.merchants m on m.id = t.merchant_id
    left join top_bo_history b on b.terminal_id = s.terminal_id
    where s.report_id = v_report_id
      and s.period_kind = 'rolling_7_day'
      and s.official_target_value > 0
      and s.official_target_met = false
    order by
      -- Churned Top BOs are considered first, by the RR-recovery order the Director
      -- specified: (1) smallest transaction gap, (2) most recent activity, (3) higher
      -- historical transaction value on a tie. Ordinary (non-Top-BO) underperformers
      -- keep the exact original ordering below, completely unaffected.
      case when b.terminal_id is not null then 0 else 1 end,
      case when b.terminal_id is not null
        then greatest(0, v_top_bo_expected_count - (coalesce(s.payment_volume, 0) + coalesce(s.transfer_volume, 0)))
        else null
      end asc nulls last,
      case when b.terminal_id is not null then s.days_since_last_transaction else null end asc nulls last,
      case when b.terminal_id is not null
        then (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0))
        else null
      end desc nulls last,
      s.days_since_last_transaction desc,
      (s.payment_value + s.transfer_value) asc,
      t.terminal_id
  loop
    select exists (
      select 1
      from public.tasks previous_task
      where previous_task.terminal_id = v_candidate.terminal_id
        and previous_task.task_type = 'TA'::public.task_type
        and previous_task.task_date between v_plan_date - 2 and v_plan_date
        and previous_task.status in (
          'assigned'::public.task_status,
          'in_progress'::public.task_status,
          'postponed'::public.task_status,
          'deferred'::public.task_status
        )
    ) into v_recovery;

    v_total_value := coalesce(v_candidate.payment_value, 0) + coalesce(v_candidate.transfer_value, 0);
    v_gap_ratio := greatest(
      0,
      least(
        1,
        (v_candidate.official_target_value - v_total_value)
          / nullif(v_candidate.official_target_value, 0)
      )
    );
    v_state := public.phase4_terminal_state(
      v_candidate.official_target_met,
      v_candidate.days_since_last_transaction,
      v_total_value,
      v_candidate.official_target_value,
      v_recovery
    );
    v_score := greatest(
      0,
      least(
        100,
        35
          + (v_gap_ratio * 40)
          + least(coalesce(v_candidate.days_since_last_transaction, 0) * 5, 25)
          - case when v_state = 'recovery_in_progress' then 8 else 0 end
      )
    );

    insert into public.agent_recommendations (
      run_id,
      agent_kind,
      recommendation_kind,
      plan_date,
      report_id,
      assigned_to,
      merchant_id,
      terminal_id,
      evidence_snapshot_id,
      score,
      operational_state,
      title,
      rationale,
      talking_points,
      suggested_task_type,
      evidence
    ) values (
      v_emeka_run,
      'emeka',
      'ta_priority',
      v_plan_date,
      v_report_id,
      p_assistant_id,
      v_candidate.merchant_id,
      v_candidate.terminal_id,
      v_candidate.snapshot_id,
      round(v_score, 2),
      v_state,
      case when v_candidate.is_churned_top_bo
        then format('RR recovery: churned Top BO (%s more transactions needed)', v_candidate.rr_transaction_gap)
        else format('%s terminal recovery', initcap(replace(v_state, '_', ' ')))
      end,
      case when v_candidate.is_churned_top_bo then
        format(
          'This terminal previously reached Top BO transaction activity (%s+ transactions) within the last 90 days and has since fallen back to %s transactions -- a gap of %s toward the Top BO Retention Rate target. Official rolling Target Met = False. Current rolling value is ₦%s against the report target of ₦%s; days since last transaction: %s.',
          v_top_bo_expected_count,
          coalesce(v_candidate.payment_volume, 0) + coalesce(v_candidate.transfer_volume, 0),
          v_candidate.rr_transaction_gap,
          trim(to_char(v_total_value, 'FM999,999,999,990.00')),
          trim(to_char(v_candidate.official_target_value, 'FM999,999,999,990.00')),
          coalesce(v_candidate.days_since_last_transaction, 0)
        )
      else
        format(
          'Official rolling Target Met = False. Current rolling value is ₦%s against the report target of ₦%s; days since last transaction: %s.',
          trim(to_char(v_total_value, 'FM999,999,999,990.00')),
          trim(to_char(v_candidate.official_target_value, 'FM999,999,999,990.00')),
          coalesce(v_candidate.days_since_last_transaction, 0)
        )
      end,
      format(
        'Emeka: Confirm the terminal is available and working, ask what is limiting transactions, agree one practical same-day turnover action, and record any merchant commitment. Treat the official Target Met flag as the result authority.'
      ),
      'TA'::public.task_type,
      jsonb_build_object(
        'officialTargetMet', v_candidate.official_target_met,
        'officialTargetValue', v_candidate.official_target_value,
        'rollingValue', v_total_value,
        'estimatedGapRatio', round(v_gap_ratio, 4),
        'daysSinceLastTransaction', v_candidate.days_since_last_transaction,
        'phoneAvailable', v_candidate.phone_number is not null,
        'isChurnedTopBo', coalesce(v_candidate.is_churned_top_bo, false),
        'rrTransactionGap', v_candidate.rr_transaction_gap
      )
    );
    v_emeka_count := v_emeka_count + 1;
  end loop;

  select count(*)
  into v_contact_gap
  from public.agent_recommendations r
  join public.merchants m on m.id = r.merchant_id
  where r.run_id = v_emeka_run
    and nullif(trim(coalesce(m.phone_number, '')), '') is null;

  update public.agent_runs
  set status = 'completed',
      output_summary = jsonb_build_object(
        'taPriorities', v_emeka_count,
        'contactGaps', v_contact_gap,
        'truthRule', 'numeric_target_and_official_flag_confirm_underperformance'
      ),
      completed_at = now()
  where id = v_emeka_run;

  insert into public.agent_runs (
    agent_kind, report_id, plan_date, assistant_id, status, input_snapshot
  ) values (
    'zainab', v_report_id, v_plan_date, p_assistant_id, 'running',
    jsonb_build_object('lookbackDays', 21, 'minimumReportDays', 2, 'creditApproval', false)
  ) returning id into v_zainab_run;

  select count(*)
  into v_monthly_loan_successes
  from public.task_outcomes o
  join public.tasks t on t.id = o.task_id
  where t.task_type = 'LOAN'::public.task_type
    and o.outcome_code = 'loan_disbursed'::public.task_outcome_code
    and (o.submitted_at at time zone 'Africa/Lagos')::date
      >= date_trunc('month', v_plan_date::timestamp)::date
    and (o.submitted_at at time zone 'Africa/Lagos')::date
      < (date_trunc('month', v_plan_date::timestamp) + interval '1 month')::date;

  if v_monthly_loan_successes < 1 then
    for v_candidate in
      with merchant_history as (
        select
          t.merchant_id,
          count(distinct s.report_date)::integer as report_days,
          avg(case when s.official_target_met then 1.0 else 0.0 end)::numeric as target_met_rate,
          avg(coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0))::numeric as avg_rolling_value
        from public.terminal_performance_snapshots s
        join public.terminals t on t.id = s.terminal_id
        where s.period_kind = 'rolling_7_day'
          and s.report_date between v_plan_date - 21 and v_plan_date
          and s.official_target_value > 0
          and t.merchant_id is not null
        group by t.merchant_id
        having count(distinct s.report_date) >= 2
           and avg(case when s.official_target_met then 1.0 else 0.0 end) >= 0.75
           and avg(coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) >= 100000
      )
      select
        h.merchant_id,
        h.report_days,
        h.target_met_rate,
        h.avg_rolling_value,
        m.business_name,
        m.phone_number,
        latest.terminal_id,
        latest.snapshot_id
      from merchant_history h
      join public.merchants m on m.id = h.merchant_id
      join lateral (
        select s.terminal_id, s.id as snapshot_id
        from public.terminal_performance_snapshots s
        join public.terminals t on t.id = s.terminal_id
        where t.merchant_id = h.merchant_id
          and s.period_kind = 'rolling_7_day'
        order by s.report_date desc,
                 (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) desc
        limit 1
      ) latest on true
      where nullif(trim(coalesce(m.phone_number, '')), '') is not null
      order by h.target_met_rate desc, h.avg_rolling_value desc, m.business_name
      limit 10
    loop
      v_score := least(
        100,
        45 + (v_candidate.target_met_rate * 35)
          + least(v_candidate.avg_rolling_value / 25000, 20)
      );

      insert into public.agent_recommendations (
        run_id,
        agent_kind,
        recommendation_kind,
        plan_date,
        report_id,
        assigned_to,
        merchant_id,
        terminal_id,
        evidence_snapshot_id,
        score,
        operational_state,
        title,
        rationale,
        talking_points,
        suggested_task_type,
        evidence
      ) values (
        v_zainab_run,
        'zainab',
        'loan_opportunity',
        v_plan_date,
        v_report_id,
        p_assistant_id,
        v_candidate.merchant_id,
        v_candidate.terminal_id,
        v_candidate.snapshot_id,
        round(v_score, 2),
        'healthy',
        'Responsible lending conversation candidate',
        format(
          'Observed across %s report days with a %s%% Target Met rate and average rolling terminal value of ₦%s. This is a conversation signal only, not a credit decision.',
          v_candidate.report_days,
          round(v_candidate.target_met_rate * 100),
          trim(to_char(v_candidate.avg_rolling_value, 'FM999,999,999,990.00'))
        ),
        'Zainab: Ask whether working capital would solve a real business need. Explain that this is not an approval or promise of credit; eligibility, pricing and terms must come from the official Moniepoint lending process. Do not pressure the merchant to borrow.',
        'LOAN'::public.task_type,
        jsonb_build_object(
          'reportDays', v_candidate.report_days,
          'targetMetRate', round(v_candidate.target_met_rate, 4),
          'averageRollingValue', round(v_candidate.avg_rolling_value, 2),
          'creditApproval', false
        )
      );
      v_zainab_count := v_zainab_count + 1;
    end loop;
  end if;

  update public.agent_runs
  set status = 'completed',
      output_summary = jsonb_build_object(
        'loanConversationCandidates', v_zainab_count,
        'monthlySuccessfulLoansRecorded', v_monthly_loan_successes,
        'monthlyTarget', 1,
        'creditApproval', false
      ),
      completed_at = now()
  where id = v_zainab_run;

  insert into public.agent_runs (
    agent_kind, report_id, plan_date, assistant_id, status, input_snapshot
  ) values (
    'tunde', v_report_id, v_plan_date, p_assistant_id, 'running',
    jsonb_build_object('reportDate', v_report_date, 'authority', 'official_report_only')
  ) returning id into v_tunde_run;

  for v_candidate in
    select
      v.task_id,
      v.state,
      v.rationale,
      v.evidence_snapshot_id,
      t.merchant_id,
      t.terminal_id
    from public.task_verifications v
    join public.tasks t on t.id = v.task_id
    where v.verified_against_report_id = v_report_id
      and t.assigned_to = p_assistant_id
      and v.state <> 'verified'::public.verification_state
    order by
      case v.state
        when 'discrepancy'::public.verification_state then 1
        when 'unverifiable'::public.verification_state then 2
        else 3
      end,
      v.verified_at desc
  loop
    v_score := case v_candidate.state
      when 'discrepancy'::public.verification_state then 95
      when 'unverifiable'::public.verification_state then 80
      else 60
    end;

    insert into public.agent_recommendations (
      run_id,
      agent_kind,
      recommendation_kind,
      plan_date,
      report_id,
      assigned_to,
      merchant_id,
      terminal_id,
      evidence_snapshot_id,
      score,
      title,
      rationale,
      talking_points,
      evidence
    ) values (
      v_tunde_run,
      'tunde',
      'verification_attention',
      v_plan_date,
      v_report_id,
      p_assistant_id,
      v_candidate.merchant_id,
      v_candidate.terminal_id,
      v_candidate.evidence_snapshot_id,
      v_score,
      format('Tunde: %s', initcap(v_candidate.state::text)),
      v_candidate.rationale,
      'Tunde: This is an evidence state, not a punishment. Use the official report outcome to decide whether the case needs another operational intervention.',
      jsonb_build_object('verificationState', v_candidate.state)
    );
    v_tunde_attention := v_tunde_attention + 1;
  end loop;

  update public.agent_runs
  set status = 'completed',
      output_summary = jsonb_build_object(
        'attentionItems', v_tunde_attention,
        'authority', 'official_report_only'
      ),
      completed_at = now()
  where id = v_tunde_run;

  insert into public.agent_runs (
    agent_kind, report_id, plan_date, assistant_id, status, input_snapshot
  ) values (
    'amina', v_report_id, v_plan_date, p_assistant_id, 'running',
    jsonb_build_object(
      'dailyCallTarget', v_daily_target,
      'taShareMin', v_ta_share_min,
      'taShareMax', v_ta_share_max,
      'taCallTarget', v_ta_target,
      'companyTargetPercent', v_company_target,
      'teamStandardPercent', v_team_standard,
      'replacedUntouchedAutoTasks', v_removed_unstarted
    )
  ) returning id into v_amina_run;

  select
    count(*),
    count(*) filter (where task_type = 'TA'::public.task_type)
  into v_locked_total, v_locked_ta
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = v_plan_date;

  v_remaining := greatest(0, v_daily_target - v_locked_total);
  v_ta_needed := greatest(0, v_ta_target - v_locked_ta);
  v_ta_needed := least(v_ta_needed, v_remaining);
  v_non_ta_needed := greatest(0, v_remaining - v_ta_needed);

  -- Amina accepts Emeka's highest-scoring contactable TA priorities first.
  for v_rec in
    select r.*
    from public.agent_recommendations r
    join public.merchants m on m.id = r.merchant_id
    where r.run_id = v_emeka_run
      and r.status = 'open'
      and nullif(trim(coalesce(m.phone_number, '')), '') is not null
      and not exists (
        select 1 from public.tasks t
        where t.assigned_to = p_assistant_id
          and t.task_date = v_plan_date
          and t.terminal_id = r.terminal_id
      )
    order by r.score desc, r.created_at
    limit v_ta_needed
  loop
    v_previous_task_id := null;
    select previous_task.id
    into v_previous_task_id
    from public.tasks previous_task
    where previous_task.assigned_to = p_assistant_id
      and previous_task.terminal_id = v_rec.terminal_id
      and previous_task.task_date < v_plan_date
      and previous_task.status in (
        'postponed'::public.task_status,
        'discrepancy'::public.task_status,
        'deferred'::public.task_status,
        'unverifiable'::public.task_status
      )
    order by previous_task.task_date desc, previous_task.created_at desc
    limit 1;

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
      rolled_from_task_id,
      created_by,
      auto_generated,
      planning_report_id,
      source_agent_recommendation_id
    ) values (
      v_plan_date,
      'TA'::public.task_type,
      'assigned'::public.task_status,
      case when v_rec.score >= 85 then 5 when v_rec.score >= 70 then 4 else 3 end,
      v_rec.merchant_id,
      v_rec.terminal_id,
      p_assistant_id,
      v_rec.rationale,
      v_rec.talking_points,
      v_previous_task_id,
      auth.uid(),
      true,
      v_report_id,
      v_rec.id
    ) returning id into v_task_id;

    update public.agent_recommendations set status = 'accepted' where id = v_rec.id;
    v_ta_created := v_ta_created + 1;
  end loop;

  -- Urgent postponed non-TA work returns before new relationship work.
  if v_non_ta_needed > 0 then
    for v_previous in
      select
        t.*,
        o.callback_at,
        o.postponement_reason
      from public.tasks t
      left join lateral (
        select outcome.callback_at, outcome.postponement_reason
        from public.task_outcomes outcome
        where outcome.task_id = t.id
        order by outcome.submitted_at desc
        limit 1
      ) o on true
      where t.assigned_to = p_assistant_id
        and t.task_date < v_plan_date
        and t.task_type <> 'TA'::public.task_type
        -- TA below the team standard: only Loan work may return here, per the
        -- Director's priority policy (TA, then Loan, then other non-TA only once
        -- TA recovers). This does not touch how postponed TA work is handled.
        and (not v_ta_below_standard or t.task_type = 'LOAN'::public.task_type)
        and t.status = 'postponed'::public.task_status
        and (
          t.priority >= 4
          or o.callback_at is null
          or (o.callback_at at time zone 'Africa/Lagos')::date <= v_plan_date
        )
        and not exists (
          select 1 from public.tasks child
          where child.rolled_from_task_id = t.id
            and child.task_date = v_plan_date
        )
      order by t.priority desc, o.callback_at nulls first, t.task_date desc
      limit v_non_ta_needed
    loop
      insert into public.agent_recommendations (
        run_id,
        agent_kind,
        recommendation_kind,
        plan_date,
        report_id,
        assigned_to,
        merchant_id,
        terminal_id,
        score,
        title,
        rationale,
        talking_points,
        suggested_task_type,
        evidence
      ) values (
        v_amina_run,
        'amina',
        'relationship_follow_up',
        v_plan_date,
        v_report_id,
        p_assistant_id,
        v_previous.merchant_id,
        v_previous.terminal_id,
        least(100, v_previous.priority * 20 + 10),
        'Return an unresolved merchant follow-up',
        coalesce(v_previous.postponement_reason, 'Previous non-TA task remains unresolved.'),
        v_previous.recommended_talking_points,
        v_previous.task_type,
        jsonb_build_object('rolledFromTaskId', v_previous.id)
      ) returning id into v_brief_id;

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
        rolled_from_task_id,
        created_by,
        auto_generated,
        planning_report_id,
        source_agent_recommendation_id
      ) values (
        v_plan_date,
        v_previous.task_type,
        'assigned'::public.task_status,
        least(v_previous.priority + 1, 5),
        v_previous.merchant_id,
        v_previous.terminal_id,
        p_assistant_id,
        coalesce(v_previous.postponement_reason, 'Unresolved follow-up returned by Amina.'),
        v_previous.recommended_talking_points,
        v_previous.id,
        auth.uid(),
        true,
        v_report_id,
        v_brief_id
      );

      update public.agent_recommendations set status = 'accepted' where id = v_brief_id;
      v_non_ta_created := v_non_ta_created + 1;
    end loop;
  end if;

  v_non_ta_needed := greatest(0, v_non_ta_needed - v_non_ta_created);

  -- Zainab contributes at most one lending conversation to a daily plan.
  if v_non_ta_needed > 0 and v_monthly_loan_successes < 1 then
    select r.*
    into v_rec
    from public.agent_recommendations r
    where r.run_id = v_zainab_run
      and r.status = 'open'
      and not exists (
        select 1 from public.tasks t
        where t.assigned_to = p_assistant_id
          and t.task_date = v_plan_date
          and t.merchant_id = r.merchant_id
      )
    order by r.score desc, r.created_at
    limit 1;

    if v_rec.id is not null then
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
        created_by,
        auto_generated,
        planning_report_id,
        source_agent_recommendation_id
      ) values (
        v_plan_date,
        'LOAN'::public.task_type,
        'assigned'::public.task_status,
        3,
        v_rec.merchant_id,
        v_rec.terminal_id,
        p_assistant_id,
        v_rec.rationale,
        v_rec.talking_points,
        auth.uid(),
        true,
        v_report_id,
        v_rec.id
      );
      update public.agent_recommendations set status = 'accepted' where id = v_rec.id;
      v_non_ta_created := v_non_ta_created + 1;
      v_loan_created := 1;
    end if;
  end if;

  v_non_ta_needed := greatest(0, v_non_ta_needed - v_loan_created);

  -- Fill remaining non-TA slots with relationship-protection calls to healthy,
  -- contactable businesses. These are not lending recommendations. Skipped entirely
  -- while TA is below the team standard: Director policy is TA and Loan work only
  -- until TA recovers, so this "other non-TA" bucket is not offered at all.
  if v_non_ta_needed > 0 and not v_ta_below_standard then
    for v_candidate in
      select
        s.id as snapshot_id,
        s.terminal_id,
        t.merchant_id,
        m.business_name,
        (coalesce(s.payment_value, 0) + coalesce(s.transfer_value, 0)) as rolling_value
      from public.terminal_performance_snapshots s
      join public.terminals t on t.id = s.terminal_id
      join public.merchants m on m.id = t.merchant_id
      where s.report_id = v_report_id
        and s.period_kind = 'rolling_7_day'
        and s.official_target_met = true
        and nullif(trim(coalesce(m.phone_number, '')), '') is not null
        and not exists (
          select 1 from public.tasks existing_task
          where existing_task.assigned_to = p_assistant_id
            and existing_task.task_date = v_plan_date
            and existing_task.merchant_id = t.merchant_id
        )
      order by rolling_value desc, m.business_name
      limit v_non_ta_needed
    loop
      v_score := least(100, 55 + least(v_candidate.rolling_value / 20000, 35));

      insert into public.agent_recommendations (
        run_id,
        agent_kind,
        recommendation_kind,
        plan_date,
        report_id,
        assigned_to,
        merchant_id,
        terminal_id,
        evidence_snapshot_id,
        score,
        operational_state,
        title,
        rationale,
        talking_points,
        suggested_task_type,
        evidence,
        status
      ) values (
        v_amina_run,
        'amina',
        'relationship_follow_up',
        v_plan_date,
        v_report_id,
        p_assistant_id,
        v_candidate.merchant_id,
        v_candidate.terminal_id,
        v_candidate.snapshot_id,
        round(v_score, 2),
        'healthy',
        'Protect a healthy merchant relationship',
        format(
          'Official rolling Target Met = True with rolling terminal value of ₦%s. Use this call to protect retention, surface service issues early and keep the relationship warm.',
          trim(to_char(v_candidate.rolling_value, 'FM999,999,999,990.00'))
        ),
        'Amina: Thank the merchant for their activity, ask whether anything is affecting service quality or future transaction flow, and capture any issue that the team should act on.',
        'FOLLOW_UP'::public.task_type,
        jsonb_build_object('officialTargetMet', true, 'rollingValue', v_candidate.rolling_value),
        'accepted'
      ) returning id into v_brief_id;

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
        created_by,
        auto_generated,
        planning_report_id,
        source_agent_recommendation_id
      ) values (
        v_plan_date,
        'FOLLOW_UP'::public.task_type,
        'assigned'::public.task_status,
        2,
        v_candidate.merchant_id,
        v_candidate.terminal_id,
        p_assistant_id,
        'Relationship-protection call selected by Amina from an officially healthy terminal.',
        'Thank the merchant for their activity, ask about service quality and future transaction flow, and record any issue requiring follow-up.',
        auth.uid(),
        true,
        v_report_id,
        v_brief_id
      );
      v_non_ta_created := v_non_ta_created + 1;
    end loop;
  end if;

  -- TA below the team standard: any daily slots freed up by skipping "other
  -- non-TA" work (above) are redirected into more TA recovery -- Director policy
  -- is to focus the whole day on TA and Loan only until TA recovers, not to leave
  -- the daily plan under-filled. Reuses the exact same TA-acceptance mechanism as
  -- the main TA loop above (same recommendation pool, same insert shape), just
  -- picking up the next-highest-scoring open TA recommendations it did not
  -- already take.
  if v_ta_below_standard and v_non_ta_needed > 0 then
    for v_rec in
      select r.*
      from public.agent_recommendations r
      join public.merchants m on m.id = r.merchant_id
      where r.run_id = v_emeka_run
        and r.status = 'open'
        and nullif(trim(coalesce(m.phone_number, '')), '') is not null
        and not exists (
          select 1 from public.tasks t
          where t.assigned_to = p_assistant_id
            and t.task_date = v_plan_date
            and t.terminal_id = r.terminal_id
        )
      order by r.score desc, r.created_at
      limit v_non_ta_needed
    loop
      v_previous_task_id := null;
      select previous_task.id
      into v_previous_task_id
      from public.tasks previous_task
      where previous_task.assigned_to = p_assistant_id
        and previous_task.terminal_id = v_rec.terminal_id
        and previous_task.task_date < v_plan_date
        and previous_task.status in (
          'postponed'::public.task_status,
          'discrepancy'::public.task_status,
          'deferred'::public.task_status,
          'unverifiable'::public.task_status
        )
      order by previous_task.task_date desc, previous_task.created_at desc
      limit 1;

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
        rolled_from_task_id,
        created_by,
        auto_generated,
        planning_report_id,
        source_agent_recommendation_id
      ) values (
        v_plan_date,
        'TA'::public.task_type,
        'assigned'::public.task_status,
        case when v_rec.score >= 85 then 5 when v_rec.score >= 70 then 4 else 3 end,
        v_rec.merchant_id,
        v_rec.terminal_id,
        p_assistant_id,
        v_rec.rationale,
        v_rec.talking_points,
        v_previous_task_id,
        auth.uid(),
        true,
        v_report_id,
        v_rec.id
      ) returning id into v_task_id;

      update public.agent_recommendations set status = 'accepted' where id = v_rec.id;
      v_ta_created := v_ta_created + 1;
      v_ta_topup_created := v_ta_topup_created + 1;
    end loop;
  end if;

  -- Re-rank the full day without changing any human outcome or verification state.
  update public.tasks
  set queue_rank = null
  where assigned_to = p_assistant_id
    and task_date = v_plan_date;

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
          -- Keep TA recovery work ahead of non-TA work in the visible queue order
          -- (matches the intent of the previously merged 202609010003 fix).
          case when t.task_type = 'TA'::public.task_type then 0 else 1 end,
          coalesce(r.score, t.priority * 20) desc,
          t.priority desc,
          t.created_at
      ) as rank_value
    from public.tasks t
    left join public.agent_recommendations r on r.id = t.source_agent_recommendation_id
    where t.assigned_to = p_assistant_id
      and t.task_date = v_plan_date
  )
  update public.tasks t
  set queue_rank = ranked.rank_value::smallint
  from ranked
  where t.id = ranked.id
    and ranked.rank_value <= 7;
  get diagnostics v_ranked = row_count;

  select
    count(*),
    count(*) filter (where task_type = 'TA'::public.task_type),
    count(*) filter (where task_type <> 'TA'::public.task_type)
  into v_total_count, v_ta_count, v_non_ta_count
  from public.tasks
  where assigned_to = p_assistant_id
    and task_date = v_plan_date;

  if v_total_count > 0 then
    v_ta_share := v_ta_count::numeric / v_total_count::numeric;
  else
    v_ta_share := 0;
  end if;

  v_mix_compliant := (
    v_total_count = v_daily_target
    and v_ta_count between v_ta_min_calls and v_ta_max_calls
  );

  insert into public.agent_recommendations (
    run_id,
    agent_kind,
    recommendation_kind,
    plan_date,
    report_id,
    assigned_to,
    score,
    title,
    rationale,
    talking_points,
    evidence,
    status
  ) values (
    v_amina_run,
    'amina',
    'operations_brief',
    v_plan_date,
    v_report_id,
    p_assistant_id,
    case when v_mix_compliant then 100 else 60 end,
    case
      when v_mix_compliant then format('%s-call plan ready', v_daily_target)
      else format('Plan needs attention: %s of %s calls ready', v_total_count, v_daily_target)
    end,
    format(
      'Amina prepared %s total calls: %s TA and %s non-TA. Target mix is %s-%s TA calls. %s assigned tasks currently lack phone numbers.',
      v_total_count,
      v_ta_count,
      v_non_ta_count,
      v_ta_min_calls,
      v_ta_max_calls,
      v_contact_gap
    ),
    case
      when v_mix_compliant then 'Amina: Work the queue from the top. Fresh official reports may reorder untouched tasks; started or completed work will not be erased.'
      else 'Amina: Work the ranked queue. The Director can add missing phone and POS details directly from Daily Tasks.'
    end,
    jsonb_build_object(
      'dailyCallTarget', v_daily_target,
      'totalCalls', v_total_count,
      'taCalls', v_ta_count,
      'nonTaCalls', v_non_ta_count,
      'taShare', round(v_ta_share, 4),
      'taMinCalls', v_ta_min_calls,
      'taMaxCalls', v_ta_max_calls,
      'mixCompliant', v_mix_compliant,
      'taBelowStandard', v_ta_below_standard,
      'terminalActivityRate', v_terminal_activity_rate,
      'taTopupCreated', v_ta_topup_created,
      'contactGaps', v_contact_gap,
      'monthlySuccessfulLoansRecorded', v_monthly_loan_successes,
      'companyTargetPercent', v_company_target,
      'teamStandardPercent', v_team_standard
    ),
    'accepted'
  ) returning id into v_brief_id;

  update public.agent_runs
  set status = 'completed',
      output_summary = jsonb_build_object(
        'dailyCallTarget', v_daily_target,
        'totalCalls', v_total_count,
        'taCalls', v_ta_count,
        'nonTaCalls', v_non_ta_count,
        'taShare', round(v_ta_share, 4),
        'taMinCalls', v_ta_min_calls,
        'taMaxCalls', v_ta_max_calls,
        'mixCompliant', v_mix_compliant,
        'taBelowStandard', v_ta_below_standard,
        'terminalActivityRate', v_terminal_activity_rate,
        'taTopupCreated', v_ta_topup_created,
        'contactGaps', v_contact_gap,
        'rankedTasks', v_ranked,
        'replacedUntouchedAutoTasks', v_removed_unstarted
      ),
      completed_at = now()
  where id = v_amina_run;

  insert into public.audit_events (
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values
    (
      null, 'emeka', 'agent_run_completed', 'agent_run', v_emeka_run::text,
      jsonb_build_object('report_id', v_report_id, 'priorities', v_emeka_count)
    ),
    (
      null, 'zainab', 'agent_run_completed', 'agent_run', v_zainab_run::text,
      jsonb_build_object('report_id', v_report_id, 'candidates', v_zainab_count)
    ),
    (
      null, 'tunde', 'agent_run_completed', 'agent_run', v_tunde_run::text,
      jsonb_build_object('report_id', v_report_id, 'attention_items', v_tunde_attention)
    ),
    (
      null, 'amina', 'daily_plan_generated', 'agent_run', v_amina_run::text,
      jsonb_build_object(
        'report_id', v_report_id,
        'plan_date', v_plan_date,
        'assistant_id', p_assistant_id,
        'total_calls', v_total_count,
        'ta_calls', v_ta_count,
        'non_ta_calls', v_non_ta_count,
        'mix_compliant', v_mix_compliant,
        'contact_gaps', v_contact_gap
      )
    );

  return jsonb_build_object(
    'reportId', v_report_id,
    'reportDate', v_report_date,
    'planDate', v_plan_date,
    'assistantId', p_assistant_id,
    'assistantName', v_assistant_name,
    'runs', jsonb_build_object(
      'emeka', v_emeka_run,
      'zainab', v_zainab_run,
      'tunde', v_tunde_run,
      'amina', v_amina_run
    ),
    'emekaPriorities', v_emeka_count,
    'zainabCandidates', v_zainab_count,
    'tundeAttentionItems', v_tunde_attention,
    'monthlySuccessfulLoansRecorded', v_monthly_loan_successes,
    'contactGaps', v_contact_gap,
    'dailyCallTarget', v_daily_target,
    'totalCalls', v_total_count,
    'taCalls', v_ta_count,
    'nonTaCalls', v_non_ta_count,
    'taShare', round(v_ta_share, 4),
    'taMinCalls', v_ta_min_calls,
    'taMaxCalls', v_ta_max_calls,
    'mixCompliant', v_mix_compliant,
    'taBelowStandard', v_ta_below_standard,
    'terminalActivityRate', v_terminal_activity_rate,
    'taTopupCreated', v_ta_topup_created,
    'replacedUntouchedAutoTasks', v_removed_unstarted,
    'briefRecommendationId', v_brief_id
  );
end;
$function$;


-- Extend Amina's existing activity-first re-ranking trigger (from
-- 202609010001) with churned-Top-BO / RR-recovery priority. This is the same
-- mechanism already used to keep agent_recommendations.score deterministic
-- and tie-break-safe (it converts a full row_number() ordering into a
-- strictly decreasing score, so ties never fall back to ambiguous ordering);
-- it is not a new selection/ranking system.
create or replace function public.apply_amina_activity_priority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.agent_kind = 'emeka' and new.recommendation_kind = 'ta_priority' then
    -- Amina's existing assignment queries order by score descending. Re-rank
    -- the complete run after each candidate is recorded, using exact rolling
    -- value before converting the result to the existing 0..100 score field.
    with ranked as (
      select
        r.id,
        row_number() over (
          order by
            -- Churned Top BOs (evidence.isChurnedTopBo = true, set by
            -- run_operations_team) are prioritised ahead of everything else,
            -- ordered by: (1) smallest transaction gap to recovery, (2) most
            -- recent transaction activity, (3) higher historical value on a
            -- tie. These keys are null for every other row, so they leave the
            -- existing ordering below completely unchanged for them.
            case when coalesce((r.evidence ->> 'isChurnedTopBo')::boolean, false) then 0 else 1 end,
            case when coalesce((r.evidence ->> 'isChurnedTopBo')::boolean, false)
              then coalesce((r.evidence ->> 'rrTransactionGap')::numeric, 2147483647)
              else null
            end asc nulls last,
            case when coalesce((r.evidence ->> 'isChurnedTopBo')::boolean, false)
              then case when jsonb_typeof(r.evidence -> 'daysSinceLastTransaction') = 'number'
                then (r.evidence ->> 'daysSinceLastTransaction')::integer else 2147483647 end
              else null
            end asc nulls last,
            case when coalesce((r.evidence ->> 'isChurnedTopBo')::boolean, false)
              then coalesce((r.evidence ->> 'rollingValue')::numeric, 0)
              else null
            end desc nulls last,
            case
              when public.amina_activity_priority_value(
                case when jsonb_typeof(r.evidence -> 'rollingValue') = 'number'
                  then (r.evidence ->> 'rollingValue')::numeric else 0 end
              ) > 0 then 0
              else 1
            end,
            public.amina_activity_priority_value(
              case when jsonb_typeof(r.evidence -> 'rollingValue') = 'number'
                then (r.evidence ->> 'rollingValue')::numeric else 0 end
            ) desc,
            case when jsonb_typeof(r.evidence -> 'daysSinceLastTransaction') = 'number'
              then (r.evidence ->> 'daysSinceLastTransaction')::integer else 2147483647 end,
            r.created_at,
            r.id
        ) as position
      from public.agent_recommendations r
      where r.run_id = new.run_id
        and r.recommendation_kind = 'ta_priority'
        and case when jsonb_typeof(r.evidence -> 'officialTargetMet') = 'boolean'
          then (r.evidence ->> 'officialTargetMet')::boolean else false end = false
    )
    update public.agent_recommendations r
    set score = greatest(0.01, 100 - ((ranked.position - 1) * 0.01))
    from ranked
    where r.id = ranked.id;
  end if;
  return new;
end;
$$;

-- Daily task "success" (requirement: 7/day, NOT limited to TA recoveries).
-- Reuses the existing task/task_outcomes model only; no new tables.
--   TA        success = the next-day official report confirmed Target Met
--             (tasks.status = 'verified', already set by
--             reconcile_ta_tasks_for_report -- self-reported completion alone
--             is not enough).
--   LOAN      success = a disbursement was recorded on the task
--             (task_outcomes.outcome_code = 'loan_disbursed' -- the same
--             signal run_operations_team already trusts elsewhere for its
--             monthly loan target).
--   FOLLOW_UP success ("approved non-TA task") = the assistant completed the
--             call and the merchant gave a commitment
--             (task_outcomes.outcome_code = 'reached_commitment' with
--             tasks.status = 'completed'). There is no separate Director
--             "approval" step for FOLLOW_UP tasks in the current system, so
--             this is the closest existing positive-outcome signal; flagged
--             explicitly in the accompanying report as an assumption to
--             confirm with the Director.
create or replace function public.is_task_outcome_successful(
  p_task_type public.task_type,
  p_task_status public.task_status,
  p_outcome_code public.task_outcome_code
)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- Wrapped in coalesce(..., false): p_outcome_code is NULL for a LOAN task
  -- with no outcome recorded yet (or a FOLLOW_UP in an unexpected state), and
  -- `null = 'x'` is SQL NULL, not false. A WHERE clause treats NULL the same
  -- as false, so count_daily_task_successes was never actually affected by
  -- this, but the function is declared to return boolean and is meant to be
  -- reusable outside a WHERE clause (e.g. negated with NOT), so it must never
  -- hand back an "unknown" third value.
  select coalesce(
    case p_task_type
      when 'TA'::public.task_type then p_task_status = 'verified'::public.task_status
      when 'LOAN'::public.task_type then p_outcome_code = 'loan_disbursed'::public.task_outcome_code
      when 'FOLLOW_UP'::public.task_type then
        p_task_status = 'completed'::public.task_status
        and p_outcome_code = 'reached_commitment'::public.task_outcome_code
      else false
    end,
    false
  );
$$;

-- Count of successful tasks (per is_task_outcome_successful above) for one
-- assistant on one day, across TA, LOAN and FOLLOW_UP alike -- the "7 daily
-- task successes" target. security invoker so it is governed by the same RLS
-- (tasks_read_own_or_director / outcomes_read_own_or_director) as any direct
-- query against these tables: an assistant can only count their own day, a
-- Director can count any assistant's day.
create or replace function public.count_daily_task_successes(
  p_assistant_id uuid,
  p_task_date date default null
)
returns integer
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_task_date date := coalesce(p_task_date, (now() at time zone 'Africa/Lagos')::date);
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_assistant_id <> auth.uid() and not public.is_director() then
    raise exception 'Not authorized to view this assistant''s daily progress';
  end if;

  select count(*)
  into v_count
  from public.tasks t
  left join lateral (
    select o.outcome_code
    from public.task_outcomes o
    where o.task_id = t.id
    order by o.submitted_at desc
    limit 1
  ) latest_outcome on true
  where t.assigned_to = p_assistant_id
    and t.task_date = v_task_date
    and public.is_task_outcome_successful(t.task_type, t.status, latest_outcome.outcome_code);

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.count_daily_task_successes(uuid, date) from public, anon;
grant execute on function public.count_daily_task_successes(uuid, date) to authenticated;
