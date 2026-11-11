begin;
select plan(164);

-- ONB-102: catalog reads, the cleaned catalog, its status and findings, and
-- the guard on the old sample command. Owner ...01 and staff ...05 are in
-- workspace 101 (a synthetic brand); owner ...04 runs workspace 102.
create function pg_temp.p(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('externalId','7001','title','Field Overshirt','url','https://cedar-lane.example/products/field-overshirt',
    'priceMinor',6900,'currency','USD','imageUrl','https://cedar-lane.example/cdn/a.jpg','compareAtMinor',8900,'compareAtIsSale',true,
    'featurable',true,'hiddenReason',null,'units30d',3,'units90d',5,'bestsellerRank',1,'launchedAt',null,'newArrival',false,
    'stock',null,'variantCount',3) || extra
$$;
create function pg_temp.f(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','price_band','statement','Most products cost between $18.50 and $120.00.',
    'value',jsonb_build_object('min',18.5,'max',120,'currency','USD'),'evidence',jsonb_build_object('ref','klaviyo:events'),
    'confidence',0.75,'pass','sample','model',null) || extra
$$;
create function pg_temp.s(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('state','ready','source','events','currency','USD','currencyCheck','matched','complete',true) || extra
$$;
create function pg_temp.lease(j text) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute'
    where id=j::uuid
$$;
create function pg_temp.record(products jsonb, findings jsonb default '[]', summary jsonb default pg_temp.s(),
    job text default current_setting('test.job'), live boolean default false) returns jsonb language sql as $$
  select public.record_catalog_reading(job::uuid,'00000000-0000-4000-8000-00000000aaaa',products,findings,summary,live)
$$;
create function pg_temp.job(tenant text, key text, mode text default 'fixture', age interval default '0') returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_catalog',key,jsonb_build_object('mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id::text
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;

-- Grants.
select ok(has_function_privilege('authenticated','public.start_catalog_reading(uuid)','execute')
  and not has_function_privilege('anon','public.start_catalog_reading(uuid)','execute'),'signed-in people may start a read, anonymous visitors not');
select ok(not bool_or(has_function_privilege(r,f,'execute')) and bool_and(has_function_privilege('service_role',f,'execute')),
  'only the worker records, pauses, claims and counts reads: '||f)
  from unnest(array['anon','authenticated']) r,
    unnest(array['public.record_catalog_reading(uuid,uuid,jsonb,jsonb,jsonb,boolean)','public.pause_source_reading(uuid,uuid,text,integer)',
      'public.claim_source_reading()','public.source_readings_waiting()']) f
  group by f;
select ok(not bool_or(has_table_privilege(r,'public.catalog_status',p)),'browser roles cannot write the catalog status')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.catalog_status','select'),'anonymous visitors cannot read it');

-- KLV-001's guard: the old sample command never changes a live Klaviyo
-- connection, except to disconnect it.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo','connected')$$,
  'a sample Klaviyo connection is set with the sample command');
reset role;
update public.workspace_connections set mode='live' where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok(format($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo',%L)$$, st),'PT409',null,
  'a live Klaviyo connection cannot be set '||st||' by the sample command')
  from unnest(array['connected','expired','error']) st;
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','shopify','connected')$$,
  'other sample connections are unchanged');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo','disconnected')$$,
  'disconnecting a live Klaviyo still works');
reset role;
select is((select mode||'/'||status from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo'),
  'fixture/disconnected','and makes it a sample connection again');

-- The owner starts a catalog read: Klaviyo connected first; a sample
-- connection only for a synthetic brand; once a day.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000101')$$,'23514',null,'Klaviyo must be connected first');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','connected')$$,'the owner connects sample Klaviyo');
select set_config('test.job',public.start_catalog_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_catalog_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),'asking again the same day is the same read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'nor another workspace''s owner');
reset role;
select is((select kind||' '||status||' '||(input->>'mode') from public.job_runs where id=current_setting('test.job')::uuid),
  'brand.read_catalog queued fixture','the job keeps the kind of connection it reads');
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo','connected')$$,'a real brand connects sample Klaviyo');
select throws_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000102')$$,'23514','Connect live Klaviyo first',
  'but never reads the sample catalog');
reset role;
update public.workspace_connections set mode='live' where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select set_config('test.live',public.start_catalog_reading('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select is((select input->>'mode' from public.job_runs where id=current_setting('test.live')::uuid),'live','a live connection is read live');

-- The sweep and an owner's "Run jobs" never take a catalog read; the
-- readers' run does, as the worker.
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101') c where c.kind='brand.read_catalog'),0,
  'the workspace jobs never take a catalog read');
select ok(public.source_readings_waiting() >= 2,'the readers'' run sees the waiting reads');
select set_config('request.jwt.claims','{}',true);
select is(public.source_readings_waiting(),null,'and only the worker sees them');
select throws_ok($$select public.claim_source_reading()$$,'42501',null,'and only the worker claims them');
select pg_temp.as_worker();
select set_config('test.claimed',(select id::text from public.claim_source_reading()),true);
select ok(current_setting('test.claimed') in (current_setting('test.job'),current_setting('test.live')),'the oldest read is leased to the worker');
select is((select status||' '||attempt from public.job_runs where id=current_setting('test.claimed')::uuid),'running 1','for its first try');
reset role;
update public.job_runs set status='queued', attempt=0, lease_token=null, lease_until=null where id=current_setting('test.claimed')::uuid;

-- Recording a read: the shapes are checked before anything is written.
select pg_temp.lease(current_setting('test.job'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s(), current_setting('test.job'), true)$$,'23514',null,
  'a sample read cannot say it is live');
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.p(%L)))', x),'23514',null,'refused product: '||x)
  from unnest(array[
    '{"url":"http://cedar-lane.example/p"}', '{"url":"https://user:pw@cedar-lane.example/p"}', '{"title":"x"}', '{"priceMinor":-1}',
    '{"priceMinor":69.5}', '{"currency":"EUR"}', '{"imageUrl":"http://x.example/a.jpg"}', '{"featurable":true,"hiddenReason":"no_image"}',
    '{"featurable":false}', '{"imageUrl":null}', '{"units30d":9}', '{"bestsellerRank":0}', '{"externalId":"a b"}',
    '{"launchedAt":"yesterday"}', '{"variantCount":0}', '{"note":"x"}', '{"hiddenReason":"retired","featurable":false}']) x;
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p(), pg_temp.p()))$$,'23514',null,'a product once per read');
select throws_ok($$select pg_temp.record((select jsonb_agg(pg_temp.p(jsonb_build_object('externalId','p'||i))) from generate_series(1,501) i))$$,
  '23514',null,'at most 500 products');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s('{"currencyCheck":"mismatch"}'))$$,'23514',null,
  'nothing featurable when the orders are in another currency');
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.p()), ''[]'', pg_temp.s(%L))', x),'23514',null,'refused summary: '||x)
  from unnest(array['{"state":"paused"}','{"source":"site"}','{"currency":"usd"}','{"complete":"yes"}','{"reason":"No products!"}','{"note":"x"}']) x;
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s('{"state":"empty"}'))$$,'23514',null,
  'an empty read has no products');
select throws_ok($$select pg_temp.record('[]')$$,'23514',null,'and a ready one has some');
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f(%L)))', x),'23514',null,'refused finding: '||x)
  from unnest(array['{"topic":"returns","value":{"days":30}}', '{"evidence":{"url":"https://cedar-lane.example/","quote":"x"}}',
    '{"evidence":{"ref":"site:home"}}', '{"pass":"code"}', '{"pass":"model"}', '{"value":{"min":120,"max":18.5,"currency":"USD"}}',
    '{"statement":"x"}', '{"note":"x"}']) x;
select throws_ok($$select public.record_catalog_reading(current_setting('test.job')::uuid,gen_random_uuid(),jsonb_build_array(pg_temp.p()),'[]',pg_temp.s(),false)$$,
  'PT409',null,'only with the job''s lease');

-- A whole read is stored at once and finishes the job.
select is(pg_temp.record(
  jsonb_build_array(pg_temp.p(),
    pg_temp.p('{"externalId":"7004","title":"Merino Beanie","url":"https://cedar-lane.example/products/merino-beanie","imageUrl":null,"compareAtMinor":null,"compareAtIsSale":false,"featurable":false,"hiddenReason":"no_image","units30d":0,"units90d":0,"bestsellerRank":null,"newArrival":true,"launchedAt":"2026-11-01T10:00:00Z"}'),
    pg_temp.p('{"externalId":"7002","title":"Weekend Knit","priceMinor":12000,"compareAtMinor":24000,"compareAtIsSale":false,"bestsellerRank":2,"units30d":0,"units90d":2,"stock":4}')),
  jsonb_build_array(pg_temp.f(), pg_temp.f('{"topic":"offering","statement":"Sells products such as Field Overshirt.","value":{},"confidence":0.6}'))),
  '{"newer": false, "products": 3, "findings": 2, "featurable": 2}'::jsonb,'a read is stored at once');
reset role;
select is((select status||' '||(checkpoint->>'products')||' '||(checkpoint->>'source') from public.job_runs where id=current_setting('test.job')::uuid),
  'succeeded 3 events','and its job is finished');
select results_eq($$select external_id, source, synthetic, featurable, coalesce(hidden_reason,'-'), stock_known, stock, price_minor, compare_at_is_sale
    from public.products where tenant_id='00000000-0000-4000-8000-000000000101' and source='klaviyo' order by external_id$$,
  $$values ('7001','klaviyo',true,true,'-',false,0,6900,true), ('7002','klaviyo',true,true,'-',true,4,12000,false),
    ('7004','klaviyo',true,false,'no_image',false,0,6900,false)$$,
  'the products are stored with the other products, as sample ones');
select is((select title from public.products where id='00000000-0000-4000-8000-000000000301'),'Field overshirt (synthetic)',
  'the workspace''s own products are left as they are');
select results_eq($$select state, source, products, featurable, currency, currency_check, complete, live from public.catalog_status
    where tenant_id='00000000-0000-4000-8000-000000000101'$$,
  $$values ('ready','events',3,2,'USD','matched',true,false)$$,'and the catalog''s status says what was found');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101' and source='catalog'
  and superseded_at is null),2,'with its findings');

-- Constraints hold on direct writes too.
select throws_ok($$update public.products set compare_at_is_sale=true, compare_at_minor=null where external_id='7002'$$,'23514',null,
  'a sale has a compare-at price above the price');
select throws_ok($$update public.products set external_id=null where external_id='7002'$$,'23514',null,'a Klaviyo product keeps its Klaviyo id');
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.job')::uuid,'catalog','returns','Returns.','{"ref":"klaviyo:catalog"}',0.5,'code')$$,
  '23514',null,'a catalog states only what a catalog can');

-- Members read the catalog; another workspace reads none of it.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.products where tenant_id='00000000-0000-4000-8000-000000000101' and source='klaviyo'),3,
  'staff read the catalog');
select is((select state from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'),'ready','and its status');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.products where tenant_id='00000000-0000-4000-8000-000000000101'),0,'another workspace reads no product');
select is((select count(*)::integer from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'),0,'nor the status');
reset role;

-- A newer read updates what it sees again and, when whole, retires what
-- it no longer sees; it replaces the catalog findings.
select set_config('test.second',pg_temp.job('00000000-0000-4000-8000-000000000101','second'),true);
select pg_temp.lease(current_setting('test.second'));
set local role service_role;
select pg_temp.as_worker();
select is((pg_temp.record(jsonb_build_array(pg_temp.p('{"priceMinor":5900,"compareAtMinor":8900}'), pg_temp.p('{"externalId":"7005","title":"Trail Socks","priceMinor":1850,"compareAtMinor":null,"compareAtIsSale":false,"bestsellerRank":null,"units30d":0,"units90d":0}')),
  jsonb_build_array(pg_temp.f()), pg_temp.s(), current_setting('test.second'))->>'products')::integer,2,'a second read is stored');
reset role;
select results_eq($$select external_id, featurable, coalesce(hidden_reason,'-'), retired_at is not null, price_minor
    from public.products where tenant_id='00000000-0000-4000-8000-000000000101' and source='klaviyo' order by external_id$$,
  $$values ('7001',true,'-',false,5900), ('7002',false,'retired',true,12000), ('7004',false,'retired',true,6900), ('7005',true,'-',false,1850)$$,
  'a product seen again is updated, one no longer seen is retired, a new one is added');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101' and source='catalog'
  and superseded_at is null and run_id=current_setting('test.second')::uuid),1,'only the newer read''s findings are current');

-- A read cut short retires nothing; a product seen again comes back.
select set_config('test.third',pg_temp.job('00000000-0000-4000-8000-000000000101','third'),true);
select pg_temp.lease(current_setting('test.third'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p('{"externalId":"7002","title":"Weekend Knit"}')), '[]',
  pg_temp.s('{"complete":false}'), current_setting('test.third'))$$,'an incomplete read is stored');
reset role;
select results_eq($$select external_id, retired_at is not null from public.products
    where tenant_id='00000000-0000-4000-8000-000000000101' and source='klaviyo' order by external_id$$,
  $$values ('7001',false), ('7002',false), ('7004',true), ('7005',false)$$,'and retires nothing, while a product seen again is back');
select is((select complete from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'),false,'the status says it was not whole');

-- An older read finishing late changes nothing; its findings are kept,
-- already replaced.
select set_config('test.old',pg_temp.job('00000000-0000-4000-8000-000000000101','old','fixture','1 hour'),true);
select pg_temp.lease(current_setting('test.old'));
set local role service_role;
select pg_temp.as_worker();
select is((pg_temp.record(jsonb_build_array(pg_temp.p('{"priceMinor":100}')), jsonb_build_array(pg_temp.f()), pg_temp.s(),
  current_setting('test.old'))->>'newer')::boolean,true,'an older read finishing late is told a newer one is there');
reset role;
select is((select price_minor from public.products where tenant_id='00000000-0000-4000-8000-000000000101' and external_id='7001'),5900,
  'and changes no product');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.old')::uuid and superseded_at is not null),1,
  'its findings are kept already replaced');
select is((select status from public.job_runs where id=current_setting('test.old')::uuid),'succeeded','and its job is finished');

-- An empty store: "no products" (D16), and a whole empty read retires the rest.
select set_config('test.empty',pg_temp.job('00000000-0000-4000-8000-000000000101','empty'),true);
select pg_temp.lease(current_setting('test.empty'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record('[]', '[]', '{"state":"empty","currency":"USD","currencyCheck":"unverified","complete":true,"reason":"no_products"}',
  current_setting('test.empty'))$$,'an empty read is stored');
reset role;
select results_eq($$select state, products, featurable, reason from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'$$,
  $$values ('empty',0,0,'no_products')$$,'the brand is marked as having no products');
select is((select count(*)::integer from public.products where tenant_id='00000000-0000-4000-8000-000000000101' and source='klaviyo'
  and featurable),0,'and nothing from Klaviyo can be featured');

-- Klaviyo pauses a read: a rate limit puts it back without using a try.
select set_config('test.paced',pg_temp.job('00000000-0000-4000-8000-000000000101','paced'),true);
update public.job_runs set attempt=1 where id=current_setting('test.paced')::uuid;
select pg_temp.lease(current_setting('test.paced'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select public.pause_source_reading(current_setting('test.paced')::uuid,'00000000-0000-4000-8000-00000000aaaa','tired')$$,
  '23514',null,'only a known reason pauses a read');
select lives_ok($$select public.pause_source_reading(current_setting('test.paced')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited',5)$$,
  'a rate limit pauses the read');
reset role;
select results_eq($$select status, attempt, error_code, lease_token is null, available_at between now()+interval '59 seconds' and now()+interval '61 seconds'
    from public.job_runs where id=current_setting('test.paced')::uuid$$,
  $$values ('retry_wait',0,'rate_limited',true,true)$$,'it comes back after at least a minute, with its try given back');
update public.job_runs set attempt=1 where id=current_setting('test.paced')::uuid;
select pg_temp.lease(current_setting('test.paced'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.paced')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited',999999)$$,
  'a long rate limit pauses it too');
reset role;
select ok((select available_at between now()+interval '23 hours 59 minutes' and now()+interval '1 day 1 minute' from public.job_runs
  where id=current_setting('test.paced')::uuid),'for at most a day');
select is((select state from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'),'empty','a rate limit leaves the status');

-- A rejected key on a live connection: the read stops, the key is no
-- longer read, the owners are told.
insert into public.klaviyo_credentials(tenant_id,secret_id,key_hint,klaviyo_account_id,api_revision)
  values ('00000000-0000-4000-8000-000000000102',vault.create_secret('pk_LIVEA0123456789abcdefghij0000','onb102-test'),
    'pk_LIVEA••••••••0000','CdrG01','2026-10-15');
select pg_temp.lease(current_setting('test.live'));
set local role service_role;
select pg_temp.as_worker();
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000102'),'pk_LIVEA0123456789abcdefghij0000','the live key is read before');
select lives_ok($$select public.pause_source_reading(current_setting('test.live')::uuid,'00000000-0000-4000-8000-00000000aaaa','klaviyo_key_rejected')$$,
  'a refused key stops the read');
reset role;
select results_eq($$select status, failure_class, error_code from public.job_runs where id=current_setting('test.live')::uuid$$,
  $$values ('failed','auth','klaviyo_key_rejected')$$,'the job ends, as a key problem');
select results_eq($$select w.status, w.last_error, c.status from public.workspace_connections w join public.klaviyo_credentials c using (tenant_id)
    where w.tenant_id='00000000-0000-4000-8000-000000000102' and w.provider='klaviyo'$$,
  $$values ('expired','klaviyo_key_rejected','revoked')$$,'the live connection needs the owner and the key is marked revoked');
select results_eq($$select state, reason, live from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000102'$$,
  $$values ('paused','klaviyo_key_rejected',true)$$,'the catalog status says it is paused, and why');
select ok(exists(select 1 from public.notifications where tenant_id='00000000-0000-4000-8000-000000000102' and kind='connection_health'
  and message like 'Klaviyo no longer accepts the API key%'),'the owner is told in plain words');
set local role service_role;
select pg_temp.as_worker();
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000102'),null,'and the key is no longer read');
reset role;

-- Review cases. The browser roles only read products.
select ok(not bool_or(has_table_privilege(r,'public.products',p)),'browser roles cannot write products')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon','public.products','select'),'anonymous visitors cannot read products');
select ok(current_setting('server_version_num')::integer < 170000
  or (not has_table_privilege('authenticated','public.catalog_status','maintain')
    and not has_table_privilege('authenticated','public.products','maintain')),'nor maintain products or the status');

-- An owner (who can read the lease token) never fails or records a read.
select set_config('test.mine',pg_temp.job('00000000-0000-4000-8000-000000000101','mine'),true);
select pg_temp.lease(current_setting('test.mine'));
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.fail_job(current_setting('test.mine')::uuid,'00000000-0000-4000-8000-00000000aaaa','auth')$$,
  '42501',null,'an owner cannot fail a running catalog read');
reset role;

-- Every product key is required; values within the table's limits.
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.p() - %L), ''[]'', pg_temp.s(), current_setting(''test.mine''))', k),
  '23514',null,'a product without '||k||' is refused')
  from unnest(array['imageUrl','hiddenReason','stock','launchedAt','compareAtMinor','bestsellerRank','units30d']) k;
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.p(%L)), ''[]'', pg_temp.s(), current_setting(''test.mine''))', x),
  '23514',null,'refused: '||x)
  from unnest(array['{"bestsellerRank":501}','{"variantCount":501}','{"compareAtMinor":0,"compareAtIsSale":false}',
    '{"imageUrl":"https://cedar-lane.example?x"}','{"launchedAt":"2026-02-30T10:00:00Z"}','{"url":"https://cedar-lane.example/a b"}']) x;
-- Findings: in the store's currency, and none for a store without products.
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f('{"value":{"min":1,"max":2,"currency":"EUR"}}')),
  pg_temp.s(), current_setting('test.mine'))$$,'23514',null,'a price band only in the store''s currency');
select throws_ok($$select pg_temp.record('[]', jsonb_build_array(pg_temp.f()),
  '{"state":"empty","currency":"USD","currencyCheck":"unverified","complete":true}', current_setting('test.mine'))$$,
  '23514',null,'no findings for a store without products');
reset role;
-- The sample catalog is never stored for a real brand.
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000101';
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s(), current_setting('test.mine'))$$,
  '23514',null,'a sample catalog is never stored for a real brand');
reset role;
update public.brand_profiles set synthetic=true where tenant_id='00000000-0000-4000-8000-000000000101';

-- A read replaces only the findings it states again.
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f(),
  pg_temp.f('{"topic":"offering","statement":"Sells products such as Field Overshirt.","value":{},"confidence":0.6}')), pg_temp.s(),
  current_setting('test.mine'))$$,'a read with a price band and an offering is stored');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s(), current_setting('test.mine'))$$,
  'PT409',null,'a finished read records nothing more');
reset role;
select set_config('test.mine2',pg_temp.job('00000000-0000-4000-8000-000000000101','mine2'),true);
select pg_temp.lease(current_setting('test.mine2'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f()), pg_temp.s(),
  current_setting('test.mine2'))$$,'a read without the analysis is stored');
reset role;
select results_eq($$select topic, run_id::text from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
    and source='catalog' and superseded_at is null order by topic$$,
  $$values ('offering',current_setting('test.mine')), ('price_band',current_setting('test.mine2'))$$,
  'its price band replaces the earlier one; the earlier offering stays');
select throws_ok($$update public.products set image_url=null where tenant_id='00000000-0000-4000-8000-000000000101'
  and external_id='7001'$$,'23514',null,'a featured Klaviyo product keeps its photo');

-- An expired lease, and a site read handed to the catalog commands.
select set_config('test.late',pg_temp.job('00000000-0000-4000-8000-000000000101','late'),true);
update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()-interval '1 second'
  where id=current_setting('test.late')::uuid;
with site as (insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by)
  values ('00000000-0000-4000-8000-000000000101','brand.read_site','site-test',jsonb_build_object('domain','cedar-lane.example'),
    '00000000-0000-4000-8000-000000000001') returning id)
select set_config('test.site',(select id::text from site),true);
select pg_temp.lease(current_setting('test.site'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s(), current_setting('test.late'))$$,
  'PT409',null,'an expired lease records nothing');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), '[]', pg_temp.s(), current_setting('test.site'))$$,
  '23514',null,'a site read is not a catalog read');
select throws_ok($$select public.pause_source_reading(current_setting('test.site')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited')$$,
  '23514',null,'nor paused as one');
reset role;

-- Rate limits: at most 6 pauses, and at most a day; then the read ends.
select set_config('test.busy',pg_temp.job('00000000-0000-4000-8000-000000000101','busy'),true);
update public.job_runs set checkpoint='{"pauses":6}' where id=current_setting('test.busy')::uuid;
select pg_temp.lease(current_setting('test.busy'));
select set_config('test.old2',pg_temp.job('00000000-0000-4000-8000-000000000101','old2','fixture','2 days'),true);
select pg_temp.lease(current_setting('test.old2'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.busy')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited',30)$$,
  'a seventh rate limit');
select lives_ok($$select public.pause_source_reading(current_setting('test.old2')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited',30)$$,
  'a rate limit a day on');
reset role;
select results_eq($$select status, failure_class, error_code from public.job_runs
    where id in (current_setting('test.busy')::uuid, current_setting('test.old2')::uuid)$$,
  $$values ('failed','rate_limit','rate_limited'), ('failed','rate_limit','rate_limited')$$,'end the read');
select ok(exists(select 1 from public.notifications where tenant_id='00000000-0000-4000-8000-000000000101'
  and message like 'Klaviyo kept asking us to slow down%'),'and the owner is told');

-- A sample read Klaviyo refused only ends: the sample connection stays.
select set_config('test.samplekey',pg_temp.job('00000000-0000-4000-8000-000000000101','samplekey'),true);
select pg_temp.lease(current_setting('test.samplekey'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.samplekey')::uuid,'00000000-0000-4000-8000-00000000aaaa','klaviyo_key_rejected')$$,
  'a sample read with a refused key');
reset role;
select is((select status||' '||failure_class from public.job_runs where id=current_setting('test.samplekey')::uuid),'failed auth','ends');
select is((select mode||'/'||status from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'),
  'fixture/connected','and leaves the sample connection as it is');

-- The guard on every path: the sample connect cannot bring a live
-- connection back with its own hint; the key check can.
update public.workspace_connections set credential_hint='pk_LIVEA••••••••0000'
  where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000102')$$,'23514',null,
  'no catalog read while the live connection needs attention');
select throws_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000102','klaviyo','Cedar Goods','pk_LIVEA••••••••0000')$$,
  'PT409',null,'the sample connect never brings a live connection back');
select lives_ok($$select public.connect_klaviyo_live('00000000-0000-4000-8000-000000000102','pk_LIVEA0123456789abcdefghij0000',
  'pk_LIVEA••••••••0000','Cedar Goods','CdrG01','2026-10-15')$$,'the key check does');
select is(public.start_catalog_reading('00000000-0000-4000-8000-000000000102')::text,current_setting('test.live'),
  'today''s failed read starts again');
reset role;
select is((select status||' '||attempt from public.job_runs where id=current_setting('test.live')::uuid),'queued 0','with all its tries');
select results_eq($$select w.mode, w.status, c.status from public.workspace_connections w join public.klaviyo_credentials c using (tenant_id)
    where w.tenant_id='00000000-0000-4000-8000-000000000102' and w.provider='klaviyo'$$,
  $$values ('live','connected','active')$$,'the live connection is back, with its key');

-- A missing scope: the live connection needs the owner, the key stays.
select pg_temp.lease(current_setting('test.live'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.live')::uuid,'00000000-0000-4000-8000-00000000aaaa','klaviyo_scope_missing')$$,
  'a missing scope stops the read');
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000102'),null,'the key is no longer read');
reset role;
select results_eq($$select w.status, w.last_error, c.status from public.workspace_connections w join public.klaviyo_credentials c using (tenant_id)
    where w.tenant_id='00000000-0000-4000-8000-000000000102' and w.provider='klaviyo'$$,
  $$values ('expired','klaviyo_scope_missing','active')$$,'the connection needs the owner; the key is not revoked');
select ok(exists(select 1 from public.notifications where tenant_id='00000000-0000-4000-8000-000000000102'
  and message like '%Accounts, Catalogs, Events and Metrics read access%'),'and the owner is told which access it needs');

-- A key changed after the read began: the read is only put back.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select lives_ok($$select public.connect_klaviyo_live('00000000-0000-4000-8000-000000000102','pk_LIVEA0123456789abcdefghij0000',
  'pk_LIVEA••••••••0000','Cedar Goods','CdrG01','2026-10-15')$$,'the owner connects again');
select lives_ok($$select public.start_catalog_reading('00000000-0000-4000-8000-000000000102')$$,'and starts the read again');
reset role;
select pg_temp.lease(current_setting('test.live'));
update public.job_runs set updated_at=now()-interval '1 minute' where id=current_setting('test.live')::uuid;
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.live')::uuid,'00000000-0000-4000-8000-00000000aaaa','klaviyo_key_rejected')$$,
  'an old key refused');
reset role;
select is((select status from public.job_runs where id=current_setting('test.live')::uuid),'retry_wait','puts the read back');
select results_eq($$select w.status, c.status from public.workspace_connections w join public.klaviyo_credentials c using (tenant_id)
    where w.tenant_id='00000000-0000-4000-8000-000000000102' and w.provider='klaviyo'$$,
  $$values ('connected','active')$$,'and leaves the new key alone');

-- A live read: real products, counted facts as code, a model's words.
select pg_temp.lease(current_setting('test.live'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f()), pg_temp.s(), current_setting('test.live'), true)$$,
  '23514',null,'a live read never states the sample rules');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f('{"pass":"model","model":"gemini-2.5-flash"}')),
  pg_temp.s(), current_setting('test.live'), true)$$,'23514',null,'a model never counts the price band');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f('{"topic":"offering","statement":"Sells coats.","value":{},"pass":"model"}')),
  pg_temp.s(), current_setting('test.live'), true)$$,'23514',null,'a model''s words name the model');
select lives_ok($$select pg_temp.record(jsonb_build_array(pg_temp.p()), jsonb_build_array(pg_temp.f('{"pass":"code"}'),
  pg_temp.f('{"topic":"offering","statement":"Sells coats.","value":{},"pass":"model","model":"gemini-2.5-flash"}')),
  pg_temp.s(), current_setting('test.live'), true)$$,'a live read is stored');
reset role;
select results_eq($$select source, synthetic, featurable from public.products where tenant_id='00000000-0000-4000-8000-000000000102' and source='klaviyo'$$,
  $$values ('klaviyo',false,true)$$,'as real products');
select results_eq($$select topic, pass from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000102' and source='catalog'
    and superseded_at is null order by topic$$,
  $$values ('offering','model'), ('price_band','code')$$,'with its findings');

-- A sample key over the live one still makes it a sample connection.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select lives_ok($$select public.connect_sample_provider('00000000-0000-4000-8000-000000000102','klaviyo','Cedar Goods','pk_OTHER••••••••1111')$$,
  'a sample connection with another key');
reset role;
select is((select mode from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo'),
  'fixture','replaces the live one');

select * from finish();
rollback;
