do $$
declare v_key text; v_req bigint;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name='monie_ops_browser_use_api_key' limit 1;
  select net.http_get(
    url:='https://api.browser-use.com/api/v2/tasks/de227200-c2d5-4554-8754-332e091f5d18',
    headers:=jsonb_build_object('X-Browser-Use-API-Key', v_key, 'Accept','application/json'),
    timeout_milliseconds:=8000
  ) into v_req;
  raise notice 'diag request %', v_req;
end $$;