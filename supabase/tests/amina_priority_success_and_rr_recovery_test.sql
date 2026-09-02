-- NOTE (see accompanying report): this repo's test suite is not currently
-- wired into CI (no pg_prove / `supabase db test` step in
-- .github/workflows/quality.yml), matching the existing
-- amina_activity_priority_test.sql. Included for local/manual verification
-- and for whoever wires up CI test execution.

begin;
select plan(11);

-- is_task_outcome_successful: TA only succeeds once verified by the
-- next-day official report, not merely self-reported completion.
select is(
  public.is_task_outcome_successful('TA', 'verified', null),
  true,
  'TA task is a success once verified'
);
select is(
  public.is_task_outcome_successful('TA', 'completed', 'reached_commitment'),
  false,
  'TA task merely completed (not yet verified) is not a success'
);
select is(
  public.is_task_outcome_successful('TA', 'discrepancy', null),
  false,
  'TA task flagged as a discrepancy is not a success'
);

-- LOAN only succeeds on an actual recorded disbursement.
select is(
  public.is_task_outcome_successful('LOAN', 'completed', 'loan_disbursed'),
  true,
  'LOAN task with a recorded disbursement is a success'
);
select is(
  public.is_task_outcome_successful('LOAN', 'completed', 'reached_commitment'),
  false,
  'LOAN task with only a conversation outcome (no disbursement) is not a success'
);

-- FOLLOW_UP ("other non-TA") succeeds on a completed call with a commitment.
select is(
  public.is_task_outcome_successful('FOLLOW_UP', 'completed', 'reached_commitment'),
  true,
  'FOLLOW_UP task completed with a reached commitment is a success'
);
select is(
  public.is_task_outcome_successful('FOLLOW_UP', 'completed', 'no_answer'),
  false,
  'FOLLOW_UP task completed without a commitment is not a success'
);
select is(
  public.is_task_outcome_successful('FOLLOW_UP', 'postponed', 'reached_commitment'),
  false,
  'FOLLOW_UP task not yet completed is not a success even with a positive outcome code'
);

select ok(
  to_regprocedure('public.is_task_outcome_successful(public.task_type,public.task_status,public.task_outcome_code)') is not null,
  'is_task_outcome_successful helper exists'
);
select ok(
  to_regprocedure('public.count_daily_task_successes(uuid,date)') is not null,
  'count_daily_task_successes RPC exists (the "7 daily task successes" target)'
);

-- The RR-recovery re-ranking is an extension of the existing
-- agent_recommendations_amina_activity_priority trigger, not a new one.
select ok(
  exists(
    select 1 from pg_trigger
    where tgname = 'agent_recommendations_amina_activity_priority' and not tgisinternal
  ),
  'Amina activity/RR-recovery ranking trigger is still attached to recommendation creation'
);

select * from finish();
rollback;
