begin;
select plan(21);

-- DES-ENGINE-004b: a Scratch build asks for its copy from library blocks
-- it may use; owners and admins hide a layout for their workspace.
-- Workspace 101: owner ...01, staff ...05, admin ...06; workspace 102: owner ...04.
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_job() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.bp() returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 0, 'bottom', 0),
    'sections', jsonb_build_array(jsonb_build_object('ordinal', 1, 'kind', 'hero', 'unsupported', null, 'background', null,
      'items', '[]'::jsonb)))
$$;
create function pg_temp.block(n int, t uuid default null, quality text default 'passed') returns uuid language sql as $$
  insert into public.library_blocks(tenant_id, source, version, fingerprint, kind, roles, facts, blueprint, quality, failure, uses)
    values (t, case when t is null then 'inbox' else 'upload' end, 1, left(encode(extensions.digest('sb-' || n, 'sha256'), 'hex'), 32),
      'hero', '{headline}', '{}', pg_temp.bp(), quality, case when quality = 'failed' then 'not_alike' end, 1)
  returning id
$$;
create function pg_temp.lease(build uuid) returns uuid language sql as $$
  select c.lease_token from public.claim_email_build(build) c
$$;
create function pg_temp.to_design(build uuid) returns uuid language plpgsql as $$
begin
  perform public.finish_email_step(build, pg_temp.lease(build), 'sections', '{"sendAt":"2027-01-01T10:00:00Z"}');
  perform public.finish_email_step(build, pg_temp.lease(build), 'content', '{"locked":true}');
  perform public.finish_email_step(build, pg_temp.lease(build), 'copy', jsonb_build_object('draft', jsonb_build_object('subject', 'Copy ' || build)));
  return pg_temp.lease(build);
end $$;

select set_config('test.a', pg_temp.block(1)::text, true);
select set_config('test.b', pg_temp.block(2)::text, true);
select set_config('test.failed', pg_temp.block(3, null, 'failed')::text, true);
select set_config('test.mine', pg_temp.block(4, '00000000-0000-4000-8000-000000000101')::text, true);
select set_config('test.theirs', pg_temp.block(5, '00000000-0000-4000-8000-000000000102')::text, true);

-- Grants.
select ok(not has_function_privilege('anon', 'public.set_library_block_hidden(uuid,uuid,boolean)', 'execute'), 'anon cannot hide');
select ok(not bool_or(has_table_privilege(r, 'public.library_block_hides', p)), 'no role writes hides directly')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_function_privilege('authenticated', 'public.request_email_copy(uuid,uuid,uuid,jsonb,integer,uuid,uuid[])', 'execute'),
  'browser roles cannot ask for copies');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'library_block_usable'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  'the usable check is private');
select throws_ok($$insert into public.email_copies(build_id, tenant_id, inbox_message_id, upload_id, blocks, input)
  values (gen_random_uuid(), '00000000-0000-4000-8000-000000000101', null, null, '{}', '{}')$$, '23514', null,
  'a copy of no block is refused');

-- Hiding a layout: owner and admin, never staff, never another workspace's block.
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok(format($$select public.set_library_block_hidden('00000000-0000-4000-8000-000000000101', %L, true)$$,
  current_setting('test.b')), '42501', null, 'staff cannot hide a layout');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select is(public.set_library_block_hidden('00000000-0000-4000-8000-000000000101', current_setting('test.b')::uuid, true), true,
  'the owner hides a shared layout');
select is(public.set_library_block_hidden('00000000-0000-4000-8000-000000000101', current_setting('test.b')::uuid, true), true,
  'twice is the same');
select throws_ok(format($$select public.set_library_block_hidden('00000000-0000-4000-8000-000000000101', %L, true)$$,
  current_setting('test.theirs')), '22023', null, 'never another workspace''s private block');
select throws_ok(format($$select public.set_library_block_hidden('00000000-0000-4000-8000-000000000101', %L, true)$$,
  current_setting('test.failed')), '22023', null, 'nor one that failed the gate');
select throws_ok(format($$select public.set_library_block_hidden('00000000-0000-4000-8000-000000000102', %L, true)$$,
  current_setting('test.a')), '42501', null, 'nor in another workspace');
select is((select count(*)::int from public.library_block_hides), 1, 'members read their own hides');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.library_block_hides), 0, 'another workspace reads none');
reset role;

-- A Scratch build asks for its copy from blocks it may use.
select set_config('test.today', ((now() at time zone (select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'))::date)::text, true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e701', '00000000-0000-4000-8000-000000000101', current_setting('test.today')::date, 'planned',
   '{"offers":[]}', '{"mode":"auto"}',
   jsonb_build_object('slots', (select jsonb_agg(jsonb_build_object('date', (current_setting('test.today')::date + 2 + i)::text,
     'time', '10:00', 'emailType', 'launch')) from generate_series(0, 3) i)),
   '00000000-0000-4000-8000-000000000001');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('test.build', public.create_email_build('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000e701', 0)::text, true);
select set_config('test.copy', public.create_email_build('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000e701', 1, 'copy')::text, true);
reset role;
select is((select mode from public.email_builds where id = current_setting('test.build')::uuid), 'scratch', 'a Scratch build');
select pg_temp.as_job();
set local role service_role;
select set_config('test.lease', pg_temp.to_design(current_setting('test.build')::uuid)::text, true);
select set_config('test.lease2', pg_temp.to_design(current_setting('test.copy')::uuid)::text, true);
select throws_ok(format($$select public.request_email_copy(%L, %L, null, '{}', 0, null, array[%L]::uuid[])$$,
  current_setting('test.copy'), current_setting('test.lease2'), current_setting('test.a')),
  'PT409', 'Only a Scratch email is built from the library', 'a Copy build is never built from blocks');
select throws_ok(format($$select public.request_email_copy(%L, %L, null, '{}', 0, null, array[%L, %L]::uuid[])$$,
  current_setting('test.build'), current_setting('test.lease'), current_setting('test.a'), current_setting('test.b')),
  'PT409', 'A library layout cannot be used', 'never a layout the workspace hid');
select throws_ok(format($$select public.request_email_copy(%L, %L, null, '{}', 0, null, array[%L]::uuid[])$$,
  current_setting('test.build'), current_setting('test.lease'), current_setting('test.theirs')),
  'PT409', 'A library layout cannot be used', 'never another workspace''s private block');
select throws_ok(format($$select public.request_email_copy(%L, %L, null, '{}', 0, null, array[%L, %L]::uuid[])$$,
  current_setting('test.build'), current_setting('test.lease'), current_setting('test.a'), current_setting('test.a')),
  '22023', 'Invalid copy input', 'each block once');
select is(public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, null, '{}', 2, null,
  array[current_setting('test.a'), current_setting('test.mine')]::uuid[])->>'state', 'queued',
  'shared and own blocks: the copy is queued');
select is((select array_length(blocks, 1) || ':' || (inbox_message_id is null and upload_id is null)::text from public.email_copies
  where build_id = current_setting('test.build')::uuid), '2:true', 'stored with its blocks, in order');
select throws_ok(format($$select public.request_email_copy(%L, %L, null, '{}', 0, null, array[%L]::uuid[])$$,
  current_setting('test.build'), current_setting('test.lease'), current_setting('test.a')),
  'PT409', 'This build copies another email', 'asked again for other blocks: refused');
reset role;

select * from finish();
rollback;
