-- Phase 1 security hardening.
-- New users cannot self-select the director role, and assistants can only move
-- their own tasks through human-work states (never verification states).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    'assistant'::public.app_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.set_my_task_status(
  p_task_id uuid,
  p_status public.task_status
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() <> 'assistant'::public.app_role then
    raise exception 'Assistant role required';
  end if;

  if p_status not in (
    'assigned'::public.task_status,
    'in_progress'::public.task_status,
    'postponed'::public.task_status,
    'completed'::public.task_status
  ) then
    raise exception 'Assistants cannot set verification states';
  end if;

  update public.tasks
  set status = p_status
  where id = p_task_id
    and assigned_to = auth.uid()
  returning * into v_task;

  if v_task.id is null then
    raise exception 'Task not found or not assigned to current user';
  end if;

  insert into public.audit_events (
    actor_user_id,
    actor_kind,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'assistant',
    'task_status_changed',
    'task',
    v_task.id::text,
    jsonb_build_object('status', p_status::text)
  );

  return v_task;
end;
$$;

revoke all on function public.set_my_task_status(uuid, public.task_status) from public;
grant execute on function public.set_my_task_status(uuid, public.task_status) to authenticated;

-- A director must be promoted through a trusted admin/service-role path after
-- the first account is created. User-controlled signup metadata is never trusted
-- for privileged role assignment.
