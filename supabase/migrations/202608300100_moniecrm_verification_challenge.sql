-- Phase 2: backend foundation for a MonieCRM OTP/MFA verification challenge.
--
-- This migration adds ONLY the state needed to safely pause a specific automation
-- run/Browser Use session when MonieCRM asks for a one-time code or another
-- interactive verification step, and to resume it later. It does not submit an
-- OTP to Browser Use, does not add an OTP entry UI, and does not store the OTP
-- value itself anywhere -- there is no column for it anywhere in this table, by
-- design. A challenge row only ever records THAT verification was requested for
-- a given run/session/task, when it expires, and how it was resolved.
--
-- Nothing here touches the Contact Vault (business_contacts / business_contact_*)
-- or the contact_bootstrap_* pipeline, and nothing here changes existing Phase 1
-- behavior for the authenticated/reauth_required/blocked states -- it only adds
-- one more state alongside them.

alter table public.automation_config
  drop constraint if exists automation_config_auth_state_check;

alter table public.automation_config
  add constraint automation_config_auth_state_check
  check (auth_state in ('unknown','checking','authenticated','reauth_required','blocked','verification_required'));

-- Re-declared to also accept the new state and to pause scheduled retrieval for it,
-- exactly like reauth_required/blocked already do. Everything else about this
-- function (Phase 1) is unchanged.
create or replace function public.automation_set_auth_state(
  p_token text,
  p_state text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_enabled boolean;
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;
  if p_state not in ('checking','authenticated','reauth_required','blocked','verification_required') then
    raise exception 'Invalid automation authentication state';
  end if;

  update public.automation_config
  set auth_state=p_state,
      auth_state_checked_at=now(),
      auth_state_message=nullif(left(btrim(coalesce(p_message,'')),500),''),
      enabled=case
        when p_state in ('reauth_required','blocked','verification_required') then false
        else enabled
      end,
      updated_at=now()
  where id=true
  returning enabled into v_enabled;

  if p_state in ('reauth_required','blocked','verification_required') then
    perform public.apply_automation_schedule();
  end if;

  return jsonb_build_object(
    'ok',true,
    'state',p_state,
    'scheduledRetrievalEnabled',v_enabled
  );
end;
$$;

revoke all on function public.automation_set_auth_state(text,text,text) from public;
grant execute on function public.automation_set_auth_state(text,text,text) to anon, authenticated;

-- The challenge itself. One row per verification prompt encountered during a run.
-- Terminal rows are kept (never deleted) as a lightweight audit trail of when
-- verification was requested and how it was resolved -- they carry no OTP value,
-- so retaining them is safe.
create table if not exists public.automation_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  browser_session_id text,
  browser_task_id text,
  challenge_type text not null default 'otp'
    check (challenge_type in ('otp', 'mfa_app', 'unknown')),
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'expired', 'cancelled', 'failed')),
  message text,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolution_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_verification_challenges_has_target
    check (browser_session_id is not null or browser_task_id is not null),
  constraint automation_verification_challenges_expiry_after_request
    check (expires_at > requested_at)
);

-- Only one open challenge per run at a time. A new one can still be opened for the
-- same run later, once the previous one has reached a terminal status.
create unique index if not exists automation_verification_challenges_one_pending_per_run
  on public.automation_verification_challenges(run_id)
  where status = 'pending';

create index if not exists automation_verification_challenges_run_idx
  on public.automation_verification_challenges(run_id, created_at desc);
create index if not exists automation_verification_challenges_pending_expiry_idx
  on public.automation_verification_challenges(expires_at)
  where status = 'pending';

drop trigger if exists automation_verification_challenges_updated_at
  on public.automation_verification_challenges;
create trigger automation_verification_challenges_updated_at
before update on public.automation_verification_challenges
for each row execute function public.set_updated_at();

alter table public.automation_verification_challenges enable row level security;

-- Same shape as automation_config/automation_runs: Directors may read, nobody
-- reads or writes directly as anon, and every write goes through a SECURITY
-- DEFINER function below -- there is no INSERT/UPDATE/DELETE grant to
-- authenticated at all.
drop policy if exists automation_verification_challenges_director_read
  on public.automation_verification_challenges;
create policy automation_verification_challenges_director_read
  on public.automation_verification_challenges
  for select
  to authenticated
  using (public.is_director());

revoke all on public.automation_verification_challenges from anon, authenticated;
grant select on public.automation_verification_challenges to authenticated;

-- Internal only (never granted to any external role): steps automation_config's
-- auth_state down from verification_required to a terminal Phase 1 state
-- (reauth_required or blocked) once a challenge is no longer pending, WITHOUT
-- ever leaving auth_state stuck at verification_required and WITHOUT clobbering
-- state that a challenge didn't set in the first place. Two guards make repeated
-- calls and concurrent challenges safe:
--   * it only acts when auth_state is currently exactly 'verification_required'
--     (so it never overwrites a state some other event already moved on to);
--   * it only acts when no OTHER challenge is still pending (so resolving one
--     challenge never clears the paused state while a different run's challenge
--     still needs a Director's attention).
-- Scheduled retrieval stays paused (enabled=false) either way, matching how
-- reauth_required/blocked already behave -- only a Director re-enabling
-- automation (or a fresh authenticated run) turns it back on.
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
  if exists (select 1 from public.automation_verification_challenges where status = 'pending') then
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
revoke all on function public.automation_resolve_verification_auth_state(text,text)
  from public, anon, authenticated;

-- Internal sweep: flags any pending challenge whose expiry has passed. Called
-- opportunistically from the functions below rather than from a new pg_cron job,
-- so "expired challenges cannot be used" holds immediately and unconditionally --
-- every mutating function below already re-checks expires_at itself regardless of
-- whether this sweep has run recently; this only keeps the visible `status` value
-- accurate for readers. When it actually expires at least one row, it also steps
-- the global auth_state down (guarded exactly as described above).
create or replace function public.automation_expire_verification_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.automation_verification_challenges
  set status = 'expired',
      resolved_at = now(),
      resolution_reason = 'Verification window expired before a code was supplied.'
  where status = 'pending' and expires_at <= now();
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
revoke all on function public.automation_expire_verification_challenges() from public, anon, authenticated;

-- Worker-side: open a challenge for a run/session when MonieCRM asks for a code.
-- Idempotent -- calling this again for a run that already has a pending challenge
-- returns the existing one instead of creating a duplicate, so a retried worker
-- call can never race past the one-pending-per-run guarantee.
create or replace function public.automation_open_verification_challenge(
  p_token text,
  p_run_id uuid,
  p_browser_session_id text default null,
  p_browser_task_id text default null,
  p_challenge_type text default 'otp',
  p_message text default null,
  p_ttl_minutes integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.automation_verification_challenges;
  v_challenge public.automation_verification_challenges;
  v_ttl integer;
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;
  if not exists (select 1 from public.automation_runs where id = p_run_id) then
    raise exception 'Automation run not found';
  end if;
  if coalesce(p_browser_session_id, p_browser_task_id) is null then
    raise exception 'A Browser Use session or task ID is required to open a verification challenge';
  end if;
  if coalesce(p_challenge_type, 'otp') not in ('otp', 'mfa_app', 'unknown') then
    raise exception 'Invalid verification challenge type';
  end if;

  perform public.automation_expire_verification_challenges();

  select * into v_existing
  from public.automation_verification_challenges
  where run_id = p_run_id and status = 'pending';

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'challengeId', v_existing.id,
      'status', v_existing.status,
      'expiresAt', v_existing.expires_at,
      'reused', true
    );
  end if;

  v_ttl := greatest(1, least(30, coalesce(p_ttl_minutes, 10)));

  insert into public.automation_verification_challenges(
    run_id, browser_session_id, browser_task_id, challenge_type, message, expires_at
  ) values (
    p_run_id, nullif(btrim(coalesce(p_browser_session_id, '')), ''),
    nullif(btrim(coalesce(p_browser_task_id, '')), ''),
    coalesce(p_challenge_type, 'otp'),
    nullif(left(btrim(coalesce(p_message, '')), 500), ''),
    now() + make_interval(mins => v_ttl)
  )
  returning * into v_challenge;

  perform public.automation_set_auth_state(
    p_token,
    'verification_required',
    coalesce(p_message, 'MonieCRM is asking for a verification code. Scheduled retrieval is paused until a Director resolves this.')
  );

  return jsonb_build_object(
    'ok', true,
    'challengeId', v_challenge.id,
    'status', v_challenge.status,
    'expiresAt', v_challenge.expires_at,
    'reused', false
  );
end;
$$;
-- Worker-callable via the same publishable-key + bridge-token pattern as the other
-- worker RPCs in this file (automation_claim_run, automation_mark_pending, etc.):
-- granted to anon/authenticated so the PostgREST call the worker already makes can
-- reach it, with automation_bridge_valid(p_token) inside the function body as the
-- real gate -- the grant alone lets nothing happen without a valid bridge token.
revoke all on function public.automation_open_verification_challenge(text,uuid,text,text,text,text,integer)
  from public;
grant execute on function public.automation_open_verification_challenge(text,uuid,text,text,text,text,integer)
  to anon, authenticated;

-- Worker-side: mark a challenge consumed. This is the ONLY function that may move
-- a challenge to 'consumed', and it never accepts or stores the code itself -- by
-- the time anything calls this (a future phase), the code will already have been
-- submitted directly to Browser Use, never through Supabase. The WHERE clause
-- enforces both single-use (status must still be 'pending') and expiry
-- (expires_at must still be in the future) atomically, so a consumed or expired
-- challenge can never be replayed.
create or replace function public.automation_consume_verification_challenge(
  p_token text,
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.automation_verification_challenges;
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;

  update public.automation_verification_challenges
  set status = 'consumed', resolved_at = now(), resolution_reason = 'Verification code accepted.'
  where id = p_challenge_id and status = 'pending' and expires_at > now()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Verification challenge is not pending or has expired';
  end if;

  -- Global auth_state is a single value shared across every run, so only drop
  -- verification_required once no *other* run still has a pending challenge
  -- waiting on it -- otherwise a Director resolving one run's code would
  -- incorrectly resume scheduled retrieval while another run is still blocked.
  if exists (select 1 from public.automation_verification_challenges where status = 'pending') then
    null;
  else
    perform public.automation_set_auth_state(
      p_token, 'checking', 'Verification code accepted; re-checking the MonieCRM session.'
    );
  end if;

  return jsonb_build_object('ok', true, 'challengeId', v_row.id, 'status', v_row.status);
end;
$$;
-- Worker-callable, same pattern as above.
revoke all on function public.automation_consume_verification_challenge(text,uuid)
  from public;
grant execute on function public.automation_consume_verification_challenge(text,uuid)
  to anon, authenticated;

-- Worker-side: mark a challenge failed (e.g. Browser Use reported the code was
-- rejected, or the run failed for another reason before a code could be used).
-- A no-op (not an error) if the challenge already reached a terminal status, so a
-- failure-handling path can always call this safely during cleanup.
--
-- On a real (first) transition to failed, this also steps the global auth_state
-- down from verification_required so it never gets stuck there -- see
-- automation_resolve_verification_auth_state() below for the guard that keeps
-- this safe when another pending challenge still needs attention.
create or replace function public.automation_fail_verification_challenge(
  p_token text,
  p_challenge_id uuid,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.automation_verification_challenges; v_next_state text;
begin
  if not public.automation_bridge_valid(p_token) then
    raise exception 'Invalid automation token';
  end if;

  update public.automation_verification_challenges
  set status = 'failed', resolved_at = now(),
      resolution_reason = coalesce(nullif(left(btrim(coalesce(p_error_message, '')), 500), ''), 'Verification failed.')
  where id = p_challenge_id and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.automation_verification_challenges where id = p_challenge_id;
    if v_row.id is null then
      raise exception 'Verification challenge not found';
    end if;
    return jsonb_build_object('ok', true, 'challengeId', v_row.id, 'status', v_row.status, 'alreadyResolved', true);
  end if;

  -- Same blocked-keyword heuristic as authStateFromFailure() in
  -- api.automation-worker.ts: only escalate to blocked when the error text itself
  -- names a suspended/locked/blocked account; reauth_required is the safe default.
  v_next_state := case
    when lower(coalesce(p_error_message, '')) ~ 'temporarily suspended|account suspended|account locked|temporarily locked|account blocked'
      then 'blocked'
    else 'reauth_required'
  end;
  perform public.automation_resolve_verification_auth_state(
    v_next_state,
    coalesce(
      nullif(left(btrim(coalesce(p_error_message, '')), 500), ''),
      'MonieCRM verification failed. Scheduled retrieval remains paused until this is resolved.'
    )
  );

  return jsonb_build_object('ok', true, 'challengeId', v_row.id, 'status', v_row.status, 'alreadyResolved', false);
end;
$$;
-- Worker-callable, same pattern as automation_open/consume_verification_challenge above.
revoke all on function public.automation_fail_verification_challenge(text,uuid,text)
  from public;
grant execute on function public.automation_fail_verification_challenge(text,uuid,text)
  to anon, authenticated;

-- Director-side: cancel a challenge by hand (foundation for a future "give up on
-- this code" control -- no UI is added in this phase). Idempotent on an already
-- terminal challenge for the same reason as the failure path above. On a real
-- (first) cancellation, also steps the global auth_state down from
-- verification_required (guarded exactly like the expiry sweep above), since a
-- Director giving up on a code is a terminal outcome for that challenge too.
create or replace function public.automation_director_cancel_verification_challenge(
  p_challenge_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.automation_verification_challenges;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  update public.automation_verification_challenges
  set status = 'cancelled', resolved_at = now(),
      resolution_reason = coalesce(nullif(left(btrim(coalesce(p_reason, '')), 500), ''), 'Cancelled by a Director.')
  where id = p_challenge_id and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.automation_verification_challenges where id = p_challenge_id;
    if v_row.id is null then
      raise exception 'Verification challenge not found';
    end if;
    return jsonb_build_object('ok', true, 'challengeId', v_row.id, 'status', v_row.status, 'alreadyResolved', true);
  end if;

  insert into public.audit_events(actor_user_id, actor_kind, event_type, entity_type, entity_id, payload)
  values (
    auth.uid(), 'director', 'automation_verification_challenge_cancelled',
    'automation_verification_challenge', v_row.id::text,
    jsonb_build_object('runId', v_row.run_id, 'reason', v_row.resolution_reason)
  );

  perform public.automation_resolve_verification_auth_state(
    'reauth_required',
    'A Director cancelled the pending MonieCRM verification challenge. Sign in again to resume scheduled retrieval.'
  );

  return jsonb_build_object('ok', true, 'challengeId', v_row.id, 'status', v_row.status, 'alreadyResolved', false);
end;
$$;
revoke all on function public.automation_director_cancel_verification_challenge(uuid,text)
  from public, anon;
grant execute on function public.automation_director_cancel_verification_challenge(uuid,text) to authenticated;

-- Director-side: read the current state without needing direct table access.
-- Sweeps expired challenges first so the result is never stale.
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
         c.status, c.message, c.requested_at, c.expires_at, r.trigger_kind
    into v_row
  from public.automation_verification_challenges c
  join public.automation_runs r on r.id = c.run_id
  where c.status = 'pending'
  order by c.requested_at desc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('pending', false);
  end if;

  return jsonb_build_object(
    'pending', true,
    'challengeId', v_row.id,
    'runId', v_row.run_id,
    'triggerKind', v_row.trigger_kind,
    'browserSessionId', v_row.browser_session_id,
    'browserTaskId', v_row.browser_task_id,
    'challengeType', v_row.challenge_type,
    'message', v_row.message,
    'requestedAt', v_row.requested_at,
    'expiresAt', v_row.expires_at
  );
end;
$$;
revoke all on function public.automation_verification_challenge_status() from public, anon;
grant execute on function public.automation_verification_challenge_status() to authenticated;
