begin;
select plan(39);

-- DST-006b: the design step waits for its pictures, and the design
-- studio's job claims it again when they are there. Workspace 101.
select ok(not has_function_privilege('authenticated','public.wait_email_round(uuid,uuid,jsonb,integer)','execute'),'members cannot make a step wait');
select ok(not has_function_privilege('anon','public.wait_email_round(uuid,uuid,jsonb,integer)','execute'),'nor can anyone signed out');
select ok(not has_function_privilege('authenticated','public.claim_studio_build(uuid)','execute'),'members cannot claim a waiting step');
select ok(not has_function_privilege('anon','public.claim_studio_build(uuid)','execute'),'nor can anyone signed out');
select ok(has_function_privilege('service_role','public.wait_email_round(uuid,uuid,jsonb,integer)','execute')
  and has_function_privilege('service_role','public.claim_studio_build(uuid)','execute'),'jobs wait and claim');

select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e401','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story'))),
   '00000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',0)::text,true);
select set_config('test.other',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',1)::text,true);
reset role;

-- Only jobs wait.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,gen_random_uuid(),'{}',600)$$,'42501',null,'a call without the job role cannot wait');
select throws_ok($$select * from public.claim_studio_build(current_setting('test.build')::uuid)$$,'42501',null,'nor claim');
reset role;

-- Only the design step waits: the build's copy step cannot.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{}')$$,'the sections are saved');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{}')$$,'and the content');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',600)$$,'PT409','Only the design step waits for its pictures','the copy step never waits');
select is(public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Hello"}}'),'design','the build reaches its design step');

-- The design step waits, under its lease, with its work.
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'design','{"round":1}'),1,'a design round is saved first');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,gen_random_uuid(),'{}',600)$$,'PT409','Lease unavailable','a wrong lease waits for nothing');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'[1]',600)$$,'22023','A step''s work is an object','the work is an object');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,jsonb_build_object('big',repeat('x',64000)),600)$$,'22023','A step''s work is too large','and at most 64 kB');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',59)$$,'22023','Wait 1 minute to 1 hour','a wait is at least a minute');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',3601)$$,'22023','Wait 1 minute to 1 hour','and at most an hour');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',null)$$,'22023','Wait 1 minute to 1 hour','and is given');
select is(public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"round":1,"renders":["s2-r1"],"saves":-100}',600),1,'the step waits');
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',600)$$,'PT409','Lease unavailable','waiting ends the claim');
reset role;
select is((select step || ':' || attempts || ':' || waits || ':' || (lease_token is null)::text || ':' || (progress->'work'->'design')::text
  from public.email_builds where id=current_setting('test.build')::uuid),
  'design:0:1:true:{"round": 1, "saves": 1, "renders": ["s2-r1"]}','it stays on its step with its try given back, its work and the save count it had');
select ok((select not_before between now() + interval '599 seconds' and now() + interval '601 seconds'
  from public.email_builds where id=current_setting('test.build')::uuid),'until its time is up');

-- Nothing else takes it before its time: not the click, not the sweep.
update public.email_builds set updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
set local role service_role;
select is((select count(*) from public.claim_email_build(current_setting('test.build')::uuid) c),0::bigint,'the click does not take a waiting step');
select is((select count(*) from public.claim_email_build() c),0::bigint,'nor does the sweep');
select throws_ok($$select * from public.claim_studio_build(null)$$,'22023','Name the build to claim','the studio claims a named build only');
reset role;

-- The studio claims it once every picture it asked for is drawn or failed.
insert into public.section_renders (tenant_id, build_id, section_key, section, origins) values
  ('00000000-0000-4000-8000-000000000101',current_setting('test.build')::uuid,'s2-r1','{"id":"s2"}',array['https://cdn.example']);
set local role service_role;
select is((select count(*) from public.claim_studio_build(current_setting('test.build')::uuid) c),0::bigint,'not while a picture is still queued');
reset role;
update public.section_renders set state = 'failed', failure = 'timeout', finished_at = now() where build_id = current_setting('test.build')::uuid;
set local role service_role;
select set_config('test.claim',(select c.step || ' ' || (c.progress->'work'->'design'->>'round') || ' ' || c.lease_token from public.claim_studio_build(current_setting('test.build')::uuid) c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),'design 1','then it is handed the step with its work');
select set_config('test.lease',split_part(current_setting('test.claim'),' ',3),true);
select is((select count(*) from public.claim_studio_build(current_setting('test.build')::uuid) c),0::bigint,'once: its lease holds it');
select is(public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"round":2}',120),2,'its next round waits again');
reset role;

-- A step that saved a round is not waiting: the studio leaves it.
update public.section_renders set state = 'queued', failure = null, finished_at = null where build_id = current_setting('test.build')::uuid;
update public.email_builds set not_before = now() - interval '1 second', updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_studio_build(current_setting('test.build')::uuid) c)::text,true);
select ok(current_setting('test.lease') <> '','once its time is up, the studio takes it even with a picture queued');
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'design','{"round":3}'),2,'it saves a round');
select is((select count(*) from public.claim_studio_build(current_setting('test.build')::uuid) c),0::bigint,'and is not waiting any more');
reset role;

-- Past its time, the sweep takes it (and draws coded blocks, in code).
update public.email_builds set waits = 1, not_before = now() - interval '1 second', updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
set local role service_role;
select is((select c.id::text from public.claim_email_build() c),current_setting('test.build'),'past its time the sweep takes the step');
reset role;

-- A design step waits at most 6 times.
update public.email_builds set waits = 6 where id = current_setting('test.build')::uuid;
select set_config('test.lease',(select lease_token::text from public.email_builds where id=current_setting('test.build')::uuid),true);
set local role service_role;
select throws_ok($$select public.wait_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{}',600)$$,'22023','This step waited too often','the seventh wait is refused');
reset role;

-- A studio claim whose lease ran out three times fails the step; a planned day that passed fails it too.
update public.email_builds set waits = 1, attempts = 3, lease_token = null, lease_until = null, not_before = now() + interval '10 minutes',
  updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
update public.section_renders set state = 'failed', failure = 'timeout', finished_at = now() where build_id = current_setting('test.build')::uuid;
set local role service_role;
select is((select count(*) from public.claim_studio_build(current_setting('test.build')::uuid) c),0::bigint,'a step out of tries is not handed out');
reset role;
select is((select state || ':' || error_code from public.email_builds where id=current_setting('test.build')::uuid),'failed:step_timed_out','it fails');

set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'sections','{}')$$,'another email gets going');
reset role;
update public.email_builds set step = 'design', waits = 1, not_before = now() + interval '10 minutes', updated_at = now() - interval '2 minutes'
  where id = current_setting('test.other')::uuid;
update public.strategy_runs set plan = jsonb_set(plan, '{slots,1,date}', to_jsonb((current_setting('test.today')::date - 1)::text))
  where id = '00000000-0000-4000-8000-00000000e401';
set local role service_role;
select is((select count(*) from public.claim_studio_build(current_setting('test.other')::uuid) c),0::bigint,'an email whose day has passed is not handed out');
reset role;
select is((select state || ':' || error_code from public.email_builds where id=current_setting('test.other')::uuid),'failed:day_passed','it fails as the day passed');

select * from finish();
rollback;
