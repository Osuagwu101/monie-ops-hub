-- Preserve status urgency, then keep target-recovery work together so the
-- highest-value active underperformers are worked before non-TA calls.
--
-- Replay note: this historical migration patches pg_get_functiondef() text.
-- PostgreSQL formatting can differ across versions, so a clean replay may not
-- find the exact source substring. The complete function is replaced safely by
-- 202609020001_amina_priority_success_and_rr_recovery.sql, which contains this
-- TA-first ordering. Therefore a non-match here is safe to skip during fresh
-- rebuilds instead of aborting the whole migration chain.

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
    'else 2 end,coalesce(r.score,t.priority*20) desc',
    'else 2 end,case when t.task_type=''TA''::public.task_type then 0 else 1 end,coalesce(r.score,t.priority*20) desc'
  );

  if v_definition = v_original then
    raise notice 'run_operations_team queue-ranking patch skipped; later full replacement migration preserves TA-first ordering';
  else
    execute v_definition;
  end if;
end;
$$;
