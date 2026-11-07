begin;
select no_plan();
-- GEM-002. Tenant 101 owner = ...001; tenant 102 owner = ...004. Synthetic seed only.

-- The worker (service role) reserves and settles live AI usage.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.live',public.reserve_ai_usage('00000000-0000-4000-8000-000000000101','ai:label:section-1:'||gen_random_uuid(),'learning',500)::text,true);
select ok((select u.state='reserved' and u.estimate_micro=500 and u.expires_at='infinity'
  from public.usage_reservations u where u.id=current_setting('test.live')::uuid),'live reservation is held until settled, never auto-expired');
select throws_ok($$select public.reserve_ai_usage('00000000-0000-4000-8000-000000000101',(select operation_id from public.usage_reservations where id=current_setting('test.live')::uuid),'learning',500)$$,
  'PT409',null,'a live operation can never be reserved twice, so a retry is never free');
select throws_ok($$select public.reserve_ai_usage('00000000-0000-4000-8000-000000000101','fixture-op','learning',500)$$,
  '23514',null,'only ai: operations use the live command');
select throws_ok($$select public.reserve_ai_usage('00000000-0000-4000-8000-000000000101','ai:label:x:1','learning',2000000000)$$,
  '23514',null,'an estimate over the request limit is refused');

-- An owner can neither use the live commands nor touch a live reservation
-- through the fixture commands.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.reserve_ai_usage('00000000-0000-4000-8000-000000000101','ai:label:x:2','learning',100)$$,
  '42501',null,'owner cannot call the live reserve command');
select throws_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,0)$$,
  '42501',null,'owner cannot call the live settle command');
select throws_ok($$select public.reconcile_fixture_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,0)$$,
  '42501',null,'owner cannot release a live AI reservation through the fixture command');
select throws_ok($$select public.reserve_fixture_usage('00000000-0000-4000-8000-000000000101','ai:label:x:3','learning',100)$$,
  '42501',null,'owner cannot pre-seed a live AI operation');
select set_config('test.fixture',public.reserve_fixture_usage('00000000-0000-4000-8000-000000000101','fixture-only-gem002','copy',1000)::text,true);
select lives_ok($$select public.reconcile_fixture_usage('00000000-0000-4000-8000-000000000101',current_setting('test.fixture')::uuid,0)$$,
  'legitimate fixture usage still reserves and reconciles');

-- The worker settles once; a second, different settle is a business conflict.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000102',current_setting('test.live')::uuid,10)$$,
  '42501',null,'a reservation cannot be settled under another workspace');
select throws_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,501)$$,
  '23514',null,'actual cost cannot exceed the reservation');
select lives_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,58)$$,'worker settles the real cost');
select ok((select u.state='reconciled' and u.actual_micro=58 from public.usage_reservations u where u.id=current_setting('test.live')::uuid),'real cost recorded');
select lives_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,58)$$,'the same settle replays safely');
select throws_ok($$select public.settle_ai_usage('00000000-0000-4000-8000-000000000101',current_setting('test.live')::uuid,60)$$,
  'PT409',null,'a different second settle is PT409, never a 40001 retry loop');

-- Function privileges: live commands belong to the service role only.
reset role;
select ok(not has_function_privilege('authenticated','public.reserve_ai_usage(uuid,text,text,bigint)','execute'),'authenticated has no execute on reserve_ai_usage');
select ok(not has_function_privilege('anon','public.settle_ai_usage(uuid,uuid,bigint)','execute'),'anon has no execute on settle_ai_usage');
select ok(has_function_privilege('service_role','public.reserve_ai_usage(uuid,text,text,bigint)','execute'),'service role can reserve live usage');

select * from finish();
rollback;
