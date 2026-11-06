begin;
select plan(16);

-- Owner of workspace 101.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_YxS7Uab••••••••9de0',null,24),
  1,'owner connects sample Klaviyo; first revision');
select is(
  (select row(status,account_label,credential_hint,template_count,shop_domain is null,connected_at is not null)::text
     from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'),
  row('connected','Cedar Lane','pk_YxS7Uab••••••••9de0',24,true,true)::text,
  'display details saved; no credential column exists');
select is(
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='workspace_connections'
       and column_name ~ '(key|token|secret|password)'),
  0::bigint,'no column can hold a key or token');
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_Zz9••••••••1111',null,30),
  2,'swapping the key bumps the revision');
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','cedar-lane.myshopify.com','shpat_ab12••••••••ff00','cedar-lane.myshopify.com',null),
  1,'owner connects sample Shopify');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00','owner@example.com',null)$$,
  '23514',null,'an email address is not a shop domain');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00','shop.example.com',null)$$,
  '23514',null,'a custom domain is not a myshopify domain');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00',null,null)$$,
  '23514',null,'Shopify needs a shop domain');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpss_ab12••••••••ff00','cedar-lane.myshopify.com',null)$$,
  '23514',null,'an API secret hint is refused');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Cedar Lane','pk_full-unmasked-key-value-1234567890',null,1)$$,
  '23514',null,'an unmasked key cannot be stored');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','drive','x','pk_a••••••••1234',null,null)$$,
  '23514',null,'only Klaviyo and Shopify');

-- Staff in the same workspace may read but not connect.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_a••••••••1234',null,1)$$,
  '42501',null,'staff cannot connect accounts');
select is((select count(*) from public.workspace_connections),2::bigint,'staff sees own workspace connections');

-- Owner of the other workspace sees and changes nothing here.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.workspace_connections),0::bigint,'other workspace cannot read these connections');
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_a••••••••1234',null,1)$$,
  '42501',null,'other workspace owner cannot connect here');
reset role;

-- Signed-out callers cannot run the command at all.
set local role anon;
select throws_ok(
  $$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_a••••••••1234',null,1)$$,
  '42501',null,'anonymous callers are denied');
reset role;

select * from finish();
rollback;
