begin;
select plan(26);

-- Workspace 101: owner ...01, manager (admin) ...06, staff ...05.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';

select hasnt_function('public','connect_sample_provider',array['uuid','text','text','text','text','integer','text'],'the seven-argument connect is replaced');
select ok(not has_function_privilege('anon','public.connect_sample_provider(uuid,text,text,text,text,integer,text,text,text,text)','execute'),'anon cannot connect');
select ok(not has_function_privilege('service_role','public.connect_sample_provider(uuid,text,text,text,text,integer,text,text,text,text)','execute'),'nor the service role');
select throws_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_country) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:facts', 'pk_Ab3dEfg12hi34')$$,'23514',null,'no key fits in the country column');
select throws_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_website) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:facts', 'https://cedar.example/?key=pk_0123456789abcdef0123456789abcdef01')$$,'23514',null,'no key fits after the website''s host');
select throws_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_website) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:facts', 'https://cedar.example/shpat_abcd1234efgh5678')$$,'23514',null,'nor in a path');
select lives_ok($$insert into public.workspace_connections (tenant_id, provider, status, fixture_account, account_website) values ('00000000-0000-4000-8000-000000000102', 'klaviyo', 'connected', 'fixture:facts', 'https://shop.cedar-lane.example')$$,'a plain https origin fits');
delete from public.workspace_connections where fixture_account = 'fixture:facts';

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Northwind Outdoor (sample)','pk_Ab3dE' || repeat(U&'\2022',8) || '0000',null,24,'Europe/Berlin','https://northwind-outdoor.example','EUR','DE')$$,'Klaviyo is saved with what business it belongs to');
select is(
  (select row(account_website, account_currency, account_country)::text from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),
  row('https://northwind-outdoor.example','EUR','DE')::text,
  'the account facts are kept');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,null,null,'AUD','AU')$$,'Shopify is saved with its currency and country');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,null,'https://cedar.example','AUD','AU')$$,'23514',null,'only Klaviyo reports a website');
-- Facts in an unexpected shape count as "not reported"; the connection works.
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,'http://cedar.example','usd','pk_Ab3dEfg12hi34')$$,'odd facts do not stop the connection');
select is(
  (select row(account_website, account_currency, account_country)::text from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),
  row(null::text, null::text, null::text)::text,
  'a non-https website, a lower-case currency and a key-shaped country are not kept');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,'https://cedar.example/?key=pk_0123456789abcdef0123456789abcdef01','USD','US')$$,'a website with a key after the host does not stop the connection');
select is((select account_website from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'it counts as "not reported"');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,'https://' || repeat('a',300) || '.example','USD','US')$$,'nor does a website that is too long');
select is((select account_website from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'it is not kept');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,'https://cedar.example/','USD','US')$$,'reconnect with facts');
select is((select account_website from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),'https://cedar.example','the website is kept as its origin, without the trailing slash');
select is((select account_currency from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),'USD','they are kept');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24)$$,'older callers without the facts still connect');
select is((select account_currency from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'and a reconnect without facts clears the old ones');

select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,null,null,'aud','australia')$$,'odd Shopify facts do not stop the connection');
select is((select row(account_currency, account_country)::text from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'shopify'),row(null::text, null::text)::text,'they count as "not reported"');

-- Staff and managers cannot connect.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,null,'USD','US')$$,'42501',null,'staff cannot connect');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,null,'USD','US')$$,'42501',null,'nor can a manager');

select * from finish();
rollback;
