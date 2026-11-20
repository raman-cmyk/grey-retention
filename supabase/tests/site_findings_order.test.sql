begin;
select plan(39);

-- ONB-SITEb: a site read that finishes after a newer one. Workspace 101
-- reads cedar-lane.example, workspace 102 north-studio.example (the seed's
-- synthetic brands, each its saved website). Each read is asked for at its
-- own time (its age); for each kind of page the newest read of it wins,
-- whatever order the reads finish in, and a read of a website the brand no
-- longer has never makes its findings current.
create function pg_temp.job(tenant text, key text, domain text, age interval) returns uuid language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_site',key,jsonb_build_object('domain',domain),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id
$$;
create function pg_temp.lease(j uuid) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute'
    where id=j
$$;
create function pg_temp.url(host text, page text) returns text language sql as $$
  select 'https://'||host||case when page = 'home' then '/' else '/pages/'||page end
$$;
-- The pages a read read, one of each kind given.
create function pg_temp.pages(host text, variadic kinds text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('url',pg_temp.url(host,k),'kind',k,'state','read')), '[]'::jsonb) from unnest(kinds) k
$$;
-- One finding from a page, its statement its quote.
create function pg_temp.fd(host text, page text, topic text, statement text, value jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic',topic,'statement',statement,'value',value,
    'evidence',jsonb_build_object('url',pg_temp.url(host,page),'quote',statement,'page',page),
    'confidence',0.8,'pass','sample','model',null)
$$;
create function pg_temp.record(j uuid, findings jsonb, pages jsonb) returns jsonb language sql as $$
  select public.record_site_findings(j,'00000000-0000-4000-8000-00000000aaaa',findings,pages,false)
$$;
-- What a workspace's current site findings say, page by page.
create function pg_temp.current(tenant text) returns text language sql as $$
  select coalesce(string_agg(evidence->>'page'||': '||statement, ' | ' order by evidence->>'page', statement), '')
    from public.brand_findings where tenant_id=tenant::uuid and source='site' and superseded_at is null
$$;

-- The command is the same command: the worker's only, security definer,
-- with an empty search path.
select ok((select prosecdef and 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'public.record_site_findings(uuid,uuid,jsonb,jsonb,boolean)'::regprocedure),
  'record_site_findings runs as its owner with an empty search path');
select ok(not bool_or(has_function_privilege(r,'public.record_site_findings(uuid,uuid,jsonb,jsonb,boolean)','execute'))
  and has_function_privilege('service_role','public.record_site_findings(uuid,uuid,jsonb,jsonb,boolean)','execute'),
  'only the worker records findings') from unnest(array['anon','authenticated','public']) r;

select set_config('test.r0',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:0','cedar-lane.example','3 hours')::text,true);
select set_config('test.r1',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:1','cedar-lane.example','2 hours')::text,true);
select set_config('test.r2',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:2','cedar-lane.example','1 hour')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.r0','test.r1','test.r2']) x;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);

-- The first read: the home, shipping and returns pages.
select is(pg_temp.record(current_setting('test.r0')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','home','free_shipping','Free shipping over $75.','{"kind":"over","amount":75,"currency":"USD"}'),
    pg_temp.fd('cedar-lane.example','shipping','shipping','We ship from Portland.'),
    pg_temp.fd('cedar-lane.example','returns','returns','Returns within 30 days.','{"days":30}')),
  pg_temp.pages('cedar-lane.example','home','shipping','returns')),'{"pages": 3, "findings": 3}'::jsonb,'the first read');
-- A newer read reads the home and returns pages, and finds nothing on the home page.
select is(pg_temp.record(current_setting('test.r2')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','returns','returns','Returns within 60 days.','{"days":60}')),
  pg_temp.pages('cedar-lane.example','home','returns')),'{"pages": 2, "findings": 1}'::jsonb,'a newer read');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),
  'returns: Returns within 60 days. | shipping: We ship from Portland.',
  'it replaces what the pages it read said, a page found empty too');

-- A read started between them finishes last: home, returns, about and shipping.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.r1')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','home','free_shipping','Free shipping over $50.','{"kind":"over","amount":50,"currency":"USD"}'),
    pg_temp.fd('cedar-lane.example','returns','returns','Returns within 90 days.','{"days":90}'),
    pg_temp.fd('cedar-lane.example','about','tone','Warm and plain-spoken.'),
    pg_temp.fd('cedar-lane.example','shipping','shipping','We ship from Portland and Leeds.')),
  pg_temp.pages('cedar-lane.example','home','returns','about','shipping')),'{"pages": 4, "findings": 4}'::jsonb,
  'an older read that finishes late is recorded');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),
  'about: Warm and plain-spoken. | returns: Returns within 60 days. | shipping: We ship from Portland and Leeds.',
  'for the pages only it read since, its findings are current; for the pages the newer read read, the newer read''s');
select is((select string_agg(evidence->>'page', ',' order by evidence->>'page') from public.brand_findings
    where run_id = current_setting('test.r1')::uuid and superseded_at is not null),'home,returns',
  'its findings from the pages the newer read read are kept, already replaced, a page the newer read found empty too');
select is((select statement from public.brand_findings where run_id = current_setting('test.r0')::uuid and evidence->>'page' = 'shipping'
    and superseded_at is not null),'We ship from Portland.','it replaces the first read''s shipping page, older than itself');
select is((select statement from public.brand_findings where run_id = current_setting('test.r2')::uuid and superseded_at is null),
  'Returns within 60 days.','and never the newer read''s findings');
select is((select status||'/'||(checkpoint->>'findings')||'/'||jsonb_array_length(checkpoint->'pages') from public.job_runs
    where id = current_setting('test.r1')::uuid),'succeeded/4/4','the late read is finished with its pages, as before');

-- A newer read that read nothing (every page skipped) wins nothing, and a
-- read between two others replaces the older one's pages only.
select set_config('test.r3',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:3','cedar-lane.example','10 minutes')::text,true);
select set_config('test.r4',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:4','cedar-lane.example','20 minutes')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.r3','test.r4']) x;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.r3')::uuid,'[]',
    '[{"url":"https://cedar-lane.example/","kind":"home","state":"skipped","reason":"timeout"},
      {"url":"https://cedar-lane.example/pages/returns","kind":"returns","state":"skipped","reason":"timeout"}]'),
  '{"pages": 2, "findings": 0}'::jsonb,'the newest read read no page');
select is(pg_temp.record(current_setting('test.r4')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','returns','returns','Returns within 45 days.','{"days":45}')),
  pg_temp.pages('cedar-lane.example','returns')),'{"pages": 1, "findings": 1}'::jsonb,'a read older than it finishes after it');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),
  'about: Warm and plain-spoken. | returns: Returns within 45 days. | shipping: We ship from Portland and Leeds.',
  'a newer read that read no page takes nothing, and the read replaces the older reads'' returns page');

-- Only a finished read counts: one still running, or one that failed (even
-- with pages on its job), takes nothing.
select set_config('test.s1',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:s1','north-studio.example','2 hours')::text,true);
select set_config('test.s2',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:s2','north-studio.example','1 hour')::text,true);
select set_config('test.s3',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:s3','north-studio.example','30 minutes')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.s1','test.s2']) x;
update public.job_runs set status = 'failed', checkpoint = jsonb_build_object('pages', pg_temp.pages('north-studio.example','home'))
  where id = current_setting('test.s3')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.s1')::uuid, jsonb_build_array(
    pg_temp.fd('north-studio.example','home','tone','Simple and warm.')),
  pg_temp.pages('north-studio.example','home')),'{"pages": 1, "findings": 1}'::jsonb,
  'an older read finishes while a newer one still runs');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000102'),'home: Simple and warm.',
  'its findings are current: the running read and the failed one have read nothing yet');
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),
  'about: Warm and plain-spoken. | returns: Returns within 45 days. | shipping: We ship from Portland and Leeds.',
  'another workspace''s newer reads never count, nor change these');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.s2')::uuid,'[]',pg_temp.pages('north-studio.example','home')),
  '{"pages": 1, "findings": 0}'::jsonb,'the newer read finishes, its home page found empty');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000102'),'',
  'and replaces the older read''s home page, as when it finishes last');

-- The same reads finished in the other order give the same findings.
select set_config('test.t1',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:t1','north-studio.example','20 minutes')::text,true);
select set_config('test.t2',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:t2','north-studio.example','10 minutes')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.t1','test.t2']) x;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.t2')::uuid, jsonb_build_array(
    pg_temp.fd('north-studio.example','faq','contact','Write to help@north-studio.example.')),
  pg_temp.pages('north-studio.example','faq')),'{"pages": 1, "findings": 1}'::jsonb,'the newer read first');
select is(pg_temp.record(current_setting('test.t1')::uuid, jsonb_build_array(
    pg_temp.fd('north-studio.example','faq','contact','Call us any weekday.'),
    pg_temp.fd('north-studio.example','product','offering','Hand-thrown vases.')),
  pg_temp.pages('north-studio.example','faq','product')),'{"pages": 2, "findings": 2}'::jsonb,'then the older one');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000102'),
  'faq: Write to help@north-studio.example. | product: Hand-thrown vases.',
  'the newest read of each page wins');
select is((select count(*)::int from public.brand_findings where tenant_id = '00000000-0000-4000-8000-000000000102'
    and source = 'site' and superseded_at is null and run_id = current_setting('test.t1')::uuid),1,
  'the older read keeps only the page the newer one did not read');

-- A newer finished read that recorded no page at all, or whose job holds
-- no pages, takes nothing.
select set_config('test.x0',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:x0','north-studio.example','9 minutes')::text,true);
select set_config('test.x1',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:x1','north-studio.example','8 minutes')::text,true);
select set_config('test.x2',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:x2','north-studio.example','7 minutes')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.x0','test.x1']) x;
update public.job_runs set status = 'succeeded', checkpoint = '{"findings": 0}' where id = current_setting('test.x2')::uuid;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.x1')::uuid,'[]','[]'),'{"pages": 0, "findings": 0}'::jsonb,
  'a newer read is recorded with no page at all');
select is(pg_temp.record(current_setting('test.x0')::uuid, jsonb_build_array(
    pg_temp.fd('north-studio.example','home','tone','Calm and kind.')),
  pg_temp.pages('north-studio.example','home')),'{"pages": 1, "findings": 1}'::jsonb,
  'an older read finishes after it, and after one whose job holds no pages');
reset role;
select is((select statement from public.brand_findings where run_id = current_setting('test.x0')::uuid and superseded_at is null),
  'Calm and kind.','neither of them takes its home page');

-- The website changes. In order: the new website's read replaces every
-- finding of the old one, from the pages it did not read too.
select set_config('test.w0',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:w0','cedar-lane.example','8 minutes')::text,true);
-- The old website's read of the day, which failed.
select set_config('test.wa',pg_temp.job('00000000-0000-4000-8000-000000000101',
  'brand.read_site:cedar-lane.example:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),'cedar-lane.example','7 minutes')::text,true);
update public.job_runs set status = 'failed', attempt = 4 where id = current_setting('test.wa')::uuid;
update public.brand_profiles set domain = 'cedar-lane-two.example' where tenant_id = '00000000-0000-4000-8000-000000000101';
select set_config('test.w1',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:w1','cedar-lane-two.example','5 minutes')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.w0','test.w1']) x;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.w1')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane-two.example','home','tone','Bright and quick.')),
  pg_temp.pages('cedar-lane-two.example','home')),'{"pages": 1, "findings": 1}'::jsonb,'the new website''s read');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),'home: Bright and quick.',
  'it replaces every finding of the old website, its about, returns and shipping pages too');
-- Late: a read of the old website finishing after it.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.w0')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','faq','contact','Write to help@cedar-lane.example.'),
    pg_temp.fd('cedar-lane.example','shipping','shipping','We ship from Leeds.')),
  pg_temp.pages('cedar-lane.example','faq','shipping')),'{"pages": 2, "findings": 2}'::jsonb,
  'a late read of the old website is recorded');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),'home: Bright and quick.',
  'it replaces nothing of the website saved now');
select is((select count(*)::int from public.brand_findings where run_id = current_setting('test.w0')::uuid and superseded_at is null),0,
  'and its own findings are all kept, already replaced');
-- Back to the first website the same day: its failed read is asked for
-- again, keeping its row and so its first time, older than the other
-- website's read.
update public.brand_profiles set domain = 'cedar-lane.example' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.start_site_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.wa'),
  'the first website''s read of the day is asked for again');
reset role;
select is((select status||'/'||(created_at < (select created_at from public.job_runs where id = current_setting('test.w1')::uuid))
    from public.job_runs where id = current_setting('test.wa')::uuid),'queued/true',
  'queued again, still older than the other website''s read');
select pg_temp.lease(current_setting('test.wa')::uuid);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.wa')::uuid, jsonb_build_array(
    pg_temp.fd('cedar-lane.example','home','tone','Warm and calm.'),
    pg_temp.fd('cedar-lane.example','about','offering','Everyday layers.')),
  pg_temp.pages('cedar-lane.example','home','about')),'{"pages": 2, "findings": 2}'::jsonb,'it finishes');
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),'about: Everyday layers. | home: Warm and calm.',
  'its findings are current: the other website''s newer read takes none of its pages');
select is((select count(*)::int from public.brand_findings where run_id = current_setting('test.w1')::uuid and superseded_at is null),0,
  'and the other website''s findings are replaced');

-- One pair of reads, finished in both orders: workspace 101 finishes the
-- newer one first, workspace 102 the older one first. Earlier findings
-- are cleared, so only the pair is compared.
update public.brand_findings set superseded_at = now() where source = 'site' and superseded_at is null
  and tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
create function pg_temp.older(host text) returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.fd(host,'faq','contact','Call us any weekday.'),
    pg_temp.fd(host,'product','offering','Hand-made vases.'))
$$;
create function pg_temp.newer(host text) returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.fd(host,'faq','contact','Write to us any time.'),
    pg_temp.fd(host,'about','audience','For quiet homes.'))
$$;
select set_config('test.p1a',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:p1','cedar-lane.example','2 minutes')::text,true);
select set_config('test.p2a',pg_temp.job('00000000-0000-4000-8000-000000000101','brand.read_site:order:p2','cedar-lane.example','1 minute')::text,true);
select set_config('test.p1b',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:p1','north-studio.example','2 minutes')::text,true);
select set_config('test.p2b',pg_temp.job('00000000-0000-4000-8000-000000000102','brand.read_site:order:p2','north-studio.example','1 minute')::text,true);
select pg_temp.lease(current_setting(x)::uuid) from unnest(array['test.p1a','test.p2a','test.p1b','test.p2b']) x;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.record(current_setting('test.p2a')::uuid,pg_temp.newer('cedar-lane.example'),
  pg_temp.pages('cedar-lane.example','faq','about'));
select pg_temp.record(current_setting('test.p1a')::uuid,pg_temp.older('cedar-lane.example'),
  pg_temp.pages('cedar-lane.example','faq','product'));
select pg_temp.record(current_setting('test.p1b')::uuid,pg_temp.older('north-studio.example'),
  pg_temp.pages('north-studio.example','faq','product'));
select pg_temp.record(current_setting('test.p2b')::uuid,pg_temp.newer('north-studio.example'),
  pg_temp.pages('north-studio.example','faq','about'));
reset role;
select is(pg_temp.current('00000000-0000-4000-8000-000000000101'),pg_temp.current('00000000-0000-4000-8000-000000000102'),
  'the same reads finished in both orders give the same findings');
select is(pg_temp.current('00000000-0000-4000-8000-000000000102'),
  'about: For quiet homes. | faq: Write to us any time. | product: Hand-made vases.','the newest read of each page');

-- A lost lease records nothing, as before.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select pg_temp.record(current_setting('test.r1')::uuid,'[]','[]')$$,'PT409',null,'a finished read records nothing more');
reset role;

select * from finish();
rollback;
