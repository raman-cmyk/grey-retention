begin;
select plan(33);

-- REL-AI part 2b: a build step saves its rounds and goes on in the next
-- claim. Workspace 101: owner ...01, staff ...05; another workspace: ...04.
select ok(not has_function_privilege('authenticated','public.save_email_round(uuid,uuid,text,jsonb)','execute'),'members cannot save a step''s rounds');
select ok(not has_function_privilege('anon','public.save_email_round(uuid,uuid,text,jsonb)','execute'),'nor can anyone signed out');
select ok(has_function_privilege('service_role','public.save_email_round(uuid,uuid,text,jsonb)','execute'),'jobs save rounds');

select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e301','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story'))),
   '00000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',0)::text,true);
select set_config('test.other',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',1)::text,true);
reset role;

-- Only jobs save rounds.
select set_config('request.jwt.claims','{}',true);
set local role service_role;
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,gen_random_uuid(),'copy','{}')$$,'42501',null,'a call without the job role cannot save rounds');
reset role;

-- The build reaches its copy step.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":1}')$$,'PT409','This is not the build''s step','a step that is not the build''s own saves nothing');
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"round":1}')$$,'22023','This step saves no rounds','nor a step without rounds');
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,null,'{"round":1}')$$,'22023',null,'nor no step');
select lives_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"sendAt":"2027-01-01T10:00:00Z"}')$$,'the sections are saved');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{"locked":true}')$$,'and the content');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,gen_random_uuid(),'copy','{"round":1}')$$,'PT409','Lease unavailable','a wrong lease saves nothing');
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','[1]')$$,'22023','A step''s work is an object','the work is an object');
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy',jsonb_build_object('big',repeat('x',64000)))$$,'22023','A step''s work is too large','and at most 64 kB');
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":1}'),1,'the first round is saved');
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":2}')$$,'PT409','Lease unavailable','saving ends the claim');
reset role;
select is((select step || ':' || attempts || ':' || (lease_token is null)::text || ':' || (progress->'work'->'copy')::text || ':' || (progress->'content')::text
  from public.email_builds where id=current_setting('test.build')::uuid),
  'copy:0:true:{"round": 1, "saves": 1}:{"locked": true}','the build stays on its step with its try given back, its work and its saved steps');

-- The step is handed out again at once, with its work.
set local role service_role;
select set_config('test.claim',(select c.step || ' ' || (c.progress->'work'->'copy'->>'round') || ' ' || c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c),true);
select is(split_part(current_setting('test.claim'),' ',1) || ' ' || split_part(current_setting('test.claim'),' ',2),'copy 1','the next claim goes on from the saved round');
select set_config('test.lease',split_part(current_setting('test.claim'),' ',3),true);
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":2,"saves":-100}'),2,'the next round replaces it, and the count is the database''s own');
reset role;
select is((select (progress->'work'->'copy')::text from public.email_builds where id=current_setting('test.build')::uuid),'{"round": 2, "saves": 2}','only the latest work is kept');

-- Members see the work of their own email; another workspace sees nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select (progress->'work'->'copy'->>'saves') from public.email_builds where id=current_setting('test.build')::uuid),'2','staff read how far the step got');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.email_builds where id=current_setting('test.build')::uuid),0::bigint,'another workspace cannot read it');
reset role;

-- A backstop: a step saves at most 16 times.
update public.email_builds set progress = jsonb_set(progress, '{work,copy,saves}', '15') where id = current_setting('test.build')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":16}'),16,'the 16th save is kept');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"round":17}')$$,'22023','This step saved too many rounds','the 17th is refused');
-- The step still finishes as before, and its work stays with the build.
select is(public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Hello"}}'),'design','the copy step is then saved as its output');
reset role;
select is((select step || ':' || (progress->'work'->'copy'->>'round') || ':' || (progress->'copy'->'draft'->>'subject') from public.email_builds where id=current_setting('test.build')::uuid),
  'design:16:Hello','the build moves on, with its last saved round');

-- The design step saves its rounds too, and then builds the email.
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select is(public.save_email_round(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'design','{"look":1}'),1,'a design round is saved, with its own count');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_build(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'{"subject":"Hello","preheader":"p","html":"<p>x</p>"}')$$,'then the email is built');
reset role;
select is((select state || ':' || step || ':' || (progress->'work'->'design'->>'look') || ':' || (progress->'work'->'copy'->>'saves') from public.email_builds where id=current_setting('test.build')::uuid),
  'push_queued:push:1:16','it goes to the push, with both steps'' work');

-- A failure before a save still counts: the save gives back only its own try.
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'sections','{}')$$,'another email gets going');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
select lives_ok($$select public.finish_email_step(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'content','{}')$$,'and reaches its copy step');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
select is(public.fail_email_step(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'subject_taken'),'retry','its copy step fails once');
reset role;
update public.email_builds set updated_at = now() - interval '2 minutes' where id = current_setting('test.other')::uuid;
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
select is(public.save_email_round(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'copy','{"round":1}'),1,'its next claim saves a round');
reset role;
select is((select attempts || ':' || error_code from public.email_builds where id=current_setting('test.other')::uuid),'1:subject_taken','the failed try still counts, and its reason is kept');

-- A step whose lease ran out saves nothing.
update public.email_builds set updated_at = now() - interval '2 minutes' where id = current_setting('test.other')::uuid;
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.other')::uuid) c)::text,true);
reset role;
update public.email_builds set lease_until = now() - interval '1 second' where id = current_setting('test.other')::uuid;
set local role service_role;
select throws_ok($$select public.save_email_round(current_setting('test.other')::uuid,current_setting('test.lease')::uuid,'copy','{"round":2}')$$,'PT409','Lease unavailable','a claim whose lease ran out saves nothing');
reset role;

select * from finish();
rollback;
