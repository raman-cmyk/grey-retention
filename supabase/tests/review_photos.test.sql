begin;
select plan(51);

-- REL-ONB2 part e: the photos customers posted with their reviews, kept by
-- the Reviews reader (`customer_photo`). Workspace 101 is a synthetic brand
-- (cedar-lane.example); 102 is made a real one (north-studio.com) below.
-- Owner ...04 runs 102; staff ...05 is in 101.
update public.brand_profiles set synthetic=false, domain='north-studio.com' where tenant_id='00000000-0000-4000-8000-000000000102';
create function pg_temp.job(tenant text, key text, mode text, domain text) returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,status,lease_token,lease_until)
    values (tenant::uuid,'brand.read_reviews',key,jsonb_build_object('domain',domain,'mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1),
      'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id::text
$$;
create function pg_temp.page() returns text language sql as $$ select 'https://north-studio.com/products/knit' $$;
create function pg_temp.photo(url text default 'https://north-studio.com/cdn/shop/files/maya.jpg', extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('source','reviews','topic','customer_photo',
    'statement','A photo a customer posted with their review on the store''s own page.',
    'value',jsonb_build_object('url',url,'page',pg_temp.page(),'product','Weekend Knit'),
    'evidence',jsonb_build_object('ref','review-data:'||pg_temp.page()),'confidence',0.9,'pass','code','model',null) || extra
$$;
-- Both sources read and the reader asked, so no other rule refuses a
-- model's finding or a comment's.
create function pg_temp.record(findings jsonb, job text default current_setting('test.live'), live boolean default true,
    pages jsonb default jsonb_build_array(pg_temp.page())) returns jsonb language sql as $$
  select public.record_review_findings(job::uuid,'00000000-0000-4000-8000-00000000aaaa',findings,pages,
    '["https://www.instagram.com/p/1/"]','{"reviews":{"state":"ready"},"social":{"state":"ready"},"analysis":"done"}'::jsonb,live)
$$;
select set_config('test.live',pg_temp.job('00000000-0000-4000-8000-000000000102','photos-live','live','north-studio.com'),true);
select set_config('test.sample',pg_temp.job('00000000-0000-4000-8000-000000000101','photos-sample','sample','cedar-lane.example'),true);

-- The value: a JPEG or PNG over https, its page, the product when named; nothing else.
select ok(private.finding_value_ok('customer_photo', v), 'photo '||v::text) from (values
  ('{"url":"https://north-studio.com/m.jpg","page":"https://north-studio.com/p"}'::jsonb),
  ('{"url":"https://judgeme.imgix.net/n/1__photo.PNG?w=800","page":"https://north-studio.com/p","product":"Weekend Knit"}'),
  ('{"url":"https://north-studio.com/m.jpeg#top","page":"https://north-studio.com/p"}')) as x(v);
select ok(not private.finding_value_ok('customer_photo', v), 'photo '||left(v::text, 90)) from (values
  ('{"url":"https://north-studio.com/m.jpg"}'::jsonb), ('{"page":"https://north-studio.com/p"}'),
  ('{"url":"http://north-studio.com/m.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/m.webp","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com:8443/m.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/m.jpg","page":"http://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/m.jpg","page":"https://north-studio.com/p","product":" "}'),
  ('{"url":"https://north-studio.com/m.jpg","page":"https://north-studio.com/p","author":"Maya R."}'),
  ('{"url":"https://north-studio.com/m.jpg","page":"https://north-studio.com/p","quote":"So soft."}'),
  ('{"url":5,"page":"https://north-studio.com/p"}'),
  (jsonb_build_object('url','https://north-studio.com/'||repeat('m',496)||'.jpg','page','https://north-studio.com/p')),
  (jsonb_build_object('url','https://north-studio.com/m.jpg','page','https://north-studio.com/p','product',repeat('k',121))),
  (jsonb_build_object('url','https://north-studio.com/'||repeat('m',460)||'.jpg','page','https://north-studio.com/'||repeat('p',470))),
  -- A host a browser reads another way, or characters no URL has.
  ('{"url":"https://evil.example\\.north-studio.com/m.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://NORTH-STUDIO.com/m.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/m a.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/<m>.jpg","page":"https://north-studio.com/p"}'),
  ('{"url":"https://north-studio.com/m\\x.jpg","page":"https://north-studio.com/p"}'))
  as x(v);

-- Recording, as the worker: refused unless code's, of a live read, citing
-- the review data of a page read here, on a host that may be the store's.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select pg_temp.record(jsonb_build_array(%L::jsonb))', bad),'23514','Invalid finding','refused: '||why)
  from (values
    (pg_temp.photo('https://images.example-cdn.com/maya.jpg'), 'another host'),
    (pg_temp.photo('https://north-studio.com.evil.com/maya.jpg'), 'a look-alike of the store'),
    (pg_temp.photo('https://cdn.shopify.com/assets/maya.jpg'), 'Shopify''s CDN outside a store''s folder'),
    (pg_temp.photo('https://loox.io/uploads/maya.jpg'), 'an app host not confirmed'),
    -- Host tricks: a browser reads `\` as `/`, so these load from evil.example.
    (pg_temp.photo('https://evil.example\.north-studio.com/m.jpg'), 'a backslash before the store''s name'),
    (pg_temp.photo('https://evil.example%2f.north-studio.com/m.jpg'), 'an escaped slash before the store''s name'),
    (pg_temp.photo('https://evilnorth-studio.com/m.jpg'), 'the store''s name at the end of another'),
    (pg_temp.photo('https://judgeme.imgix.net.evil.example/m.jpg'), 'the app host before another'),
    (pg_temp.photo('https://north-studio.com@evil.example/m.jpg'), 'the store''s name as a user'),
    (pg_temp.photo('https://user@north-studio.com/m.jpg'), 'a user on the store''s host'),
    (pg_temp.photo('https://judgeme%2Eimgix.net/m.jpg'), 'an escaped dot in the app host'),
    -- The reader asked (analysis done): only the photo's own rule refuses it.
    (pg_temp.photo(extra => '{"pass":"model","model":"gemini-2.5-flash"}'), 'a model''s'),
    (pg_temp.photo(extra => '{"model":"gemini-2.5-flash"}'), 'code''s with a model'),
    (pg_temp.photo(extra => jsonb_build_object('evidence',jsonb_build_object('url',pg_temp.page(),'quote','So soft.'))),
      'evidence with words'),
    (pg_temp.photo(extra => '{"evidence":{"ref":"review-data:https://north-studio.com/products/other"}}'), 'another page''s data'),
    (pg_temp.photo(extra => jsonb_build_object('evidence',jsonb_build_object('ref','review-data:'||pg_temp.page(),'x',1))),
      'evidence with more'),
    (pg_temp.photo(extra => '{"source":"social"}'), 'stored as a comment'),
    (pg_temp.photo(extra => jsonb_build_object('value',jsonb_build_object('url','https://north-studio.com/m.jpg',
      'page','https://north-studio.com/products/other'),'evidence',
      jsonb_build_object('ref','review-data:https://north-studio.com/products/other'))), 'a page not read here')) as x(bad, why);
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.photo(), pg_temp.photo()))$$,'23514','Invalid finding',
  'refused: the same photo twice');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.photo('https://north-studio.com/m.jpg?w=400'),
  pg_temp.photo('https://north-studio.com/m.jpg?w=800')))$$,'23514','Invalid finding',
  'refused: the same photo twice at another size (its host and path)');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.photo('https://cdn.shopify.com/s/files/1/0123/4567/8901/files/a.jpg'),
  pg_temp.photo('https://cdn.shopify.com/s/files/1/9999/9999/files/other-store.jpg')))$$,'23514','Invalid finding',
  'refused: photos in two stores'' folders on Shopify''s CDN');
select throws_ok($$select pg_temp.record((select jsonb_agg(pg_temp.photo('https://north-studio.com/m'||n||'.jpg'))
  from generate_series(1, 13) n))$$,'23514','Invalid finding','refused: more than 12 a read');
select throws_ok(format('select pg_temp.record(jsonb_build_array(%L::jsonb),%L,false,%L::jsonb)',
    pg_temp.photo('https://cedar-lane.example/m.jpg',jsonb_build_object('pass',pass,'value',
      jsonb_build_object('url','https://cedar-lane.example/m.jpg','page','https://cedar-lane.example/products/knit'),
      'evidence',jsonb_build_object('ref','review-data:https://cedar-lane.example/products/knit'))),
    current_setting('test.sample'),'["https://cedar-lane.example/products/knit"]'),
  '23514','Invalid finding','refused: a sample read''s, '||pass)
  from unnest(array['sample','code']) pass;
select is(pg_temp.record((select jsonb_agg(pg_temp.photo(u)) from unnest(array[
    'https://north-studio.com/cdn/shop/files/maya.jpg','https://shop.north-studio.com/m2.png',
    'https://cdn.shopify.com/s/files/1/0123/4567/8901/files/m3.jpg','https://cdn.shopify.com/s/files/1/0123/4567/8901/products/m4.jpg',
    'https://judgeme.imgix.net/north-studio/1700000000__m5.jpg']
  || (select array_agg('https://north-studio.com/m'||n||'.jpg') from generate_series(6, 12) n)) u))->>'findings','12',
  'kept: 12 photos on the store''s domain, a subdomain, its folder on Shopify''s CDN and Judge.me''s host');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000102'
  and topic='customer_photo' and pass='code' and superseded_at is null and value ? 'product'
  and not value ? 'author' and evidence = jsonb_build_object('ref','review-data:'||pg_temp.page())),12,
  'stored with their page and product, citing the review data, never a name');
reset role;

-- The table holds the topic for reviews only.
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,value,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000102',current_setting('test.live')::uuid,'social','customer_photo','A photo.',
    jsonb_build_object('url','https://north-studio.com/m.jpg','page','https://www.instagram.com/p/1/'),'{"ref":"x"}',0.9,'model')$$,
  '23514','new row for relation "brand_findings" violates check constraint "brand_findings_social_topics"',
  'a comment''s photo is never a customer''s photo here');
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,value,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000102',current_setting('test.live')::uuid,'reviews','customer_photo','A photo.',
    '{"url":"https://north-studio.com/m.jpg"}','{"ref":"x"}',0.9,'model')$$,
  '23514','new row for relation "brand_findings" violates check constraint "brand_findings_check"',
  'a photo''s value is checked by the table too');

-- Members read them; another workspace does not (RLS unchanged).
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000004','role','authenticated')::text,true);
select is((select count(*)::integer from public.brand_findings where topic='customer_photo'),12,'the owner reads them');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-000000000005','role','authenticated')::text,true);
select is((select count(*)::integer from public.brand_findings where topic='customer_photo'),0,'another workspace reads none');
reset role;

select * from finish();
rollback;
