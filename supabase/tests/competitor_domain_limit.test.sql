begin;
select plan(29);

-- Workspace 101: owner ...01, manager (admin) ...06, staff ...05. Workspace 102: owner ...04.
update public.competitor_subscriptions set active = false where tenant_id = '00000000-0000-4000-8000-000000000101';
create function pg_temp.sub(label text) returns public.competitor_subscriptions language sql as $$
  select * from public.competitor_subscriptions
  where tenant_id = '00000000-0000-4000-8000-000000000101' and label = sub.label
$$;
create function pg_temp.active_count() returns int language sql as $$
  select count(*)::int from public.competitor_subscriptions
  where tenant_id = '00000000-0000-4000-8000-000000000101' and active
$$;

select ok(has_function_privilege('authenticated','public.subscribe_competitor(uuid,text,text,text)','execute'),'members may call track (it checks the owner)');
select ok(not has_function_privilege('anon','public.subscribe_competitor(uuid,text,text,text)','execute'),'anon cannot track');
select ok(not has_function_privilege('anon','public.update_competitor_subscription(uuid,uuid,integer,boolean,text)','execute'),'anon cannot change tracking');
select ok(not has_function_privilege('authenticated','private.competitor_slots_full(uuid,uuid)','execute'),'the limit helper stays private');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- A new domain tracked without a label gets the domain as its label.
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101', 'limit-' || n || '.example') from generate_series(1, 10) n$$,'the owner tracks 10 domains');
reset role;
select is(pg_temp.active_count(),10,'all 10 are tracked');
select is((pg_temp.sub('limit-1.example')).private_rules,'','a new domain starts without private rules');
set local role authenticated;
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-11.example')$$,'PT409','You can track up to 10 domains','an 11th domain is refused');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','brand.com')$$,'23514',null,'only sample .example domains in this version');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101',repeat('a',120) || '.example')$$,'23514',null,'a domain too long to be its own label is refused');

-- The advanced page sets rules; tracking the same domain again keeps them.
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-3.example','Limit three','Never copy prices.')$$,'the advanced page saves a label and rules');
reset role;
create temporary table tz_rev as select (pg_temp.sub('Limit three')).revision as r;
set local role authenticated;
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-3.example')$$,'tracking it again from Inspiration works');
reset role;
select is((pg_temp.sub('Limit three')).private_rules,'Never copy prices.','and keeps its private rules');
select is((pg_temp.sub('Limit three')).revision,(select r from tz_rev),'and does not change it at all (a playbook on it stays valid)');
select is(pg_temp.active_count(),10,'and does not count twice');

-- Stopping one makes room again; tracking it again keeps its rules.
update public.competitor_subscriptions set private_rules = 'Watch launches only.' where tenant_id = '00000000-0000-4000-8000-000000000101' and label = 'limit-1.example';
set local role authenticated;
select lives_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(pg_temp.sub('limit-1.example')).id,(pg_temp.sub('limit-1.example')).revision,false,'Watch launches only.')$$,'the owner stops tracking one');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-11.example')$$,'then an 11th fits');
-- Now 10 again: a stopped domain cannot come back by either way.
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-1.example')$$,'PT409','You can track up to 10 domains','tracking a stopped domain again counts');
select throws_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(pg_temp.sub('limit-1.example')).id,(pg_temp.sub('limit-1.example')).revision,true,'Watch launches only.')$$,'PT409','You can track up to 10 domains','turning a stopped domain back on counts too');
select lives_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(pg_temp.sub('limit-11.example')).id,(pg_temp.sub('limit-11.example')).revision,false,'')$$,'stop another one');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-1.example')$$,'now the stopped domain can come back');
reset role;
select is((pg_temp.sub('limit-1.example')).private_rules,'Watch launches only.','with its private rules kept');
select is(pg_temp.active_count(),10,'still 10 tracked');
set local role authenticated;
select throws_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(pg_temp.sub('limit-1.example')).id,0,false,'')$$,'PT409','Stale subscription','a stale page cannot stop tracking');

-- Another workspace has its own 10 (also for a domain this one tracks);
-- managers, staff and other workspaces cannot track or stop tracking here.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','limit-2.example')$$,'another workspace tracks a domain this one tracks too');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-12.example')$$,'42501',null,'another workspace cannot track here');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-13.example')$$,'42501',null,'a manager cannot track');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-14.example')$$,'42501',null,'staff cannot track');
select throws_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(pg_temp.sub('limit-1.example')).id,(pg_temp.sub('limit-1.example')).revision,false,'')$$,'42501',null,'staff cannot stop tracking');

select * from finish();
rollback;
