-- Preserve status urgency, then keep target-recovery work together so the
-- highest-value active underperformers are worked before non-TA calls.

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
    raise exception 'run_operations_team queue-ranking baseline did not match';
  end if;

  execute v_definition;
end;
$$;
