begin;
select plan(12);

-- Workspace 101: owner ...01, manager (admin) ...06, staff ...05. Workspace 102: owner ...04.
update public.competitor_subscriptions set active = false where tenant_id = '00000000-0000-4000-8000-000000000101';

select ok(has_function_privilege('authenticated','public.subscribe_competitor(uuid,text,text,text)','execute'),'members may call track (it checks the owner)');
select ok(not has_function_privilege('anon','public.subscribe_competitor(uuid,text,text,text)','execute'),'anon cannot track');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101', 'limit-' || n || '.example', 'limit-' || n || '.example') from generate_series(1, 10) n$$,'the owner tracks 10 domains');
select is((select count(*)::int from public.competitor_subscriptions where tenant_id = '00000000-0000-4000-8000-000000000101' and active),10,'all 10 are tracked');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-11.example','limit-11.example')$$,'PT409','You can track up to 10 domains','an 11th domain is refused');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-3.example','limit-3.example')$$,'tracking one of the 10 again still works');
select is((select count(*)::int from public.competitor_subscriptions where tenant_id = '00000000-0000-4000-8000-000000000101' and active),10,'and does not count twice');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','brand.com','brand.com')$$,'23514',null,'only sample .example domains in this version');

-- Stopping one makes room again.
select lives_ok($$select public.update_competitor_subscription('00000000-0000-4000-8000-000000000101',(select id from public.competitor_subscriptions where tenant_id = '00000000-0000-4000-8000-000000000101' and label = 'limit-1.example'),(select revision from public.competitor_subscriptions where tenant_id = '00000000-0000-4000-8000-000000000101' and label = 'limit-1.example'),false,'')$$,'the owner stops tracking one');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-11.example','limit-11.example')$$,'then an 11th fits');

-- Another workspace has its own 10; staff cannot track.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','limit-12.example','limit-12.example')$$,'another workspace is not limited by this one');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','limit-13.example','limit-13.example')$$,'42501',null,'staff cannot track');

select * from finish();
rollback;
