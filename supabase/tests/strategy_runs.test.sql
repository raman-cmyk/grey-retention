begin;
select plan(66);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04. Admin ...02.
select ok(not has_table_privilege('authenticated','public.strategy_runs','insert,update,delete,truncate'),'members cannot write plans directly');
select ok(not has_table_privilege('service_role','public.strategy_runs','insert,update,delete,truncate,maintain'),'jobs write plans only through the commands');
select ok(not has_table_privilege('anon','public.strategy_runs','select'),'anon cannot read plans');
select ok(not has_function_privilege('anon','public.start_strategy_run(uuid)','execute'),'anon cannot start a plan');
select ok(not has_function_privilege('authenticated','public.claim_strategy_run(uuid)','execute'),'members cannot claim a plan step');
select ok(not has_function_privilege('authenticated','public.finish_strategy_pulse(uuid,uuid,jsonb)','execute'),'members cannot finish a pulse');
select ok(not has_function_privilege('authenticated','public.fail_strategy_step(uuid,uuid,text,boolean)','execute'),'members cannot fail a step');
select ok(has_function_privilege('service_role','public.claim_strategy_run(uuid)','execute'),'jobs claim plan steps');

-- Helpers for the test only: claim as a job, and let time pass.
create function pg_temp.claim(target uuid default null) returns uuid language sql as $$ select c.lease_token from public.claim_strategy_run(target) c $$;
create function pg_temp.later(run uuid, minutes int) returns void language sql as $$
  update public.strategy_runs set updated_at = updated_at - make_interval(mins => minutes),
    lease_until = lease_until - make_interval(mins => minutes)
  where id = run $$;
grant execute on function pg_temp.claim(uuid) to service_role;

-- The owner starts a plan; starting again returns the open one.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.run',public.start_strategy_run('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_strategy_run('00000000-0000-4000-8000-000000000101'),current_setting('test.run')::uuid,'one open plan per workspace');
select is((select state from public.strategy_runs where id=current_setting('test.run')::uuid),'pulse_queued','it waits for the pulse');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"auto"}')$$,'PT409','This plan is not waiting for your offers','no pick before the pulse');
select is((select count(*) from public.strategy_runs where tenant_id='00000000-0000-4000-8000-000000000101'),1::bigint,'the owner reads the plan');
reset role;
select is((select start_on from public.strategy_runs where id=current_setting('test.run')::uuid),
  (now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date+1,'the 15 days start tomorrow, store time');

-- Staff and other workspaces cannot start, pick or read it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.start_strategy_run('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a plan');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"auto"}')$$,'42501',null,'staff cannot pick offers');
select is((select count(*) from public.strategy_runs where tenant_id='00000000-0000-4000-8000-000000000101'),1::bigint,'staff read their own workspace''s plan');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.strategy_runs where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace cannot read it');
select throws_ok($$select public.start_strategy_run('00000000-0000-4000-8000-000000000101')$$,'42501',null,'nor start one there');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000102',current_setting('test.run')::uuid,'{"mode":"auto"}')$$,'42501','Plan unavailable','nor pick for it through its own workspace');
reset role;

-- Job commands check the caller themselves.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select * from public.claim_strategy_run()$$,'42501',null,'a call without the job role cannot claim');
select throws_ok($$select public.fail_strategy_step(current_setting('test.run')::uuid,gen_random_uuid(),'x_y')$$,'42501',null,'nor fail a step');
reset role;

-- A job reads the store and finishes the pulse; leases are exact.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,null,'{"offers":[]}')$$,'PT409','Lease unavailable','an unclaimed step cannot be finished without a lease');
select throws_ok($$select public.fail_strategy_step(current_setting('test.run')::uuid,null,'x_y')$$,'PT409','Lease unavailable','nor failed');
select is(pg_temp.claim(gen_random_uuid()),null,'a claim for another run hands out nothing');
select set_config('test.lease',pg_temp.claim(current_setting('test.run')::uuid)::text,true);
select isnt(current_setting('test.lease'),null,'a claim for this run hands it out');
select is(pg_temp.claim(),null,'a leased step is not handed out twice');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,gen_random_uuid(),'{"offers":[]}')$$,'PT409','Lease unavailable','a wrong lease cannot finish it');
select throws_ok($$select public.finish_strategy_plan(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"slots":[]}')$$,'PT409','Lease unavailable','a pulse step cannot be finished as a plan');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"highlights":[]}')$$,'22023',null,'a pulse needs its offers');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"offers":[{"code":"X"}]}')$$,'22023',null,'each offer needs an id');
select throws_ok($$select public.fail_strategy_step(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'Not A Code')$$,'22023',null,'a failure needs a short code');
reset role;
-- An expired lease is refused, and the step can be claimed again.
select pg_temp.later(current_setting('test.run')::uuid, 10);
set local role service_role;
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"offers":[]}')$$,'PT409','Lease unavailable','an expired lease cannot finish it');
select set_config('test.lease2',pg_temp.claim()::text,true);
select isnt(current_setting('test.lease2'),current_setting('test.lease'),'the step is claimed again with a new lease');
reset role;
select is((select attempts from public.strategy_runs where id=current_setting('test.run')::uuid),2,'and the attempt is counted');
set local role service_role;
select lives_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease2')::uuid,
  '{"offers":[{"id":"offer:CANDLE10"},{"id":"offer:WELCOME15"}],"highlights":[]}')$$,'the pulse is saved');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease2')::uuid,'{"offers":[]}')$$,'PT409','Lease unavailable','not twice');
reset role;

-- The owner picks offers: only ones the pulse found.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select row(state,attempts)::text from public.strategy_runs where id=current_setting('test.run')::uuid),row('offers_ready',0)::text,'the owner sees the offers');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"all"}')$$,'22023',null,'an unknown choice is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"auto","offers":["offer:CANDLE10"]}')$$,'22023',null,'extra fields are refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offer":["offer:CANDLE10"]}')$$,'22023',null,'a pick without its offers is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":["offer:BIGSALE40"]}')$$,'22023','Pick only offers this plan found','an offer the pulse did not find is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":[]}')$$,'22023',null,'an empty pick is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":[1]}')$$,'22023',null,'offers are ids');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,(select jsonb_build_object('mode','picked','offers',jsonb_agg('offer:'||n)) from generate_series(1,21) n))$$,'22023',null,'at most 20 offers');
select lives_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":["offer:CANDLE10","offer:CANDLE10"]}')$$,'a real pick is saved');
select is((select row(state,offer_pick)::text from public.strategy_runs where id=current_setting('test.run')::uuid),
  row('plan_queued','{"mode":"picked","offers":["offer:CANDLE10"]}'::jsonb)::text,'once, and the plan is queued');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"none"}')$$,'PT409',null,'a second pick is refused');
reset role;

-- A job plans the 15 days; then a new plan can start.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',pg_temp.claim()::text,true);
select throws_ok($$select public.finish_strategy_plan(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"notes":[]}')$$,'22023',null,'a plan needs its slots');
select lives_ok($$select public.finish_strategy_plan(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"slots":[],"notes":[]}')$$,'the plan is saved');
select throws_ok($$select public.fail_strategy_step(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'late_failure')$$,'PT409',null,'a finished plan cannot be failed');
reset role;
select is((select state from public.strategy_runs where id=current_setting('test.run')::uuid),'planned','the plan is done');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.next',public.start_strategy_run('00000000-0000-4000-8000-000000000101')::text,true);
select isnt(current_setting('test.next')::uuid,current_setting('test.run')::uuid,'a finished plan does not block a new one');
reset role;

-- An open plan whose 15 days have begun is replaced by a new one.
update public.strategy_runs set start_on = start_on - 3 where id = current_setting('test.next')::uuid;
set local role authenticated;
select set_config('test.fresh',public.start_strategy_run('00000000-0000-4000-8000-000000000101')::text,true);
select isnt(current_setting('test.fresh')::uuid,current_setting('test.next')::uuid,'an out-of-date plan is replaced');
reset role;
select is((select row(state,error_code)::text from public.strategy_runs where id=current_setting('test.next')::uuid),row('failed','out_of_date')::text,'and closed with the reason');
-- And no offers are picked for days that have begun.
update public.strategy_runs set state='offers_ready', pulse='{"offers":[]}', start_on = start_on - 3 where id = current_setting('test.fresh')::uuid;
set local role authenticated;
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.fresh')::uuid,'{"mode":"none"}')$$,'PT409','These 15 days have begun; start a new plan','offers for days that have begun are refused');
reset role;
update public.strategy_runs set state='failed', error_code='test_done' where id = current_setting('test.fresh')::uuid;

-- A step that keeps failing waits a minute between tries and fails after the third.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.other',public.start_strategy_run('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.fail_strategy_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'retry','the first failure is tried again');
select is(pg_temp.claim(),null,'but not at once');
reset role;
select pg_temp.later(current_setting('test.other')::uuid, 2);
set local role service_role;
select is(public.fail_strategy_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'retry','the second failure is tried again a minute later');
reset role;
select pg_temp.later(current_setting('test.other')::uuid, 2);
set local role service_role;
select is(public.fail_strategy_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'failed','the third fails the plan');
reset role;
select is((select row(state,error_code)::text from public.strategy_runs where id=current_setting('test.other')::uuid),row('failed','store_unreadable')::text,'with the reason');

-- A failure that cannot change on a retry fails the plan at once.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.final',public.start_strategy_run('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.fail_strategy_step(current_setting('test.final')::uuid,pg_temp.claim(current_setting('test.final')::uuid),'store_wrong_days',true),'failed','a final failure fails at once');
reset role;

-- A lease that ran out three times is failed by the next claim, which looks on.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.third',public.start_strategy_run('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
update public.strategy_runs set attempts = 3, lease_token = gen_random_uuid(), lease_until = now() - interval '1 minute', updated_at = now() - interval '1 day'
  where id = current_setting('test.third')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.waiting',public.start_strategy_run('00000000-0000-4000-8000-000000000101')::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select isnt(pg_temp.claim(),null,'the next claim still hands out a waiting step');
reset role;
select is((select row(state,error_code)::text from public.strategy_runs where id=current_setting('test.third')::uuid),row('failed','step_timed_out')::text,'the timed-out step is failed with the reason');
select is((select attempts from public.strategy_runs where id=current_setting('test.waiting')::uuid),1,'and the other workspace''s step is the one handed out');

-- A paused workspace's plans are not run.
update public.strategy_runs set lease_token = null, lease_until = null, attempts = 0 where id = current_setting('test.waiting')::uuid;
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000101';
set local role service_role;
select is(pg_temp.claim(),null,'a paused workspace''s step is not handed out');
reset role;

-- Platform admins read every plan.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(distinct tenant_id) from public.strategy_runs),2::bigint,'admins read plans in every workspace');
reset role;

select * from finish();
rollback;
