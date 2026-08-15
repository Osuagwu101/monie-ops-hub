-- Phase 6: Operational Readiness & Acceptance.
-- Provides a Director-only, non-secret readiness snapshot and an auditable readiness history.
-- This phase does not enable Moniepoint automation or require external credentials.

create table public.readiness_audits (
  id uuid primary key default gen_random_uuid(),
  run_by uuid references public.profiles(id) on delete set null,
  overall_status text not null check (
    overall_status in (
      'blocked',
      'platform_ready_activation_pending',
      'manual_operations_ready',
      'ready_for_live_automation'
    )
  ),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index readiness_audits_created_idx on public.readiness_audits(created_at desc);

alter table public.readiness_audits enable row level security;

create policy readiness_audits_director_read on public.readiness_audits
for select to authenticated
using (public.is_director());

revoke all on public.readiness_audits from anon;
grant select on public.readiness_audits to authenticated;

create or replace function public.system_readiness_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, storage, vault, cron
as $$
declare
  v_config public.automation_config;
  v_directors integer := 0;
  v_assistants integer := 0;
  v_latest_report_id uuid;
  v_latest_report_date date;
  v_latest_report_status text;
  v_latest_report_age integer;
  v_private_bucket boolean := false;
  v_bridge_secret boolean := false;
  v_browser_key boolean := false;
  v_moniepoint_user boolean := false;
  v_moniepoint_password boolean := false;
  v_login_url boolean := false;
  v_domains boolean := false;
  v_cron_count integer := 0;
  v_sensitive_rls_count integer := 0;
  v_sensitive_rls_expected integer := 10;
  v_report_functions boolean := false;
  v_team_functions boolean := false;
  v_management_functions boolean := false;
  v_automation_functions boolean := false;
  v_source_integrity_trigger boolean := false;
  v_auto_replan_trigger boolean := false;
  v_platform_ready boolean := false;
  v_manual_ready boolean := false;
  v_live_automation_ready boolean := false;
  v_overall_status text;
  v_checks jsonb;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  select * into v_config from public.automation_config where id = true;

  select count(*) filter (where role = 'director'::public.app_role and is_active),
         count(*) filter (where role = 'assistant'::public.app_role and is_active)
  into v_directors, v_assistants
  from public.profiles;

  select id, report_date, processing_status
  into v_latest_report_id, v_latest_report_date, v_latest_report_status
  from public.report_imports
  order by report_date desc, imported_at desc
  limit 1;

  if v_latest_report_date is not null then
    v_latest_report_age := greatest(0, (now() at time zone 'Africa/Lagos')::date - v_latest_report_date);
  end if;

  select exists(
    select 1 from storage.buckets
    where id = 'moniepoint-reports' and public = false
  ) into v_private_bucket;

  select exists(select 1 from vault.secrets where name = 'monie_ops_automation_bridge_token'),
         exists(select 1 from vault.secrets where name = 'monie_ops_browser_use_api_key'),
         exists(select 1 from vault.secrets where name = 'monie_ops_moniepoint_username'),
         exists(select 1 from vault.secrets where name = 'monie_ops_moniepoint_password')
  into v_bridge_secret, v_browser_key, v_moniepoint_user, v_moniepoint_password;

  v_login_url := nullif(btrim(coalesce(v_config.moniepoint_login_url, '')), '') is not null;
  v_domains := coalesce(array_length(v_config.allowed_domains, 1), 0) > 0;

  select count(*) into v_cron_count
  from cron.job
  where jobname in (
    'monie-ops-morning-audit',
    'monie-ops-morning-refresh',
    'monie-ops-evening-refresh',
    'monie-ops-automation-poller'
  );

  select count(*) into v_sensitive_rls_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'merchants',
      'terminals',
      'tasks',
      'report_imports',
      'agent_runs',
      'agent_recommendations',
      'performance_scorecards',
      'compensation_recommendations',
      'automation_config',
      'automation_runs'
    )
    and c.relrowsecurity = true;

  select
    exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ingest_moniepoint_report')
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reconcile_ta_tasks_for_report')
  into v_report_functions;

  select
    exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'run_operations_team')
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_my_task_outcome')
  into v_team_functions;

  select
    exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'refresh_amina_management')
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'review_compensation_recommendation')
  into v_management_functions;

  select
    exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'poll_automation_queue')
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'automation_claim_run')
    and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'automation_complete_run')
  into v_automation_functions;

  select exists(
    select 1 from pg_trigger
    where tgname = 'report_imports_validate_source_object' and not tgisinternal
  ) into v_source_integrity_trigger;

  select exists(
    select 1 from pg_trigger
    where tgname = 'report_imports_phase4_auto_replan' and not tgisinternal
  ) into v_auto_replan_trigger;

  v_platform_ready :=
    v_private_bucket
    and v_bridge_secret
    and v_cron_count = 4
    and v_sensitive_rls_count = v_sensitive_rls_expected
    and v_report_functions
    and v_team_functions
    and v_management_functions
    and v_automation_functions
    and v_source_integrity_trigger
    and v_auto_replan_trigger;

  v_manual_ready :=
    v_platform_ready
    and v_directors > 0
    and v_assistants > 0
    and v_latest_report_status = 'processed';

  v_live_automation_ready :=
    v_platform_ready
    and v_browser_key
    and v_moniepoint_user
    and v_moniepoint_password
    and v_login_url
    and v_domains;

  v_overall_status := case
    when not v_platform_ready then 'blocked'
    when v_manual_ready and v_live_automation_ready then 'ready_for_live_automation'
    when v_manual_ready then 'manual_operations_ready'
    else 'platform_ready_activation_pending'
  end;

  v_checks := jsonb_build_array(
    jsonb_build_object(
      'key', 'private_report_storage',
      'category', 'security',
      'label', 'Official report storage is private',
      'status', case when v_private_bucket then 'pass' else 'blocker' end,
      'detail', case when v_private_bucket then 'The moniepoint-reports bucket is private.' else 'The official report bucket is missing or public.' end,
      'requiredFor', jsonb_build_array('manual', 'automation')
    ),
    jsonb_build_object(
      'key', 'sensitive_rls',
      'category', 'security',
      'label', 'Sensitive operational tables enforce RLS',
      'status', case when v_sensitive_rls_count = v_sensitive_rls_expected then 'pass' else 'blocker' end,
      'detail', format('%s of %s required sensitive tables have RLS enabled.', v_sensitive_rls_count, v_sensitive_rls_expected),
      'requiredFor', jsonb_build_array('manual', 'automation')
    ),
    jsonb_build_object(
      'key', 'report_engine',
      'category', 'report_engine',
      'label', 'Official report ingestion and Tunde reconciliation exist',
      'status', case when v_report_functions and v_source_integrity_trigger then 'pass' else 'blocker' end,
      'detail', 'The report engine must preserve immutable source evidence and reconcile TA outcomes.',
      'requiredFor', jsonb_build_array('manual', 'automation')
    ),
    jsonb_build_object(
      'key', 'operations_team',
      'category', 'operations',
      'label', 'Amina, Emeka, Zainab and Tunde orchestration is installed',
      'status', case when v_team_functions and v_auto_replan_trigger then 'pass' else 'blocker' end,
      'detail', 'The shared team orchestration and safe report-triggered reprioritisation are present.',
      'requiredFor', jsonb_build_array('manual', 'automation')
    ),
    jsonb_build_object(
      'key', 'amina_management',
      'category', 'operations',
      'label', 'Amina Level 2 scoring and Director review controls exist',
      'status', case when v_management_functions then 'pass' else 'blocker' end,
      'detail', 'Individual scorecards and Director-controlled compensation recommendations are available.',
      'requiredFor', jsonb_build_array('manual', 'automation')
    ),
    jsonb_build_object(
      'key', 'director_account',
      'category', 'people',
      'label', 'At least one active Director account exists',
      'status', case when v_directors > 0 then 'pass' else 'warning' end,
      'detail', format('%s active Director account(s) found.', v_directors),
      'requiredFor', jsonb_build_array('manual')
    ),
    jsonb_build_object(
      'key', 'assistant_account',
      'category', 'people',
      'label', 'At least one active Human Operations Assistant exists',
      'status', case when v_assistants > 0 then 'pass' else 'warning' end,
      'detail', format('%s active Assistant account(s) found.', v_assistants),
      'requiredFor', jsonb_build_array('manual')
    ),
    jsonb_build_object(
      'key', 'processed_report',
      'category', 'data',
      'label', 'A processed official report is available',
      'status', case
        when v_latest_report_status = 'processed' and coalesce(v_latest_report_age, 9999) <= 2 then 'pass'
        when v_latest_report_status = 'processed' then 'warning'
        else 'warning'
      end,
      'detail', case
        when v_latest_report_id is null then 'No official report has been imported yet.'
        when v_latest_report_status <> 'processed' then format('Latest report status is %s.', coalesce(v_latest_report_status, 'unknown'))
        when v_latest_report_age > 2 then format('Latest processed report is %s day(s) old.', v_latest_report_age)
        else format('Latest processed report date is %s.', v_latest_report_date)
      end,
      'requiredFor', jsonb_build_array('manual')
    ),
    jsonb_build_object(
      'key', 'automation_bridge',
      'category', 'automation',
      'label', 'Private worker bridge is provisioned',
      'status', case when v_bridge_secret and v_automation_functions and v_cron_count = 4 then 'pass' else 'blocker' end,
      'detail', format('Bridge configured: %s. Scheduled jobs installed: %s/4.', v_bridge_secret, v_cron_count),
      'requiredFor', jsonb_build_array('automation')
    ),
    jsonb_build_object(
      'key', 'browser_use_key',
      'category', 'automation',
      'label', 'Browser Use API key is configured',
      'status', case when v_browser_key then 'pass' else 'pending_external' end,
      'detail', case when v_browser_key then 'A Browser Use API key is stored in Vault.' else 'Pending Director credential setup; manual operation is not blocked.' end,
      'requiredFor', jsonb_build_array('automation')
    ),
    jsonb_build_object(
      'key', 'moniepoint_credentials',
      'category', 'automation',
      'label', 'Moniepoint login credentials are configured',
      'status', case when v_moniepoint_user and v_moniepoint_password then 'pass' else 'pending_external' end,
      'detail', case when v_moniepoint_user and v_moniepoint_password then 'Moniepoint login credentials are stored in Vault.' else 'Pending Director credential setup; no credential value is exposed by this audit.' end,
      'requiredFor', jsonb_build_array('automation')
    ),
    jsonb_build_object(
      'key', 'moniepoint_scope',
      'category', 'automation',
      'label', 'Moniepoint login URL and allowed domains are configured',
      'status', case when v_login_url and v_domains then 'pass' else 'pending_external' end,
      'detail', case when v_login_url and v_domains then 'Login scope is configured.' else 'Pending exact login URL/domain setup before unattended retrieval.' end,
      'requiredFor', jsonb_build_array('automation')
    ),
    jsonb_build_object(
      'key', 'automation_safe_default',
      'category', 'automation',
      'label', 'Unattended retrieval activation state',
      'status', case when v_config.enabled then 'info' else 'pass' end,
      'detail', case when v_config.enabled then 'Scheduled retrieval is enabled.' else 'Scheduled retrieval remains safely disabled until Director activation.' end,
      'requiredFor', jsonb_build_array('automation')
    )
  );

  return jsonb_build_object(
    'generatedAt', now(),
    'overallStatus', v_overall_status,
    'platformReady', v_platform_ready,
    'manualOperationsReady', v_manual_ready,
    'liveAutomationReady', v_live_automation_ready,
    'automationEnabled', v_config.enabled,
    'counts', jsonb_build_object(
      'directors', v_directors,
      'assistants', v_assistants,
      'cronJobs', v_cron_count,
      'sensitiveRlsTables', v_sensitive_rls_count,
      'sensitiveRlsExpected', v_sensitive_rls_expected
    ),
    'latestReport', case
      when v_latest_report_id is null then null
      else jsonb_build_object(
        'id', v_latest_report_id,
        'reportDate', v_latest_report_date,
        'status', v_latest_report_status,
        'ageDays', v_latest_report_age
      )
    end,
    'externalActivation', jsonb_build_object(
      'browserUseApiKeyConfigured', v_browser_key,
      'moniepointCredentialsConfigured', v_moniepoint_user and v_moniepoint_password,
      'loginScopeConfigured', v_login_url and v_domains
    ),
    'checks', v_checks
  );
end;
$$;

revoke all on function public.system_readiness_snapshot() from public, anon;
grant execute on function public.system_readiness_snapshot() to authenticated;

create or replace function public.run_readiness_audit()
returns public.readiness_audits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_row public.readiness_audits;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  v_snapshot := public.system_readiness_snapshot();

  insert into public.readiness_audits(run_by, overall_status, snapshot)
  values(auth.uid(), v_snapshot->>'overallStatus', v_snapshot)
  returning * into v_row;

  insert into public.audit_events(
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values (
    auth.uid(),
    'director',
    'readiness_audit_completed',
    'readiness_audit',
    v_row.id::text,
    jsonb_build_object(
      'overallStatus', v_row.overall_status,
      'platformReady', v_snapshot->'platformReady',
      'manualOperationsReady', v_snapshot->'manualOperationsReady',
      'liveAutomationReady', v_snapshot->'liveAutomationReady'
    )
  );

  return v_row;
end;
$$;

revoke all on function public.run_readiness_audit() from public, anon;
grant execute on function public.run_readiness_audit() to authenticated;
