begin;
select plan(17);

-- DST-002b part b1: the owner's Copy, Remix or Scratch on "Create email".
-- Workspace 101: owner ...01, staff ...05.
select col_default_is('public','email_builds','mode','scratch','a build is made from scratch unless the owner chose otherwise');
select col_not_null('public','email_builds','mode','every build has a mode');
select col_has_check('public','email_builds','mode','the column itself allows only copy, remix or scratch');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_email_build' and p.pronargs = 3),'the three-argument command is replaced, not kept beside the new one');
select ok(not has_function_privilege('anon','public.create_email_build(uuid,uuid,integer,text)','execute'),'anon cannot create an email');
select ok(has_function_privilege('authenticated','public.create_email_build(uuid,uuid,integer,text)','execute'),'members may call it (the owner check is inside)');

-- A planned run with a designed email, a text email and a third designed one.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch','format','designed'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story','format','text'),
     jsonb_build_object('date',(current_setting('test.today')::date+4)::text,'time','10:00','emailType','offer'))),
   '00000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- The app before this change names t, run and slot only: still Scratch.
select set_config('test.scratch',public.create_email_build(t => '00000000-0000-4000-8000-000000000101', run => '00000000-0000-4000-8000-00000000e101', slot => 2)::text,true);
select is((select mode from public.email_builds where id=current_setting('test.scratch')::uuid),'scratch','without a mode, the email is made from scratch');
select set_config('test.copy',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,'copy')::text,true);
select is((select mode from public.email_builds where id=current_setting('test.copy')::uuid),'copy','the owner''s Copy is kept on the build');
select is(public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,'remix'),current_setting('test.copy')::uuid,'clicking again returns the build being made');
select is((select mode from public.email_builds where id=current_setting('test.copy')::uuid),'copy','and keeps the mode it was started with');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,'copy')$$,'22023','A text email is written, not copied or remixed','a text email cannot be copied');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,'remix')$$,'22023','A text email is written, not copied or remixed','nor remixed');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,'paste')$$,'22023','Choose Copy, Remix or Scratch','an unknown mode is refused');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,null)$$,'22023','Choose Copy, Remix or Scratch','a missing mode is refused');
select set_config('test.text',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,'scratch')::text,true);
select is((select mode from public.email_builds where id=current_setting('test.text')::uuid),'scratch','a text email is made as it always was');
reset role;

-- Staff choose nothing: the owner check comes first.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,'remix')$$,'42501',null,'staff cannot create an email in any mode');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,'paste')$$,'42501',null,'staff learn nothing from the mode check: the owner check comes first');
reset role;

select * from finish();
rollback;
