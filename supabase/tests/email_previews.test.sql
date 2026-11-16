begin;
select plan(59);

-- DST-005b part 2a: a whole built email drawn in the inbox's views by the
-- browser outside the app. Workspace 101: owner ...01; another workspace:
-- owner ...04; platform admin ...02.
create function pg_temp.page(words text default 'Meet the cedar tray') returns text language sql as $$
  select '<!doctype html><html><body><h1>' || words || '</h1></body></html>'
$$;
create function pg_temp.req(k text, v text default 'desktop', d text default pg_temp.page(),
  o text[] default array['https://cdn.shop.example']) returns uuid language sql as $$
  select public.request_email_render(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, k, v, d, o)
$$;
create function pg_temp.job(r text) returns text language sql as $$
  select id::text from public.platform_jobs where kind = 'studio.preview' and subject_key = r
$$;
-- Jobs made in one transaction share their time: each is claimed by its own view.
create function pg_temp.claim(r text) returns text language sql as $$
  select lease_token::text from public.claim_platform_job(array['studio.preview'], r)
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot ask for, record or fail a view')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.request_email_render(uuid,uuid,text,text,text,text[])',
                    'public.record_email_render(uuid,uuid,integer,boolean,boolean,integer)',
                    'public.fail_email_render(uuid,uuid,text)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'jobs do')
  from unnest(array['public.request_email_render(uuid,uuid,text,text,text,text[])',
                    'public.record_email_render(uuid,uuid,integer,boolean,boolean,integer)',
                    'public.fail_email_render(uuid,uuid,text)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'the helpers are not callable')
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['private.leased_email_render(uuid,uuid)','private.fail_dead_preview()']) f;
select ok(not bool_or(has_table_privilege(r, 'public.email_renders', p)),'nobody writes views but the commands')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok((select relrowsecurity from pg_class where oid = 'public.email_renders'::regclass),'row level security is on');

-- A build of workspace 101, taken to its design step.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e501','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'))),
   '00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e501',0)::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select pg_temp.req('e-r1')$$,'PT409','Only the design step draws the email','a build draws its email only on its design step');
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"sendAt":"2027-01-01T10:00:00Z"}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{"locked":true}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Meet the cedar tray"}}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);

-- What it takes.
select throws_ok($$select public.request_email_render(current_setting('test.build')::uuid,gen_random_uuid(),'e-r1','desktop',pg_temp.page(),array['https://cdn.shop.example'])$$,
  'PT409','Lease unavailable','only under the build''s own lease');
select throws_ok($$select public.request_email_render(gen_random_uuid(),current_setting('test.lease')::uuid,'e-r1','desktop',pg_temp.page(),array['https://cdn.shop.example'])$$,
  'PT409','Lease unavailable','of a build that exists');
select throws_ok($$select pg_temp.req('E r1')$$,'22023','A render has no usable key','a usable key');
select throws_ok($$select pg_temp.req('e-r1','tablet')$$,'22023','An email is drawn as desktop, phone or dark','a known view');
select throws_ok($$select pg_temp.req('e-r1','desktop','')$$,'22023','A render needs the email''s page','the email''s page');
select throws_ok($$select pg_temp.req('e-r1','desktop',repeat('x',200001))$$,'22023',null,'at most a built email''s size');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page(),array['http://cdn.shop.example'])$$,'22023','A render loads from https origins only','https origins only');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page(),array['https://cdn.shop.example:8443'])$$,'22023',null,'with no port');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page(),array['https://10.0.0.5'])$$,'22023',null,'a hostname, never an IP address');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page(),array(select 'https://h' || n || '.example' from generate_series(1,9) n))$$,
  '22023',null,'at most 8 origins');

-- Asked for once: one view and one job; the same again is the same view.
select set_config('test.r1',pg_temp.req('e-r1')::text,true);
select is(pg_temp.req('e-r1')::text,current_setting('test.r1'),'the same key, view and page again is the same view');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page('Another email'))$$,'PT409','This key is another email''s','the same key and view with another page is refused');
select throws_ok($$select pg_temp.req('e-r1','desktop',pg_temp.page(),array['https://cdn.other.example'])$$,'PT409',null,'or with other origins');
select isnt(pg_temp.req('e-r1','phone')::text,current_setting('test.r1'),'another view of the same email is its own render');
select lives_ok($$select pg_temp.req('e-r0','dark',pg_temp.page(),array[]::text[])$$,'an email with no outside picture has no origins');
select is((select state || ':' || tenant_id from public.email_renders where id=current_setting('test.r1')::uuid),
  'queued:00000000-0000-4000-8000-000000000101','it is queued for the build''s workspace');
select is((select count(*)::int from public.platform_jobs where subject_key=current_setting('test.r1')),1,'with one preview job');

-- The design studio's claim waits for a queued view, until its time is up.
reset role;
update public.email_builds set waits = 1, not_before = now() + interval '10 minutes', lease_token = null, lease_until = null,
  attempts = 0 where id = current_setting('test.build')::uuid;
set local role service_role;
select is((select count(*)::int from public.claim_studio_build(current_setting('test.build')::uuid)),0,
  'the studio waits while a view is queued');
reset role;
update public.email_builds set not_before = now() - interval '1 second' where id = current_setting('test.build')::uuid;
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_studio_build(current_setting('test.build')::uuid) c)::text,true);
select isnt(current_setting('test.lease'),'','and goes on once its time is up');

-- Drawn: only with its stored picture, at the size reported.
select set_config('test.job',pg_temp.job(current_setting('test.r1')),true);
select set_config('test.jl',pg_temp.claim(current_setting('test.r1')),true);
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,false,90000)$$,
  '23514','Stored picture missing','a picture is recorded only once it is stored');
insert into storage.objects(bucket_id, name, metadata) values ('studio-renders','email/'||current_setting('test.r1')||'.jpg',
  '{"size":90000,"mimetype":"image/jpeg","eTag":"\"v1\""}');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,false,89999)$$,
  '23514','The stored picture is not the one reported','at the size stored');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,6001,false,false,90000)$$,
  '23514','The picture is not the email''s size','at most 6,000 px tall');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,true,false,90000)$$,
  '23514','The picture is not the email''s size','cut only at the limit');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,null,false,90000)$$,
  '23514',null,'saying whether it was cut');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,null,90000)$$,
  '23514',null,'and whether it is wider than the view');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,false,4000000)$$,
  '23514','The picture is not a usable size','and at most 3 MiB');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,gen_random_uuid(),2100,false,false,90000)$$,
  'PT409',null,'under the job''s own lease');
select lives_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,false,90000)$$,'the picture is recorded');
select is((select state || ':' || path || ':' || height || ':' || cut || ':' || bytes || ':' || etag from public.email_renders where id=current_setting('test.r1')::uuid),
  'drawn:email/'||current_setting('test.r1')||'.jpg:2100:false:90000:"v1"','the view is drawn, with its stored picture''s tag');
select is((select status || ':' || (result->>'height') from public.platform_jobs where id=current_setting('test.job')::uuid),'succeeded:2100','and its job is done');
select throws_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,2100,false,false,90000)$$,
  'PT409',null,'a finished view is recorded once');

-- Cut at the limit, and said so.
select set_config('test.r2',pg_temp.req('e-r2')::text,true);
select set_config('test.job',pg_temp.job(current_setting('test.r2')),true);
reset role;
insert into storage.objects(bucket_id, name, metadata) values ('studio-renders','email/'||current_setting('test.r2')||'.jpg',
  '{"size":300000,"mimetype":"image/jpeg","eTag":"\"v2\""}');
set local role service_role;
select set_config('test.jl',pg_temp.claim(current_setting('test.r2')),true);
select lives_ok($$select public.record_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,6000,true,true,300000)$$,'an email cut at 6,000 px, and wide, is recorded');
select is((select height || ':' || cut || ':' || wide from public.email_renders where id=current_setting('test.r2')::uuid),'6000:true:true','as cut and wide');

-- A page the browser refuses fails at once; a timeout is tried again.
select set_config('test.r3',pg_temp.req('e-r3')::text,true);
select set_config('test.job',pg_temp.job(current_setting('test.r3')),true);
select set_config('test.jl',pg_temp.claim(current_setting('test.r3')),true);
select throws_ok($$select public.fail_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'gone')$$,'23514','Invalid failure','a known failure only');
select lives_ok($$select public.fail_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'navigated')$$,'a page that tried to leave is failed');
select is((select state || ':' || failure from public.email_renders where id=current_setting('test.r3')::uuid),'failed:navigated','at once');
select set_config('test.r4',pg_temp.req('e-r4')::text,true);
select set_config('test.job',pg_temp.job(current_setting('test.r4')),true);
select set_config('test.jl',pg_temp.claim(current_setting('test.r4')),true);
select public.fail_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'timeout');
select is((select r.state || ':' || j.status || ':' || j.last_error_code from public.email_renders r, public.platform_jobs j
  where r.id=current_setting('test.r4')::uuid and j.id=current_setting('test.job')::uuid),'queued:retry_wait:preview_timeout','a timeout is tried again');

-- A job that fails for good, on a lease that ran out, fails its view.
reset role;
update public.platform_jobs set available_at = now() where id=current_setting('test.job')::uuid;
set local role service_role;
select set_config('test.jl',pg_temp.claim(current_setting('test.r4')),true);
reset role;
update public.platform_jobs set attempt = 4, lease_expires_at = now() - interval '1 minute' where id=current_setting('test.job')::uuid;
set local role service_role;
select throws_ok($$select public.fail_email_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'timeout')$$,
  'PT409',null,'never under a lease that ran out');
select public.claim_platform_job(array['studio.preview'], 'no-such-view');
select is((select r.state || ':' || r.failure || ':' || j.status from public.email_renders r, public.platform_jobs j
  where r.id=current_setting('test.r4')::uuid and j.id=current_setting('test.job')::uuid),'failed:timeout:failed','a job that fails for good fails its view');

-- A section's job draws no email, and an email's job no section.
select set_config('test.sec',public.request_section_render(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'s2-r1',
  jsonb_build_object('id','s2','height',320,'html','<h1>x</h1>','css',''),array['https://cdn.shop.example'])::text,true);
select set_config('test.sjob',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.sec')),true);
select set_config('test.sl',(select lease_token::text from public.claim_platform_job(array['studio.render'], current_setting('test.sec'))),true);
select throws_ok($$select public.record_email_render(current_setting('test.sjob')::uuid,current_setting('test.sl')::uuid,2100,false,false,90000)$$,
  '23514','This job draws no email','a section''s job draws no email');
select set_config('test.r4p',pg_temp.req('e-r4','phone')::text,true);
select set_config('test.pjob',pg_temp.job(current_setting('test.r4p')),true);
select set_config('test.pl',pg_temp.claim(current_setting('test.r4p')),true);
select throws_ok($$select public.record_section_render(current_setting('test.pjob')::uuid,current_setting('test.pl')::uuid,640,1000)$$,
  '23514','This job draws no section','and an email''s job no section');

-- At most 9 views a build (7 so far).
select lives_ok($$select pg_temp.req('e-r5', v) from unnest(array['desktop','phone']) v$$,'up to 9 views a build');
select throws_ok($$select pg_temp.req('e-r6')$$,'22023','This build drew the email too often','and no more');
reset role;

-- The studio goes on at once when every picture and view it asked for is
-- drawn or failed, before its time is up.
reset role;
update public.email_renders set state = 'failed', failure = 'timeout', finished_at = now()
  where build_id = current_setting('test.build')::uuid and state = 'queued';
update public.section_renders set state = 'failed', failure = 'timeout', finished_at = now()
  where build_id = current_setting('test.build')::uuid and state = 'queued';
update public.email_builds set waits = 1, not_before = now() + interval '10 minutes', lease_token = null, lease_until = null,
  attempts = 0, updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
set local role service_role;
select is((select count(*)::int from public.claim_studio_build(current_setting('test.build')::uuid)),1,
  'the studio goes on once every view is drawn or failed');
reset role;

-- Who sees them: the workspace's members, never another workspace.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.email_renders where build_id=current_setting('test.build')::uuid),9,'the workspace''s members see its views');
select is((select count(*)::int from storage.objects where bucket_id='studio-renders' and name like 'email/%'),2,'and their pictures');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.email_renders),0,'another workspace sees none');
select is((select count(*)::int from storage.objects where bucket_id='studio-renders' and name like 'email/%'),0,'nor their pictures');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.email_renders),9,'platform admins see every view');
select is((select count(*)::int from storage.objects where bucket_id='studio-renders' and name like 'email/%'),2,'and every picture');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.email_renders$$,'42501',null,'nobody signed out reads views');
reset role;

-- A build that is deleted takes its views with it.
select lives_ok($$delete from public.email_builds where id=current_setting('test.build')::uuid$$,'a build with views can be deleted');
select is((select count(*)::int from public.email_renders where build_id=current_setting('test.build')::uuid),0,'and its views go with it');

select * from finish();
rollback;
