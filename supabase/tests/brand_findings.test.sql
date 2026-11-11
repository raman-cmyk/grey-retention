begin;
select plan(56);

-- ONB-101: onboarding findings and the Site reader's job. Owner ...01 and
-- staff ...05 are in workspace 101 (cedar-lane.example); owner ...04 runs
-- workspace 102.
create function pg_temp.f(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','returns','statement','Returns within 30 days.','value',jsonb_build_object('days',30),
    'evidence',jsonb_build_object('url','https://cedar-lane.example/pages/returns','quote','Return any unworn item within 30 days.','page','returns'),
    'confidence',0.704,'pass','sample','model',null) || extra
$$;
create function pg_temp.pages(state text default 'read') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('url','https://cedar-lane.example/','kind','home','state',state,'findings',1),
    jsonb_build_object('url','https://cedar-lane.example/pages/faq','kind','faq','state','skipped','reason','timeout'))
$$;
create function pg_temp.lease(j uuid) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute' where id=j
$$;
create function pg_temp.record(findings jsonb, pages jsonb default pg_temp.pages(), job text default current_setting('test.job')) returns jsonb language sql as $$
  select public.record_site_findings(job::uuid,'00000000-0000-4000-8000-00000000aaaa',findings,pages,false)
$$;

-- Grants.
select ok(has_function_privilege('authenticated','public.start_site_reading(uuid)','execute')
  and not has_function_privilege('anon','public.start_site_reading(uuid)','execute'),'signed-in people may start a read, anonymous visitors not');
select ok(not bool_or(has_function_privilege(r,'public.record_site_findings(uuid,uuid,jsonb,jsonb,boolean)','execute'))
  and has_function_privilege('service_role','public.record_site_findings(uuid,uuid,jsonb,jsonb,boolean)','execute'),
  'only the worker records findings') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_findings',p)),'browser roles cannot write findings')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_findings','select'),'anonymous visitors cannot read them');

-- One value shape per topic.
select ok(private.finding_value_ok(t, v), t||' '||v::text) from (values
  ('free_shipping','{"kind":"over","amount":75,"currency":"USD"}'::jsonb), ('free_shipping','{"kind":"never"}'),
  ('returns','{"days":0}'), ('guarantee','{"days":365}'), ('delivery_days','{"min":3,"max":5,"region":"United States"}'),
  ('locale','{"language":"en","currency":"USD"}'), ('price_band','{"min":24.5,"max":120,"currency":"EUR"}'),
  ('claim','{"subject":"product","productId":"p1"}'), ('review_platform','{"name":"Judge.me","verified":true,"rating":4.8,"count":12}'),
  ('tone','{}')) as x(t, v);
select ok(not private.finding_value_ok(t, v), t||' '||v::text) from (values
  ('free_shipping','{"kind":"over","amount":75}'::jsonb), ('free_shipping','{"kind":"always","amount":5}'),
  ('returns','{"days":30.5}'), ('returns','{"days":"30"}'), ('delivery_days','{"min":5,"max":3}'),
  ('locale','{"language":"English","currency":"USD"}'), ('price_band','{"min":120,"max":24.5,"currency":"USD"}'),
  ('claim','{"subject":"everyone"}'), ('review_platform','{"name":"Judge.me"}'), ('tone','{"x":1}'), ('mood','{}')) as x(t, v);

-- The owner starts a read, at most once a day.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.job',public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'asking again the same day returns the same job');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.start_site_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a read');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.start_site_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'another workspace''s owner cannot either');
reset role;
update public.brand_profiles set domain = '' where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select throws_ok($$select public.start_site_reading('00000000-0000-4000-8000-000000000102')$$,'23514',null,
  'a read needs the brand''s website');
reset role;
select is((select kind||'/'||status||'/'||(input->>'domain') from public.job_runs where id=current_setting('test.job')::uuid),
  'brand.read_site/queued/cedar-lane.example','the job is queued with the brand''s domain');

-- Recording a run: only well-formed findings from the brand's own pages.
select pg_temp.lease(current_setting('test.job')::uuid);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.record_site_findings(current_setting('test.job')::uuid,gen_random_uuid(),'[]','[]',false)$$,
  'PT409',null,'a stale lease records nothing');
select throws_ok($$select pg_temp.record('{}')$$,'23514',null,'findings are a list');
select throws_ok($$select pg_temp.record((select jsonb_agg(pg_temp.f()) from generate_series(1,201)))$$,'23514',null,'at most 200');
select throws_ok($$select pg_temp.record('[]', (select jsonb_agg(pg_temp.pages()->0) from generate_series(1,9)))$$,'23514',null,'at most 8 pages');
select throws_ok($$select pg_temp.record('[]', '[{"url":"https://cedar-lane.example/","kind":"cart","state":"read"}]')$$,'23514',null,
  'only the pages the reader reads');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('evidence',
  jsonb_build_object('url','https://other.example/pages/returns','quote','x','page','returns')))))$$,'23514',null,
  'evidence must be on the brand''s own host');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('evidence',
  jsonb_build_object('url','http://cedar-lane.example/pages/returns','quote','x','page','returns')))))$$,'23514',null,'over https');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('evidence',
  jsonb_build_object('url','https://cedar-lane.example.evil.com/','quote','x','page','home')))))$$,'23514',null,
  'a look-alike host is another host');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('evidence',
  jsonb_build_object('url','https://cedar-lane.example/','quote',repeat('x',301),'page','home')))))$$,'23514',null,'a quote is short');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"value":{"days":"thirty"}}')))$$,'23514',null,
  'a value has its topic''s shape');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"topic":"review_platform","value":{"name":"Judge.me","verified":true}}')))$$,
  '23514',null,'the site cannot state a review platform');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"pass":"owner"}')))$$,'23514',null,'the sample rules or a model only');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f()), pg_temp.pages('skipped'))$$,'23514',null,
  'no findings without a page read');
select is((select count(*)::int from public.brand_findings),0,'nothing was stored by a refused run');

select is(pg_temp.record(jsonb_build_array(pg_temp.f(),
    pg_temp.f('{"topic":"free_shipping","statement":"Free shipping over $75.","value":{"kind":"over","amount":75,"currency":"USD"},
      "evidence":{"url":"https://www.cedar-lane.example/","quote":"Free shipping on orders over $75.","page":"home"},"pass":"model","model":"gemini-2.5-flash"}'))),
  '{"pages": 2, "findings": 2}'::jsonb,'a run''s findings are stored at once');
select is((select string_agg(topic||':'||confidence||':'||pass||':'||coalesce(model,'-'),',' order by topic) from public.brand_findings
    where run_id=current_setting('test.job')::uuid and source='site' and superseded_at is null),
  'free_shipping:0.70:model:gemini-2.5-flash,returns:0.70:sample:-','with their source, confidence, pass and model');
select is((select status||'/'||(checkpoint->>'findings')||'/'||(checkpoint->>'live')||'/'||jsonb_array_length(checkpoint->'pages')
    from public.job_runs where id=current_setting('test.job')::uuid),'succeeded/2/false/2','and the job is finished with the pages');
select throws_ok($$select pg_temp.record('[]')$$,'PT409',null,'a finished job records nothing more');

-- A newer run replaces the site's findings; a run that read nothing does not.
reset role;
insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by)
  values ('00000000-0000-4000-8000-000000000101','brand.read_site','brand.read_site:test:2','{"domain":"cedar-lane.example"}',
    '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000101','brand.read_site','brand.read_site:test:3','{"domain":"cedar-lane.example"}',
    '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000101','commerce.sync','test:other','{}','00000000-0000-4000-8000-000000000001');
select set_config('test.job2',(select id::text from public.job_runs where idempotency_key='brand.read_site:test:2'),true);
select set_config('test.job3',(select id::text from public.job_runs where idempotency_key='brand.read_site:test:3'),true);
select set_config('test.other',(select id::text from public.job_runs where idempotency_key='test:other'),true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.job2','test.job3','test.other']) x;
set local role service_role;
select throws_ok($$select pg_temp.record('[]', pg_temp.pages(), current_setting('test.other'))$$,'23514',null,
  'another kind of job cannot record site findings');
select is(pg_temp.record('[]', pg_temp.pages('skipped'), current_setting('test.job2')),'{"pages": 2, "findings": 0}'::jsonb,
  'a run that read no page is finished');
select is((select count(*)::int from public.brand_findings where superseded_at is null),2,'and replaces nothing');
select is(pg_temp.record(jsonb_build_array(pg_temp.f('{"value":{"days":60},"statement":"Returns within 60 days."}')),
    pg_temp.pages(), current_setting('test.job3')),'{"pages": 2, "findings": 1}'::jsonb,'a newer run');
select is((select string_agg(topic||':'||(superseded_at is null),',' order by created_at, topic) from public.brand_findings),
  'free_shipping:false,returns:false,returns:true','replaces the site''s earlier findings');
reset role;

-- Members read their own workspace's findings.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select statement from public.brand_findings where superseded_at is null),'Returns within 60 days.',
  'staff of the workspace read its current findings');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.brand_findings),0,'another workspace reads none');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.brand_findings$$,'42501',null,'anonymous visitors cannot read them');
reset role;

select * from finish();
rollback;
