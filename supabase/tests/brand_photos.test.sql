begin;
select plan(43);

-- ONB-059b: the photo library's site photos, kept by the Site reader's
-- job. Owner ...01 and staff ...05 are in workspace 101; owner ...04 runs
-- workspace 102.
create function pg_temp.job(key text, kind text default 'brand.read_site', age interval default '0',
  domain text default 'WWW.Cedar-Lane.example') returns uuid
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values ('00000000-0000-4000-8000-000000000101',kind,key,jsonb_build_object('domain',domain),
      '00000000-0000-4000-8000-000000000001', now()-age,
      'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id
$$;
create function pg_temp.keep(job uuid, photos jsonb) returns boolean language sql as $$
  select public.record_site_photos(job,'00000000-0000-4000-8000-00000000aaaa',photos)
$$;
create function pg_temp.photo(url text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('url',url,'kind','product','page','product','alt','Trail socks','source','schema') || extra
$$;
select set_config('test.old',pg_temp.job('photos-old',age=>'1 hour')::text,true);
select set_config('test.new',pg_temp.job('photos-new')::text,true);
select set_config('test.other',pg_temp.job('photos-catalog','brand.read_catalog')::text,true);
select set_config('test.oldest',pg_temp.job('photos-oldest',age=>'2 hours')::text,true);
select set_config('test.nosite',pg_temp.job('photos-nosite',domain=>'localhost')::text,true);
select set_config('test.expired',pg_temp.job('photos-expired')::text,true);
update public.job_runs set lease_until = now() - interval '1 second' where id = current_setting('test.expired')::uuid;

-- Grants.
select ok(not bool_or(has_function_privilege(r,'public.record_site_photos(uuid,uuid,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_site_photos(uuid,uuid,jsonb)','execute'),
  'only the worker keeps photos') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_photos',p)),'browser roles cannot write photos')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_photos','select'),'anonymous visitors cannot read them');

-- Only the site read's own job, under its lease, with well-formed photos.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'[]'),'42501',null,
  'the worker needs its role in the token');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select public.record_site_photos(%L,gen_random_uuid(),%L)',current_setting('test.new'),'[]'),
  'PT409',null,'a wrong lease keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.expired'),'[]'),'PT409',null,
  'a lease that ran out keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.other'),'[]'),'23514',null,
  'another reader''s job cannot keep photos');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.nosite'),'[]'),'23514',null,
  'a job without a real website keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),bad),'23514',null,'refused: '||why)
  from (values
    ('{}'::jsonb, 'not a list'),
    ((select jsonb_agg(pg_temp.photo('https://cdn.example.com/p'||i||'.jpg')) from generate_series(1,201) i), 'over 200'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"note":"x"}')), 'an unknown key'),
    (jsonb_build_array(pg_temp.photo('http://cdn.example.com/a.jpg')), 'not https'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"kind":"logo"}')), 'an unknown kind'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"page":"cart"}')), 'an unknown page'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg',jsonb_build_object('alt',repeat('a',201)))), 'a long description'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg'),pg_temp.photo('https://cdn.example.com/a.jpg')), 'the same photo twice'),
    ('["x"]'::jsonb, 'not an object'),
    ('[null]'::jsonb, 'a null photo'),
    (jsonb_build_array(pg_temp.photo('x') || '{"url":7}'), 'an address that is not text'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"alt":7}')), 'a description that is not text'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg') - 'kind'), 'no kind'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com:8443/a.jpg')), 'a port'),
    (jsonb_build_array(pg_temp.photo('https://a:b@cdn.example.com/a.jpg')), 'a name and password'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/'||repeat('a',973)||'.jpg')), '1,001 characters')
  ) as x(bad, why);

-- The most a set holds: 200 photos, an address of 1,000 characters and a
-- description of 200.
select ok(pg_temp.keep(current_setting('test.oldest')::uuid,
  (select jsonb_agg(pg_temp.photo('https://cdn.example.com/p'||i||'.jpg')) from generate_series(1,198) i)
  || jsonb_build_array(pg_temp.photo('https://cdn.example.com/'||repeat('a',972)||'.jpg'),
    pg_temp.photo('https://cdn.example.com/long.jpg',jsonb_build_object('alt',repeat('d',200))))),
  'the largest set is kept');
select is((select count(*)::integer from public.brand_photos where tenant_id='00000000-0000-4000-8000-000000000101'),200,
  'all 200');
-- Kept in their order; an empty description is none.
select ok(pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(
  pg_temp.photo('https://cdn.example.com/socks.jpg'),
  pg_temp.photo('https://cedar-lane.example/files/dawn.jpg','{"kind":"lifestyle","page":"home","alt":"","source":"page"}'))),
  'a read keeps its photos');
select is((select array_agg(url||' '||kind||' '||coalesce(alt,'-')||' '||position order by position) from public.brand_photos
  where tenant_id='00000000-0000-4000-8000-000000000101'),
  array['https://cdn.example.com/socks.jpg product Trail socks 0','https://cedar-lane.example/files/dawn.jpg lifestyle - 1'],
  'in their order, with their descriptions');
select is((select domain||' '||(run_id::text = current_setting('test.old')) from public.brand_photo_sets
  where tenant_id='00000000-0000-4000-8000-000000000101'),'cedar-lane.example true',
  'the set names its read and the plain website it was read from');
-- A newer read replaces the whole set.
select ok(pg_temp.keep(current_setting('test.new')::uuid,jsonb_build_array(pg_temp.photo('https://cdn.example.com/cap.png'))),
  'a newer read keeps its photos');
select is((select array_agg(url) from public.brand_photos where tenant_id='00000000-0000-4000-8000-000000000101'),
  array['https://cdn.example.com/cap.png'],'the earlier set is replaced');
-- An older read finishing later changes nothing.
select ok(not pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(pg_temp.photo('https://cdn.example.com/old.jpg'))),
  'an older read is too late');
select is((select count(*)::integer from public.brand_photos where tenant_id='00000000-0000-4000-8000-000000000101'),1,
  'the newer set stays');
-- A set with a bad photo is refused whole and the set stays.
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),jsonb_build_array(
  pg_temp.photo('https://cdn.example.com/fine.jpg'),pg_temp.photo('https://cdn.example.com/bad.jpg','{"source":"guess"}'))),
  '23514',null,'one bad photo refuses the set');
select is((select array_agg(url) from public.brand_photos where tenant_id='00000000-0000-4000-8000-000000000101'),
  array['https://cdn.example.com/cap.png'],'and the set stays');
-- An empty set from the same read clears them.
select ok(pg_temp.keep(current_setting('test.new')::uuid,'[]'),'the same read may keep none');
select is((select count(*)::integer from public.brand_photos where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'none kept');
-- A newer read that kept none still wins over an older one.
select ok(not pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(pg_temp.photo('https://cdn.example.com/stale.jpg'))),
  'an older read cannot fill a newer read''s empty set');
select ok(pg_temp.keep(current_setting('test.new')::uuid,jsonb_build_array(pg_temp.photo('https://cdn.example.com/cap.png'))),
  'and keep them again');
-- Once the read has stored its findings, its lease is gone.
select public.record_site_findings(current_setting('test.new')::uuid,'00000000-0000-4000-8000-00000000aaaa','[]','[]',false);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'[]'),'PT409',null,
  'a finished read keeps nothing');
reset role;

-- The workspace's members read them; another workspace does not.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select url||' '||(select domain from public.brand_photo_sets) from public.brand_photos),
  'https://cdn.example.com/cap.png cedar-lane.example','staff read their workspace''s photos and where they came from');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.brand_photos) + (select count(*)::integer from public.brand_photo_sets),0,
  'another workspace''s owner reads none');
reset role;

-- A photo row always names a read of its own workspace.
select throws_ok(format($$insert into public.brand_photos(tenant_id,run_id,url,kind,page,source,position)
  values('00000000-0000-4000-8000-000000000102',%L,'https://cdn.example.com/x.jpg','product','home','page',0)$$,
  current_setting('test.old')),'23503',null,'a row needs a read of the same workspace');

select * from finish();
rollback;
