do $$
declare v_result jsonb;
begin
  select public.queue_automation_run_internal('manual', now(), true) into v_result;
  raise notice 'queue result: %', v_result;
end $$;