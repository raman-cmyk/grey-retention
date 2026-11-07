begin;
select plan(61);

-- Workspace 101 (Asia/Kathmandu): owner ...01, manager (admin) ...06, staff ...05. Workspace 102: owner ...04.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';
delete from public.job_runs where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'calendar.plan';
create function pg_temp.tz_events() returns bigint language sql as $$
  select count(*) from public.workspace_events
  where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101'
$$;

-- Privileges.
select is((select timezone_source from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'setup','existing workspaces start as "set at setup"');
select ok(not has_function_privilege('anon','public.set_brand_timezone(uuid,text,text)','execute'),'anon cannot change the timezone');
select ok(not has_function_privilege('service_role','public.set_brand_timezone(uuid,text,text)','execute'),'nor the service role');
select ok(has_function_privilege('authenticated','public.set_brand_timezone(uuid,text,text)','execute'),'members may call it (it checks the owner)');
select ok(not has_function_privilege('anon','public.use_klaviyo_timezone(uuid,text)','execute'),'anon cannot switch to Klaviyo''s');
select ok(not has_function_privilege('service_role','public.use_klaviyo_timezone(uuid,text)','execute'),'the service role cannot switch it');
select ok(has_function_privilege('authenticated','public.use_klaviyo_timezone(uuid,text)','execute'),'members may call the switch (it checks the owner)');
select hasnt_function('public','use_klaviyo_timezone',array['uuid'],'the one-argument switch is gone');
select ok(not has_function_privilege('authenticated','private.set_tenant_timezone(uuid,text,text)','execute'),'helpers stay private');
select ok(not has_function_privilege('authenticated','private.plan_in_flight(uuid)','execute'),'the plan check stays private');
select ok(not has_function_privilege('anon','public.connect_sample_provider(uuid,text,text,text,text,integer,text,text,text,text)','execute'),'anon cannot connect');
select ok(has_function_privilege('authenticated','public.connect_sample_provider(uuid,text,text,text,text,integer,text,text,text,text)','execute'),'members may call connect (it checks the owner)');
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

-- Owner connects Klaviyo: the account's timezone becomes the brand timezone.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.tenants set timezone = 'UTC' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'the owner cannot write the timezone directly');
select throws_ok($$update public.tenants set timezone_source = 'owner' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'nor where it came from');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/New_York')$$,'the owner connects Klaviyo with an account timezone');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('America/New_York','klaviyo')::text,'Klaviyo''s timezone becomes the brand timezone');
select is((select account_timezone from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),'America/New_York','and is kept on the connection');
reset role;
select is((select detail || jsonb_build_object('actor', actor_id) from public.workspace_events where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101' order by created_at desc, id desc limit 1),
  jsonb_build_object('from','Asia/Kathmandu','to','America/New_York','source','klaviyo','actor','00000000-0000-4000-8000-000000000001'),'the change is logged: from, to, source and who');
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Denver')$$,'reconnecting with another account timezone works');
select is((select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'America/Denver','and moves the brand timezone while it follows Klaviyo');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'Mars/Olympus')$$,'an unknown Klaviyo timezone does not stop the connection');
select is((select account_timezone from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'it counts as "not reported"');
select is((select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'America/Denver','and the brand timezone stays');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/New_York')$$,'reconnect with a timezone again');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24)$$,'reconnect without one');
select is((select account_timezone from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'forgets the old account timezone');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/New_York')$$,'reconnect with the same timezone as the brand');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,'UTC')$$,'23514',null,'only Klaviyo reports a timezone');

-- The owner chooses one in Settings; Klaviyo no longer overrides it.
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Asia/Kathmandu')$$,'PT409','The timezone changed in another window','a stale page cannot overwrite the timezone');
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Mars/Olympus','America/New_York')$$,'23514',null,'an unknown timezone is refused');
select lives_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','America/New_York','America/New_York')$$,'saving the timezone the brand already has works');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('America/New_York','klaviyo')::text,'but changes nothing');
select lives_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','America/New_York')$$,'the owner picks a timezone');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('Europe/London','owner')::text,'saved as chosen by the owner');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Chicago')$$,'reconnecting Klaviyo works');
select is((select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'Europe/London','but does not override the owner''s choice');

-- While GROS is making a plan, the timezone stays.
reset role;
insert into public.job_runs (tenant_id, kind, idempotency_key, input, created_by)
values ('00000000-0000-4000-8000-000000000101', 'calendar.plan', 'tz-plan-in-flight', '{}', '00000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','Europe/London')$$,'PT409','GROS is making a plan','no change while a plan is being made');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago')$$,'PT409','GROS is making a plan','nor a switch to Klaviyo''s');
reset role;
update public.job_runs set status = 'succeeded' where tenant_id = '00000000-0000-4000-8000-000000000101' and idempotency_key = 'tz-plan-in-flight';
set local role authenticated;

select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Denver')$$,'PT409','Klaviyo reported another timezone','the switch names the Klaviyo timezone the page showed');
select lives_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago')$$,'"Use Klaviyo''s timezone" switches back once the plan is ready');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('America/Chicago','klaviyo')::text,'to the Klaviyo account''s timezone');

-- Without a connected Klaviyo there is nothing to switch to.
reset role;
update public.workspace_connections set status = 'disconnected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
set local role authenticated;
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago')$$,'PT409','Klaviyo has not reported a timezone','no Klaviyo, no switch');

-- Managers, staff and other workspaces cannot change it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Chicago')$$,'42501',null,'a manager cannot change the timezone');
select throws_ok($$update public.tenants set timezone = 'UTC' where id = '00000000-0000-4000-8000-000000000101'$$,'42501',null,'nor write it directly');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Chicago')$$,'42501',null,'staff cannot change the timezone');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Chicago')$$,'42501',null,'another workspace cannot change it');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101','America/Chicago')$$,'42501',null,'nor switch it');

reset role;
-- Logged changes: New York, Denver, New York, London (owner), Chicago. The
-- same-zone save, the reconnects that kept the zone and the refusals logged
-- nothing.
select is(pg_temp.tz_events(),5::bigint,'only real timezone changes are logged');

select * from finish();
rollback;
