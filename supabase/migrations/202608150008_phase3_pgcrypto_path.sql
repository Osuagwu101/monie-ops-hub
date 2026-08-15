-- Phase 3 rollback execution audit fix.
-- Supabase installs pgcrypto functions in the controlled `extensions` schema.
-- Keep the SECURITY DEFINER function's search path explicit while allowing the
-- merchant identity hash to resolve extensions.digest().

alter function public.ingest_moniepoint_report(jsonb, jsonb)
set search_path = public, extensions;
