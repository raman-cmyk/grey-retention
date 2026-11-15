begin;
select plan(29);

-- ONB-059b: the photo library's site photos, kept by the Site reader's
-- job. Owner ...01 and staff ...05 are in workspace 101; owner ...04 runs
-- workspace 102.
create function pg_temp.job(key text, kind text default 'brand.read_site', age interval default '0') returns uuid
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values ('00000000-0000-4000-8000-000000000101',kind,key,jsonb_build_object('domain','cedar-lane.example'),
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
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.other'),'[]'),'23514',null,
  'another reader''s job cannot keep photos');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),bad),'23514',null,'refused: '||why)
  from (values
    ('{}'::jsonb, 'not a list'),
    ((select jsonb_agg(pg_temp.photo('https://cdn.example.com/p'||i||'.jpg')) from generate_series(1,201) i), 'over 200'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"note":"x"}')), 'an unknown key'),
    (jsonb_build_array(pg_temp.photo('http://cdn.example.com/a.jpg')), 'not https'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"kind":"logo"}')), 'an unknown kind'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg','{"page":"cart"}')), 'an unknown page'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg',jsonb_build_object('alt',repeat('a',201)))), 'a long description'),
    (jsonb_build_array(pg_temp.photo('https://cdn.example.com/a.jpg'),pg_temp.photo('https://cdn.example.com/a.jpg')), 'the same photo twice')
  ) as x(bad, why);

-- Kept in their order; an empty description is none.
select ok(pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(
  pg_temp.photo('https://cdn.example.com/socks.jpg'),
  pg_temp.photo('https://cedar-lane.example/files/dawn.jpg','{"kind":"lifestyle","page":"home","alt":"","source":"page"}'))),
  'a read keeps its photos');
select is((select array_agg(url||' '||kind||' '||coalesce(alt,'-')||' '||position order by position) from public.brand_photos
  where tenant_id='00000000-0000-4000-8000-000000000101'),
  array['https://cdn.example.com/socks.jpg product Trail socks 0','https://cedar-lane.example/files/dawn.jpg lifestyle - 1'],
  'in their order, with their descriptions');
select is((select count(distinct run_id)::integer from public.brand_photos where run_id=current_setting('test.old')::uuid),1,
  'from that read');
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
select ok(pg_temp.keep(current_setting('test.new')::uuid,jsonb_build_array(pg_temp.photo('https://cdn.example.com/cap.png'))),
  'and keep them again');
reset role;

-- The workspace's members read them; another workspace does not.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select url from public.brand_photos),'https://cdn.example.com/cap.png','staff read their workspace''s photos');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.brand_photos),0,'another workspace''s owner reads none');
reset role;

-- A photo row always names a read of its own workspace.
select throws_ok(format($$insert into public.brand_photos(tenant_id,run_id,url,kind,page,source,position)
  values('00000000-0000-4000-8000-000000000102',%L,'https://cdn.example.com/x.jpg','product','home','page',0)$$,
  current_setting('test.old')),'23503',null,'a row needs a read of the same workspace');

select * from finish();
rollback;
