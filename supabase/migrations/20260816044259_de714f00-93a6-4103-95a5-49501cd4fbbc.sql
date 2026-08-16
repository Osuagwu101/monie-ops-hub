do $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = public.automation_secret_name('browser_use_api_key')
  limit 1;

  if v_key is null then
    raise notice 'browser use key not configured';
    return;
  end if;

  perform net.http_get(
    url := 'https://api.browser-use.com/api/v2/tasks/cb6e518e-16d6-403a-aca3-7266391b13d9',
    headers := jsonb_build_object(
      'Accept', 'application/json',
      'X-Browser-Use-API-Key', v_key
    )
  );
end
$$;