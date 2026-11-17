begin;
select plan(24);

-- DST-004b2b: a render keeps the reference crop it was asked with and the
-- two grey-level grids the browser read. Workspace 101: owner ...01.
create function pg_temp.sec(h int default 320) returns jsonb language sql as $$
  select jsonb_build_object('id','s2','height',h,'html','<h1>Meet the cedar tray</h1>','css','')
$$;
create function pg_temp.req(k text, ref text default null) returns uuid language sql as $$
  select public.request_section_render(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, k,
    pg_temp.sec(), array['https://cdn.shop.example'], ref)
$$;
-- A grid of w × h cells, all at one grey level.
create function pg_temp.grid(w int, h int, v int default 200) returns jsonb language sql as $$
  select jsonb_build_object('width',w,'height',h,'values',(select jsonb_agg(v) from generate_series(1,w*h)))
$$;
create function pg_temp.rec(job text, lease text, g jsonb default null, rg jsonb default null) returns void language sql as $$
  select public.record_section_render(job::uuid, lease::uuid, 640, 1000, g, rg)
$$;
create function pg_temp.drawable(r text, label text default 'e') returns void language sql as $$
  insert into storage.objects(bucket_id, name, metadata) values ('studio-renders','render/'||r||'.jpg',
    jsonb_build_object('size',1000,'mimetype','image/jpeg','eTag','"'||label||'"'))
$$;

-- Grants: the new commands, as the old ones.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot ask for or record a render')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.request_section_render(uuid,uuid,text,jsonb,text[],text)',
                    'public.record_section_render(uuid,uuid,integer,integer,jsonb,jsonb)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'jobs do')
  from unnest(array['public.request_section_render(uuid,uuid,text,jsonb,text[],text)',
                    'public.record_section_render(uuid,uuid,integer,integer,jsonb,jsonb)']) f;
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('request_section_render','record_section_render') and p.pronargs in (4,5)),
  'the old commands are gone, so no call is ambiguous');
select ok(not bool_or(has_function_privilege(r, 'private.usable_grid(jsonb)', 'execute')),'the grid check is not callable')
  from unnest(array['anon','authenticated','service_role']) r;

-- A build of workspace 101 on its design step.
select set_config('test.today',((now() at time zone (select timezone from public.tenants where id='00000000-0000-4000-8000-000000000101'))::date)::text,true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e491','00000000-0000-4000-8000-000000000101',current_setting('test.today')::date,'planned',
   '{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots',jsonb_build_array(
     jsonb_build_object('date',(current_setting('test.today')::date+2)::text,'time','10:00','emailType','launch'))),
   '00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.build',public.create_email_build('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e491',0,'copy')::text,true);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'sections','{"sendAt":"2027-01-01T10:00:00Z"}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'content','{"locked":true}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select public.finish_email_step(current_setting('test.build')::uuid,current_setting('test.lease')::uuid,'copy','{"draft":{"subject":"Meet the cedar tray"}}');
select set_config('test.lease',(select c.lease_token from public.claim_email_build(current_setting('test.build')::uuid) c)::text,true);
select set_config('test.crop','sect/00000000-0000-4000-8000-0000000000a1/1.jpg',true);

-- The reference: only an inbox section's own crop.
select throws_ok($$select pg_temp.req('s2-r1','shot/00000000-0000-4000-8000-0000000000a1.jpg')$$,
  '22023','A render''s reference is an inbox section''s picture','never a whole email''s screenshot');
select throws_ok($$select pg_temp.req('s2-r1','img/' || repeat('a',64) || '.png')$$,'22023',null,'nor a kept image');
select throws_ok($$select pg_temp.req('s2-r1','sect/../x.jpg')$$,'22023',null,'nor another path');

-- Asked for with its reference: kept, and part of the request.
select set_config('test.r1',pg_temp.req('s2-r1',current_setting('test.crop'))::text,true);
select is((select reference_path from public.section_renders where id=current_setting('test.r1')::uuid),current_setting('test.crop'),
  'the render keeps the crop it rebuilds');
select is(pg_temp.req('s2-r1',current_setting('test.crop'))::text,current_setting('test.r1'),'the same key, section and reference is the same render');
select throws_ok($$select pg_temp.req('s2-r1')$$,'PT409','This key is another section''s','the same key without its reference is refused');
select throws_ok($$select pg_temp.req('s2-r1','sect/00000000-0000-4000-8000-0000000000a1/2.jpg')$$,'PT409',null,
  'and with another reference');

-- Drawn with its grids: each a real grid, the reference's only with a reference.
select set_config('test.job',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r1')),true);
select set_config('test.jl',(select c.lease_token::text from public.claim_platform_job(array['studio.render']) c
  where c.subject_key=current_setting('test.r1')),true);
select pg_temp.drawable(current_setting('test.r1'));
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),'{"width":2,"height":2,"values":[1,2,3]}')$$,
  '23514','The grids are not the picture''s','a grid has one value a cell');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),'{"width":1,"height":1,"values":[300]}')$$,
  '23514',null,'each a grey level from 0 to 255');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),pg_temp.grid(300,1))$$,
  '23514',null,'at most 256 cells each way');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),'{"width":1,"height":1,"values":[12.5]}')$$,
  '23514',null,'whole grey levels only');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),'{"width":1,"height":1,"values":["a"]}')$$,
  '23514',null,'numbers only, never a cast error');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),'{"width":1.5,"height":2,"values":[1,2,3]}')$$,
  '23514',null,'a whole width');
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),
  '{"width":1,"height":1,"values":[1],"note":"x"}')$$,'23514',null,'and nothing else');
select lives_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),pg_temp.grid(48,51),pg_temp.grid(48,51,240))$$,
  'the picture is recorded with both grids');
select is((select state || ':' || (grid->>'width') || 'x' || (grid->>'height') || ':' || (reference_grid->'values'->>0)
  from public.section_renders where id=current_setting('test.r1')::uuid),'drawn:48x51:240','the render keeps them');

-- The old call (five arguments) still asks for a render with none.
select set_config('test.r2',public.request_section_render(current_setting('test.build')::uuid, current_setting('test.lease')::uuid,
  's2-r2', pg_temp.sec(), array['https://cdn.shop.example'])::text,true);
select is((select reference_path from public.section_renders where id=current_setting('test.r2')::uuid),null,'a render asked for as before has none');

-- A render with no reference takes no reference grid; one without grids is drawn as before.
select set_config('test.job',(select id::text from public.platform_jobs where kind='studio.render' and subject_key=current_setting('test.r2')),true);
select set_config('test.jl',(select c.lease_token::text from public.claim_platform_job(array['studio.render']) c
  where c.subject_key=current_setting('test.r2')),true);
select pg_temp.drawable(current_setting('test.r2'));
select throws_ok($$select pg_temp.rec(current_setting('test.job'),current_setting('test.jl'),pg_temp.grid(4,4),pg_temp.grid(4,4))$$,
  '23514','The grids are not the picture''s','no reference grid without a reference');
select lives_ok($$select public.record_section_render(current_setting('test.job')::uuid,current_setting('test.jl')::uuid,640,1000)$$,
  'a picture is recorded without grids, as before');
select is((select state || ':' || coalesce(grid::text,'none') from public.section_renders where id=current_setting('test.r2')::uuid),
  'drawn:none','and has none (its match is not measured)');
reset role;

select * from finish();
rollback;
