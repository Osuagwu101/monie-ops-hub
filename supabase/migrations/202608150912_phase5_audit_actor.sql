-- Phase 5 scheduled workers are first-class audited actors.
alter table public.audit_events drop constraint if exists audit_events_actor_kind_check;
alter table public.audit_events
  add constraint audit_events_actor_kind_check
  check (actor_kind = any (array[
    'director'::text,
    'assistant'::text,
    'system'::text,
    'automation'::text,
    'amina'::text,
    'emeka'::text,
    'zainab'::text,
    'tunde'::text
  ]));
