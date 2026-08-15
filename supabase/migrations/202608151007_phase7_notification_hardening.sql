-- Phase 7 hardening: push tokens are operational routing identifiers, not UI data.
-- Device registration remains behind the authenticated RPC, and transient failed push
-- deliveries may be reclaimed once inside the same reminder window.

drop policy if exists mobile_devices_self_insert on public.mobile_devices;
drop policy if exists mobile_devices_self_update on public.mobile_devices;
drop policy if exists mobile_devices_self_delete on public.mobile_devices;

revoke all on public.mobile_devices from authenticated;
grant select (
  id,
  user_id,
  platform,
  device_label,
  notifications_granted,
  exact_alarm_capable,
  app_version,
  enabled,
  last_seen_at,
  created_at,
  updated_at
) on public.mobile_devices to authenticated;

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
      occurrence_id,device_id,stage,sequence_no,notification_key,status,last_error,updated_at
    )
    select due.occurrence_id,due.device_id,due.stage,due.sequence_no,due.notification_key,'queued',null,now()
    from due
    on conflict(notification_key) do update
      set status='queued',last_error=null,updated_at=now()
      where public.meeting_notification_deliveries.status='failed'
    returning
      public.meeting_notification_deliveries.id,
      public.meeting_notification_deliveries.occurrence_id,
      public.meeting_notification_deliveries.device_id,
      public.meeting_notification_deliveries.stage,
      public.meeting_notification_deliveries.notification_key
  )
  select i.id,d.expo_push_token,d.platform,x.stage,x.title,x.body,x.meeting_url,x.occurrence_id,x.starts_at
  from inserted i
  join due x on x.notification_key=i.notification_key
  join director_devices d on d.id=i.device_id;
end;
$$;

revoke all on function public.meeting_claim_notifications(text) from public,anon,authenticated;
grant execute on function public.meeting_claim_notifications(text) to anon;
