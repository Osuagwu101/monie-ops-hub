-- Phase 1 security audit fixes.
-- Narrow assistant reads to work actually assigned to them and make assistant
-- task-state transitions monotonic. Directors retain portfolio-wide access.

-- Replace broad authenticated read policies with least-privilege policies.
drop policy if exists merchants_authenticated_read on public.merchants;
create policy merchants_assigned_or_director_read on public.merchants
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.merchant_id = merchants.id
      and t.assigned_to = auth.uid()
  )
);

drop policy if exists terminals_authenticated_read on public.terminals;
create policy terminals_assigned_or_director_read on public.terminals
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.terminal_id = terminals.id
      and t.assigned_to = auth.uid()
  )
);

drop policy if exists performance_authenticated_read on public.terminal_performance_snapshots;
create policy performance_assigned_or_director_read on public.terminal_performance_snapshots
for select to authenticated
using (
  public.is_director()
  or exists (
    select 1
    from public.tasks t
    where t.terminal_id = terminal_performance_snapshots.terminal_id
      and t.assigned_to = auth.uid()
  )
);

-- Harden new-user profile fallback for any non-email auth method.
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
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Team member'
    ),
    'assistant'::public.app_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Assistants may only progress their own human-work state. They can never
-- write any verification state, and a completed task cannot be reopened by them.
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
  v_old_status public.task_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() <> 'assistant'::public.app_role then
    raise exception 'Assistant role required';
  end if;

  select status
  into v_old_status
  from public.tasks
  where id = p_task_id
    and assigned_to = auth.uid()
  for update;

  if v_old_status is null then
    raise exception 'Task not found or not assigned to current user';
  end if;

  if not (
    (v_old_status = 'assigned'::public.task_status and p_status in (
      'in_progress'::public.task_status,
      'postponed'::public.task_status,
      'completed'::public.task_status
    ))
    or (v_old_status = 'in_progress'::public.task_status and p_status in (
      'postponed'::public.task_status,
      'completed'::public.task_status
    ))
    or (v_old_status = 'postponed'::public.task_status and p_status in (
      'in_progress'::public.task_status,
      'completed'::public.task_status
    ))
  ) then
    raise exception 'Invalid assistant task-state transition from % to %', v_old_status, p_status;
  end if;

  update public.tasks
  set status = p_status
  where id = p_task_id
  returning * into v_task;

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
    jsonb_build_object(
      'from_status', v_old_status::text,
      'to_status', p_status::text
    )
  );

  return v_task;
end;
$$;

revoke all on function public.set_my_task_status(uuid, public.task_status) from public;
grant execute on function public.set_my_task_status(uuid, public.task_status) to authenticated;
