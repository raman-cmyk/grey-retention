begin;
select plan(51);

-- Known starting point, whatever earlier scripts did.
delete from public.campaign_defaults
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');

-- Grants: members only read; every write goes through the command.
select ok(not has_table_privilege('anon','public.campaign_defaults','select'),'anon cannot read defaults');
select ok(not has_table_privilege('authenticated','public.campaign_defaults','insert,update,delete'),'members cannot write the table directly');
select ok(not has_table_privilege('service_role','public.campaign_defaults','select,insert,update,delete'),'service role has no table access');
select ok(not has_function_privilege('anon','public.save_campaign_defaults(uuid,integer,uuid,text,text,text[],text[],boolean,text)','execute'),'anon cannot save');
select ok(not has_function_privilege('authenticated','private.audience_ids_valid(text[])','execute'),'helper stays private');
select ok(not has_function_privilege('service_role','public.save_campaign_defaults(uuid,integer,uuid,text,text,text[],text[],boolean,text)','execute'),'service role cannot save');
select ok(not has_function_privilege('service_role','private.audience_ids_valid(text[])','execute')
  and not has_function_privilege('service_role','private.trim_text(text)','execute'),'helpers are closed to the service role');
select ok(has_table_privilege('authenticated','public.campaign_defaults','select'),'members can read (RLS decides which rows)');
select ok(has_function_privilege('authenticated','public.save_campaign_defaults(uuid,integer,uuid,text,text,text[],text[],boolean,text)','execute'),'members can call the command (it checks the owner)');

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
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array['list_a '],'{}',true)$$,'23514',null,'refused: an id with a trailing space');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[' list_a'],'{}',true)$$,'23514',null,'refused: an id with a leading space');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[E'\t'],'{}',true)$$,'23514',null,'refused: a tab as an id');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[U&'\00A0'],'{}',true)$$,'23514',null,'refused: a no-break space as an id');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[repeat('x',101)],'{}',true)$$,'23514',null,'refused: an id over 100 characters');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array[['a'],['b']],'{}',true)$$,'23514',null,'refused: a nested list');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',null::text[],'{}',true)$$,'23514',null,'refused: a missing list');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','',array['list_a'],array['list_a '],true)$$,'23514',null,'refused: the same audience in both lists, one padded');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','https://cedar-lane.example@evil.example','{}','{}',true)$$,'23514',null,'refused: a user@host link');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','https:///','{}','{}',true)$$,'23514',null,'refused: a link without a host');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','https://cedar-lane.example/a b','{}','{}',true)$$,'23514',null,'refused: a link with a space');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'',E'https://cedar-lane.example/\x01','{}','{}',true)$$,'23514',null,'refused: a link with a control character');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','https://cedar-lane.example/'||repeat('x',2000),'{}','{}',true)$$,'23514',null,'refused: a link over 2000 characters');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,E'Cedar Lane\r\nBcc: someone@example.test','','{}','{}',true)$$,'23514',null,'refused: a sender name with a line break');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',null,null,'','','{}','{}',true)$$,'PT409',null,'a missing revision is stale');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',99,null,'','','{}','{}',true)$$,'PT409',null,'a revision from the future is stale');
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',2,null,'','','{}','{}',null)$$,'23514',null,'the footer choice is required');

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
select is((select row(revision, featured_product_id)::text from public.campaign_defaults where tenant_id='00000000-0000-4000-8000-000000000101'),
  row(3, null::uuid)::text,'removing the product clears the featured product and keeps the row');

-- Outer whitespace of any kind is trimmed; who saved is recorded.
set local role authenticated;
select is(
  public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',3,null,E'\t Cedar Lane \u00a0',
    E' https://cedar-lane.example/new?utm=1 \n',array['LSTnews01'],array['SEGeng030'],true),
  4,'owner saves padded values');
select is(
  (select row(sender_name, primary_link, updated_by)::text from public.campaign_defaults),
  row('Cedar Lane','https://cedar-lane.example/new?utm=1','00000000-0000-4000-8000-000000000001'::uuid)::text,
  'stored trimmed, with the saver recorded');
reset role;

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
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000101',4,null,'','','{}','{}',true)$$,'42501',null,'other workspace cannot write here');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.save_campaign_defaults('00000000-0000-4000-8000-000000000102',0,null,'','','{}','{}',true)$$,'42501',null,'an owner cannot write into another workspace');
reset role;
select is((select count(*) from public.campaign_defaults where tenant_id='00000000-0000-4000-8000-000000000102'),0::bigint,'no row appeared for the other workspace');

select * from finish();
rollback;
