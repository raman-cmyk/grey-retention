begin;
select plan(12);

-- REL-AI1b: two emails in one plan never save the same subject.
-- Workspace 101: owner ...01. Workspace 102: owner ...04.
select ok(not has_function_privilege('authenticated','private.subject_key(text)','execute'),'members cannot call the subject key');

select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e301','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','story'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story'),
     jsonb_build_object('date',(current_setting('test.today')::date+4)::text,'time','10:00','emailType','story'),
     jsonb_build_object('date',(current_setting('test.today')::date+5)::text,'time','10:00','emailType','story'))),
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e302','00000000-0000-4000-8000-000000000102',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','story'))),
   '00000000-0000-4000-8000-000000000004');

-- Builds waiting at their copy step (the job made the steps before).
insert into public.email_builds (id, tenant_id, run_id, slot, step, progress, created_by) values
  ('00000000-0000-4000-8000-00000000c301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',0,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000c302','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',1,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000c303','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',2,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000c304','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e302',0,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000004');
-- Earlier failed builds: slot 3 failed before its push (its subject is
-- free again); slot 2 failed after reaching the push (its draft may carry it).
insert into public.email_builds (tenant_id, run_id, slot, state, step, progress, email, created_by) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',3,'failed','design',
   '{"copy":{"draft":{"subject":"Gone"}}}',null,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',2,'failed','push',
   '{"copy":{"draft":{"subject":"Drafted"}}}','{"subject":"Drafted","preheader":"p","html":"<p>x</p>"}','00000000-0000-4000-8000-000000000001');

create function pg_temp.save(b text, subject text) returns text language sql as $$
  select public.finish_email_step(b::uuid,
    (select c.lease_token from public.claim_email_build(b::uuid) c),
    'copy', jsonb_build_object('draft', jsonb_build_object('subject', subject)))
$$;
grant execute on function pg_temp.save(text, text) to service_role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c301','Hello from Cedar'),'design','the first email saves its subject');
reset role;
update public.email_builds set attempts = 0 where id = '00000000-0000-4000-8000-00000000c302';
set local role service_role;
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c302','  HELLO   from cedar ')$$,'PT409','Another email in this plan has this subject','another email of the plan cannot save it, whatever its case and spacing');
reset role;
update public.email_builds set attempts = 0, lease_token = null, lease_until = null where id = '00000000-0000-4000-8000-00000000c302';
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c302','A note from Cedar'),'design','it saves a different one');
reset role;
update public.email_builds set attempts = 0 where id = '00000000-0000-4000-8000-00000000c303';
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c303','Gone'),'design','a subject of a build that failed before its push is free again');
reset role;
select is((select step from public.email_builds where id='00000000-0000-4000-8000-00000000c303'),'design','and it moved on');

-- A failed build that reached the push still holds its subject (only it
-- holds "Drafted" now), but not for its own email ("Try again").
update public.email_builds set step = 'copy', progress = '{"sections":{},"content":{}}', attempts = 0
  where id = '00000000-0000-4000-8000-00000000c302';
set local role service_role;
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c302','Drafted')$$,'PT409',null,'another email of the plan cannot take the subject of a failed build that reached the push');
reset role;
update public.email_builds set attempts = 0, lease_token = null, lease_until = null where id = '00000000-0000-4000-8000-00000000c302';
update public.email_builds set step = 'copy', progress = '{"sections":{},"content":{}}', attempts = 0
  where id = '00000000-0000-4000-8000-00000000c303';
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c303','Drafted'),'design','but its own email may use it again');
reset role;

-- A drafted email from before the saved steps has its subject only in its
-- stored email (no saved copy step): it still holds it.
insert into public.email_builds (tenant_id, run_id, slot, state, step, progress, email, klaviyo_campaign_id, created_by) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',3,'drafted','push','{}',
   '{"subject":"Old draft","preheader":"p","html":"<p>x</p>"}','camp-old','00000000-0000-4000-8000-000000000001');
set local role service_role;
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c302','old  DRAFT')$$,'PT409',null,'a drafted email holds the subject in its stored email');
reset role;
update public.email_builds set attempts = 0, lease_token = null, lease_until = null where id = '00000000-0000-4000-8000-00000000c302';
set local role service_role;
select throws_ok($$select public.finish_email_step('00000000-0000-4000-8000-00000000c302'::uuid,
  (select c.lease_token from public.claim_email_build('00000000-0000-4000-8000-00000000c302'::uuid) c),'copy','{"draft":{"subject":"  "}}')$$,
  '22023','A copy step needs its subject','a copy step needs its subject');
-- Another workspace's plan is its own.
select is(pg_temp.save('00000000-0000-4000-8000-00000000c304','Hello from Cedar'),'design','another plan may use the same subject');
reset role;

-- The other steps are not checked.
update public.email_builds set step = 'sections', progress = '{}', attempts = 0, lease_token = null, lease_until = null
  where id = '00000000-0000-4000-8000-00000000c302';
set local role service_role;
select is(public.finish_email_step('00000000-0000-4000-8000-00000000c302'::uuid,
  (select c.lease_token from public.claim_email_build('00000000-0000-4000-8000-00000000c302'::uuid) c),'sections','{}'),
  'content','other steps save as before');
reset role;

select * from finish();
rollback;
