begin;
select plan(22);

-- ONB-060b: the brand's two logos, kept by the Site reader's job. Owner
-- ...01 and staff ...05 are in workspace 101 (cedar-lane.example); owner
-- ...04 runs workspace 102.
create function pg_temp.job(tenant text, key text, kind text default 'brand.read_site', age interval default '0') returns uuid
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values (tenant::uuid,kind,key,jsonb_build_object('domain','WWW.Cedar-Lane.example'),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age,
      'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id
$$;
create function pg_temp.keep(job uuid, on_light text, on_dark text) returns boolean language sql as $$
  select public.record_site_logos(job,'00000000-0000-4000-8000-00000000aaaa',on_light,on_dark)
$$;
select set_config('test.old',pg_temp.job('00000000-0000-4000-8000-000000000101','logos-old',age=>'1 hour')::text,true);
select set_config('test.new',pg_temp.job('00000000-0000-4000-8000-000000000101','logos-new')::text,true);
select set_config('test.other',pg_temp.job('00000000-0000-4000-8000-000000000101','logos-catalog','brand.read_catalog')::text,true);

-- Grants.
select ok(not bool_or(has_function_privilege(r,'public.record_site_logos(uuid,uuid,text,text)','execute'))
  and has_function_privilege('service_role','public.record_site_logos(uuid,uuid,text,text)','execute'),
  'only the worker keeps logos') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_logos',p)),'browser roles cannot write logos')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_logos','select'),'anonymous visitors cannot read them');

-- Only the site read's own job, under its lease, with https pictures.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok(format('select pg_temp.keep(%L,null,null)',current_setting('test.new')),'42501',null,
  'the worker needs its role in the token');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select public.record_site_logos(%L,gen_random_uuid(),null,null)',current_setting('test.new')),
  'PT409',null,'a wrong lease keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,null,null)',current_setting('test.other')),'23514',null,
  'another reader''s job cannot keep logos');
select throws_ok(format('select pg_temp.keep(%L,%L,null)',current_setting('test.new'),u),'23514',null,'refused: '||left(u,40))
  from unnest(array['http://cdn.example/logo.png','https://cdn.example:8443/logo.png','https://a:b@cdn.example/logo.png',
    'https://cdn.example/'||repeat('a',1000),'logo.png']) u;
select throws_ok(format('select pg_temp.keep(%L,%L,%L)',current_setting('test.new'),'https://cdn.example/logo.png',
  'https://cdn.example/logo.png'),'23514',null,'never the same picture for both');

-- Kept, with the plain domain the job read; a logo may be on another host.
select ok(pg_temp.keep(current_setting('test.new')::uuid,'https://cdn.example/files/logo-dark.svg',null),'the newest read keeps its logos');
select is((select array[domain,on_light,coalesce(on_dark,'none'),run_id::text] from public.brand_logos
  where tenant_id='00000000-0000-4000-8000-000000000101'),
  array['cedar-lane.example','https://cdn.example/files/logo-dark.svg','none',current_setting('test.new')],
  'one row for the workspace, from that read');
-- An older read finishing later does not replace them.
select ok(not pg_temp.keep(current_setting('test.old')::uuid,'https://cedar-lane.example/old.png',null),'an older read is too late');
select is((select on_light from public.brand_logos where tenant_id='00000000-0000-4000-8000-000000000101'),
  'https://cdn.example/files/logo-dark.svg','the newer logos stay');
-- The same read again replaces them (both may be gone).
select ok(pg_temp.keep(current_setting('test.new')::uuid,null,null),'the same read may keep them again');
select is((select count(*)::integer from public.brand_logos where tenant_id='00000000-0000-4000-8000-000000000101'
  and on_light is null and on_dark is null),1,'still one row, now without logos');
select ok(pg_temp.keep(current_setting('test.new')::uuid,'https://cdn.example/dark.png','https://cdn.example/light.png'),
  'both logos');
reset role;

-- The workspace's members read them; another workspace does not.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select on_dark from public.brand_logos),'https://cdn.example/light.png','staff read their workspace''s logos');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.brand_logos),0,'another workspace''s owner reads none');
reset role;

-- A logo row always names its read, and a check keeps the pictures apart.
select throws_ok($$insert into public.brand_logos(tenant_id,run_id,domain,on_light,on_dark)
  values('00000000-0000-4000-8000-000000000102',gen_random_uuid(),'north-studio.example',null,null)$$,'23503',null,
  'a row needs a read of the same workspace');

select * from finish();
rollback;
