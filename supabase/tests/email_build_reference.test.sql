begin;
select plan(29);

-- UI-USE: "Use this design" on Inspiration runs Create email on a planned
-- email with the inspiration email the owner chose (Copy or Remix).
-- Workspace 101: owner ...01, staff ...05; workspace 102: owner ...04.
select has_column('public','email_builds','reference_id','a build can keep the inspiration email the owner chose');
select col_is_null('public','email_builds','reference_id','most builds have none (the worker picks, or Scratch)');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.email_builds'::regclass
  and conname = 'email_builds_reference_mode' and contype = 'c'),'a chosen email comes with Copy or Remix only');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_email_build' and p.pronargs <> 5),'the four-argument command is replaced, not kept beside the new one');
select ok(not has_function_privilege('anon','public.create_email_build(uuid,uuid,integer,text,uuid)','execute'),'anon cannot create an email');
select ok(has_function_privilege('authenticated','public.create_email_build(uuid,uuid,integer,text,uuid)','execute'),'members may call it (the owner check is inside)');

-- Brands: one workspace 101 follows, one it follows but hid, one it
-- stopped following, and one only workspace 102 follows; one email each.
insert into public.competitor_captures(domain, synthetic, brand_name) values
  ('use-followed.example', true, 'Followed'),
  ('use-hidden.example', true, 'Hidden'),
  ('use-dropped.example', true, 'Dropped'),
  ('use-other.example', true, 'Other');
insert into public.competitor_subscriptions(tenant_id, capture_id, label, active, created_by)
  select '00000000-0000-4000-8000-000000000101', c.id, c.brand_name, c.domain <> 'use-dropped.example', '00000000-0000-4000-8000-000000000001'
  from public.competitor_captures c where c.domain in ('use-followed.example', 'use-hidden.example', 'use-dropped.example');
insert into public.competitor_subscriptions(tenant_id, capture_id, label, created_by)
  select '00000000-0000-4000-8000-000000000102', c.id, c.brand_name, '00000000-0000-4000-8000-000000000004'
  from public.competitor_captures c where c.domain = 'use-other.example';
insert into public.competitor_hidden(tenant_id, capture_id, hidden_by)
  select '00000000-0000-4000-8000-000000000101', c.id, '00000000-0000-4000-8000-000000000001'
  from public.competitor_captures c where c.domain = 'use-hidden.example';
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic)
  select c.id, 'use-' || c.domain, now() - interval '1 day', 'Sample subject', 'Sample body', '<p>Sample body</p>', '{}', true
  from public.competitor_captures c where c.domain like 'use-%.example';
create function pg_temp.email_of(domain text) returns text language sql as $$
  select e.id::text from public.competitor_emails e join public.competitor_captures c on c.id = e.capture_id
  where c.domain = email_of.domain
$$;
select set_config('test.followed',pg_temp.email_of('use-followed.example'),true);
select set_config('test.hidden',pg_temp.email_of('use-hidden.example'),true);
select set_config('test.dropped',pg_temp.email_of('use-dropped.example'),true);
select set_config('test.other',pg_temp.email_of('use-other.example'),true);
select set_config('test.followed_brand',(select id::text from public.competitor_captures where domain='use-followed.example'),true);

-- A planned run: four designed emails and a text one.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e201','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch','format','designed'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story','format','text'),
     jsonb_build_object('date',(current_setting('test.today')::date+4)::text,'time','10:00','emailType','offer'),
     jsonb_build_object('date',(current_setting('test.today')::date+5)::text,'time','10:00','emailType','story','format','designed'),
     jsonb_build_object('date',(current_setting('test.today')::date+6)::text,'time','10:00','emailType','launch','format','designed'))),
   '00000000-0000-4000-8000-000000000001');

-- The table itself keeps a chosen email off a Scratch build.
select throws_ok($$insert into public.email_builds (tenant_id, run_id, slot, created_by, mode, reference_id)
  values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',4,'00000000-0000-4000-8000-000000000001','scratch',current_setting('test.followed')::uuid)$$,
  '23514',null,'a Scratch build cannot keep a chosen email');

-- The hint a refusal carries (the app reads it, not the words).
create function pg_temp.hint_of(t uuid, run uuid, slot integer, mode text, reference uuid) returns text language plpgsql as $$
declare h text;
begin
  perform public.create_email_build(t, run, slot, mode, reference);
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end $$;
grant execute on function pg_temp.hint_of(uuid,uuid,integer,text,uuid) to authenticated;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- The app before this change (t, run, slot and mode) works as it did.
select set_config('test.plain',public.create_email_build(t => '00000000-0000-4000-8000-000000000101', run => '00000000-0000-4000-8000-00000000e201', slot => 4, mode => 'copy')::text,true);
select ok((select mode = 'copy' and reference_id is null from public.email_builds where id=current_setting('test.plain')::uuid),'without a reference, the worker picks one, as before');
-- The owner's chosen email from a brand the workspace follows.
select set_config('test.chosen',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',0,'copy',current_setting('test.followed')::uuid)::text,true);
select is((select reference_id::text from public.email_builds where id=current_setting('test.chosen')::uuid),current_setting('test.followed'),'the chosen email is kept on the build');
select is((select mode from public.email_builds where id=current_setting('test.chosen')::uuid),'copy','with the owner''s Copy');
-- Clicking again (another email, another mode) returns the build being made.
select is(public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',0,'remix',current_setting('test.followed')::uuid),current_setting('test.chosen')::uuid,'clicking again returns the build being made');
select ok((select mode = 'copy' and reference_id::text = current_setting('test.followed') from public.email_builds where id=current_setting('test.chosen')::uuid),'and keeps the mode and email it was started with');
-- Remix with a chosen email, on an email with no format (a designed one).
select set_config('test.remix',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',2,'remix',current_setting('test.followed')::uuid)::text,true);
select ok((select mode = 'remix' and reference_id::text = current_setting('test.followed') from public.email_builds where id=current_setting('test.remix')::uuid),'Remix keeps the chosen email too');
-- Emails the workspace may not use: refused the same way.
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.other')::uuid)$$,'22023','This inspiration email is not one you can use','an email only another workspace follows is refused');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',gen_random_uuid())$$,'22023','This inspiration email is not one you can use','an unknown email is refused');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.hidden')::uuid)$$,'22023','This inspiration email is not one you can use','an email of a brand the workspace hid is refused');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'remix',current_setting('test.dropped')::uuid)$$,'22023','This inspiration email is not one you can use','an email of a brand it no longer follows is refused');
select is(pg_temp.hint_of('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.other')::uuid),'build_reference_unknown','the refusal carries its hint');
-- A chosen email comes with Copy or Remix; a text email has neither.
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'scratch',current_setting('test.followed')::uuid)$$,'22023','Choose Copy or Remix for an inspiration email','Scratch with a chosen email is refused');
select is(pg_temp.hint_of('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'scratch',current_setting('test.followed')::uuid),'build_mode_reference','that refusal carries its hint');
select is(pg_temp.hint_of('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',1,'copy',current_setting('test.followed')::uuid),'build_mode_text','a text email is not copied from a chosen email either');
select is(pg_temp.hint_of('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'paste',current_setting('test.followed')::uuid),'build_mode_unknown','an unknown mode is refused first');
select is((select count(*) from public.email_builds where run_id='00000000-0000-4000-8000-00000000e201' and slot in (1,3)),0::bigint,'no refused click made a build');
-- The owner hides the brand he chose from: its email is no longer his to use.
select lives_ok($$select public.hide_competitor('00000000-0000-4000-8000-000000000101',current_setting('test.followed_brand')::uuid)$$,'the owner hides the brand');
select is(pg_temp.hint_of('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.followed')::uuid),'build_reference_unknown','after hiding it, its email is refused');
reset role;

-- Staff choose nothing: the owner check comes first.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.followed')::uuid)$$,'42501',null,'staff cannot create an email from a chosen one');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.other')::uuid)$$,'42501',null,'staff learn nothing from the email check: the owner check comes first');
reset role;

-- Another workspace's owner: its own followed email does not open this
-- workspace's plan, and this workspace's email is not its to use.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.other')::uuid)$$,'42501','Plan unavailable','another workspace cannot reach this plan with an email it follows');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e201',3,'copy',current_setting('test.followed')::uuid)$$,'22023','This inspiration email is not one you can use','nor use an email only this workspace follows');
reset role;

select * from finish();
rollback;
