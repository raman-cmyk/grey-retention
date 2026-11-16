begin;
select plan(6);

-- TXT-001d: a text email's copy step saves a letter; its subject is
-- checked as a designed email's draft subject is (REL-AI1b).
-- Workspace 101: owner ...01.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e401','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','story','format','text'),
     jsonb_build_object('date',(current_setting('test.today')::date+3)::text,'time','10:00','emailType','story'),
     jsonb_build_object('date',(current_setting('test.today')::date+4)::text,'time','10:00','emailType','story','format','text'))),
   '00000000-0000-4000-8000-000000000001');
insert into public.email_builds (id, tenant_id, run_id, slot, step, progress, created_by) values
  ('00000000-0000-4000-8000-00000000c401','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',0,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000c402','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',1,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000c403','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',2,'copy','{"sections":{},"content":{}}','00000000-0000-4000-8000-000000000001');

create function pg_temp.save(b text, output jsonb) returns text language sql as $$
  select public.finish_email_step(b::uuid,
    (select c.lease_token from public.claim_email_build(b::uuid) c),
    'copy', output)
$$;
grant execute on function pg_temp.save(text, jsonb) to service_role;
create function pg_temp.again(b text) returns void language sql as $$
  update public.email_builds set attempts = 0, lease_token = null, lease_until = null where id = b::uuid
$$;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c401',
  '{"letter":{"subject":"A short note about the Cedar candle"},"productIds":[],"changes":[]}'),
  'design','a text email saves its letter, with its subject');
select is((select progress->'copy'->'letter'->>'subject' from public.email_builds where id='00000000-0000-4000-8000-00000000c401'),
  'A short note about the Cedar candle','and the letter is kept as saved');
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c402',
  '{"draft":{"subject":"a SHORT note about the cedar   candle"}}')$$,
  'PT409','Another email in this plan has this subject',
  'a designed email of the plan cannot take a saved letter''s subject');
reset role;
select pg_temp.again('00000000-0000-4000-8000-00000000c402');
set local role service_role;
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c403',
  '{"letter":{"subject":"A short note about the Cedar candle"}}')$$,
  'PT409',null,'nor can another letter');
reset role;
select pg_temp.again('00000000-0000-4000-8000-00000000c403');
set local role service_role;
select throws_ok($$select pg_temp.save('00000000-0000-4000-8000-00000000c403',
  '{"letter":{"subject":"  "}}')$$,
  '22023','A copy step needs its subject','a letter with no subject is refused');
reset role;
select pg_temp.again('00000000-0000-4000-8000-00000000c402');
set local role service_role;
select is(pg_temp.save('00000000-0000-4000-8000-00000000c402',
  '{"draft":{"subject":"A note from Cedar"}}'),
  'design','a designed email saves a free subject, as before');
reset role;

select * from finish();
rollback;
