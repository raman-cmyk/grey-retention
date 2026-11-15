begin;
select plan(37);

-- DST-001b: a designed section drawn to a picture by a browser outside the
-- app. Workspace 101: owner ...01; another workspace: owner ...04.
create function pg_temp.sec(h int default 320) returns jsonb language sql as $$
  select jsonb_build_object('id','s2','height',h,'html','<h1>Meet the cedar tray</h1>','css','')
$$;
create function pg_temp.req(k text, s jsonb default pg_temp.sec(), o text[] default array['https://cdn.shop.example']) returns uuid language sql as $$
  select public.request_section_render(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, k, s, o)
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot ask for, record or fail a render')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.request_section_render(uuid,uuid,text,jsonb,text[])','public.record_section_render(uuid,uuid,integer,integer)',
                    'public.fail_section_render(uuid,uuid,text)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'jobs do')
  from unnest(array['public.request_section_render(uuid,uuid,text,jsonb,text[])','public.record_section_render(uuid,uuid,integer,integer)',
                    'public.fail_section_render(uuid,uuid,text)']) f;
select ok(not bool_or(has_function_privilege(r, 'private.leased_section_render(uuid,uuid)', 'execute')),'the lease helper is not callable')
  from unnest(array['anon','authenticated','service_role']) r;
select ok(not bool_or(has_table_privilege(r, 'public.section_renders', p)),'nobody writes renders but the commands')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select is((select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id='studio-renders'),
  'false:3145728:image/jpeg','the pictures are private JPEGs of at most 3 MiB');

-- A build of workspace 101 on its sections step.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e401','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'))),
   '00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e401',0)::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select throws_ok($$select pg_temp.req('s2-r1')$$,'PT409','Only the design step draws sections','a build draws sections only on its design step');
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"sendAt":"2027-01-01T10:00:00Z"}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{"locked":true}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Meet the cedar tray"}}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);

-- What it takes.
select throws_ok($$select public.request_section_render(current_setting('test.build')::uuid,gen_random_uuid(),'s2-r1',pg_temp.sec(),array['https://cdn.shop.example'])$$,
  'PT409','Lease unavailable','only under the build''s own lease');
select throws_ok($$select pg_temp.req('S2 r1')$$,'22023','A render has no usable key','a usable key');
select throws_ok($$select pg_temp.req('s2-r1','{"id":"s2"}')$$,'22023',null,'a section with its height');
select throws_ok($$select pg_temp.req('s2-r1',pg_temp.sec(2000))$$,'22023',null,'of a usable height');
select throws_ok($$select pg_temp.req('s2-r1',pg_temp.sec(),array['http://cdn.shop.example'])$$,'22023','A render loads from https origins only','https origins only');
select throws_ok($$select pg_temp.req('s2-r1',pg_temp.sec(),array['https://cdn.shop.example:8443'])$$,'22023',null,'with no port');
select throws_ok($$select pg_temp.req('s2-r1',pg_temp.sec(),array[]::text[])$$,'22023',null,'and at least one');

-- Asked for once: one render and one job, the same key again is the same render.
select set_config('test.r1',pg_temp.req('s2-r1')::text,true);
select is(pg_temp.req('s2-r1')::text,current_setting('test.r1'),'the same key again is the same render');
select is((select state || ':' || tenant_id from public.section_renders where id=current_setting('test.r1')::uuid),
  'queued:00000000-0000-4000-8000-000000000101','it is queued for the build''s workspace');
select is((select count(*)::int from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r1')),1,'with one render job');

-- Drawn: only with its stored picture, at the section's size.
select set_config('test.job',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r1')),true);
select set_config('test.jl',(select lease_token::text from public.claim_platform_job(array['studio.render'])),true);
select throws_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,640,1000)$$,
  'PT409','Stored picture missing','a picture is recorded only once it is stored');
insert into storage.objects(bucket_id, name) values ('studio-renders','render/'||current_setting('test.r1')||'.jpg');
select throws_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,600,1000)$$,
  '23514','The picture is not the section''s size','at twice the section''s height');
select throws_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,640,4000000)$$,
  '23514',null,'and at most 3 MiB');
select throws_ok($$select public.record_section_render(current_setting('test.job')::uuid,gen_random_uuid(),640,1000)$$,
  'PT409',null,'under the job''s own lease');
select lives_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,640,1000)$$,'the picture is recorded');
select is((select state || ':' || path || ':' || height || ':' || bytes from public.section_renders where id=current_setting('test.r1')::uuid),
  'drawn:render/'||current_setting('test.r1')||'.jpg:640:1000','the render is drawn');
select is((select status from public.platform_jobs where id=current_setting('test.job')::uuid),'succeeded','and its job is done');
select throws_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,640,1000)$$,
  'PT409',null,'a finished render is recorded once');

-- A section the browser refuses fails at once.
select set_config('test.r2',pg_temp.req('s2-r2')::text,true);
select set_config('test.job',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r2')),true);
select set_config('test.jl',(select lease_token::text from public.claim_platform_job(array['studio.render'])),true);
select throws_ok($$select public.fail_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'gone')$$,'23514','Invalid failure','a known failure only');
select lives_ok($$select public.fail_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'refused')$$,'a refused section is failed');
select is((select state || ':' || failure from public.section_renders where id=current_setting('test.r2')::uuid),'failed:refused','at once');
select is((select status || ':' || (result->>'failure') from public.platform_jobs where id=current_setting('test.job')::uuid),'succeeded:refused','its job is done, with the reason');

-- A timeout is tried again, and fails with the job's last attempt.
select set_config('test.r3',pg_temp.req('s2-r3')::text,true);
select set_config('test.job',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r3')),true);
select set_config('test.jl',(select lease_token::text from public.claim_platform_job(array['studio.render'])),true);
select public.fail_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'timeout');
select is((select r.state || ':' || j.status || ':' || j.last_error_code from public.section_renders r, public.platform_jobs j
  where r.id=current_setting('test.r3')::uuid and j.id=current_setting('test.job')::uuid),'queued:retry_wait:render_timeout','a timeout is tried again');
reset role;
update public.platform_jobs set attempt = 3, available_at = now() where id=current_setting('test.job')::uuid;
set local role service_role;
select set_config('test.jl',(select lease_token::text from public.claim_platform_job(array['studio.render'])),true);
select public.fail_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,'failed');
select is((select r.state || ':' || r.failure || ':' || j.status from public.section_renders r, public.platform_jobs j
  where r.id=current_setting('test.r3')::uuid and j.id=current_setting('test.job')::uuid),'failed:failed:failed','the last attempt fails the render');

-- At most 12 renders a build.
select lives_ok($$select pg_temp.req('s3-r' || n) from generate_series(1,9) n$$,'up to 12 renders a build');
select throws_ok($$select pg_temp.req('s4-r1')$$,'22023','This build drew too many sections','and no more');
reset role;

-- Who sees them: the workspace's members, never another workspace.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.section_renders where build_id=current_setting('test.build')::uuid),12,'the workspace''s members see its renders');
select is((select count(*)::int from storage.objects where bucket_id='studio-renders' and name='render/'||current_setting('test.r1')||'.jpg'),1,'and their pictures');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.section_renders),0,'another workspace sees none');
select is((select count(*)::int from storage.objects where bucket_id='studio-renders'),0,'nor their pictures');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.section_renders$$,'42501',null,'nobody signed out reads renders');
reset role;

select * from finish();
rollback;
