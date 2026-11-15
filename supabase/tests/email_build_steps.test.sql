begin;
select plan(41);

-- REL-081: "Create email" runs as saved steps. Workspace 101: owner ...01.
select ok(not has_function_privilege('authenticated','public.finish_email_step(uuid,uuid,text,jsonb)','execute'),'members cannot finish a step');
select ok(not has_function_privilege('anon','public.finish_email_step(uuid,uuid,text,jsonb)','execute'),'nor can anyone signed out');
select ok(has_function_privilege('service_role','public.finish_email_step(uuid,uuid,text,jsonb)','execute'),'jobs finish steps');
select ok(not has_function_privilege('authenticated','public.claim_email_build(uuid)','execute'),'members still cannot claim a build');
select ok(has_function_privilege('service_role','public.claim_email_build(uuid)','execute'),'jobs still claim builds');
select ok(not has_function_privilege('anon','public.claim_email_build(uuid)','execute'),'nor can anyone signed out, after the claim was made again');

create function pg_temp.later(build uuid, minutes int) returns void language sql as $$
  update public.email_builds set updated_at = updated_at - make_interval(mins => minutes),
    lease_until = lease_until - make_interval(mins => minutes)
  where id = build $$;

-- A planned run with three emails in the coming days.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story'),
     jsonb_build_object('date',(current_setting('test.today')::date+4)::text,'time','10:00','emailType','offer'))),
   '00000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0)::text,true);
select is((select step || ':' || progress::text from public.email_builds where id=current_setting('test.build')::uuid),'sections:{}','a new build starts at the first step, with nothing saved');
reset role;

-- Only jobs finish steps.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,gen_random_uuid(),'sections','{}')$$,'42501',null,'a call without the job role cannot finish a step');
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.claim',(select c.step || ' ' || c.progress::text || ' ' || c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),'sections {}','the claim brings the step to run and what is saved');
select set_config('test.lease',split_part(current_setting('test.claim'),' ',3),true);
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{}')$$,'PT409','This is not the build''s next step','a step cannot be skipped');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'design','{}')$$,'PT409',null,'nor the design step finished as a saved step');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'bogus','{}')$$,'22023','Unknown build step','a step it does not know is refused');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections',null)$$,'22023',null,'a step needs its output');
select throws_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p","html":"<p>x</p>"}')$$,'PT409','This is not the build''s next step','an email is not built before its design step');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,gen_random_uuid(),'sections','{}')$$,'PT409','Lease unavailable','a wrong lease cannot finish a step');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','[1]')$$,'22023',null,'a step''s output is an object');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections',jsonb_build_object('big',repeat('x',300001)))$$,'22023','A step''s output is too large','and not too large');
select is(public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"sendAt":"2027-01-01T10:00:00Z"}'),'content','the first step is saved and the build moves on');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{}')$$,'PT409','Lease unavailable','a finished step''s lease is spent');
reset role;
select is((select step || ':' || attempts || ':' || (lease_token is null)::text || ':' || (progress->'sections'->>'sendAt') from public.email_builds where id=current_setting('test.build')::uuid),
  'content:0:true:2027-01-01T10:00:00Z','the next step has its own attempts, and the first step''s output is kept');

-- The next step is handed out at once; when it fails, only it is tried again.
set local role service_role;
select set_config('test.claim',(select c.step || ' ' || (c.progress ? 'sections')::text || ' ' || c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),'content true','the next step runs at once, with the saved step');
select is(public.fail_email_step(current_setting('test.build')::uuid,split_part(current_setting('test.claim'),' ',3)::uuid,'store_unreadable'),'retry','a failed step is tried again');
reset role;
select is((select state || ':' || step || ':' || (progress ? 'sections')::text from public.email_builds where id=current_setting('test.build')::uuid),
  'build_queued:content:true','the failed step waits, the saved steps stay');
select pg_temp.later(current_setting('test.build')::uuid, 2);
set local role service_role;
select set_config('test.claim',(select c.step || ' ' || c.lease_token from public.claim_email_build() c),true);
select is(split_part(current_setting('test.claim'),' ',1),'content','the retry starts at the failed step, not at the start');
select set_config('test.lease',split_part(current_setting('test.claim'),' ',2),true);
select is(public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{"locked":true}'),'copy','then it is saved');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select is(public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Hello"}}'),'design','and so is the copy');
reset role;

-- The furthest build is handed out first.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.second',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1)::text,true);
reset role;
update public.email_builds set updated_at = now() - interval '1 hour' where id = current_setting('test.second')::uuid;
-- Past the sweep's 30-second grace for a step that just moved on.
select pg_temp.later(current_setting('test.build')::uuid, 1);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.claim',(select c.id || ' ' || c.step || ' ' || c.lease_token from public.claim_email_build() c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),current_setting('test.build') || ' design',
  'an email near its end goes before an older new one');
select set_config('test.lease',split_part(current_setting('test.claim'),' ',3),true);
select lives_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"s","preheader":"p","html":"<p>x</p>"}')$$,'the design step builds the email');
reset role;
select is((select state || ':' || step || ':' || attempts from public.email_builds where id=current_setting('test.build')::uuid),'push_queued:push:0','the push is its own step');
select pg_temp.later(current_setting('test.build')::uuid, 1);
set local role service_role;
select set_config('test.claim',(select c.id || ' ' || c.step || ' ' || c.lease_token from public.claim_email_build() c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),current_setting('test.build') || ' push',
  'a push goes before an older new build');
select throws_ok($$select public.finish_email_step(current_setting('test.build')::uuid,split_part(current_setting('test.claim'),' ',3)::uuid,'copy','{}')$$,
  'PT409','Lease unavailable','a pushing build has no build step to finish');
reset role;

-- Members see how far their email got; another workspace sees nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select step from public.email_builds where id=current_setting('test.second')::uuid),'sections','staff read the step');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.email_builds where id=current_setting('test.second')::uuid),0::bigint,'another workspace cannot read it');
reset role;

-- A step whose lease ran out cannot be saved.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.second')::uuid) c)::text,true);
reset role;
update public.email_builds set lease_until = now() - interval '1 second' where id = current_setting('test.second')::uuid;
set local role service_role;
select throws_ok($$select public.finish_email_step(current_setting('test.second')::uuid,current_setting('test.lease')::uuid,'sections','{}')$$,
  'PT409','Lease unavailable','a step whose lease ran out cannot be saved');
reset role;
select is((select step || ':' || progress::text from public.email_builds where id=current_setting('test.second')::uuid),'sections:{}','and nothing is saved');

-- A step that fails for good fails the build; "Try again" starts at the first step.
update public.email_builds set progress = '{"sections":{}}', step = 'content', lease_token = null, lease_until = null, attempts = 0
  where id = current_setting('test.second')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(public.fail_email_step(current_setting('test.second')::uuid,(select c.lease_token from public.claim_email_build(current_setting('test.second')::uuid) c),'copy_failed',true),'failed','a final failure fails the build at its step');
reset role;
select is((select state || ':' || step || ':' || error_code from public.email_builds where id=current_setting('test.second')::uuid),'failed:content:copy_failed','it shows the step it stopped at');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.again',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1)::text,true);
reset role;
select is((select step || ':' || progress::text from public.email_builds where id=current_setting('test.again')::uuid),'sections:{}','"Try again" starts with fresh store data at the first step');

-- The step and the email agree.
select throws_ok($$insert into public.email_builds (tenant_id, run_id, slot, step, created_by)
  values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',2,'push','00000000-0000-4000-8000-000000000001')$$,
  '23514',null,'a build cannot be at the push without its email');
select throws_ok($$insert into public.email_builds (tenant_id, run_id, slot, state, email, created_by)
  values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',2,'push_queued','{"subject":"s","preheader":"p","html":"<p>x</p>"}','00000000-0000-4000-8000-000000000001')$$,
  '23514',null,'nor have its email before the push');
select throws_ok($$insert into public.email_builds (tenant_id, run_id, slot, step, created_by)
  values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',2,'review','00000000-0000-4000-8000-000000000001')$$,
  '23514',null,'a build has only the known steps');

select * from finish();
rollback;
