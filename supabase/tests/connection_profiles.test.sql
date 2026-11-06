begin;
select plan(36);

-- Start from a known state for workspace 101 so revisions are exact even
-- after browser journeys have used the local database.
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101';

select columns_are('public', 'workspace_connections', array[
  'tenant_id','provider','mode','status','fixture_account','folder_id','read_only','revision',
  'last_sync_at','last_error','updated_at','account_label','credential_hint','shop_domain',
  'template_count','connected_at'
], 'no column can hold a key or token beyond the checked display fields');

-- Owner of workspace 101.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Juniper Supply','pk_Ab3dE••••••••1a2b',null,24),
  1,'owner connects sample Klaviyo; first revision');
select is(
  (select row(status,account_label,credential_hint,template_count,shop_domain is null,connected_at is not null,last_sync_at is null)::text
     from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'),
  row('connected','Juniper Supply','pk_Ab3dE••••••••1a2b',24,true,true,true)::text,
  'display details saved; connecting does not claim a sync');
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Juniper Supply','pk_Zz9yX••••••••1111',null,30),
  2,'swapping the key bumps the revision');
select is(
  (select row(credential_hint, template_count)::text from public.workspace_connections
     where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'),
  row('pk_Zz9yX••••••••1111',30)::text,'swap replaces the hint and count');
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','juniper.myshopify.com','shpat_ab12••••••••ff00','juniper.myshopify.com',null),
  1,'owner connects sample Shopify');

-- Reconnecting after a failure clears the error.
select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','shopify','error');
select ok((select last_error is not null or status = 'error' from public.workspace_connections
  where tenant_id='00000000-0000-4000-8000-000000000101' and provider='shopify'),'connection marked failing');
select is(
  public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','juniper.myshopify.com','shpca_cd34••••••••ee11','juniper.myshopify.com',null),
  3,'reconnect after a failure bumps the revision');
select is(
  (select row(status, last_error is null, credential_hint)::text from public.workspace_connections
     where tenant_id='00000000-0000-4000-8000-000000000101' and provider='shopify'),
  row('connected',true,'shpca_cd34••••••••ee11')::text,'reconnect clears the failure');

-- Domain and label checks.
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00','owner@example.com',null)$$,'23514',null,'an email address is not a shop domain');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00','shop.example.com',null)$$,'23514',null,'a custom domain is not a myshopify domain');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00',null,null)$$,'23514',null,'Shopify needs a shop domain');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b','juniper.myshopify.com',1)$$,'23514',null,'Klaviyo takes no shop domain');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpat_ab12••••••••ff00','juniper.myshopify.com',5)$$,'23514',null,'Shopify takes no template count');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo',null,'pk_Ab3dE••••••••1a2b',null,1)$$,'23514',null,'a label is required');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','   ','pk_Ab3dE••••••••1a2b',null,1)$$,'23514',null,'a blank label is refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','pk_0123456789abcdef0123456789abcdef01','pk_Ab3dE••••••••1a2b',null,1)$$,'23514',null,'a key pasted as the label is refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','drive','x','pk_Ab3dE••••••••1a2b',null,null)$$,'23514',null,'only Klaviyo and Shopify');

-- Hint checks: only the exact masked shape fits.
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','shpat_ab12••••••••ff00',null,1)$$,'23514',null,'Klaviyo needs a pk_ hint');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','shopify','Shop','shpss_ab12••••••••ff00','juniper.myshopify.com',null)$$,'23514',null,'an API secret hint is refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_full-unmasked-key-value-1234567890',null,1)$$,'23514',null,'an unmasked key cannot be stored');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE•••••••1a2b',null,1)$$,'23514',null,'seven bullets refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE•••••••••1a2b',null,1)$$,'23514',null,'nine bullets refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE********1a2b',null,1)$$,'23514',null,'other mask characters refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dEfghij••••••••1a2b',null,1)$$,'23514',null,'too many visible characters refused');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x',E'pk_Ab3dE••••••••1a2b\n',null,1)$$,'23514',null,'trailing newline refused');

-- Clients can never write the table directly, even the owner.
select throws_ok($$insert into public.workspace_connections(tenant_id,provider,status,fixture_account) values('00000000-0000-4000-8000-000000000101','drive','connected','x')$$,'42501',null,'owner cannot insert directly');
select throws_ok($$update public.workspace_connections set account_label='x' where tenant_id='00000000-0000-4000-8000-000000000101'$$,'42501',null,'owner cannot update directly');
select throws_ok($$delete from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101'$$,'42501',null,'owner cannot delete directly');

-- Staff and workspace admins may read but not connect.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b',null,1)$$,'42501',null,'staff cannot connect accounts');
select is((select count(*) from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101'),2::bigint,'staff sees own workspace connections');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b',null,1)$$,'42501',null,'workspace admin cannot connect accounts');

-- The other workspace's owner sees and changes nothing here.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'other workspace cannot read these connections');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b',null,1)$$,'42501',null,'other workspace owner cannot connect here');
reset role;

-- Signed-out callers and the service role cannot run the command.
set local role anon;
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b',null,1)$$,'42501',null,'anonymous callers are denied');
reset role;
set local role service_role;
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','x','pk_Ab3dE••••••••1a2b',null,1)$$,'42501',null,'the service role cannot connect accounts');
reset role;

select * from finish();
rollback;
