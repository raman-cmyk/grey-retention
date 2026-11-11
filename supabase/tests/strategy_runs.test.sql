begin;
select plan(37);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04. Admin ...02.
select ok(not has_table_privilege('authenticated','public.strategy_runs','insert,update,delete,truncate'),'members cannot write plans directly');
select ok(not has_table_privilege('service_role','public.strategy_runs','insert,update,delete,truncate'),'jobs write plans only through the commands');
select ok(not has_table_privilege('anon','public.strategy_runs','select'),'anon cannot read plans');
select ok(not has_function_privilege('anon','public.start_strategy_run(uuid)','execute'),'anon cannot start a plan');
select ok(not has_function_privilege('authenticated','public.claim_strategy_run()','execute'),'members cannot claim a plan step');
select ok(not has_function_privilege('authenticated','public.finish_strategy_pulse(uuid,uuid,jsonb)','execute'),'members cannot finish a pulse');
select ok(not has_function_privilege('authenticated','public.fail_strategy_step(uuid,uuid,text)','execute'),'members cannot fail a step');
select ok(has_function_privilege('service_role','public.claim_strategy_run()','execute'),'jobs claim plan steps');

-- The owner starts a plan; starting again returns the open one.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.run',public.start_strategy_run('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_strategy_run('00000000-0000-4000-8000-000000000101'),current_setting('test.run')::uuid,'one open plan per workspace');
select is((select state from public.strategy_runs where id=current_setting('test.run')::uuid),'pulse_queued','it waits for the pulse');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"auto"}')$$,'PT409','This plan is not waiting for your offers','no pick before the pulse');
reset role;
select is((select start_on from public.strategy_runs where id=current_setting('test.run')::uuid),
  (now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date+1,'the 15 days start tomorrow, store time');

-- Staff and other workspaces cannot start, pick or read it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.start_strategy_run('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a plan');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.strategy_runs where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace cannot read it');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000102',current_setting('test.run')::uuid,'{"mode":"auto"}')$$,'42501','Plan unavailable','nor pick for it through its own workspace');
reset role;

-- A job reads the store and finishes the pulse.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select lease_token::text from public.claim_strategy_run()),true);
select isnt(current_setting('test.lease'),'','the job gets a lease');
select is((select count(*) from public.claim_strategy_run()),0::bigint,'a leased step is not handed out twice');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,gen_random_uuid(),'{"offers":[]}')$$,'PT409','Lease unavailable','a wrong lease cannot finish it');
select throws_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"highlights":[]}')$$,'22023',null,'a pulse needs its offers');
select lives_ok($$select public.finish_strategy_pulse(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,
  '{"offers":[{"id":"offer:CANDLE10"},{"id":"offer:WELCOME15"}],"highlights":[]}')$$,'the pulse is saved');
reset role;

-- The owner picks offers: only ones the pulse found.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select state from public.strategy_runs where id=current_setting('test.run')::uuid),'offers_ready','the owner sees the offers');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"all"}')$$,'22023',null,'an unknown choice is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"auto","offers":["offer:CANDLE10"]}')$$,'22023',null,'extra fields are refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":["offer:BIGSALE40"]}')$$,'22023','Pick only offers this plan found','an offer the pulse did not find is refused');
select throws_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":[]}')$$,'22023',null,'an empty pick is refused');
select lives_ok($$select public.pick_strategy_offers('00000000-0000-4000-8000-000000000101',current_setting('test.run')::uuid,'{"mode":"picked","offers":["offer:CANDLE10","offer:CANDLE10"]}')$$,'a real pick is saved');
select is((select row(state,offer_pick)::text from public.strategy_runs where id=current_setting('test.run')::uuid),
  row('plan_queued','{"mode":"picked","offers":["offer:CANDLE10"]}'::jsonb)::text,'once, and the plan is queued');
reset role;

-- A job plans the 15 days; then a new plan can start.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select lease_token::text from public.claim_strategy_run()),true);
select lives_ok($$select public.finish_strategy_plan(current_setting('test.run')::uuid,current_setting('test.lease')::uuid,'{"slots":[],"notes":[]}')$$,'the plan is saved');
reset role;
select is((select state from public.strategy_runs where id=current_setting('test.run')::uuid),'planned','the plan is done');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select isnt(public.start_strategy_run('00000000-0000-4000-8000-000000000101'),current_setting('test.run')::uuid,'a finished plan does not block a new one');
reset role;

-- A step that keeps failing is failed for good after its third attempt.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.other',public.start_strategy_run('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
update public.strategy_runs set updated_at = now() + interval '1 day' where tenant_id='00000000-0000-4000-8000-000000000101' and state='pulse_queued';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.l',(select c.lease_token::text from public.claim_strategy_run() c),true);
select is(public.fail_strategy_step(current_setting('test.other')::uuid,current_setting('test.l')::uuid,'store_unreadable'),'retry','the first failure is tried again');
select set_config('test.l',(select c.lease_token::text from public.claim_strategy_run() c),true);
select is(public.fail_strategy_step(current_setting('test.other')::uuid,current_setting('test.l')::uuid,'store_unreadable'),'retry','so is the second');
select set_config('test.l',(select c.lease_token::text from public.claim_strategy_run() c),true);
select is(public.fail_strategy_step(current_setting('test.other')::uuid,current_setting('test.l')::uuid,'store_unreadable'),'failed','the third fails the plan');
reset role;
select is((select row(state,error_code)::text from public.strategy_runs where id=current_setting('test.other')::uuid),row('failed','store_unreadable')::text,'with the reason');

-- A lease that ran out three times is failed by the next claim.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.third',public.start_strategy_run('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
update public.strategy_runs set attempts = 3, lease_token = gen_random_uuid(), lease_until = now() - interval '1 minute', updated_at = now() - interval '1 day'
  where id = current_setting('test.third')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*) from public.claim_strategy_run() c where c.id=current_setting('test.third')::uuid),0::bigint,'a step out of attempts is not handed out');
reset role;
select is((select row(state,error_code)::text from public.strategy_runs where id=current_setting('test.third')::uuid),row('failed','step_timed_out')::text,'it is failed with the reason');

-- Platform admins read every plan.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select ok((select count(*) from public.strategy_runs) >= 4,'admins read every workspace''s plans');
reset role;

select * from finish();
rollback;
