-- Phase 4: Director-only OTP handoff.
--
-- The submitted code is intentionally not stored in the challenge row. It is
-- kept in Supabase Vault under a deterministic, challenge-bound name so a later
-- worker phase can consume it once. This phase only accepts the code and marks
-- the challenge submitted; it never reads it back, resumes Browser Use, or
-- submits anything to Moniepoint.

alter table public.automation_verification_challenges
  drop constraint if exists automation_verification_challenges_status_check;

alter table public.automation_verification_challenges
  add constraint automation_verification_challenges_status_check
  check (status in ('pending', 'submitted', 'consumed', 'expired', 'cancelled', 'failed'));

alter table public.automation_verification_challenges
  add column if not exists submitted_at timestamptz;

create or replace function public.automation_verification_secret_name(p_challenge_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select 'monie_ops_verification_code_' || p_challenge_id::text;
$$;
revoke all on function public.automation_verification_secret_name(uuid)
  from public, anon, authenticated;

create or replace function public.automation_clear_verification_secret(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets
  where name = public.automation_verification_secret_name(p_challenge_id);
end;
$$;
revoke all on function public.automation_clear_verification_secret(uuid)
  from public, anon, authenticated;

-- A submitted handoff is still waiting for the later worker phase. Keep the
-- global verification-required/paused state until that handoff is consumed or
-- expires; resolving another challenge must not make it look authenticated.
create or replace function public.automation_resolve_verification_auth_state(
  p_state text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_current text;
begin
  if p_state not in ('reauth_required', 'blocked') then
    raise exception 'Invalid terminal verification auth state';
  end if;
  select auth_state into v_current from public.automation_config where id = true;
  if v_current is distinct from 'verification_required' then
    return;
  end if;
  if exists (
    select 1 from public.automation_verification_challenges
    where status in ('pending', 'submitted')
  ) then
    return;
  end if;
  update public.automation_config
  set auth_state = p_state,
      auth_state_checked_at = now(),
      auth_state_message = nullif(left(btrim(coalesce(p_message, '')), 500), ''),
      enabled = false,
      updated_at = now()
  where id = true;
  perform public.apply_automation_schedule();
end;
$$;
revoke all on function public.automation_resolve_verification_auth_state(text, text)
  from public, anon, authenticated;

-- Extend the existing opportunistic expiry sweep to erase submitted handoffs
-- when their challenge window closes. No new scheduled job is introduced.
create or replace function public.automation_expire_verification_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_challenge_id uuid;
begin
  for v_challenge_id in
    select id
    from public.automation_verification_challenges
    where status in ('pending', 'submitted') and expires_at <= now()
  loop
    perform public.automation_clear_verification_secret(v_challenge_id);
  end loop;

  update public.automation_verification_challenges
  set status = 'expired',
      resolved_at = now(),
      resolution_reason = 'Verification window expired before a code was supplied.'
  where status in ('pending', 'submitted') and expires_at <= now();
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.automation_resolve_verification_auth_state(
      'reauth_required',
      'The verification window expired before a code was supplied. Scheduled retrieval remains paused; sign in again to continue.'
    );
  end if;

  return v_count;
end;
$$;
revoke all on function public.automation_expire_verification_challenges()
  from public, anon, authenticated;

-- Director-side submission. The code is validated and written only to Vault;
-- it is never included in a return value, error, audit event, or log payload.
create or replace function public.automation_submit_verification_code(
  p_challenge_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row public.automation_verification_challenges;
  v_secret_id uuid;
  v_secret_name text;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;
  if p_code is null or p_code !~ '^[0-9]{4,8}$' then
    raise exception 'Verification code must contain 4 to 8 digits';
  end if;

  perform public.automation_expire_verification_challenges();

  select * into v_row
  from public.automation_verification_challenges
  where id = p_challenge_id
  for update;

  if v_row.id is null then
    raise exception 'Verification challenge not found';
  end if;
  if v_row.status <> 'pending' or v_row.expires_at <= now() then
    raise exception 'Verification challenge is no longer pending';
  end if;

  v_secret_name := public.automation_verification_secret_name(p_challenge_id);
  select id into v_secret_id from vault.secrets where name = v_secret_name limit 1;
  if v_secret_id is null then
    perform vault.create_secret(
      p_code,
      v_secret_name,
      'Short-lived MonieCRM verification handoff'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_code,
      v_secret_name,
      'Short-lived MonieCRM verification handoff'
    );
  end if;

  update public.automation_verification_challenges
  set status = 'submitted', submitted_at = now(), updated_at = now()
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'challengeId', p_challenge_id,
    'status', 'submitted'
  );
end;
$$;
revoke all on function public.automation_submit_verification_code(uuid,text)
  from public, anon;
grant execute on function public.automation_submit_verification_code(uuid,text)
  to authenticated;

-- Return the newest challenge for the Director. Pending is true only while the
-- code input is actionable; submitted/expired/consumed/etc. remain visible as a
-- status but cannot be submitted again.
create or replace function public.automation_verification_challenge_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row record;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  perform public.automation_expire_verification_challenges();

  select c.id, c.run_id, c.browser_session_id, c.browser_task_id, c.challenge_type,
         c.status, c.message, c.requested_at, c.expires_at, c.submitted_at, r.trigger_kind
    into v_row
  from public.automation_verification_challenges c
  join public.automation_runs r on r.id = c.run_id
  order by c.requested_at desc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('pending', false, 'status', null);
  end if;

  return jsonb_build_object(
    'pending', v_row.status = 'pending',
    'challengeId', v_row.id,
    'runId', v_row.run_id,
    'triggerKind', v_row.trigger_kind,
    'browserSessionId', v_row.browser_session_id,
    'browserTaskId', v_row.browser_task_id,
    'challengeType', v_row.challenge_type,
    'status', v_row.status,
    'message', v_row.message,
    'requestedAt', v_row.requested_at,
    'expiresAt', v_row.expires_at,
    'submittedAt', v_row.submitted_at
  );
end;
$$;
revoke all on function public.automation_verification_challenge_status() from public, anon;
grant execute on function public.automation_verification_challenge_status() to authenticated;

-- Future worker-side handoff. This is deliberately the only path that can
-- retrieve the submitted code: it requires the existing bridge token, locks the
-- exact challenge, deletes its Vault secret, and marks it consumed in one
-- transaction. It does not call Browser Use or change auth state; Phase 5 owns
-- those actions after receiving this one-time payload.
create or replace function public.automation_take_verification_code(
  p_token text,
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_row public.automation_verification_challenges;
  v_code text;
  v_secret_name text;
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;

  select * into v_row
  from public.automation_verification_challenges
  where id = p_challenge_id
  for update;

  if v_row.id is null then
    raise exception 'Verification challenge not found';
  end if;
  if v_row.status <> 'submitted' or v_row.expires_at <= now() then
    raise exception 'Verification handoff is not available';
  end if;

  v_secret_name := public.automation_verification_secret_name(p_challenge_id);
  select decrypted_secret into v_code
  from vault.decrypted_secrets
  where name = v_secret_name
  limit 1;
  if v_code is null then
    raise exception 'Verification handoff is unavailable';
  end if;

  delete from vault.secrets where name = v_secret_name;

  update public.automation_verification_challenges
  set status = 'consumed', resolved_at = now(),
      resolution_reason = 'Verification handoff consumed by the automation worker.',
      updated_at = now()
  where id = p_challenge_id;

  return jsonb_build_object(
    'ok', true,
    'challengeId', v_row.id,
    'runId', v_row.run_id,
    'browserSessionId', v_row.browser_session_id,
    'browserTaskId', v_row.browser_task_id,
    'challengeType', v_row.challenge_type,
    'code', v_code
  );
end;
$$;
revoke all on function public.automation_take_verification_code(text, uuid)
  from public;
grant execute on function public.automation_take_verification_code(text, uuid)
  to anon, authenticated;
