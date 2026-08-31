create or replace function public.automation_browser_session_context(p_token text, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $function$
declare
  v_run public.automation_runs;
  v_api_key text;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select * into v_run from public.automation_runs where id = p_run_id;
  if v_run.id is null then raise exception 'Automation run not found'; end if;
  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'monie_ops_browser_use_api_key' limit 1;
  if v_api_key is null then raise exception 'Browser Use API key is not configured'; end if;
  return jsonb_build_object(
    'runId', v_run.id,
    'browserSessionId', v_run.browser_session_id,
    'browserTaskId', v_run.browser_task_id,
    'browserUseApiKey', v_api_key
  );
end;
$function$;

revoke all on function public.automation_browser_session_context(text, uuid) from public, anon, authenticated;
grant execute on function public.automation_browser_session_context(text, uuid) to anon, authenticated, service_role;