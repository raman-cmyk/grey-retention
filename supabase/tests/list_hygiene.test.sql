begin;
select plan(43);

-- PICK-101: list hygiene. Workspace 101: owner ...01, staff ...05, admin
-- ...06. Workspace 102: owner ...04.
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.set(on_ boolean, days integer, rev integer,
    t text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select public.set_list_hygiene(t::uuid, on_, days, rev)
$$;

-- Grants and row level security.
select ok(not bool_or(has_table_privilege(r,tbl,p)),'nobody writes '||tbl||' directly')
  from unnest(array['anon','authenticated','service_role']) r,
    unnest(array['public.list_hygiene_settings','public.klaviyo_hygiene_segments']) tbl,
    unnest(array['insert','update','delete','truncate','references','trigger']) p
  group by tbl;
select ok(not has_table_privilege('anon',tbl,'select'),'anonymous visitors cannot read '||tbl)
  from unnest(array['public.list_hygiene_settings','public.klaviyo_hygiene_segments']) tbl;
select ok((select relrowsecurity from pg_class where oid=tbl::regclass),'row level security is on for '||tbl)
  from unnest(array['public.list_hygiene_settings','public.klaviyo_hygiene_segments']) tbl;
select ok(has_function_privilege('authenticated','public.set_list_hygiene(uuid,boolean,integer,integer)','execute')
  and not has_function_privilege('anon','public.set_list_hygiene(uuid,boolean,integer,integer)','execute'),
  'signed-in members may call set_list_hygiene (it checks the owner itself)');
select ok(has_function_privilege('service_role','public.save_hygiene_segment(uuid,uuid,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.save_hygiene_segment(uuid,uuid,text,jsonb)','execute')
  and not has_function_privilege('anon','public.save_hygiene_segment(uuid,uuid,text,jsonb)','execute'),
  'only the worker saves the hygiene segment');

-- Owner only: staff, an admin and another workspace's owner are refused.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select throws_ok($$select pg_temp.set(true,90,0)$$,'42501',null,'staff cannot change list hygiene');
select pg_temp.as_member('00000000-0000-4000-8000-000000000006');
select throws_ok($$select pg_temp.set(true,90,0)$$,'42501',null,'an admin cannot change list hygiene');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.set(true,90,0)$$,'42501',null,'another workspace''s owner cannot change it');

-- The owner: bounds, revisions, no-op saves, the change history.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.set(true,29,0)$$,'23514',null,'fewer than 30 days is refused');
select throws_ok($$select pg_temp.set(true,731,0)$$,'23514',null,'more than 730 days is refused');
select throws_ok($$select pg_temp.set(null,180,0)$$,'23514',null,'on or off must be said');
select is(pg_temp.set(true,180,0),0,'saving the default with no row changes nothing');
select is((select count(*)::integer from public.list_hygiene_settings),0,'and keeps no row');
select throws_ok($$select pg_temp.set(true,90,3)$$,'PT409',null,'a stale page cannot save');
select is(pg_temp.set(true,90,0),1,'the owner sets 90 days');
select throws_ok($$select pg_temp.set(false,90,0)$$,'PT409',null,'another window''s revision is refused');
select is(pg_temp.set(true,90,1),1,'the same setting again changes nothing');
select is(pg_temp.set(false,90,1),2,'the owner turns hygiene off');
select results_eq($$select enabled, days, revision from public.list_hygiene_settings$$,
  $$values (false, 90::smallint, 2)$$,'the row says off, 90 days, revision 2');

-- Members read their own workspace only.
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.list_hygiene_settings),1,'staff read their store''s setting');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.list_hygiene_settings),0,'another workspace cannot read it');
reset role;
select set_eq($$select detail from public.workspace_events where kind='list_hygiene_changed'$$,
  $$values ('{"from_enabled":true,"from_days":180,"to_enabled":true,"to_days":90}'::jsonb),
    ('{"from_enabled":true,"from_days":90,"to_enabled":false,"to_days":90}'::jsonb)$$,
  'each real change is in the change history');

-- The hygiene segment: saved only under a build's exact push lease.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"},{"date":"2099-01-02","time":"10:00","emailType":"offer"}]}',
   '00000000-0000-4000-8000-000000000001');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, email, lease_token, lease_until, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c101','push_queued','push','{}','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,
   '00000000-0000-4000-8000-00000000c102','push_queued','push','{}','00000000-0000-4000-8000-00000000bbbb',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now());
create function pg_temp.save(step jsonb, b text default '00000000-0000-4000-8000-00000000b101',
    l text default '00000000-0000-4000-8000-00000000aaaa', r text default 'v1-180') returns void language sql as $$
  select public.save_hygiene_segment(b::uuid, l::uuid, r, step)
$$;

set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.save('{"state":"creating"}')$$,'42501',null,'no request role, no save');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.save('{"state":"creating"}')$$,'42501',null,'an owner''s request cannot save');
select pg_temp.as_worker();
select throws_ok($$select pg_temp.save('{"state":"creating"}','00000000-0000-4000-8000-00000000b101',
  '00000000-0000-4000-8000-00000000abcd')$$,'PT409',null,'not with another lease');
select throws_ok(format('select pg_temp.save(%L::jsonb)', x),'23514',null,'refused step: '||x)
  from unnest(array['{}','{"state":"done"}','{"state":"ready","segment_id":"bad id!"}','{"mystery":1}',
    '{"state":"creating","profile_count":-1}','{"state":"creating","create_started_at":"yesterday"}']) x;
select throws_ok($$select pg_temp.save('{"state":"creating"}',r=>'180')$$,'23514',null,'a rule key is v<version>-<days>');
select throws_ok($$select pg_temp.save('{"state":"ready"}')$$,'23514',null,'ready needs the segment id');

select lives_ok($$select pg_temp.save(jsonb_build_object('state','creating','create_started_at',now()))$$,
  'build b101 starts making the segment');
select throws_ok($$select pg_temp.save(jsonb_build_object('state','creating','create_started_at',now()),
  '00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-00000000bbbb')$$,
  'PT409',null,'another push waits while it is being made');
select lives_ok($$select pg_temp.save('{"state":"ready","segment_id":"SegGros001","reason":null}')$$,
  'it is saved as ready');
select throws_ok($$select pg_temp.save(jsonb_build_object('state','creating'),
  '00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-00000000bbbb')$$,
  'PT409',null,'nobody makes a second one once it is ready');
select lives_ok($$select pg_temp.save(jsonb_build_object('profile_count',930,'counted_at',now()),
  '00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-00000000bbbb')$$,
  'another push records its size');
reset role;

set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select results_eq($$select state, segment_id, profile_count from public.klaviyo_hygiene_segments$$,
  $$values ('ready', 'SegGros001', 930::bigint)$$,'members read the segment and its size');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_hygiene_segments),0,'another workspace cannot read it');
reset role;

select * from finish();
rollback;
