begin;
select no_plan();
-- PLN-033a. Tenant 101: owner ...001, admin ...006, staff ...005. Tenant 102 owner ...004. Operator ...002. Synthetic seed only.

-- Grants: members read, nobody writes directly, the worker reads.
select ok(not has_table_privilege('authenticated','public.revenue_goals','insert,update,delete,truncate,references,trigger,maintain'),'members cannot write goals directly');
select ok(not has_table_privilege('anon','public.revenue_goals','select'),'visitors cannot read goals');
select ok(has_table_privilege('service_role','public.revenue_goals','select')
  and not has_table_privilege('service_role','public.revenue_goals','insert,update,delete,truncate,references,trigger,maintain'),'the worker reads goals and writes none');
select ok(not has_function_privilege('anon','public.set_revenue_goal(uuid,date,numeric,text,integer)','execute')
  and not has_function_privilege('service_role','public.set_revenue_goal(uuid,date,numeric,text,integer)','execute'),'only members can call the command');
select ok(not has_function_privilege('authenticated','private.record_revenue_goal_change()','execute'),'the recorder is not callable');

-- The owner sets this month's goal; a stale page is refused.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',20000,'USD',0),1,'the first goal is revision 1');
select is((select (amount, currency)::text from public.revenue_goals where month = '2026-11-01'),'(20000.00,USD)','and reads back');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',25000,'USD',0)$$,'PT409',null,'a second "first" save is a conflict');
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',25000,'USD',1),2,'the owner raises it');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',30000,'USD',1)$$,'PT409',null,'a stale revision is a conflict');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',30000,'USD',null)$$,'PT409',null,'no revision is a conflict');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2027-03-01',100,'USD',null)$$,'PT409',null,'no revision on a month with no goal is a conflict');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2027-03-01',100,'USD',1)$$,'PT409',null,'a revision on a month with no goal is a conflict');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2027-03-01',null,null,1)$$,'PT409',null,'so is clearing it with one');

-- Checks.
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-15',100,'USD',0)$$,'23514',null,'a goal is for a whole month');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101',null,100,'USD',0)$$,'23514',null,'a month is needed');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',0,'USD',0)$$,'23514',null,'more than nothing');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',-5,'USD',0)$$,'23514',null,'not negative');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',1000000001,'USD',0)$$,'23514',null,'at most a billion');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',10.555,'USD',0)$$,'23514',null,'whole cents');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',100,'usd',0)$$,'23514',null,'a currency code');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',100,null,0)$$,'23514',null,'an amount needs a currency');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',null,'USD',0)$$,'23514',null,'and a currency an amount');
select throws_ok($$update public.revenue_goals set amount = 1$$,'42501',null,'no direct update');
select throws_ok($$insert into public.revenue_goals (tenant_id, month, amount, currency) values ('00000000-0000-4000-8000-000000000101','2027-01-01',1,'USD')$$,'42501',null,'no direct insert');

-- Clearing keeps the row and its revision line.
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',null,null,2),3,'the owner clears it');
select is((select (amount is null and currency is null and revision = 3) from public.revenue_goals where month = '2026-11-01'),true,'cleared, revision kept');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',5000,'USD',0)$$,'PT409',null,'an old page that saw no goal cannot overwrite it');
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',5000,'USD',3),4,'and it can be set again');
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2027-02-01',null,null,0),0,'clearing a month with no goal changes nothing');
select is((select count(*) from public.revenue_goals where month = '2027-02-01'),0::bigint,'and stores nothing');

-- An admin may change it; staff read but cannot.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',30000,'USD',0),1,'an admin sets next month');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.revenue_goals),2::bigint,'staff read the goals');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',1,'USD',1)$$,'42501',null,'staff cannot change a goal');

-- Another brand sees and changes nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.revenue_goals),0::bigint,'another brand sees nothing');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',1,'USD',1)$$,'42501',null,'another brand cannot change a goal');
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000102','2026-11-01',900,'GBP',0),1,'and sets its own');

-- Operators read for support but cannot change.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.revenue_goals),3::bigint,'an operator reads the goals');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-12-01',1,'USD',1)$$,'42501',null,'an operator cannot change a goal');

-- The change history: set, raised, cleared, set again for 101; the same value again records nothing.
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',5000,'USD',4),5,'the same goal again');
reset role;
select is((select count(*) from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'revenue_goal_set' and detail->>'month' = '2026-11-01'),4::bigint,'four real changes recorded, not five');
select is((select detail->>'from_amount' || '>' || coalesce(detail->>'to_amount','none') from public.workspace_events
  where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'revenue_goal_set' and detail->>'to_amount' is null),'25000.00>none','clearing is recorded with what it was');
select is((select actor_id from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'revenue_goal_set' and detail->>'month' = '2026-12-01'),'00000000-0000-4000-8000-000000000006'::uuid,'and who did it');

-- No sign-in, no access.
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select count(*) from public.revenue_goals$$,'42501',null,'anonymous callers cannot read goals');
select throws_ok($$select public.set_revenue_goal('00000000-0000-4000-8000-000000000101','2026-11-01',1,'USD',5)$$,'42501',null,'anonymous callers are refused');

select * from finish();
rollback;
