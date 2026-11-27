begin;
select plan(66);

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
select ok(has_function_privilege('authenticated','public.retry_list_hygiene(uuid)','execute')
  and not has_function_privilege('anon','public.retry_list_hygiene(uuid)','execute')
  and not has_function_privilege('service_role','public.retry_list_hygiene(uuid)','execute'),
  'only signed-in members may call retry_list_hygiene (it checks the owner itself); never anon or the worker');
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
-- b101 (lease aaaa) and b102 (lease bbbb) wait for their push; b103's
-- lease ran out; b104 is still building.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"},{"date":"2099-01-02","time":"10:00","emailType":"offer"},{"date":"2099-01-03","time":"10:00","emailType":"offer"},{"date":"2099-01-04","time":"10:00","emailType":"offer"}]}',
   '00000000-0000-4000-8000-000000000001');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, step, email, lease_token, lease_until, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000b101','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c101','push_queued','push','{}','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b102','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,
   '00000000-0000-4000-8000-00000000c102','push_queued','push','{}','00000000-0000-4000-8000-00000000bbbb',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b103','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',2,
   '00000000-0000-4000-8000-00000000c103','push_queued','push','{}','00000000-0000-4000-8000-00000000cccc',now()-interval '1 second',
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b104','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',3,
   '00000000-0000-4000-8000-00000000c104','build_queued','sections',null,'00000000-0000-4000-8000-00000000dddd',now()+interval '1 minute',
   '00000000-0000-4000-8000-000000000001',now());
create function pg_temp.save(step jsonb, b text default 'b101', r text default 'v1-180') returns void language sql as $$
  select public.save_hygiene_segment(('00000000-0000-4000-8000-00000000'||b)::uuid,
    ('00000000-0000-4000-8000-0000000'||case b when 'b101' then '0aaaa' when 'b102' then '0bbbb' when 'b103' then '0cccc' else '0dddd' end)::uuid,
    r, step)
$$;
create function pg_temp.claim() returns jsonb language sql as $$
  select '{"state":"creating","klaviyo_account_id":"AcctA","fingerprint":"0123abcd","segment_id":null}'::jsonb
$$;
create function pg_temp.row_() returns text language sql as $$
  select concat_ws('|', state, coalesce(segment_id,''), coalesce(reason,''), coalesce(klaviyo_account_id,''),
    coalesce(fingerprint,''), coalesce(profile_count::text,''), coalesce(claim_build::text,''))
  from public.klaviyo_hygiene_segments where rule_key = 'v1-180'
$$;

set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.save(pg_temp.claim())$$,'42501',null,'no request role, no save');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.save(pg_temp.claim())$$,'42501',null,'an owner''s request cannot save');
select pg_temp.as_worker();
select throws_ok($$select public.save_hygiene_segment('00000000-0000-4000-8000-00000000b101'::uuid,
  '00000000-0000-4000-8000-00000000abcd'::uuid,'v1-180',pg_temp.claim())$$,'PT409',null,'not with another lease');
select throws_ok($$select pg_temp.save(pg_temp.claim(),'b103')$$,'PT409',null,'not with an expired lease');
select throws_ok($$select pg_temp.save(pg_temp.claim(),'b104')$$,'PT409',null,'not from a build that is not pushing');
select throws_ok(format('select pg_temp.save(%L::jsonb)', x),'23514',null,'refused step: '||x)
  from unnest(array['{}','{"state":"done"}','{"state":"ready","segment_id":"bad id!"}','{"mystery":1}',
    '{"state":"creating","profile_count":-1}','{"state":"creating","create_started_at":"2099-01-01T00:00:00Z"}',
    '{"state":"creating","fingerprint":"XYZ"}','{"profile_count":5}']) x;
select throws_ok($$select pg_temp.save(pg_temp.claim(),'b101','180')$$,'23514',null,'a rule key is v<version>-<days>');
select throws_ok($$select pg_temp.save('{"state":"ready","segment_id":"SegA"}')$$,'23514',null,
  'a first ready save needs its account and fingerprint');
select throws_ok($$select pg_temp.save('{"state":"no_data"}')$$,'23514',null,'a first no_data save needs its reason');

-- First saves of no_data and of ready, whole rows at once (rule keys of their own).
select lives_ok($$select pg_temp.save('{"state":"no_data","reason":"no_order_metric","klaviyo_account_id":"AcctA","fingerprint":null,"segment_id":null}',
  'b101','v1-90')$$,'a first no_data save with its reason is kept');
select lives_ok($$select pg_temp.save('{"state":"ready","segment_id":"SegR","klaviyo_account_id":"AcctA","fingerprint":"0123abcd","reason":null,"profile_count":12,"counted_at":"2026-11-27T12:00:00Z"}',
  'b101','v1-365')$$,'a first ready save with every field is kept');
select results_eq($$select rule_key, state, segment_id, profile_count from public.klaviyo_hygiene_segments order by rule_key$$,
  $$values ('v1-365','ready','SegR',12::bigint), ('v1-90','no_data',null,null::bigint)$$,'both rows are whole');

-- The claim: the database stamps the time, one maker at a time.
select lives_ok($$select pg_temp.save(pg_temp.claim())$$,'build b101 starts making the segment');
select ok((select create_started_at = now() and claim_build = '00000000-0000-4000-8000-00000000b101'
  from public.klaviyo_hygiene_segments where rule_key='v1-180'),'the database stamps the claim, never the caller');
select throws_ok($$select pg_temp.save(pg_temp.claim(),'b102')$$,'PT409',null,
  'a second maker is refused while the claim is live');
select throws_ok($$select pg_temp.save('{"state":"failed","reason":"refused"}','b102')$$,'PT409',null,
  'only the claimant writes a row while its claim is live');
select lives_ok($$select pg_temp.save(pg_temp.claim())$$,'the same build may claim again');
reset role;
update public.klaviyo_hygiene_segments set create_started_at = now() - interval '3 minutes', reason = 'refused'
  where rule_key = 'v1-180';
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.save(pg_temp.claim(),'b102')$$,'after two minutes another push takes the claim over');
select is(pg_temp.row_(),'creating|||AcctA|0123abcd||00000000-0000-4000-8000-00000000b102',
  'the takeover is b102''s claim, with the old reason cleared');
select lives_ok($$select pg_temp.save('{"state":"ready","segment_id":"SegA","reason":null}','b102')$$,
  'the claimant saves it as ready');
select throws_ok($$select pg_temp.save(pg_temp.claim())$$,'PT409',null,
  'nobody makes a second one for the same account and fingerprint');
select lives_ok($$select pg_temp.save('{"profile_count":930,"counted_at":"2026-11-27T12:00:00Z"}')$$,
  'another push records its size');
select lives_ok($$select pg_temp.save(pg_temp.claim() || '{"klaviyo_account_id":"AcctB"}')$$,
  'a reconnect to another account starts a new one');
select is(pg_temp.row_(),'creating|||AcctB|0123abcd|930|00000000-0000-4000-8000-00000000b101',
  'its row now belongs to the new account, with the old segment id cleared');
select lives_ok($$select pg_temp.save(pg_temp.claim() || '{"segment_id":"SegSneaky"}')$$,
  'the same build claims again, sending a segment id');
select is((select segment_id from public.klaviyo_hygiene_segments where rule_key='v1-180'),null,
  'entering creating always clears the segment id');
reset role;

set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.klaviyo_hygiene_segments),3,'members read the segment rows');
select throws_ok($$select public.retry_list_hygiene('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'staff cannot ask for it again');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_hygiene_segments),0,'another workspace cannot read them');
select throws_ok($$select public.retry_list_hygiene('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'another workspace''s owner cannot ask either');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is(public.retry_list_hygiene('00000000-0000-4000-8000-000000000101'),1,
  'the owner asks again: the no_data row goes, the others stay');
reset role;
select results_eq($$select rule_key from public.klaviyo_hygiene_segments order by rule_key$$,
  $$values ('v1-180'), ('v1-365')$$,'a row being made and a ready one are kept');
select is((select detail from public.workspace_events where kind='list_hygiene_retried'),'{"rows": 1}'::jsonb,
  'the owner''s ask is in the change history');

select * from finish();
rollback;
