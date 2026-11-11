begin;
select plan(86);

-- ONB-101: onboarding findings and the Site reader's job. Owner ...01 and
-- staff ...05 are in workspace 101 (cedar-lane.example); owner ...04 runs
-- workspace 102 (north-studio.example).
create function pg_temp.f(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','returns','statement','Returns within 30 days.','value',jsonb_build_object('days',30),
    'evidence',jsonb_build_object('url','https://CEDAR-LANE.example/pages/returns','quote','Return any unworn item within 30 days.','page','returns'),
    'confidence',0.704,'pass','sample','model',null) || extra
$$;
create function pg_temp.ev(url text, page text default 'returns') returns jsonb language sql as $$
  select jsonb_build_object('evidence', jsonb_build_object('url', url, 'quote', 'x', 'page', page))
$$;
create function pg_temp.pages(state text default 'read', host text default 'cedar-lane.example') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('url','https://'||host||'/','kind','home','state',state,'findings',1),
    jsonb_build_object('url','https://'||host||'/pages/returns','kind','returns','state',state),
    jsonb_build_object('url','https://'||host||'/pages/faq','kind','faq','state','skipped','reason','timeout'))
$$;
create function pg_temp.lease(j uuid) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute' where id=j
$$;
create function pg_temp.record(findings jsonb, pages jsonb default pg_temp.pages(), job text default current_setting('test.job')) returns jsonb language sql as $$
  select public.record_site_findings(job::uuid,'00000000-0000-4000-8000-00000000aaaa',findings,pages,false)
$$;
create function pg_temp.job(tenant text, key text, domain text, age interval default '0') returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_site',key,jsonb_build_object('domain',domain),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id::text
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

-- One value shape per topic, never null.
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

-- The owner starts a read, at most once a day, of the plain domain.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.job',public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'asking again the same day returns the same job');
reset role;
update public.brand_profiles set domain = ' WWW.Cedar-Lane.example' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select is(public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'a website saved with www. is the same site');
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
update public.brand_profiles set domain = '169.254.169.254' where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select throws_ok($$select public.start_site_reading('00000000-0000-4000-8000-000000000102')$$,'23514',null,
  'a website is a name, never an address');
reset role;
select is((select kind||'/'||status||'/'||(input->>'domain') from public.job_runs where id=current_setting('test.job')::uuid),
  'brand.read_site/queued/cedar-lane.example','the job is queued with the plain domain it reads');

-- Recording a run: only well-formed findings from the brand's own pages read now.
select pg_temp.lease(current_setting('test.job')::uuid);
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.record('[]')$$,'42501',null,'the worker needs its role in the token');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.record_site_findings(current_setting('test.job')::uuid,gen_random_uuid(),'[]','[]',false)$$,
  'PT409',null,'a wrong lease records nothing');
select throws_ok($$select pg_temp.record('{}')$$,'23514',null,'findings are a list');
select throws_ok($$select pg_temp.record((select jsonb_agg(pg_temp.f()) from generate_series(1,201)))$$,'23514',null,'at most 200');
select throws_ok($$select pg_temp.record('[]', (select jsonb_agg(pg_temp.pages()->0) from generate_series(1,9)))$$,'23514',null,'at most 8 pages');
select throws_ok($$select pg_temp.record('[]', '[{"url":"https://cedar-lane.example/","kind":"cart","state":"read"}]')$$,'23514',null,
  'only the pages the reader reads');
select throws_ok($$select pg_temp.record('[]', pg_temp.pages('read','other.example'))$$,'23514',null,'pages are on the brand''s own host');
select throws_ok($$select pg_temp.record('[]', '[{"url":"https://cedar-lane.example/","kind":"home","state":"read","note":"x"}]')$$,'23514',null,
  'a page says only what it was');
select throws_ok(format('select pg_temp.record(jsonb_build_array(pg_temp.f(pg_temp.ev(%L))))', u),'23514',null,'evidence: '||u)
  from unnest(array['https://other.example/pages/returns','http://cedar-lane.example/pages/returns',
    'https://cedar-lane.example.evil.com/','https://cedar-lane.example@evil.example/','https://evil.example@cedar-lane.example/',
    'https://cedar-lane.example:8443/pages/returns','https://evilcedar-lane.example/pages/returns']) u;
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(pg_temp.ev('https://cedar-lane.example/pages/faq','faq'))))$$,
  '23514',null,'evidence cites a page this run read');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('evidence',
  jsonb_build_object('url','https://cedar-lane.example/','quote',repeat('x',301),'page','home')))))$$,'23514',null,'a quote is short');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"value":{"days":"thirty"}}')))$$,'23514',null,
  'a value has its topic''s shape');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"topic":"review_platform","value":{"name":"Judge.me","verified":true}}')))$$,
  '23514',null,'the site cannot state a review platform');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f() - 'topic'))$$,'23514',null,'a finding has a topic');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"note":"x"}')))$$,'23514',null,'and nothing it should not');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f('{"pass":"owner"}')))$$,'23514',null,'the sample rules or a model only');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f()), pg_temp.pages('skipped'))$$,'23514',null,
  'no findings without a page read');
select is((select count(*)::int from public.brand_findings),0,'nothing was stored by a refused run');

select is(pg_temp.record(jsonb_build_array(pg_temp.f(),
    pg_temp.f('{"topic":"free_shipping","statement":"Free shipping over $75.","value":{"kind":"over","amount":75,"currency":"USD"},
      "evidence":{"url":"https://shop.cedar-lane.example/","quote":"Free shipping on orders over $75.","page":"home"},"pass":"model","model":"gemini-2.5-flash"}'))),
  '{"pages": 3, "findings": 2}'::jsonb,'a run''s findings are stored at once, from the brand''s own subdomains too');
select is((select string_agg(topic||':'||confidence||':'||pass||':'||coalesce(model,'-'),',' order by topic) from public.brand_findings
    where run_id=current_setting('test.job')::uuid and source='site' and superseded_at is null),
  'free_shipping:0.70:model:gemini-2.5-flash,returns:0.70:sample:-','with their source, confidence, pass and model');
select is((select status||'/'||(checkpoint->>'findings')||'/'||(checkpoint->>'live')||'/'||jsonb_array_length(checkpoint->'pages')
    from public.job_runs where id=current_setting('test.job')::uuid),'succeeded/2/false/3','and the job is finished with the pages');
select throws_ok($$select pg_temp.record('[]')$$,'PT409',null,'a finished job records nothing more');
reset role;

-- Another workspace's runs.
select set_config('test.other',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:test:102','north-studio.example'),true);
select pg_temp.lease(current_setting('test.other')::uuid);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f()), pg_temp.pages('read','north-studio.example'), current_setting('test.other'))$$,
  '23514',null,'a workspace''s run cannot store another brand''s pages');
select is(pg_temp.record(jsonb_build_array(pg_temp.f(pg_temp.ev('https://north-studio.example/pages/returns'))),
    pg_temp.pages('read','north-studio.example'), current_setting('test.other')),'{"pages": 3, "findings": 1}'::jsonb,
  'it stores its own');
reset role;

-- Later runs: a run replaces the findings from the kinds of page it read.
select set_config('test.job2',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:2','cedar-lane.example'),true);
select set_config('test.job3',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:3','cedar-lane.example'),true);
select set_config('test.job4',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:4','cedar-lane.example','1 hour'),true);
select set_config('test.job5',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:5','cedar-lane.example'),true);
insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by)
  values ('00000000-0000-4000-8000-000000000101','commerce.sync','test:sync','{}','00000000-0000-4000-8000-000000000001');
select set_config('test.sync',(select id::text from public.job_runs where idempotency_key='test:sync'),true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.job2','test.job3','test.job4','test.job5','test.sync']) x;
update public.job_runs set lease_until = now() - interval '1 second' where id = current_setting('test.job5')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select pg_temp.record('[]', pg_temp.pages(), current_setting('test.sync'))$$,'23514',null,
  'another kind of job cannot record site findings');
select throws_ok($$select pg_temp.record('[]', pg_temp.pages(), current_setting('test.job5'))$$,'PT409',null,
  'an expired lease records nothing');
select is(pg_temp.record('[]', pg_temp.pages('skipped'), current_setting('test.job2')),'{"pages": 3, "findings": 0}'::jsonb,
  'a run that read no page is finished');
select is((select count(*)::int from public.brand_findings where superseded_at is null and tenant_id='00000000-0000-4000-8000-000000000101'),2,
  'and replaces nothing');
select is(pg_temp.record(jsonb_build_array(pg_temp.f('{"value":{"days":60},"statement":"Returns within 60 days."}')),
    pg_temp.pages(), current_setting('test.job3')),'{"pages": 3, "findings": 1}'::jsonb,'a newer run');
select is((select string_agg(topic||':'||(superseded_at is null),',' order by superseded_at is null, topic) from public.brand_findings
    where tenant_id='00000000-0000-4000-8000-000000000101'),
  'free_shipping:false,returns:false,returns:true','replaces what the pages it read said earlier');
select is(pg_temp.record(jsonb_build_array(pg_temp.f('{"value":{"days":90},"statement":"Returns within 90 days."}')),
    pg_temp.pages(), current_setting('test.job4')),'{"pages": 3, "findings": 1}'::jsonb,'an older run that finishes later');
select is((select statement from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101' and superseded_at is null),
  'Returns within 60 days.','does not replace the newer findings');
select is((select count(*)::int from public.brand_findings where run_id=current_setting('test.job4')::uuid and superseded_at is not null),1,
  'its own are kept, already replaced');
reset role;
select set_config('test.job6',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:6','cedar-lane.example'),true);
select pg_temp.lease(current_setting('test.job6')::uuid);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record('[]','[{"url":"https://cedar-lane.example/pages/faq","kind":"faq","state":"read","findings":0}]',
    current_setting('test.job6')),'{"pages": 1, "findings": 0}'::jsonb,'a run that read only the help page');
select is((select statement from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101' and superseded_at is null),
  'Returns within 60 days.','keeps what the other pages said');
select is((select count(*)::int from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000102' and superseded_at is null),1,
  'and the other workspace''s findings are untouched');
reset role;

-- Site reads are never taken by the workspace jobs (an owner's "Run jobs"
-- or the sweep), only by the readers' run, as the worker.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot claim or count site reads')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.claim_site_reading()','public.site_readings_waiting()']) f;
select set_config('test.r1',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:test:r1','cedar-lane.example'),true);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not exists (select 1 from generate_series(1,10) g, lateral public.claim_job('00000000-0000-4000-8000-000000000101') c
    where c.kind = 'brand.read_site'),'the workspace jobs never take a site read');
select ok(public.site_readings_waiting() >= 1,'the readers'' run sees the reads waiting');
select is((select kind||'/'||status from public.claim_site_reading()),'brand.read_site/running','and takes the next one as the worker');
select isnt((select lease_until < now() and status = 'running' from public.job_runs where id = current_setting('test.job5')::uuid),true,
  'a read whose lease ran out is taken back');
reset role;
-- A paused workspace's read waits; a read whose lease ran out on its fourth
-- try is failed, not tried again.
select set_config('test.r2',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:test:r2','north-studio.example','2 hours'),true);
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000102';
update public.job_runs set status = 'running', attempt = 4, lease_token = gen_random_uuid(), lease_until = now() - interval '1 second'
  where id = current_setting('test.r1')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not exists (select 1 from generate_series(1,5) g, lateral public.claim_site_reading() c
    where c.tenant_id = '00000000-0000-4000-8000-000000000102'),'a paused workspace''s read waits');
select is((select status from public.job_runs where id = current_setting('test.r1')::uuid),'failed',
  'a read whose lease ran out on its fourth try is failed');
reset role;
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000102';
update public.job_runs set status = 'failed', attempt = 4 where id = current_setting('test.job')::uuid;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'asking again after a failed read the same day');
reset role;
select is((select status||'/'||attempt from public.job_runs where id = current_setting('test.job')::uuid),'queued/0',
  'starts it again with all its tries');

-- Members read their own workspace's findings.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select string_agg(statement, ',') from public.brand_findings where superseded_at is null),'Returns within 60 days.',
  'staff of the workspace read its current findings, and only those');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'another workspace reads none of them');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.brand_findings$$,'42501',null,'anonymous visitors cannot read them');
reset role;

select * from finish();
rollback;
