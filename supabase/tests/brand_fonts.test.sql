begin;
select plan(59);

-- FONT-SITE part b: the brand's web fonts, kept by the Site reader's job.
-- Owner ...01 and staff ...05 are in workspace 101; owner ...04 runs
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
create function pg_temp.keep(job uuid, fonts jsonb) returns boolean language sql as $$
  select public.record_site_fonts(job,'00000000-0000-4000-8000-00000000aaaa',fonts)
$$;
create function pg_temp.file(url text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('url',url,'format','woff2','weight',400,'italic',false,'unicodeRange','U+0000-00FF, U+0131') || extra
$$;
create function pg_temp.font(family text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('family',family,'roles','["heading"]'::jsonb,'kind','self-hosted',
    'files',jsonb_build_array(pg_temp.file('https://cedar-lane.example/fonts/'||replace(family,' ','-')||'.woff2'))) || extra
$$;
select set_config('test.old',pg_temp.job('fonts-old',age=>'1 hour')::text,true);
select set_config('test.new',pg_temp.job('fonts-new')::text,true);
select set_config('test.other',pg_temp.job('fonts-catalog','brand.read_catalog')::text,true);
select set_config('test.oldest',pg_temp.job('fonts-oldest',age=>'2 hours')::text,true);
select set_config('test.nosite',pg_temp.job('fonts-nosite',domain=>'localhost')::text,true);
select set_config('test.expired',pg_temp.job('fonts-expired')::text,true);
update public.job_runs set lease_until = now() - interval '1 second' where id = current_setting('test.expired')::uuid;

-- Grants.
select ok(not bool_or(has_function_privilege(r,'public.record_site_fonts(uuid,uuid,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_site_fonts(uuid,uuid,jsonb)','execute'),
  'only the worker keeps fonts') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_fonts',p)),'browser roles cannot write fonts')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_fonts','select'),'anonymous visitors cannot read them');
select ok(not bool_or(has_function_privilege(r,'private.site_fonts_ok(jsonb)','execute')),'nor run the shape check')
  from unnest(array['anon','authenticated']) r;

-- Only the site read's own job, under its lease, with well-formed fonts.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'[]'),'42501',null,
  'the worker needs its role in the token');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select public.record_site_fonts(%L,gen_random_uuid(),%L)',current_setting('test.new'),'[]'),
  'PT409',null,'a wrong lease keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.expired'),'[]'),'PT409',null,
  'a lease that ran out keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.other'),'[]'),'23514',null,
  'another reader''s job cannot keep fonts');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.nosite'),'[]'),'23514',null,
  'a job without a real website keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),bad),'23514',null,'refused: '||why)
  from (values
    (null::jsonb, 'nothing'),
    ('{}'::jsonb, 'not a list'),
    ((select jsonb_agg(pg_temp.font('Cedar '||i)) from generate_series(1,9) i), 'over 8 families'),
    ('["x"]'::jsonb, 'a family that is not an object'),
    (jsonb_build_array(pg_temp.font('Cedar','{"note":"x"}')), 'an unknown key'),
    (jsonb_build_array(pg_temp.font('Cedar') - 'kind'), 'no kind'),
    (jsonb_build_array(pg_temp.font('Cedar','{"kind":"pirated"}')), 'an unknown kind'),
    (jsonb_build_array(pg_temp.font('Cedar "Serif"')), 'a name the studio refuses'),
    (jsonb_build_array(pg_temp.font(repeat('a',61))), 'a name over 60 characters'),
    (jsonb_build_array(pg_temp.font('Cedar'),pg_temp.font('CEDAR')), 'the same family twice'),
    (jsonb_build_array(pg_temp.font('Cedar','{"roles":["footer"]}')), 'an unknown role'),
    (jsonb_build_array(pg_temp.font('Cedar','{"roles":["body","body"]}')), 'a role twice'),
    (jsonb_build_array(pg_temp.font('Cedar','{"roles":"heading"}')), 'roles that are not a list'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',
      (select jsonb_agg(pg_temp.file('https://cedar-lane.example/f'||i||'.woff2')) from generate_series(1,13) i)))), 'over 12 files'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2'),pg_temp.file('https://cedar-lane.example/a.woff2'))))), 'the same file twice'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('http://cedar-lane.example/a.woff2'))))), 'a file not on https'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example:8443/a.woff2'))))), 'a file on a port'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/'||repeat('a',968)||'.woff2'))))), 'a file address of 1,001 characters'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.eot','{"format":"embedded-opentype"}'))))), 'a file type browsers do not all load'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"weight":950}'))))), 'a weight over 900'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"weight":"400"}'))))), 'a weight that is not a number'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"weight":450.5}'))))), 'a weight that is not whole'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"maxWeight":300}'))))), 'a variable range that runs down'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"italic":"no"}'))))), 'italic that is not true or false'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2') - 'unicodeRange')))), 'a file without its range'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files',jsonb_build_array(
      pg_temp.file('https://cedar-lane.example/a.woff2','{"unicodeRange":"latin"}'))))), 'a range the reader never writes'),
    (jsonb_build_array(pg_temp.font('Cedar',jsonb_build_object('files','["x"]'::jsonb))), 'a file that is not an object')
  ) as x(bad, why);

-- The most a list holds: 8 families of 12 files, a file address of 1,000
-- characters and a range of 1,000.
select ok(pg_temp.keep(current_setting('test.oldest')::uuid,
  (select jsonb_agg(pg_temp.font('Cedar '||i,jsonb_build_object('files',
    (select jsonb_agg(pg_temp.file('https://cedar-lane.example/'||i||'-'||n||repeat('a',967-length(i||'-'||n))||'.woff2',
      jsonb_build_object('weight',100+n*50,'unicodeRange','U+000041'||repeat(', U+0041',124))))
      from generate_series(0,11) n)))) from generate_series(1,8) i)),
  'the largest list is kept');
select is((select jsonb_array_length(fonts) from public.brand_fonts where tenant_id='00000000-0000-4000-8000-000000000101'),8,
  'all 8 families');
-- Kept as given, in their order, with a variable font's range and a file for every character.
select ok(pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(
  pg_temp.font('Cedar Serif'),
  pg_temp.font('Inter',jsonb_build_object('roles','["body"]'::jsonb,'kind','google','files',jsonb_build_array(
    pg_temp.file('https://fonts.gstatic.com/s/inter/v13/a.woff2','{"weight":100,"maxWeight":900,"unicodeRange":null}')))),
  pg_temp.font('Loaded Only','{"roles":[],"kind":"unknown","files":[]}'))),
  'a read keeps its fonts');
select is((select array_agg(f->>'family' order by n) from public.brand_fonts, jsonb_array_elements(fonts) with ordinality x(f, n)
  where tenant_id='00000000-0000-4000-8000-000000000101'),array['Cedar Serif','Inter','Loaded Only'],'in their order');
select is((select fonts->1->'files'->0 from public.brand_fonts where tenant_id='00000000-0000-4000-8000-000000000101'),
  '{"url":"https://fonts.gstatic.com/s/inter/v13/a.woff2","format":"woff2","weight":100,"maxWeight":900,"italic":false,"unicodeRange":null}'::jsonb,
  'each file as found');
select is((select domain||' '||(run_id::text = current_setting('test.old')) from public.brand_fonts
  where tenant_id='00000000-0000-4000-8000-000000000101'),'cedar-lane.example true',
  'the row names its read and the plain website it was read from');
-- A retry of the same read keeps the same list once.
select ok(pg_temp.keep(current_setting('test.old')::uuid,(select fonts from public.brand_fonts
  where tenant_id='00000000-0000-4000-8000-000000000101')),'a retry of the same read keeps it again');
select is((select count(*)::integer||' '||max(jsonb_array_length(fonts)) from public.brand_fonts
  where tenant_id='00000000-0000-4000-8000-000000000101'),'1 3','once, unchanged');
-- A newer read replaces the whole list.
select ok(pg_temp.keep(current_setting('test.new')::uuid,jsonb_build_array(pg_temp.font('Dawn Sans'))),
  'a newer read keeps its fonts');
select is((select fonts->0->>'family' from public.brand_fonts where tenant_id='00000000-0000-4000-8000-000000000101'),
  'Dawn Sans','the earlier list is replaced');
-- An older read finishing later changes nothing.
select ok(not pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(pg_temp.font('Old Serif'))),
  'an older read is too late');
select is((select fonts->0->>'family' from public.brand_fonts where tenant_id='00000000-0000-4000-8000-000000000101'),
  'Dawn Sans','the newer list stays');
-- A list with one bad family is refused whole and the list stays.
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),jsonb_build_array(
  pg_temp.font('Fine Sans'),pg_temp.font('Bad','{"kind":"guess"}'))),'23514',null,'one bad family refuses the list');
select is((select fonts->0->>'family' from public.brand_fonts where tenant_id='00000000-0000-4000-8000-000000000101'),
  'Dawn Sans','and the list stays');
-- None found: the same read keeps an empty list, which an older read cannot fill.
select ok(pg_temp.keep(current_setting('test.new')::uuid,'[]'),'the same read may keep none');
select ok(not pg_temp.keep(current_setting('test.old')::uuid,jsonb_build_array(pg_temp.font('Stale Serif'))),
  'an older read cannot fill a newer read''s empty list');
select ok(pg_temp.keep(current_setting('test.new')::uuid,jsonb_build_array(pg_temp.font('Dawn Sans'))),
  'and keep them again');
-- Once the read has stored its findings, its lease is gone.
select public.record_site_findings(current_setting('test.new')::uuid,'00000000-0000-4000-8000-00000000aaaa','[]','[]',false);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'[]'),'PT409',null,
  'a finished read keeps nothing');
reset role;

-- The workspace's members read them; another workspace and anonymous
-- visitors do not.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select fonts->0->>'family'||' '||domain from public.brand_fonts),'Dawn Sans cedar-lane.example',
  'staff read their workspace''s fonts and where they came from');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.brand_fonts),0,'another workspace''s owner reads none');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok('select count(*) from public.brand_fonts','42501',null,'an anonymous visitor reads none');
reset role;

-- A row always names a read of its own workspace, and the table keeps
-- the shape as the command does.
select throws_ok(format($$insert into public.brand_fonts(tenant_id,run_id,domain,fonts)
  values('00000000-0000-4000-8000-000000000102',%L,'cedar-lane.example','[]')$$,
  current_setting('test.old')),'23503',null,'a row needs a read of the same workspace');
select throws_ok($$update public.brand_fonts set fonts = '[{"family":"x"}]'
  where tenant_id='00000000-0000-4000-8000-000000000101'$$,'23514',null,'the table refuses a bad list too');

select * from finish();
rollback;
