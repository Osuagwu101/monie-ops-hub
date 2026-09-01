-- Director-owned merchant contact editing and activity-first Amina priority.
-- Existing merchant text columns, task eligibility, duplicate prevention and
-- assistant capacity rules remain authoritative.

create or replace function public.update_merchant_contact_details(
  p_merchant_id uuid,
  p_phone_number text,
  p_account_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants;
  v_phone text := nullif(btrim(coalesce(p_phone_number, '')), '');
  v_account text := nullif(btrim(coalesce(p_account_number, '')), '');
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  if v_phone is null and v_account is null then
    raise exception 'Enter a BO phone number or POS account number.';
  end if;

  if length(coalesce(v_phone, '')) > 64 or length(coalesce(v_account, '')) > 64 then
    raise exception 'Phone and POS account details must each be 64 characters or fewer.';
  end if;

  update public.merchants
  set phone_number = v_phone,
      account_number = v_account,
      contact_source = 'director_manual',
      contact_synced_at = now()
  where id = p_merchant_id
  returning * into v_merchant;

  if v_merchant.id is null then
    raise exception 'Business not found';
  end if;

  insert into public.audit_events(
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'director', 'merchant_contact_updated', 'merchant', p_merchant_id::text,
    jsonb_build_object(
      'phoneAvailable', v_phone is not null,
      'accountAvailable', v_account is not null,
      'source', 'director_manual'
    )
  );

  return jsonb_build_object(
    'id', v_merchant.id,
    'phone_number', v_merchant.phone_number,
    'account_number', v_merchant.account_number,
    'contact_source', v_merchant.contact_source,
    'contact_synced_at', v_merchant.contact_synced_at
  );
end;
$$;

revoke all on function public.update_merchant_contact_details(uuid,text,text) from public, anon;
grant execute on function public.update_merchant_contact_details(uuid,text,text) to authenticated;

-- A Director-entered value remains authoritative. Automated enrichment may
-- fill a missing field, but it cannot replace a non-empty manual value.
create or replace function public.preserve_director_manual_merchant_contacts()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.contact_source = 'director_manual'
     and new.contact_source is distinct from 'director_manual' then
    new.phone_number := coalesce(old.phone_number, new.phone_number);
    new.account_number := coalesce(old.account_number, new.account_number);
    new.contact_source := 'director_manual';
    new.contact_synced_at := old.contact_synced_at;
  end if;
  return new;
end;
$$;

drop trigger if exists merchants_preserve_director_manual_contacts on public.merchants;
create trigger merchants_preserve_director_manual_contacts
before update of phone_number, account_number, contact_source, contact_synced_at
on public.merchants
for each row execute function public.preserve_director_manual_merchant_contacts();

create or replace function public.amina_activity_priority_value(p_rolling_value numeric)
returns numeric
language sql
immutable
strict
set search_path = public
as $$
  select greatest(p_rolling_value, 0);
$$;

create or replace function public.apply_amina_activity_priority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.agent_kind = 'emeka' and new.recommendation_kind = 'ta_priority' then
    -- Amina's existing assignment queries order by score descending. Re-rank
    -- the complete run after each candidate is recorded, using exact rolling
    -- value before converting the result to the existing 0..100 score field.
    with ranked as (
      select
        r.id,
        row_number() over (
          order by
            case
              when public.amina_activity_priority_value(
                case when jsonb_typeof(r.evidence -> 'rollingValue') = 'number'
                  then (r.evidence ->> 'rollingValue')::numeric else 0 end
              ) > 0 then 0
              else 1
            end,
            public.amina_activity_priority_value(
              case when jsonb_typeof(r.evidence -> 'rollingValue') = 'number'
                then (r.evidence ->> 'rollingValue')::numeric else 0 end
            ) desc,
            case when jsonb_typeof(r.evidence -> 'daysSinceLastTransaction') = 'number'
              then (r.evidence ->> 'daysSinceLastTransaction')::integer else 2147483647 end,
            r.created_at,
            r.id
        ) as position
      from public.agent_recommendations r
      where r.run_id = new.run_id
        and r.recommendation_kind = 'ta_priority'
        and case when jsonb_typeof(r.evidence -> 'officialTargetMet') = 'boolean'
          then (r.evidence ->> 'officialTargetMet')::boolean else false end = false
    )
    update public.agent_recommendations r
    set score = greatest(0.01, 100 - ((ranked.position - 1) * 0.01))
    from ranked
    where r.id = ranked.id;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_recommendations_amina_activity_priority
  on public.agent_recommendations;
create trigger agent_recommendations_amina_activity_priority
after insert or update of evidence, recommendation_kind
on public.agent_recommendations
for each row execute function public.apply_amina_activity_priority();

-- Existing open recommendations will be replaced by Amina's normal replan;
-- new runs are ranked before either assignment loop reads them.
