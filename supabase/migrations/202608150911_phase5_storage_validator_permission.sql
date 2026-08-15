-- Storage RLS invokes this SECURITY DEFINER validator as anon. Granting execute exposes
-- only a boolean path check; it does not expose Vault secrets or automation run data.
grant execute on function public.is_valid_automation_upload_path(text) to anon;
