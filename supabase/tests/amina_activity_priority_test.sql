begin;
select plan(7);

select is(
  public.amina_activity_priority_value(50000) > public.amina_activity_priority_value(30000),
  true,
  '50k is prioritised above 30k'
);
select is(
  public.amina_activity_priority_value(30000) > public.amina_activity_priority_value(15000),
  true,
  '30k is prioritised above 15k'
);
select is(
  public.amina_activity_priority_value(15000) > public.amina_activity_priority_value(0),
  true,
  'a currently transacting BO is prioritised above zero transactions'
);
select is(
  public.amina_activity_priority_value(0),
  0::numeric,
  'zero-transaction candidates remain in the later priority group'
);

select ok(
  to_regprocedure('public.update_merchant_contact_details(uuid,text,text)') is not null,
  'Director contact update RPC exists'
);
select ok(
  exists(
    select 1 from pg_trigger
    where tgname = 'merchants_preserve_director_manual_contacts' and not tgisinternal
  ),
  'Director-entered contacts are protected from automated overwrite'
);
select ok(
  exists(
    select 1 from pg_trigger
    where tgname = 'agent_recommendations_amina_activity_priority' and not tgisinternal
  ),
  'Amina activity-first ranking is attached to recommendation creation'
);

select * from finish();
rollback;
