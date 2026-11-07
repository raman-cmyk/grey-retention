begin;
select plan(92);

-- Workspace 101 (Asia/Kathmandu): owner ...01, manager (admin) ...06, staff ...05. Workspace 102: owner ...04.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';
delete from public.job_runs where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'calendar.plan';
create function pg_temp.tz_events() returns bigint language sql as $$
  select count(*) from public.workspace_events
  where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101'
$$;
create function pg_temp.brand() returns text language sql as $$
  select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'
$$;
create function pg_temp.klaviyo_zone() returns text language sql as $$
  select account_timezone from public.workspace_connections
  where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'
$$;
create function pg_temp.plan(status text) returns void language sql as $$
  insert into public.job_runs (tenant_id, kind, idempotency_key, input, created_by, status)
  values ('00000000-0000-4000-8000-000000000101', 'calendar.plan', 'tz-plan', '{}', '00000000-0000-4000-8000-000000000001', status)
  on conflict (tenant_id, idempotency_key) do update set status = excluded.status
$$;
grant execute on function pg_temp.tz_events(), pg_temp.brand(), pg_temp.klaviyo_zone() to authenticated;

-- Privileges.
select is((select timezone_source from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'setup','existing workspaces start as "set at setup"');
select ok(not has_function_privilege('anon','public.set_brand_timezone(uuid,text,text)','execute'),'anon cannot change the timezone');
select ok(not has_function_privilege('service_role','public.set_brand_timezone(uuid,text,text)','execute'),'nor the service role');
select ok(has_function_privilege('authenticated','public.set_brand_timezone(uuid,text,text)','execute'),'members may call it (it checks the owner)');
select ok(not has_function_privilege('anon','public.use_klaviyo_timezone(uuid,text,text)','execute'),'anon cannot switch to Klaviyo''s');
select ok(not has_function_privilege('service_role','public.use_klaviyo_timezone(uuid,text,text)','execute'),'the service role cannot switch it');
select ok(has_function_privilege('authenticated','public.use_klaviyo_timezone(uuid,text,text)','execute'),'members may call the switch (it checks the owner)');
select hasnt_function('public','use_klaviyo_timezone',array['uuid'],'the one-argument switch is gone');
select hasnt_function('public','use_klaviyo_timezone',array['uuid','text'],'the two-argument switch is gone');
select hasnt_function('public','connect_sample_provider',array['uuid','text','text','text','text','integer'],'the six-argument connect is gone');
select ok(not has_function_privilege('authenticated','private.set_tenant_timezone(uuid,text,text)','execute'),'helpers stay private');
select ok(not has_function_privilege('authenticated','private.plan_in_flight(uuid)','execute'),'the plan check stays private');
select ok(not has_function_privilege('authenticated','private.known_timezone(text)','execute'),'the timezone check stays private');
select ok(not has_function_privilege('anon','public.connect_sample_provider(uuid,text,text,text,text,integer,text)','execute'),'anon cannot connect');
select ok(not has_function_privilege('service_role','public.connect_sample_provider(uuid,text,text,text,text,integer,text)','execute'),'nor the service role');
select ok(has_function_privilege('authenticated','public.connect_sample_provider(uuid,text,text,text,text,integer,text)','execute'),'members may call connect (it checks the owner)');
select ok(not has_column_privilege('authenticated','public.tenants','timezone','update'),'no one writes the timezone directly');
select ok(not has_column_privilege('authenticated','public.tenants','timezone_source','update'),'nor where it came from');
select ok(has_column_privilege('authenticated','public.tenants','name','update'),'the workspace name stays editable');

-- Timezone names.
select ok(private.known_timezone('Asia/Kathmandu') and private.known_timezone('UTC'),'region timezones are known');
select ok(private.known_timezone('Asia/Katmandu'),'old spellings Postgres knows are known too');
select ok(not private.known_timezone('Mars/Olympus') and not private.known_timezone('posix/Asia/Kathmandu') and not private.known_timezone(null),'unknown and posix copies are not');
select lives_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_timezone) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:tz-a', 'EST5EDT')$$,'every real timezone name fits (EST5EDT)');
select lives_ok($$update public.workspace_connections set account_timezone = 'GB-Eire' where fixture_account = 'fixture:tz-a'$$,'GB-Eire fits');
select lives_ok($$update public.workspace_connections set account_timezone = 'Etc/GMT+5' where fixture_account = 'fixture:tz-a'$$,'Etc/GMT+5 fits');
select lives_ok($$update public.workspace_connections set account_timezone = 'America/Argentina/Buenos_Aires' where fixture_account = 'fixture:tz-a'$$,'three-part names fit');
select throws_ok($$update public.workspace_connections set account_timezone = 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b' where fixture_account = 'fixture:tz-a'$$,'23514',null,'a Klaviyo key cannot be stored as a timezone');
select throws_ok($$update public.workspace_connections set account_timezone = 'shpss_ab12cd34ef56' where fixture_account = 'fixture:tz-a'$$,'23514',null,'nor a Shopify secret');
select throws_ok($$update public.workspace_connections set account_timezone = 'Europe/London Bridge' where fixture_account = 'fixture:tz-a'$$,'23514',null,'nor text with spaces');
delete from public.workspace_connections where fixture_account = 'fixture:tz-a';

-- Which plan jobs count as "GROS is making a plan".
select pg_temp.plan('queued');
select ok(private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'a queued plan is in flight');
select pg_temp.plan('leased');
select ok(private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'a leased plan is in flight');
select pg_temp.plan('running');
select ok(private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'a running plan is in flight');
select pg_temp.plan('retry_wait');
select ok(private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'a plan waiting to retry is in flight');
select pg_temp.plan('succeeded');
select ok(not private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'a finished plan is not');
select pg_temp.plan('failed');
select ok(not private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'nor a failed one');
select pg_temp.plan('cancelled');
select ok(not private.plan_in_flight('00000000-0000-4000-8000-000000000101'),'nor a cancelled one');
select ok(not private.plan_in_flight('00000000-0000-4000-8000-000000000102'),'and another workspace''s plan never counts');

-- Owner connects Klaviyo: the account's timezone becomes the brand timezone.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.tenants set timezone = 'UTC' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'the owner cannot write the timezone directly');
select throws_ok($$update public.tenants set timezone_source = 'owner' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'nor where it came from');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/New_York')$$,'the owner connects Klaviyo with an account timezone');
select is(pg_temp.brand(),row('America/New_York','klaviyo')::text,'Klaviyo''s timezone becomes the brand timezone');
select is(pg_temp.klaviyo_zone(),'America/New_York','and is kept on the connection');
reset role;
select is((select detail || jsonb_build_object('actor', actor_id) from public.workspace_events where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101' order by created_at desc, id desc limit 1),
  jsonb_build_object('from','Asia/Kathmandu','to','America/New_York','source','klaviyo','from_source','setup','actor','00000000-0000-4000-8000-000000000001'),'the change is logged: from, to, source, earlier source and who');
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Denver')$$,'reconnecting with another account timezone works');
select is(pg_temp.brand(),row('America/Denver','klaviyo')::text,'and moves the brand timezone while it follows Klaviyo');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'Mars/Olympus')$$,'an unknown Klaviyo timezone does not stop the connection');
select is(pg_temp.klaviyo_zone(),null,'it counts as "not reported"');
select is(pg_temp.brand(),row('America/Denver','klaviyo')::text,'and the brand timezone stays');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24)$$,'reconnect without a timezone');
select is(pg_temp.klaviyo_zone(),null,'nothing is reported');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Denver')$$,'reconnect with the brand''s own timezone');
select is(pg_temp.klaviyo_zone(),'America/Denver','it is kept on the connection');

-- While GROS is making a plan, the brand timezone stays.
reset role;
select pg_temp.plan('queued');
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Phoenix')$$,'connecting while a plan is being made works');
select is(pg_temp.klaviyo_zone(),'America/Phoenix','the account timezone is kept');
select is(pg_temp.brand(),row('America/Denver','klaviyo')::text,'but the brand timezone does not move during the plan');
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Denver')$$,'PT409','GROS is making a plan','no change while a plan is being made');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Phoenix','America/Denver')$$,'PT409','GROS is making a plan','nor a switch to a new Klaviyo timezone');
select is(public.set_brand_timezone('00000000-0000-4000-8000-000000000101','America/Denver','America/Denver'),false,'saving the same timezone during a plan changes nothing and is fine');
reset role;
select pg_temp.plan('failed');
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Phoenix')$$,'after the plan, reconnect');
select is(pg_temp.brand(),row('America/Phoenix','klaviyo')::text,'and the brand follows Klaviyo again');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,'UTC')$$,'23514',null,'only Klaviyo reports a timezone');

-- The owner chooses one in Settings; Klaviyo no longer overrides it.
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Asia/Kathmandu')$$,'PT409','The timezone changed in another window','a stale page cannot overwrite the timezone');
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','America/Phoenix','Asia/Kathmandu')$$,'PT409','The timezone changed in another window','a stale page is told, even when it picks the timezone the brand has now');
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Mars/Olympus','America/Phoenix')$$,'23514',null,'an unknown timezone is refused');
select is(public.set_brand_timezone('00000000-0000-4000-8000-000000000101','America/Phoenix','America/Phoenix'),false,'saving the timezone the brand already has says "no change"');
select is(pg_temp.brand(),row('America/Phoenix','klaviyo')::text,'and changes nothing');
select is(public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','America/Phoenix'),true,'the owner picks a timezone');
select is(pg_temp.brand(),row('Europe/London','owner')::text,'saved as chosen by the owner');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Chicago')$$,'reconnecting Klaviyo works');
select is(pg_temp.brand(),row('Europe/London','owner')::text,'but does not override the owner''s choice');

-- "Use Klaviyo's timezone" names both timezones the page showed.
reset role;
select pg_temp.plan('running');
set local role authenticated;
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago','Europe/London')$$,'PT409','GROS is making a plan','no switch to a new zone while a plan runs');
reset role;
select pg_temp.plan('succeeded');
set local role authenticated;
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Denver','Europe/London')$$,'PT409','Klaviyo reported another timezone','a stale Klaviyo timezone is refused');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago','Asia/Kathmandu')$$,'PT409','The timezone changed in another window','a stale brand timezone is refused too');
select lives_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago','Europe/London')$$,'"Use Klaviyo''s timezone" switches back once the plan is ready');
select is(pg_temp.brand(),row('America/Chicago','klaviyo')::text,'to the Klaviyo account''s timezone');

-- Klaviyo's zone that the brand already has: only the source changes, and
-- that is allowed during a plan (the plan's timezone does not move).
select is(public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','America/Chicago'),true,'the owner picks London again');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'Europe/London')$$,'Klaviyo now reports London too');
reset role;
select pg_temp.plan('queued');
set local role authenticated;
select lives_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Europe/London')$$,'following Klaviyo again works during a plan when the zone stays');
select is(pg_temp.brand(),row('Europe/London','klaviyo')::text,'only where it came from changes');
reset role;
-- (One transaction: every event has the same time, so look it up by content.)
select ok(exists(select 1 from public.workspace_events where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101'
  and detail = jsonb_build_object('from','Europe/London','to','Europe/London','source','klaviyo','from_source','owner')),'and that is logged, because it decides what a later reconnect may do');
select pg_temp.plan('succeeded');

-- Without a connected Klaviyo there is nothing to switch to.
update public.workspace_connections set status = 'disconnected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
set local role authenticated;
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Europe/London')$$,'PT409','Klaviyo has not reported a timezone','no Klaviyo, no switch');
reset role;
update public.workspace_connections set status = 'connected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
set local role authenticated;

-- Managers, staff and other workspaces cannot change it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','Europe/London')$$,'42501',null,'a manager cannot change the timezone');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Europe/London')$$,'42501',null,'nor switch it');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'UTC')$$,'42501',null,'nor move it by connecting');
select throws_ok($$update public.tenants set timezone = 'UTC' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'nor write it directly');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','Europe/London')$$,'42501',null,'staff cannot change the timezone');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Europe/London')$$,'42501',null,'nor switch it');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','Europe/London')$$,'42501',null,'another workspace cannot change it');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Europe/London')$$,'42501',null,'nor switch it');
select is((select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'),null,'and cannot even read it');

reset role;
select is(pg_temp.brand(),row('Europe/London','klaviyo')::text,'the refusals changed nothing');
-- Logged: New York, Denver, Phoenix, London (owner), Chicago (Klaviyo),
-- London (owner), London (owner → Klaviyo). The same-zone saves, the
-- reconnects that kept the zone and the refusals logged nothing.
select is(pg_temp.tz_events(),7::bigint,'every change is logged, and only changes');

select * from finish();
rollback;
