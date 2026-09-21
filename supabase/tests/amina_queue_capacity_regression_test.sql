-- Regression coverage for the 15-contact queue / 7-success operating rule.
-- These assertions run against a fully replayed local Supabase schema in CI.

begin;
select plan(9);

select ok(
  to_regprocedure('public.run_operations_team_with_capacity(uuid,date,uuid)') is not null,
  'Director manual re-plan wrapper exists'
);

select ok(
  position(
    'extend_human_support_queue'
    in pg_get_functiondef(
      'public.run_operations_team_with_capacity(uuid,date,uuid)'::regprocedure
    )
  ) > 0,
  'Manual Run Team always extends the queue after the seven-success plan'
);

select ok(
  position(
    'daily_contact_capacity'
    in pg_get_functiondef(
      'public.extend_human_support_queue(uuid,date,uuid)'::regprocedure
    )
  ) > 0,
  'Queue extension reads the configured daily contact capacity'
);

select ok(
  position(
    'set queue_rank = null'
    in lower(pg_get_functiondef(
      'public.extend_human_support_queue(uuid,date,uuid)'::regprocedure
    ))
  ) > 0,
  'Queue extension normalizes existing ranks before rebuilding the queue'
);

select ok(
  position(
    'ranked.position <= v_capacity'
    in pg_get_functiondef(
      'public.extend_human_support_queue(uuid,date,uuid)'::regprocedure
    )
  ) > 0,
  'Queue ranks are rebuilt through configured capacity instead of stopping at seven'
);

select ok(
  position(
    '''requiredTarget'', 7'
    in pg_get_functiondef(
      'public.extend_human_support_queue(uuid,date,uuid)'::regprocedure
    )
  ) > 0,
  'Seven remains the required daily success target'
);

select is(
  (select daily_contact_capacity from public.operating_config where id = true),
  15,
  'Default operating queue capacity remains 15 contacts'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'tasks_queue_rank_check'
      and pg_get_constraintdef(oid) like '%15%'
  ),
  'Task queue rank constraint still permits ranks through 15'
);

select ok(
  to_regprocedure('public.count_daily_task_successes(uuid,date)') is not null,
  'Seven-success counting RPC remains installed'
);

select * from finish();
rollback;
