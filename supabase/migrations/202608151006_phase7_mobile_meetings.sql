-- Phase 7: mobile meeting reminders and synced acknowledgement state.
-- Meeting times are stored in Africa/Lagos and materialized into timestamped occurrences.
-- Push dispatch reuses the existing private Phase 5 bridge token; no new secret is exposed.

create table public.meeting_series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  enabled boolean not null default true,
  timezone text not null default 'Africa/Lagos' check (timezone = 'Africa/Lagos'),
  recurrence_kind text not null check (recurrence_kind in ('weekly','monthly_weekday_set')),
  weekday smallint not null check (weekday between 0 and 6),
  month_ordinals smallint[] not null default '{}'::smallint[],
  start_time time not null,
  meeting_url text,
  reminder_10_minutes boolean not null default true,
  reminder_2_minutes boolean not null default true,
  escalation_after_minutes integer not null default 4 check (escalation_after_minutes between 1 and 30),
  escalation_repeat_minutes integer not null default 2 check (escalation_repeat_minutes between 1 and 30),
  escalation_max_hours integer not null default 6 check (escalation_max_hours between 1 and 12),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_series_weekly_ordinals check (
    (recurrence_kind='weekly' and coalesce(array_length(month_ordinals,1),0)=0)
    or
    (recurrence_kind='monthly_weekday_set' and coalesce(array_length(month_ordinals,1),0)>0)
  ),
  constraint meeting_series_https_url check (meeting_url is null or meeting_url ~ '^https://')
);

create table public.meeting_occurrences (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.meeting_series(id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','joined','cancelled')),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id, starts_at)
);

create table public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios','android')),
  device_label text,
  notifications_granted boolean not null default false,
  exact_alarm_capable boolean not null default false,
  app_version text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meeting_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.meeting_occurrences(id) on delete cascade,
  device_id uuid not null references public.mobile_devices(id) on delete cascade,
  stage text not null check (stage in ('pre10','pre2','escalation')),
  sequence_no integer not null default 0 check (sequence_no >= 0),
  notification_key text not null unique,
  status text not null default 'queued' check (status in ('queued','sent','failed','cancelled')),
  expo_ticket_id text,
  last_error text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index meeting_occurrences_start_idx on public.meeting_occurrences(starts_at,status);
create index meeting_occurrences_series_idx on public.meeting_occurrences(series_id,starts_at);
create index mobile_devices_user_idx on public.mobile_devices(user_id,enabled,last_seen_at desc);
create index meeting_delivery_occurrence_idx on public.meeting_notification_deliveries(occurrence_id,stage,queued_at desc);
create index meeting_delivery_status_idx on public.meeting_notification_deliveries(status,queued_at);

alter table public.meeting_series enable row level security;
alter table public.meeting_occurrences enable row level security;
alter table public.mobile_devices enable row level security;
alter table public.meeting_notification_deliveries enable row level security;

create policy meeting_series_director_read on public.meeting_series
for select to authenticated using (public.is_director());
create policy meeting_series_director_manage on public.meeting_series
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy meeting_occurrences_director_read on public.meeting_occurrences
for select to authenticated using (public.is_director());
create policy meeting_occurrences_director_manage on public.meeting_occurrences
for all to authenticated using (public.is_director()) with check (public.is_director());

create policy mobile_devices_self_read on public.mobile_devices
for select to authenticated using (user_id=auth.uid());
create policy mobile_devices_self_insert on public.mobile_devices
for insert to authenticated with check (user_id=auth.uid());
create policy mobile_devices_self_update on public.mobile_devices
for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy mobile_devices_self_delete on public.mobile_devices
for delete to authenticated using (user_id=auth.uid());
create policy mobile_devices_director_read on public.mobile_devices
for select to authenticated using (public.is_director());

create policy meeting_deliveries_director_read on public.meeting_notification_deliveries
for select to authenticated using (public.is_director());

revoke all on public.meeting_series from anon;
revoke all on public.meeting_occurrences from anon;
revoke all on public.mobile_devices from anon;
revoke all on public.meeting_notification_deliveries from anon;
grant select,insert,update,delete on public.meeting_series to authenticated;
grant select,insert,update,delete on public.meeting_occurrences to authenticated;
grant select,insert,update,delete on public.mobile_devices to authenticated;
grant select on public.meeting_notification_deliveries to authenticated;

insert into public.meeting_series(
  slug,name,recurrence_kind,weekday,month_ordinals,start_time,
  reminder_10_minutes,reminder_2_minutes,escalation_after_minutes,escalation_repeat_minutes
) values
  ('cluster-meeting','Cluster Meeting','weekly',2,'{}'::smallint[],'20:00',true,true,4,2),
  ('zonal-meeting','Zonal Meeting','monthly_weekday_set',4,array[2,-1]::smallint[],'09:00',true,true,4,2)
on conflict(slug) do nothing;

create or replace function public.meeting_date_matches(
  p_date date,
  p_kind text,
  p_weekday smallint,
  p_ordinals smallint[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when extract(dow from p_date)::smallint <> p_weekday then false
    when p_kind='weekly' then true
    when p_kind='monthly_weekday_set' then
      ceil(extract(day from p_date) / 7.0)::smallint = any(p_ordinals)
      or (
        -1 = any(p_ordinals)
        and extract(month from p_date + 7) <> extract(month from p_date)
      )
    else false
  end
$$;

create or replace function public.materialize_meeting_occurrences(
  p_start_date date default null,
  p_days integer default 120
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := coalesce(p_start_date,(now() at time zone 'Africa/Lagos')::date);
  v_days integer := greatest(1,least(coalesce(p_days,120),365));
  v_count integer := 0;
begin
  insert into public.meeting_occurrences(series_id,starts_at)
  select
    s.id,
    ((d::date + s.start_time) at time zone s.timezone)
  from public.meeting_series s
  cross join generate_series(v_start,v_start + (v_days-1),interval '1 day') d
  where s.enabled
    and public.meeting_date_matches(d::date,s.recurrence_kind,s.weekday,s.month_ordinals)
  on conflict(series_id,starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.materialize_meeting_occurrences(date,integer) from public,anon,authenticated;

create or replace function public.refresh_meeting_calendar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_created integer;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  v_created := public.materialize_meeting_occurrences((now() at time zone 'Africa/Lagos')::date,180);
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(auth.uid(),'director','meeting_calendar_refreshed','meeting_series','all',jsonb_build_object('occurrencesCreated',v_created));
  return jsonb_build_object('occurrencesCreated',v_created);
end;
$$;
revoke all on function public.refresh_meeting_calendar() from public,anon;
grant execute on function public.refresh_meeting_calendar() to authenticated;

create or replace function public.update_meeting_series(
  p_id uuid,
  p_enabled boolean,
  p_start_time time,
  p_meeting_url text,
  p_reminder_10_minutes boolean,
  p_reminder_2_minutes boolean,
  p_escalation_after_minutes integer,
  p_escalation_repeat_minutes integer
)
returns public.meeting_series
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.meeting_series;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  if p_meeting_url is not null and nullif(btrim(p_meeting_url),'') is not null and p_meeting_url !~ '^https://' then
    raise exception 'Meeting URL must use HTTPS';
  end if;
  update public.meeting_series set
    enabled=coalesce(p_enabled,true),
    start_time=coalesce(p_start_time,start_time),
    meeting_url=nullif(btrim(p_meeting_url),''),
    reminder_10_minutes=coalesce(p_reminder_10_minutes,true),
    reminder_2_minutes=coalesce(p_reminder_2_minutes,true),
    escalation_after_minutes=greatest(1,least(30,coalesce(p_escalation_after_minutes,4))),
    escalation_repeat_minutes=greatest(1,least(30,coalesce(p_escalation_repeat_minutes,2))),
    updated_by=auth.uid(),updated_at=now()
  where id=p_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Meeting series not found'; end if;

  -- Future materialized rows follow the updated time. Joined/cancelled history remains immutable.
  delete from public.meeting_occurrences
  where series_id=p_id and status='scheduled' and starts_at>now();
  perform public.materialize_meeting_occurrences((now() at time zone 'Africa/Lagos')::date,180);

  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(auth.uid(),'director','meeting_series_updated','meeting_series',v_row.id::text,
    jsonb_build_object('name',v_row.name,'enabled',v_row.enabled,'startTime',v_row.start_time,'meetingUrlConfigured',v_row.meeting_url is not null,'escalationRepeatMinutes',v_row.escalation_repeat_minutes));
  return v_row;
end;
$$;
revoke all on function public.update_meeting_series(uuid,boolean,time,text,boolean,boolean,integer,integer) from public,anon;
grant execute on function public.update_meeting_series(uuid,boolean,time,text,boolean,boolean,integer,integer) to authenticated;

create or replace function public.register_mobile_device(
  p_expo_push_token text,
  p_platform text,
  p_device_label text,
  p_notifications_granted boolean,
  p_exact_alarm_capable boolean,
  p_app_version text
)
returns public.mobile_devices
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.mobile_devices;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_platform not in ('ios','android') then raise exception 'Unsupported mobile platform'; end if;
  if nullif(btrim(coalesce(p_expo_push_token,'')),'') is null then raise exception 'Push token required'; end if;
  insert into public.mobile_devices(user_id,expo_push_token,platform,device_label,notifications_granted,exact_alarm_capable,app_version,enabled,last_seen_at,updated_at)
  values(auth.uid(),btrim(p_expo_push_token),p_platform,nullif(btrim(p_device_label),''),coalesce(p_notifications_granted,false),coalesce(p_exact_alarm_capable,false),nullif(btrim(p_app_version),''),true,now(),now())
  on conflict(expo_push_token) do update set
    user_id=excluded.user_id,
    platform=excluded.platform,
    device_label=excluded.device_label,
    notifications_granted=excluded.notifications_granted,
    exact_alarm_capable=excluded.exact_alarm_capable,
    app_version=excluded.app_version,
    enabled=true,
    last_seen_at=now(),
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.register_mobile_device(text,text,text,boolean,boolean,text) from public,anon;
grant execute on function public.register_mobile_device(text,text,text,boolean,boolean,text) to authenticated;

create or replace function public.acknowledge_meeting_occurrence(p_occurrence_id uuid)
returns public.meeting_occurrences
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.meeting_occurrences;
begin
  if not public.is_director() then raise exception 'Director role required'; end if;
  update public.meeting_occurrences set
    status='joined',acknowledged_at=coalesce(acknowledged_at,now()),acknowledged_by=coalesce(acknowledged_by,auth.uid()),updated_at=now()
  where id=p_occurrence_id and status<>'cancelled'
  returning * into v_row;
  if v_row.id is null then raise exception 'Meeting occurrence not found or cancelled'; end if;
  update public.meeting_notification_deliveries set status='cancelled',updated_at=now()
  where occurrence_id=p_occurrence_id and status='queued';
  insert into public.audit_events(actor_user_id,actor_kind,event_type,entity_type,entity_id,payload)
  values(auth.uid(),'director','meeting_join_acknowledged','meeting_occurrence',v_row.id::text,
    jsonb_build_object('startsAt',v_row.starts_at,'acknowledgedAt',v_row.acknowledged_at));
  return v_row;
end;
$$;
revoke all on function public.acknowledge_meeting_occurrence(uuid) from public,anon;
grant execute on function public.acknowledge_meeting_occurrence(uuid) to authenticated;

create or replace function public.meeting_claim_notifications(p_token text)
returns table(
  delivery_id uuid,
  expo_push_token text,
  platform text,
  stage text,
  title text,
  body text,
  meeting_url text,
  occurrence_id uuid,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  perform pg_advisory_xact_lock(hashtext('monie_ops_meeting_notifications'));
  perform public.materialize_meeting_occurrences((now() at time zone 'Africa/Lagos')::date,120);

  return query
  with director_devices as (
    select d.id,d.expo_push_token,d.platform
    from public.mobile_devices d
    join public.profiles p on p.id=d.user_id
    where d.enabled and d.notifications_granted and p.role='director'::public.app_role and p.is_active
  ), due as (
    select o.id occurrence_id,s.id series_id,s.name,s.meeting_url,o.starts_at,d.id device_id,d.expo_push_token,d.platform,
           'pre10'::text stage,0 sequence_no,
           format('%s:%s:pre10',o.id,d.id) notification_key,
           format('10 minutes to %s',s.name) title,
           format('It''s 10 minutes to %s.',s.name) body
    from public.meeting_occurrences o
    join public.meeting_series s on s.id=o.series_id and s.enabled
    cross join director_devices d
    where o.status='scheduled' and s.reminder_10_minutes
      and now()>=o.starts_at-interval '10 minutes' and now()<o.starts_at-interval '8 minutes'
    union all
    select o.id,s.id,s.name,s.meeting_url,o.starts_at,d.id,d.expo_push_token,d.platform,
           'pre2',0,format('%s:%s:pre2',o.id,d.id),
           format('2 minutes to %s',s.name),
           format('2 minutes to %s — drop everything you''re doing and join now.',s.name)
    from public.meeting_occurrences o
    join public.meeting_series s on s.id=o.series_id and s.enabled
    cross join director_devices d
    where o.status='scheduled' and s.reminder_2_minutes
      and now()>=o.starts_at-interval '2 minutes' and now()<o.starts_at+make_interval(mins=>s.escalation_after_minutes)
    union all
    select o.id,s.id,s.name,s.meeting_url,o.starts_at,d.id,d.expo_push_token,d.platform,
           'escalation',
           floor(extract(epoch from (now()-(o.starts_at+make_interval(mins=>s.escalation_after_minutes))))/(s.escalation_repeat_minutes*60))::integer,
           format('%s:%s:escalation:%s',o.id,d.id,floor(extract(epoch from (now()-(o.starts_at+make_interval(mins=>s.escalation_after_minutes))))/(s.escalation_repeat_minutes*60))::integer),
           format('%s has started',s.name),
           format('%s has started. Have you joined? Tap “Yes, I have joined” to stop these reminders.',s.name)
    from public.meeting_occurrences o
    join public.meeting_series s on s.id=o.series_id and s.enabled
    cross join director_devices d
    where o.status='scheduled'
      and now()>=o.starts_at+make_interval(mins=>s.escalation_after_minutes)
      and now()<o.starts_at+make_interval(hours=>s.escalation_max_hours)
  ), inserted as (
    insert into public.meeting_notification_deliveries(
      occurrence_id,device_id,stage,sequence_no,notification_key,status
    )
    select occurrence_id,device_id,stage,sequence_no,notification_key,'queued'
    from due
    on conflict(notification_key) do nothing
    returning id,occurrence_id,device_id,stage,notification_key
  )
  select i.id,d.expo_push_token,d.platform,x.stage,x.title,x.body,x.meeting_url,x.occurrence_id,x.starts_at
  from inserted i
  join due x on x.notification_key=i.notification_key
  join director_devices d on d.id=i.device_id;
end;
$$;
revoke all on function public.meeting_claim_notifications(text) from public,anon,authenticated;
grant execute on function public.meeting_claim_notifications(text) to anon;

create or replace function public.meeting_complete_notification(
  p_token text,
  p_delivery_id uuid,
  p_status text,
  p_ticket_id text,
  p_error text,
  p_disable_device boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_device_id uuid;
begin
  if not public.automation_bridge_valid(p_token) then raise exception 'Invalid automation token'; end if;
  if p_status not in ('sent','failed') then raise exception 'Invalid delivery status'; end if;
  update public.meeting_notification_deliveries set
    status=p_status,
    expo_ticket_id=nullif(btrim(p_ticket_id),''),
    last_error=nullif(left(coalesce(p_error,''),500),''),
    sent_at=case when p_status='sent' then now() else sent_at end,
    updated_at=now()
  where id=p_delivery_id
  returning device_id into v_device_id;
  if v_device_id is null then raise exception 'Delivery not found'; end if;
  if coalesce(p_disable_device,false) then
    update public.mobile_devices set enabled=false,updated_at=now() where id=v_device_id;
  end if;
end;
$$;
revoke all on function public.meeting_complete_notification(text,uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.meeting_complete_notification(text,uuid,text,text,text,boolean) to anon;

create or replace function public.dispatch_meeting_notification_worker()
returns bigint
language plpgsql
security definer
set search_path = public,vault,net
as $$
declare v_token text; v_request_id bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='monie_ops_automation_bridge_token' limit 1;
  if v_token is null then raise exception 'Automation bridge token is missing'; end if;
  select net.http_post(
    url:='https://monie-ops-hub.lovable.app/api/meeting-notifications',
    headers:=jsonb_build_object('Content-Type','application/json','x-monie-automation-token',v_token),
    body:='{}'::jsonb,
    timeout_milliseconds:=5000
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.dispatch_meeting_notification_worker() from public,anon,authenticated;

select public.materialize_meeting_occurrences((now() at time zone 'Africa/Lagos')::date,180);

select cron.unschedule(jobname)
from cron.job
where jobname in ('monie-ops-meeting-calendar','monie-ops-meeting-notifications');

select cron.schedule(
  'monie-ops-meeting-calendar',
  '5 0 * * *',
  'select public.materialize_meeting_occurrences((now() at time zone ''Africa/Lagos'')::date,180)'
);
select cron.schedule(
  'monie-ops-meeting-notifications',
  '* * * * *',
  'select public.dispatch_meeting_notification_worker()'
);
