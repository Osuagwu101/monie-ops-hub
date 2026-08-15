-- Live Moniepoint mirror, BO contact enrichment and 15-contact human support capacity.
-- The official report remains authoritative for targets and transaction performance.

alter table public.operating_config
  add column if not exists daily_contact_capacity integer not null default 15
  check (daily_contact_capacity between 7 and 30);

update public.operating_config set daily_contact_capacity = 15 where id = true;

alter table public.tasks drop constraint if exists tasks_queue_rank_check;
alter table public.tasks
  add constraint tasks_queue_rank_check check (queue_rank between 1 and 15);

alter table public.merchants
  add column if not exists account_number text,
  add column if not exists contact_source text,
  add column if not exists contact_synced_at timestamptz;

create table if not exists public.dashboard_mirror_snapshots (
  id uuid primary key default gen_random_uuid(),
  automation_run_id uuid references public.automation_runs(id) on delete set null,
  report_id uuid references public.report_imports(id) on delete set null,
  captured_at timestamptz not null default now(),
  source_url text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.dashboard_mirror_snapshots enable row level security;
drop policy if exists dashboard_mirror_director_read on public.dashboard_mirror_snapshots;
create policy dashboard_mirror_director_read on public.dashboard_mirror_snapshots
for select to authenticated using (public.is_director());
revoke all on public.dashboard_mirror_snapshots from anon;
grant select on public.dashboard_mirror_snapshots to authenticated;

create table if not exists public.bo_attention_queue (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  queue_rank smallint not null check (queue_rank between 1 and 15),
  report_id uuid not null references public.report_imports(id) on delete cascade,
  merchant_id uuid references public.merchants(id) on delete cascade,
  terminal_id uuid not null references public.terminals(id) on delete cascade,
  snapshot_id uuid not null references public.terminal_performance_snapshots(id) on delete cascade,
  priority_score numeric(6,2) not null,
  created_at timestamptz not null default now(),
  unique(plan_date, queue_rank),
  unique(plan_date, terminal_id)
);

alter table public.bo_attention_queue enable row level security;
drop policy if exists bo_attention_director_read on public.bo_attention_queue;
create policy bo_attention_director_read on public.bo_attention_queue
for select to authenticated using (public.is_director());
revoke all on public.bo_attention_queue from anon;
grant select on public.bo_attention_queue to authenticated;

create or replace function public.refresh_bo_attention_queue(
  p_report_id uuid,
  p_plan_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_date date := coalesce(p_plan_date, (now() at time zone 'Africa/Lagos')::date);
  v_count integer := 0;
begin
  if not public.is_director()
     and coalesce(current_setting('app.automation_authorized', true),'') <> '1' then
    raise exception 'Director or automation authorization required';
  end if;

  if not exists(select 1 from public.report_imports where id=p_report_id and processing_status='processed') then
    raise exception 'Processed report not found';
  end if;

  delete from public.bo_attention_queue where plan_date=v_plan_date;

  insert into public.bo_attention_queue(
    plan_date, queue_rank, report_id, merchant_id, terminal_id, snapshot_id, priority_score
  )
  select
    v_plan_date,
    row_number() over(order by scored.priority_score desc, scored.terminal_external_id)::smallint,
    p_report_id,
    scored.merchant_id,
    scored.terminal_id,
    scored.snapshot_id,
    scored.priority_score
  from (
    select
      s.id snapshot_id,
      s.terminal_id,
      t.terminal_id terminal_external_id,
      t.merchant_id,
      round(
        least(100::numeric,
          greatest(0::numeric,
            35
            + least(coalesce(s.days_since_last_transaction,0),5) * 5
            + case
                when coalesce(s.official_target_value,0) > 0 then
                  least(40::numeric,
                    greatest(0::numeric,
                      (s.official_target_value - (coalesce(s.payment_value,0)+coalesce(s.transfer_value,0)))
                      / nullif(s.official_target_value,0) * 40
                    )
                  )
                else 0
              end
          )
        ), 2
      ) priority_score
    from public.terminal_performance_snapshots s
    join public.terminals t on t.id=s.terminal_id
    where s.report_id=p_report_id
      and s.period_kind='rolling_7_day'
      and s.official_target_value > 0
      and s.official_target_met=false
  ) scored
  order by scored.priority_score desc, scored.terminal_external_id
  limit 15;

  get diagnostics v_count = row_count;
  return jsonb_build_object('queueDate',v_plan_date,'candidateCount',v_count,'capacity',15);
end;
$$;
revoke all on function public.refresh_bo_attention_queue(uuid,date) from public, anon;
grant execute on function public.refresh_bo_attention_queue(uuid,date) to authenticated;

create or replace function public.extend_human_support_queue(
  p_assistant_id uuid,
  p_plan_date date,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity integer;
  v_current integer;
  v_added integer := 0;
  v_emeka_run uuid;
  v_rec record;
  v_rank integer;
begin
  if not public.is_director()
     and coalesce(current_setting('app.automation_authorized', true),'') <> '1' then
    raise exception 'Director or automation authorization required';
  end if;

  select daily_contact_capacity into v_capacity from public.operating_config where id=true;
  v_capacity := greatest(7, least(15, coalesce(v_capacity,15)));

  select count(*) into v_current
  from public.tasks
  where assigned_to=p_assistant_id and task_date=p_plan_date;

  if v_current >= v_capacity then
    return jsonb_build_object('capacity',v_capacity,'existing',v_current,'added',0);
  end if;

  select id into v_emeka_run
  from public.agent_runs
  where agent_kind='emeka' and assistant_id=p_assistant_id and plan_date=p_plan_date and report_id=p_report_id
  order by created_at desc limit 1;

  if v_emeka_run is null then
    return jsonb_build_object('capacity',v_capacity,'existing',v_current,'added',0,'reason','emeka_run_missing');
  end if;

  v_rank := v_current;
  for v_rec in
    select r.*, m.phone_number
    from public.agent_recommendations r
    join public.merchants m on m.id=r.merchant_id
    where r.run_id=v_emeka_run
      and r.recommendation_kind='ta_priority'
      and r.status='open'
      and nullif(trim(coalesce(m.phone_number,'')),'') is not null
      and not exists(
        select 1 from public.tasks t
        where t.assigned_to=p_assistant_id and t.task_date=p_plan_date and t.terminal_id=r.terminal_id
      )
    order by r.score desc, r.created_at
    limit greatest(0,v_capacity-v_current)
  loop
    v_rank := v_rank + 1;
    insert into public.tasks(
      task_date,task_type,status,priority,merchant_id,terminal_id,assigned_to,
      reason,recommended_talking_points,due_at,created_by,queue_rank,auto_generated,
      planning_report_id,source_agent_recommendation_id
    ) values(
      p_plan_date,'TA'::public.task_type,'assigned'::public.task_status,
      greatest(1,least(5,ceil(coalesce(v_rec.score,50)/20)::integer)),
      v_rec.merchant_id,v_rec.terminal_id,p_assistant_id,
      v_rec.rationale,v_rec.talking_points,
      (p_plan_date::timestamp + time '18:00') at time zone 'Africa/Lagos',
      null,v_rank::smallint,true,p_report_id,v_rec.id
    );
    update public.agent_recommendations set status='accepted' where id=v_rec.id;
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('capacity',v_capacity,'requiredTarget',7,'existing',v_current,'added',v_added,'total',v_current+v_added);
end;
$$;
revoke all on function public.extend_human_support_queue(uuid,date,uuid) from public, anon;
grant execute on function public.extend_human_support_queue(uuid,date,uuid) to authenticated;

create or replace function public.apply_moniepoint_enrichment(
  p_token text,
  p_run_id uuid,
  p_contacts jsonb,
  p_dashboard jsonb,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_report_id uuid;
  v_item jsonb;
  v_requested text;
  v_phone text;
  v_account text;
  v_status text;
  v_matches integer;
  v_merchant_id uuid;
  v_updated integer := 0;
  v_plan_date date := (now() at time zone 'Africa/Lagos')::date;
  v_assistant record;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  select report_id into v_report_id from public.automation_runs where id=p_run_id;
  if v_report_id is null then raise exception 'Automation run has no staged report'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) loop
    v_requested := nullif(trim(coalesce(v_item->>'requestedName',v_item->>'matchedName','')),'');
    v_phone := nullif(trim(coalesce(v_item->>'phoneNumber','')),'');
    v_account := nullif(trim(coalesce(v_item->>'accountNumber','')),'');
    v_status := lower(coalesce(v_item->>'status',''));
    if v_requested is null or v_status <> 'matched' then continue; end if;

    select count(*), min(id::text)::uuid into v_matches, v_merchant_id
    from public.merchants
    where lower(trim(business_name))=lower(trim(v_requested));

    if v_matches=1 then
      update public.merchants
      set phone_number=coalesce(v_phone,phone_number),
          account_number=coalesce(v_account,account_number),
          contact_source='moniepoint_team_management',
          contact_synced_at=now(),
          updated_at=now()
      where id=v_merchant_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  if p_dashboard is not null and jsonb_typeof(p_dashboard)='object' then
    insert into public.dashboard_mirror_snapshots(automation_run_id,report_id,captured_at,source_url,payload)
    values(p_run_id,v_report_id,now(),nullif(trim(coalesce(p_source_url,'')),''),p_dashboard);
  end if;

  perform set_config('app.automation_authorized','1',true);
  perform public.refresh_bo_attention_queue(v_report_id,v_plan_date);
  perform public.reconcile_ta_tasks_for_report(v_report_id);

  for v_assistant in
    select id from public.profiles
    where role='assistant'::public.app_role and is_active=true
    order by created_at
  loop
    perform public.run_operations_team(v_assistant.id,v_plan_date,v_report_id);
    perform public.extend_human_support_queue(v_assistant.id,v_plan_date,v_report_id);
  end loop;

  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(null,'automation','moniepoint_enrichment_applied','report_import',v_report_id::text,
    jsonb_build_object('contactsUpdated',v_updated,'dashboardCaptured',p_dashboard is not null));

  return jsonb_build_object('reportId',v_report_id,'contactsUpdated',v_updated,'planDate',v_plan_date);
end;
$$;
revoke all on function public.apply_moniepoint_enrichment(text,uuid,jsonb,jsonb,text) from public;
grant execute on function public.apply_moniepoint_enrichment(text,uuid,jsonb,jsonb,text) to anon, authenticated;

-- A fresh official report may arrive from an authenticated Director or the private automation bridge.
create or replace function public.phase4_after_report_processed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assistant record;
  v_plan_date date;
begin
  if new.processing_status <> 'processed'
     or old.processing_status = 'processed'
     or (
       not public.is_director()
       and coalesce(current_setting('app.automation_authorized',true),'') <> '1'
     ) then
    return new;
  end if;

  v_plan_date := (now() at time zone 'Africa/Lagos')::date;
  perform public.refresh_bo_attention_queue(new.id,v_plan_date);
  perform public.reconcile_ta_tasks_for_report(new.id);

  for v_assistant in
    select id from public.profiles
    where role='assistant'::public.app_role and is_active=true
    order by created_at
  loop
    perform public.run_operations_team(v_assistant.id,v_plan_date,new.id);
    perform public.extend_human_support_queue(v_assistant.id,v_plan_date,new.id);
  end loop;
  return new;
exception when others then
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(null,'system','phase4_auto_replan_failed','report_import',new.id::text,jsonb_build_object('error',sqlerrm));
  return new;
end;
$$;
