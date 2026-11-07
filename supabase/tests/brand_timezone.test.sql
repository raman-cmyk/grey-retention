begin;
select plan(27);

-- Workspace 101 (Asia/Kathmandu): owner ...01, staff ...05. Workspace 102: owner ...04.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';

select is((select timezone_source from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'setup','existing workspaces start as "set at setup"');
select ok(not has_function_privilege('anon','public.set_brand_timezone(uuid,text,text)','execute'),'anon cannot change the timezone');
select ok(not has_function_privilege('service_role','public.use_klaviyo_timezone(uuid)','execute'),'the service role cannot switch it');
select ok(not has_function_privilege('authenticated','private.set_tenant_timezone(uuid,text,text)','execute'),'helpers stay private');
select ok(not has_function_privilege('anon','public.connect_sample_provider(uuid,text,text,text,text,integer,text)','execute'),'anon cannot connect');
select ok(has_function_privilege('authenticated','public.connect_sample_provider(uuid,text,text,text,text,integer,text)','execute'),'members may call connect (it checks the owner)');
select ok(private.known_timezone('Asia/Kathmandu') and private.known_timezone('UTC'),'region timezones are known');
select ok(not private.known_timezone('Mars/Olympus') and not private.known_timezone('posix/Asia/Kathmandu') and not private.known_timezone(null),'unknown and posix copies are not');
select throws_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_timezone) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:test', 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b')$$,'23514',null,'a key-shaped value cannot be stored as a timezone');

-- Owner connects Klaviyo: the account's timezone becomes the brand timezone.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/New_York')$$,'the owner connects Klaviyo with an account timezone');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('America/New_York','klaviyo')::text,'Klaviyo''s timezone becomes the brand timezone');
select is((select account_timezone from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),'America/New_York','and is kept on the connection');
select is((select detail->>'to' from public.workspace_events where kind = 'brand_timezone_set' and tenant_id = '00000000-0000-4000-8000-000000000101' order by created_at desc limit 1),'America/New_York','the change is logged');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'Mars/Olympus')$$,'23514',null,'an unknown Klaviyo timezone is refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,'UTC')$$,'23514',null,'only Klaviyo reports a timezone');

-- The owner chooses one in Settings; Klaviyo no longer overrides it.
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','Asia/Kathmandu')$$,'PT409','The timezone changed in another window','a stale page cannot overwrite the timezone');
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Mars/Olympus','America/New_York')$$,'23514',null,'an unknown timezone is refused');
select lives_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','Europe/London','America/New_York')$$,'the owner picks a timezone');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('Europe/London','owner')::text,'saved as chosen by the owner');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,'America/Chicago')$$,'reconnecting Klaviyo works');
select is((select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'),'Europe/London','but does not override the owner''s choice');
select lives_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101')$$,'"Use Klaviyo''s timezone" switches back');
select is((select row(timezone, timezone_source)::text from public.tenants where id = '00000000-0000-4000-8000-000000000101'),row('America/Chicago','klaviyo')::text,'to the Klaviyo account''s timezone');

-- Without a connected Klaviyo there is nothing to switch to.
reset role;
update public.workspace_connections set status = 'disconnected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
set local role authenticated;
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101')$$,'PT409','Klaviyo has not reported a timezone','no Klaviyo, no switch');

-- Staff and other workspaces cannot change it.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Chicago')$$,'42501',null,'staff cannot change the timezone');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.set_brand_timezone('00000000-0000-4000-8000-000000000101','UTC','America/Chicago')$$,'42501',null,'another workspace cannot change it');
select throws_ok($$select public.use_klaviyo_timezone('00000000-0000-4000-8000-000000000101')$$,'42501',null,'nor switch it');

select * from finish();
rollback;
