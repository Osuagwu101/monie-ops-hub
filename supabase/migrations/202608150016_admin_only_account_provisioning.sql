-- Admin-only account provisioning.
-- Public sign-up is blocked at the auth.users boundary. The one reserved Director email
-- may self-register once and choose its own password. Staff registrations require a
-- single-use invitation created by the Director through a trusted RPC.

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  accepted_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz
);

create unique index staff_invites_one_pending_per_email_idx
  on public.staff_invites (lower(email))
  where status = 'pending';
create index staff_invites_created_at_idx on public.staff_invites (created_at desc);

alter table public.staff_invites enable row level security;

create policy staff_invites_director_manage on public.staff_invites
for all to authenticated
using (public.is_director())
with check (public.is_director());

create or replace function public.create_staff_invite(
  p_email text,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_full_name, ''));
  v_token text;
  v_invite_id uuid;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'A valid staff email is required';
  end if;
  if v_email = 'nnaemekasolomon31@gmail.com' then
    raise exception 'The reserved Admin email cannot be used for a staff account';
  end if;
  if v_name = '' then
    raise exception 'Staff full name is required';
  end if;

  update public.staff_invites
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now();

  update public.staff_invites
  set status = 'revoked'
  where status = 'pending'
    and lower(email) = v_email;

  if exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = v_email
  ) then
    raise exception 'An account already exists for this email';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.staff_invites (
    email,
    full_name,
    token_hash,
    created_by
  ) values (
    v_email,
    v_name,
    encode(digest(v_token, 'sha256'), 'hex'),
    auth.uid()
  ) returning id into v_invite_id;

  insert into public.audit_events (
    actor_user_id,
    actor_kind,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'director',
    'staff_invite_created',
    'staff_invite',
    v_invite_id::text,
    jsonb_build_object('email', v_email, 'expires_at', now() + interval '24 hours')
  );

  return jsonb_build_object(
    'inviteId', v_invite_id,
    'email', v_email,
    'fullName', v_name,
    'inviteToken', v_token,
    'expiresAt', now() + interval '24 hours'
  );
end;
$$;

revoke all on function public.create_staff_invite(text, text) from public;
grant execute on function public.create_staff_invite(text, text) to authenticated;

create or replace function public.guard_portal_user_creation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_token text := trim(coalesce(new.raw_user_meta_data ->> 'staff_invite_token', ''));
  v_invite public.staff_invites;
begin
  if v_email = 'nnaemekasolomon31@gmail.com' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('portal_role', 'director');
    return new;
  end if;

  if v_token = '' then
    raise exception 'Public sign-up is disabled. Staff accounts must be created by the Admin.';
  end if;

  select *
  into v_invite
  from public.staff_invites
  where lower(email) = v_email
    and status = 'pending'
    and expires_at > now()
    and token_hash = encode(digest(v_token, 'sha256'), 'hex')
  for update;

  if v_invite.id is null then
    raise exception 'This staff invitation is invalid, expired, or already used.';
  end if;

  new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('staff_created_by_admin', true, 'portal_role', 'assistant');
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    || jsonb_build_object('full_name', v_invite.full_name);

  return new;
end;
$$;

drop trigger if exists portal_guard_auth_user_creation on auth.users;
create trigger portal_guard_auth_user_creation
before insert on auth.users
for each row execute function public.guard_portal_user_creation();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_role public.app_role;
  v_token text := trim(coalesce(new.raw_user_meta_data ->> 'staff_invite_token', ''));
  v_invite_id uuid;
begin
  v_role := case
    when v_email = 'nnaemekasolomon31@gmail.com' then 'director'::public.app_role
    else 'assistant'::public.app_role
  end;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(v_email, '@', 1)
    ),
    v_role
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        role = case
          when v_email = 'nnaemekasolomon31@gmail.com' then 'director'::public.app_role
          else public.profiles.role
        end,
        updated_at = now();

  if v_role = 'assistant'::public.app_role and v_token <> '' then
    update public.staff_invites
    set status = 'accepted',
        accepted_user_id = new.id,
        accepted_at = now()
    where id = (
      select id
      from public.staff_invites
      where lower(email) = v_email
        and status = 'pending'
        and token_hash = encode(digest(v_token, 'sha256'), 'hex')
      order by created_at desc
      limit 1
    )
    returning id into v_invite_id;

    if v_invite_id is not null then
      insert into public.audit_events (
        actor_user_id,
        actor_kind,
        event_type,
        entity_type,
        entity_id,
        payload
      ) values (
        new.id,
        'assistant',
        'staff_account_activated',
        'staff_invite',
        v_invite_id::text,
        jsonb_build_object('email', v_email)
      );
    end if;
  end if;

  return new;
end;
$$;

-- Defense in depth: the reserved Admin identity can never be demoted by ordinary profile updates.
create or replace function public.protect_reserved_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select lower(trim(coalesce(email, '')))
  into v_email
  from auth.users
  where id = new.id;

  if v_email = 'nnaemekasolomon31@gmail.com' then
    new.role := 'director'::public.app_role;
    new.is_active := true;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_reserved_admin on public.profiles;
create trigger profiles_protect_reserved_admin
before insert or update on public.profiles
for each row execute function public.protect_reserved_admin_profile();
