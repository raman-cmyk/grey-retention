begin;
select plan(25);

-- Known starting point, whatever earlier scripts did.
delete from public.campaign_defaults
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');

-- Grants: members only read; every write goes through the command.
select ok(not has_table_privilege('anon','public.campaign_defaults','select'),'anon cannot read defaults');
select ok(not has_table_privilege('authenticated','public.campaign_defaults','insert,update,delete'),'members cannot write the table directly');
select ok(not has_table_privilege('service_role','public.campaign_defaults','select,insert,update,delete'),'service role has no table access');
select ok(not has_function_privilege('anon','public.save_campaign_defaults(uuid,integer,uuid,text,text,text[],text[],boolean,text)','execute'),'anon cannot save');
select ok(not has_function_privilege('authenticated','private.audience_ids_valid(text[])','execute'),'helper stays private');

-- Owner of workspace 101.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(
  $$insert into public.campaign_defaults(tenant_id) values ('00000000-0000-4000-8000-000000000101')$$,
  '42501',null,'owner cannot write the table directly');
select is(
  public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',0,
    '00000000-0000-4000-8000-000000000301','  Cedar Lane  ','https://cedar-lane.example/new',
    array['list_engaged'],array['seg_unsubscribed'],false),
  1,'owner saves defaults; first revision');
select is(
  (select row(featured_product_id, sender_name, primary_link, send_to, dont_send_to, include_footer, footer_source)::text
     from public.campaign_defaults),
  row('00000000-0000-4000-8000-000000000301'::uuid,'Cedar Lane','https://cedar-lane.example/new',
      '{list_engaged}'::text[],'{seg_unsubscribed}'::text[],false,'auto')::text,
  'every tab is saved at once (sender name trimmed)');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',0,null,'','','{}','{}',true)$$,
  'PT409',null,'a stale page is refused, not overwritten');
select is(
  public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',1,null,'','','{}','{}',true),
  2,'clearing every default is allowed');
select is(
  (select row(featured_product_id, sender_name, primary_link, send_to, include_footer)::text from public.campaign_defaults),
  row(null::uuid,'','','{}'::text[],true)::text,'blank values mean "use the Klaviyo default / let the AI choose"');

-- Validation.
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,'00000000-0000-4000-8000-000000000302','','','{}','{}',true)$$,
  '23514','Choose a product from your catalogue','another workspace''s product is refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','http://cedar-lane.example','{}','{}',true)$$,
  '23514','Primary link must start with https://','plain http link refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,repeat('x',101),'','{}','{}',true)$$,
  '23514',null,'sender name over 100 characters refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array['a','a'],'{}',true)$$,
  '23514',null,'duplicate audience refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array['a'],array['a'],true)$$,
  '23514','An audience cannot be in both Send to and Don''t send to','same audience in both lists refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[null]::text[],'{}',true)$$,
  '23514',null,'a NULL audience id refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',(select array_agg('id'||g) from generate_series(1,21) g),'{}',true)$$,
  '23514',null,'more than 20 audiences refused');
select throws_ok(
  $$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','','{}','{}',true,'template:123')$$,
  '23514',null,'only the automatic footer can be chosen for now');

-- A removed product clears the default.
reset role;
insert into public.products(id, tenant_id, title, url, stock_observed_at, source, synthetic)
  values ('00000000-0000-4000-8000-000000000399','00000000-0000-4000-8000-000000000101',
          'Test canvas cap','https://cedar-lane.example/products/cap',now(),'fixture',true);
set local role authenticated;
select is(
  public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,'00000000-0000-4000-8000-000000000399','','','{}','{}',true),
  3,'owner features a product');
reset role;
delete from public.products where id = '00000000-0000-4000-8000-000000000399';
select is((select featured_product_id from public.campaign_defaults where tenant_id='00000000-0000-4000-8000-000000000101'),
  null::uuid,'removing the product clears the featured product');

-- Staff and the team admin read but cannot change defaults.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.campaign_defaults),1::bigint,'staff can read the defaults');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',4,null,'','','{}','{}',true)$$,'42501',null,'staff cannot change defaults');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',4,null,'','','{}','{}',true)$$,'42501',null,'team admin cannot change defaults');

-- Another workspace sees nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.campaign_defaults),0::bigint,'other workspace cannot read');
reset role;

select * from finish();
rollback;
