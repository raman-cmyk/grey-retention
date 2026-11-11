begin;
select no_plan();
-- GEM-003. Operator = ...002 (seed super_admin); tenant 101 owner = ...001. Synthetic seed only.

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.set_platform_ai_daily_cap(10000)$$,'the worker can set the platform cap');
select set_config('test.a',public.reserve_platform_ai_usage('ai:label:section-a:'||gen_random_uuid(),'learning',6000)::text,true);
select ok(current_setting('test.a') <> '','the worker reserves platform usage for competitor labelling');
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:section-b:1','learning',5000)$$,
  '23514','Platform AI allowance reached; no AI request was sent','reservations over the daily cap are refused before sending');
select throws_ok($$select public.reserve_platform_ai_usage('fixture-op','learning',100)$$,'23514',null,'only ai: operations are allowed');
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:x:1','learning',0)$$,'23514',null,'an estimate must be positive');
select set_config('test.b',public.reserve_platform_ai_usage('ai:label:section-c:1','learning',1000)::text,true);
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:section-c:1','learning',1000)$$,'PT409',null,'an operation can be reserved only once');

-- Settling frees the unused part of the reservation for later calls.
select throws_ok($$select public.settle_platform_ai_usage(current_setting('test.a')::uuid,6001)$$,'23514',null,'actual cost cannot exceed the reservation');
select lives_ok($$select public.settle_platform_ai_usage(current_setting('test.a')::uuid,100)$$,'the worker settles the real cost');
select lives_ok($$select public.settle_platform_ai_usage(current_setting('test.a')::uuid,100)$$,'the same settle replays safely');
select throws_ok($$select public.settle_platform_ai_usage(current_setting('test.a')::uuid,200)$$,'PT409',null,'a different second settle is PT409');
select lives_ok($$select public.reserve_platform_ai_usage('ai:label:section-d:1','learning',5000)$$,'settled headroom can be reserved again');
select ok((select cap_micro=10000 and spent_micro=100 and reserved_micro=6000 from public.platform_ai_usage_today()),'today''s usage shows cap, spent and reserved');

-- A zero-cost settle releases the reservation, frees its headroom and replays safely.
select set_config('test.z',public.reserve_platform_ai_usage('ai:label:section-z:1','learning',2000)::text,true);
select lives_ok($$select public.settle_platform_ai_usage(current_setting('test.z')::uuid,0)$$,'an unbilled call settles at zero');
select lives_ok($$select public.settle_platform_ai_usage(current_setting('test.z')::uuid,0)$$,'the zero settle replays safely');
select throws_ok($$select public.settle_stale_platform_ai_usage(interval '1 minute')$$,'23514',null,'the stale window cannot be shorter than ten minutes');

-- Clients and anonymous callers can't touch the platform budget.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:x:2','learning',10)$$,'42501',null,'an owner cannot reserve platform usage');
select throws_ok($$select public.settle_platform_ai_usage(current_setting('test.b')::uuid,0)$$,'42501',null,'an owner cannot settle platform usage');
select throws_ok($$select public.set_platform_ai_daily_cap(1000000000)$$,'42501',null,'an owner cannot raise the platform cap');
select throws_ok($$select public.platform_ai_usage_today()$$,'42501',null,'an owner cannot read platform spend');
select throws_ok($$select count(*) from private.platform_ai_usage$$,'42501',null,'the usage table is not readable by clients');
select throws_ok($$select count(*) from private.platform_ai_budget$$,'42501',null,'the budget table is not readable by clients');
select throws_ok($$update private.platform_ai_budget set daily_cap_micro=1000000000$$,'42501',null,'clients cannot write the budget table');
select throws_ok($$insert into private.platform_ai_usage(operation_id,feature,estimate_micro) values('ai:x:y:z','learning',1)$$,'42501',null,'clients cannot write the usage table');
select throws_ok($$select public.settle_stale_platform_ai_usage()$$,'42501',null,'an owner cannot run the stale sweep');
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:x:3','learning',10)$$,'42501',null,'an anonymous caller cannot reserve platform usage');

-- An operator can read spend, change the cap and settle stale usage, but
-- not reserve.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.set_platform_ai_daily_cap(20000)$$,'an operator can change the cap');
select ok((select cap_micro=20000 from public.platform_ai_usage_today()),'operator reads the new cap');
select throws_ok($$select public.reserve_platform_ai_usage('ai:label:x:4','learning',10)$$,'42501',null,'an operator cannot reserve as the worker');
select is(public.settle_stale_platform_ai_usage(),0,'nothing is stale yet');
-- A plain admin (not super admin) can't raise the paid cap.
reset role;
update public.platform_admins set role='admin' where profile_id='00000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.set_platform_ai_daily_cap(30000)$$,'42501',null,'a plain admin cannot change the platform cap');
select ok((select cap_micro=20000 from public.platform_ai_usage_today()),'a plain admin can still read platform spend');
reset role;
update public.platform_admins set role='super_admin' where profile_id='00000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
reset role;
update private.platform_ai_usage set created_at=now()-interval '2 hours' where id=current_setting('test.b')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is(public.settle_stale_platform_ai_usage(),1,'the operator sweep settles stale platform usage');
reset role;
select ok((select state='reconciled' and actual_micro=1000 from private.platform_ai_usage where id=current_setting('test.b')::uuid),'stale usage is charged at its full estimate');

select * from finish();
rollback;
