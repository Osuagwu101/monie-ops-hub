-- Phase 2: Human Assistant Portal workflow.
-- Adds structured call outcomes and forces assistant completion through an audited RPC.

create type public.task_outcome_code as enum (
  'reached_commitment',
  'reached_no_commitment',
  'callback_requested',
  'no_answer',
  'merchant_busy',
  'terminal_issue',
  'merchant_declined',
  'loan_interest',
  'escalation_required'
);

alter table public.task_outcomes
  add column outcome_code public.task_outcome_code,
  add column callback_at timestamptz,
  add column attempt_number integer not null default 1 check (attempt_number > 0);

create index task_outcomes_task_submitted_idx
  on public.task_outcomes (task_id, submitted_at desc);

create unique index tasks_rollover_once_idx
  on public.tasks (rolled_from_task_id, task_date)
  where rolled_from_task_id is not null;

-- Direct assistant inserts are replaced by submit_my_task_outcome so the note,
-- status transition and audit event are committed atomically.
drop policy if exists outcomes_assistant_insert on public.task_outcomes;

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

  if p_status <> 'in_progress'::public.task_status then
    raise exception 'Use submit_my_task_outcome to postpone or complete a task';
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

  if v_old_status not in ('assigned'::public.task_status, 'postponed'::public.task_status) then
    raise exception 'Task cannot be started from state %', v_old_status;
  end if;

  update public.tasks
  set status = 'in_progress'::public.task_status
  where id = p_task_id
  returning * into v_task;

  insert into public.audit_events (
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'assistant', 'task_started', 'task', v_task.id::text,
    jsonb_build_object('from_status', v_old_status::text, 'to_status', 'in_progress')
  );

  return v_task;
end;
$$;

revoke all on function public.set_my_task_status(uuid, public.task_status) from public;
grant execute on function public.set_my_task_status(uuid, public.task_status) to authenticated;

create or replace function public.submit_my_task_outcome(
  p_task_id uuid,
  p_outcome_code public.task_outcome_code,
  p_final_status public.task_status,
  p_reached_merchant boolean default null,
  p_commitment_received boolean default null,
  p_expected_amount numeric default null,
  p_expected_by timestamptz default null,
  p_postponement_reason text default null,
  p_callback_at timestamptz default null,
  p_notes text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_old_status public.task_status;
  v_attempt integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() <> 'assistant'::public.app_role then
    raise exception 'Assistant role required';
  end if;

  if p_final_status not in ('postponed'::public.task_status, 'completed'::public.task_status) then
    raise exception 'Outcome must end in postponed or completed';
  end if;

  if p_final_status = 'postponed'::public.task_status
     and nullif(trim(coalesce(p_postponement_reason, '')), '') is null then
    raise exception 'A postponement reason is required';
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

  if v_old_status not in (
    'assigned'::public.task_status,
    'in_progress'::public.task_status,
    'postponed'::public.task_status
  ) then
    raise exception 'Task cannot receive an assistant outcome from state %', v_old_status;
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into v_attempt
  from public.task_outcomes
  where task_id = p_task_id;

  insert into public.task_outcomes (
    task_id,
    assistant_id,
    outcome_code,
    reached_merchant,
    commitment_received,
    expected_amount,
    expected_by,
    postponement_reason,
    callback_at,
    notes,
    attempt_number
  ) values (
    p_task_id,
    auth.uid(),
    p_outcome_code,
    p_reached_merchant,
    p_commitment_received,
    p_expected_amount,
    p_expected_by,
    nullif(trim(coalesce(p_postponement_reason, '')), ''),
    p_callback_at,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_attempt
  );

  update public.tasks
  set status = p_final_status
  where id = p_task_id
  returning * into v_task;

  insert into public.audit_events (
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'assistant', 'task_outcome_submitted', 'task', v_task.id::text,
    jsonb_build_object(
      'from_status', v_old_status::text,
      'to_status', p_final_status::text,
      'outcome_code', p_outcome_code::text,
      'attempt_number', v_attempt
    )
  );

  return v_task;
end;
$$;

revoke all on function public.submit_my_task_outcome(
  uuid,
  public.task_outcome_code,
  public.task_status,
  boolean,
  boolean,
  numeric,
  timestamptz,
  text,
  timestamptz,
  text
) from public;

grant execute on function public.submit_my_task_outcome(
  uuid,
  public.task_outcome_code,
  public.task_status,
  boolean,
  boolean,
  numeric,
  timestamptz,
  text,
  timestamptz,
  text
) to authenticated;

create or replace function public.rollover_task(
  p_task_id uuid,
  p_target_date date,
  p_reason text
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.tasks;
  v_new public.tasks;
begin
  if not public.is_director() then
    raise exception 'Director role required';
  end if;

  select * into v_source from public.tasks where id = p_task_id;
  if v_source.id is null then
    raise exception 'Source task not found';
  end if;

  insert into public.tasks (
    task_date,
    task_type,
    status,
    priority,
    merchant_id,
    terminal_id,
    assigned_to,
    reason,
    recommended_talking_points,
    due_at,
    rolled_from_task_id,
    created_by
  ) values (
    p_target_date,
    v_source.task_type,
    'assigned'::public.task_status,
    least(v_source.priority + 1, 5),
    v_source.merchant_id,
    v_source.terminal_id,
    v_source.assigned_to,
    p_reason,
    v_source.recommended_talking_points,
    null,
    v_source.id,
    auth.uid()
  ) returning * into v_new;

  insert into public.audit_events (
    actor_user_id, actor_kind, event_type, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'director', 'task_rolled_over', 'task', v_new.id::text,
    jsonb_build_object('rolled_from_task_id', v_source.id::text, 'target_date', p_target_date::text)
  );

  return v_new;
end;
$$;

revoke all on function public.rollover_task(uuid, date, text) from public;
grant execute on function public.rollover_task(uuid, date, text) to authenticated;
