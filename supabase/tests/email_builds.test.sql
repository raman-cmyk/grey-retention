begin;
select plan(62);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04.
select ok(not has_table_privilege('authenticated','public.email_builds','insert,update,delete,truncate'),'members cannot write builds directly');
select ok(not has_table_privilege('service_role','public.email_builds','insert,update,delete,truncate,maintain'),'jobs write builds only through the commands');
select ok(not has_table_privilege('anon','public.email_builds','select'),'anon cannot read builds');
select ok(not has_function_privilege('anon','public.create_email_build(uuid,uuid,integer)','execute'),'anon cannot create an email');
select ok(not has_function_privilege('authenticated','public.claim_email_build(uuid)','execute'),'members cannot claim a build');
select ok(not has_function_privilege('authenticated','public.finish_email_build(uuid,uuid,jsonb)','execute'),'members cannot finish a build');
select ok(not has_function_privilege('authenticated','public.finish_email_push(uuid,uuid,text,boolean)','execute'),'members cannot finish a push');
select ok(not has_function_privilege('authenticated','public.fail_email_step(uuid,uuid,text,boolean,integer)','execute'),'members cannot fail a step');
select ok(has_function_privilege('service_role','public.claim_email_build(uuid)','execute'),'jobs claim builds');

-- Helpers for the test only: claim as a job, and let time pass.
create function pg_temp.claim(target uuid default null) returns uuid language sql as $$ select c.lease_token from public.claim_email_build(target) c $$;
create function pg_temp.later(build uuid, minutes int) returns void language sql as $$
  update public.email_builds set updated_at = updated_at - make_interval(mins => minutes),
    lease_until = lease_until - make_interval(mins => minutes),
    not_before = not_before - make_interval(mins => minutes)
  where id = build $$;
grant execute on function pg_temp.claim(uuid) to service_role;

-- A planned run for workspace 101 (the plan job wrote it), with two emails:
-- one in two days, one yesterday (store time); and one still planning.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e001','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'),
     jsonb_build_object('date',(current_setting('test.today')::date-1)::text,'time','10:00','emailType','offer'))),
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e002','00000000-0000-4000-8000-000000000102',current_setting('test.today')::date+1,'pulse_queued',
   null,null,null,'00000000-0000-4000-8000-000000000004');

-- The owner creates an email; clicking again returns the same build.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',0)::text,true);
select is(public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',0),current_setting('test.build')::uuid,'one build per planned email');
select is((select state from public.email_builds where id=current_setting('test.build')::uuid),'build_queued','it waits for the build job');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)$$,'PT409','This email''s day has passed','no email for a day that has passed');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',2)$$,'22023','This plan has no such email','no email the plan does not have');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',null)$$,'22023',null,'a planned email is named');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e002',0)$$,'42501','Plan unavailable','no email from another workspace''s plan');
reset role;

-- Staff and other workspaces cannot create or read it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',0)$$,'42501',null,'staff cannot create an email');
select is((select count(*) from public.email_builds where tenant_id='00000000-0000-4000-8000-000000000101'),1::bigint,'staff read their own workspace''s builds');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',0)$$,'42501',null,'a workspace admin cannot create an email either');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.email_builds where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace cannot read it');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e002',0)$$,'PT409','This plan is not ready yet','no email from a plan still being made');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e001',0)$$,'42501','Plan unavailable','nor from another workspace''s plan through its own');
reset role;

-- Job commands check the caller themselves.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select * from public.claim_email_build()$$,'42501',null,'a call without the job role cannot claim');
select throws_ok($$select public.fail_email_step(current_setting('test.build')::uuid,gen_random_uuid(),'x_y')$$,'42501',null,'nor fail a step');
reset role;

-- A job builds the email: leases are exact, the planned email comes along.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.finish_email_build(current_setting('test.build')::uuid,null,'{}')$$,'PT409','Lease unavailable','an unclaimed build cannot be finished');
select is(pg_temp.claim(gen_random_uuid()),null,'a claim for another build hands out nothing');
select is((select c.planned->>'emailType' from public.claim_email_build(current_setting('test.build')::uuid) c),'launch','the claim brings the planned email');
select is(pg_temp.claim(),null,'a leased step is not handed out twice');
select set_config('test.lease',(select lease_token from public.email_builds where id=current_setting('test.build')::uuid)::text,true);
select throws_ok($$select public.finish_email_build(current_setting('test.build')::uuid,gen_random_uuid(),'{"subject":"s","preheader":"p","html":"<p>x</p>"}')$$,'PT409','Lease unavailable','a wrong lease cannot finish it');
select throws_ok($$select public.finish_email_push(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'c1',false)$$,'PT409','Lease unavailable','a build step cannot be finished as a push');
select throws_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p"}')$$,'22023',null,'a built email needs its HTML');
select throws_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p","html":""}')$$,'22023',null,'and not an empty one');
select lives_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p","html":"<p>x</p>"}')$$,'the job finishes the build');
select is((select state from public.email_builds where id=current_setting('test.build')::uuid),'push_queued','the email waits for the push');

-- Klaviyo is busy: the push waits as long as it asked.
select set_config('test.lease',pg_temp.claim(current_setting('test.build')::uuid)::text,true);
select throws_ok($$select public.fail_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'rate_limited',false,0)$$,'22023',null,'a wait needs at least a second');
select is(public.fail_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'rate_limited',false,600),'retry','a busy Klaviyo is tried again');
select is((select attempts || ':' || waits from public.email_builds where id=current_setting('test.build')::uuid),'0:1','a wait does not use up an attempt');
select is((select email->>'html' from public.email_builds where id=current_setting('test.build')::uuid),'<p>x</p>','the built email is kept for the retry');
reset role;
select pg_temp.later(current_setting('test.build')::uuid, 2);
set local role service_role;
select is(pg_temp.claim(),null,'not before Klaviyo''s wait is over');
reset role;
select pg_temp.later(current_setting('test.build')::uuid, 9);
set local role service_role;
select set_config('test.lease',pg_temp.claim()::text,true);
select isnt(current_setting('test.lease'),null,'then the push is tried again');
select throws_ok($$select public.finish_email_push(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'',false)$$,'22023',null,'a draft needs its campaign id');
select lives_ok($$select public.finish_email_push(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sample-draft-1',true)$$,'the job records the draft');
reset role;
select is((select state || ':' || klaviyo_campaign_id || ':' || sample_draft::text from public.email_builds where id=current_setting('test.build')::uuid),
  'drafted:sample-draft-1:true','the email is a draft, marked as the fake''s');
select is((select error_code from public.email_builds where id=current_setting('test.build')::uuid),null,'the last error is cleared');

-- Creating it again returns the draft, never a second one.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',0),current_setting('test.build')::uuid,'the drafted email is returned, not built twice');
reset role;

-- Three failed attempts fail the build; a final failure fails at once.
update public.strategy_runs set plan = jsonb_set(plan,'{slots,1,date}',to_jsonb((current_setting('test.today')::date+3)::text))
  where id='00000000-0000-4000-8000-00000000e001';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.other',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.fail_email_step(current_setting('test.other')::uuid,pg_temp.claim(),'Not A Code')$$,'22023',null,'a failure needs a short code');
reset role;
select pg_temp.later(current_setting('test.other')::uuid, 10);
set local role service_role;
select is(public.fail_email_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'retry','the first failure is tried again');
select is(pg_temp.claim(),null,'but not at once');
reset role;
select pg_temp.later(current_setting('test.other')::uuid, 2);
set local role service_role;
select is(public.fail_email_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'retry','the second failure is tried again a minute later');
reset role;
select pg_temp.later(current_setting('test.other')::uuid, 2);
set local role service_role;
select is(public.fail_email_step(current_setting('test.other')::uuid,pg_temp.claim(),'store_unreadable'),'failed','the third attempt fails the build');
reset role;
select is((select state || ':' || error_code from public.email_builds where id=current_setting('test.other')::uuid),'failed:store_unreadable','with its reason');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.final',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)::text,true);
select isnt(current_setting('test.final')::uuid,current_setting('test.other')::uuid,'a failed email can be created again');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.fail_email_step(current_setting('test.final')::uuid,pg_temp.claim(current_setting('test.final')::uuid),'rejected',true),'failed','a final failure fails at once');
reset role;

-- A build that reached the push and failed keeps its push key for the next.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.third',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)::text,true);
reset role;
select isnt((select push_key from public.email_builds where id=current_setting('test.third')::uuid),
  (select push_key from public.email_builds where id=current_setting('test.final')::uuid),'a build that never reached the push gets a new key');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',pg_temp.claim(current_setting('test.third')::uuid)::text,true);
select lives_ok($$select public.finish_email_build(current_setting('test.third')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p","html":"<p>x</p>"}')$$,'the third build is built');
select set_config('test.lease',pg_temp.claim(current_setting('test.third')::uuid)::text,true);
reset role;
-- Its lease runs out: finishing or failing with it is refused.
select pg_temp.later(current_setting('test.third')::uuid, 10);
set local role service_role;
select throws_ok($$select public.finish_email_push(current_setting('test.third')::uuid,current_setting('test.lease')::uuid,'c3',false)$$,'PT409','Lease unavailable','an expired lease cannot finish a push');
select throws_ok($$select public.fail_email_step(current_setting('test.third')::uuid,current_setting('test.lease')::uuid,'x_y')$$,'PT409','Lease unavailable','nor fail it');
select is(public.fail_email_step(current_setting('test.third')::uuid,pg_temp.claim(current_setting('test.third')::uuid),'klaviyo_unavailable',true),'failed','the push fails for good');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.fourth',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)::text,true);
reset role;
select is((select push_key from public.email_builds where id=current_setting('test.fourth')::uuid),
  (select push_key from public.email_builds where id=current_setting('test.third')::uuid),'"Try again" after a push keeps the key, so Klaviyo returns the same draft');
-- A step whose lease ran out three times fails as timed out.
update public.email_builds set attempts = 3, lease_token = gen_random_uuid(), lease_until = now() - interval '1 minute',
  updated_at = now() - interval '10 minutes' where id = current_setting('test.fourth')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.claim(current_setting('test.fourth')::uuid),null,'a step out of attempts is not handed out');
reset role;
select is((select state || ':' || error_code from public.email_builds where id=current_setting('test.fourth')::uuid),'failed:step_timed_out','it fails as timed out');
-- A newer plan replaces this one: no more emails from the old one.
insert into public.strategy_runs (tenant_id, start_on, state, created_by, created_at)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.today')::date+1,'failed','00000000-0000-4000-8000-000000000001',now()+interval '1 second');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1)$$,'PT409','This plan has been replaced; use the latest plan','an older plan is refused');
reset role;

-- A paused workspace's builds wait.
update public.tenants set status='paused' where id='00000000-0000-4000-8000-000000000101';
insert into public.email_builds (tenant_id, run_id, slot, created_by)
  values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e001',1,'00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.claim(),null,'a paused workspace''s build is not handed out');
reset role;

select * from finish();
rollback;
