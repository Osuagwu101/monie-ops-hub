-- Admin-only account provisioning.
-- Public sign-up is blocked at the auth.users boundary. The one reserved Director email
-- may self-register once and choose its own password. Staff users must be created through
-- an Admin-controlled server path that marks app_metadata.staff_created_by_admin=true.

create or replace function public.guard_portal_user_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_staff_created_by_admin boolean := coalesce(
    (new.raw_app_meta_data ->> 'staff_created_by_admin')::boolean,
    false
  );
begin
  if v_email = 'nnaemekasolomon31@gmail.com' then
    return new;
  end if;

  if v_staff_created_by_admin then
    return new;
  end if;

  raise exception 'Public sign-up is disabled. Staff accounts must be created by the Admin.';
end;
$$;

-- Run before the existing profile-creation trigger.
drop trigger if exists portal_guard_auth_user_creation on auth.users;
create trigger portal_guard_auth_user_creation
before insert on auth.users
for each row execute function public.guard_portal_user_creation();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_role public.app_role;
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
