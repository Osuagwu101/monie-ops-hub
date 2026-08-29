-- Persist a safe, Director-visible MonieCRM authentication state.
-- Authentication failures pause scheduled retrieval so one expired session cannot
-- repeatedly submit credentials and lock the BRM account.

alter table public.automation_config
  add column if not exists auth_state text not null default 'unknown',
  add column if not exists auth_state_checked_at timestamptz null,
  add column if not exists auth_state_message text null;

alter table public.automation_config
  drop constraint if exists automation_config_auth_state_check;

alter table public.automation_config
  add constraint automation_config_auth_state_check
  check (auth_state in ('unknown','checking','authenticated','reauth_required','blocked'));

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
  if p_state not in ('checking','authenticated','reauth_required','blocked') then
    raise exception 'Invalid automation authentication state';
  end if;

  update public.automation_config
  set auth_state=p_state,
      auth_state_checked_at=now(),
      auth_state_message=nullif(left(btrim(coalesce(p_message,'')),500),''),
      enabled=case
        when p_state in ('reauth_required','blocked') then false
        else enabled
      end,
      updated_at=now()
  where id=true
  returning enabled into v_enabled;

  if p_state in ('reauth_required','blocked') then
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
