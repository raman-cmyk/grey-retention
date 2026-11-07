begin;
select plan(10);

-- Workspace 101: owner ...01, staff ...05.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Northwind Outdoor (sample)','pk_Ab3dE' || repeat(U&'\2022',8) || '0000',null,24,'Europe/Berlin','https://northwind-outdoor.example','EUR','DE')$$,'Klaviyo is saved with what business it belongs to');
select is(
  (select row(account_website, account_currency, account_country)::text from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),
  row('https://northwind-outdoor.example','EUR','DE')::text,
  'the account facts are kept');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,null,null,'AUD','AU')$$,'Shopify is saved with its currency and country');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar.myshopify.com','shpat_ab12' || repeat(U&'\2022',8) || 'ff00','cedar.myshopify.com',null,null,'https://cedar.example','AUD','AU')$$,'23514',null,'only Klaviyo reports a website');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,'http://cedar.example','USD','US')$$,'23514',null,'the website must be https');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,null,'usd','US')$$,'23514',null,'a currency is three capital letters');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,null,'USD','pk_Ab3dEfg12hi34')$$,'23514',null,'no key fits in the country');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24)$$,'older callers without the facts still connect');
select is((select account_currency from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),null,'and a reconnect without facts clears the old ones');

-- Staff cannot connect.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar','pk_Ab3dE' || repeat(U&'\2022',8) || '1a2b',null,24,null,null,'USD','US')$$,'42501',null,'staff cannot connect');

select * from finish();
rollback;
