begin;
select plan(49);

-- DES-ENGINE-004: every section of a stored Inspiration blueprint, and of
-- a workspace's own upload, becomes a library block (structure only), one
-- block per structure with its count of uses. Workspace 101: owner ...01;
-- workspace 102: owner ...04; platform admin ...02.
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_job() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('lb-' || n, 'sha256'), 'hex') $$;
create function pg_temp.fp(n int) returns text language sql as $$ select left(pg_temp.k(1000 + n), 32) $$;
create function pg_temp.section_bp() returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 0, 'bottom', 0),
    'sections', jsonb_build_array(jsonb_build_object('ordinal', 1, 'kind', 'hero', 'unsupported', null, 'background', null,
      'items', jsonb_build_array(jsonb_build_object('type', 'text', 'role', 'headline',
        'runs', jsonb_build_array(jsonb_build_object('text', 'Xxxx xxx')))))))
$$;
create function pg_temp.block(ordinal int, fp text, quality text default 'passed', bp jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('ordinal', ordinal, 'fingerprint', fp, 'kind', 'hero', 'roles', '["headline"]'::jsonb,
    'facts', '{"height":200}'::jsonb, 'blueprint', coalesce(bp, pg_temp.section_bp()), 'quality', quality,
    'failure', case when quality = 'failed' then 'not_alike' end)
$$;
create function pg_temp.message(n int, capture text) returns uuid language sql as $$
  insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, raw_path, raw_sha256, subject,
      received_at, synthetic, state, marked_html_path, capture_id, method, email_type, industry, labels_state, labels_pass, offer_type, season, angle,
      brand_size, labels_confidence)
    select b.id, pg_temp.k(n), 1, 8000 + n, 10, 'fake/' || pg_temp.k(n), pg_temp.k(n), 'Email ' || n, now(), true, 'assigned', 'fake/' || pg_temp.k(n) || '.marked.html',
      (select id from public.competitor_captures where domain = capture), 'alias', 'launch', 'skincare', 'tagged', 'sample',
      'none', 'none', 'newness', 'small', 0.9
    from public.inbox_mailboxes b where b.key = 'fake'
  returning id
$$;
create function pg_temp.ready(message uuid) returns void language sql as $$
  insert into public.inbox_blueprints(inbox_message_id, version, state, blueprint, sections, unsupported)
    values (message, 1, 'ready', pg_temp.section_bp(), 1, 0)
$$;
create function pg_temp.claim() returns jsonb language plpgsql as $$
declare r record;
begin
  select * into r from public.claim_library_blocks();
  return case when r.id is null then null else jsonb_build_object('job', r.id, 'lease', r.lease_token, 'subject', r.subject_key,
    'tenant', r.tenant_id, 'blueprint', r.blueprint) end;
end $$;
create function pg_temp.upload(t uuid, state text) returns uuid language sql as $$
  insert into public.email_uploads (tenant_id, request_key, name, design, file_kind, byte_size, sha256, created_by, state,
      blueprint, failure, original_etag, html_etag, html_size)
    values (t, gen_random_uuid(), 'Mine', 'own', 'eml', 1, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
      (select profile_id from public.tenant_memberships where tenant_id = t and role = 'owner' limit 1), state,
      case when state = 'ready' then pg_temp.section_bp() end, case when state = 'failed' then 'not_valid' end, 'a', 'b', 1)
  returning id
$$;

-- Grants and visibility.
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'browser roles cannot claim or record blocks')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.claim_library_blocks()','public.record_library_blocks(uuid,uuid,jsonb)',
         'public.known_library_blocks(uuid,text[])','public.library_block_jobs_waiting()']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')), 'the worker can')
  from unnest(array['public.claim_library_blocks()','public.record_library_blocks(uuid,uuid,jsonb)',
    'public.known_library_blocks(uuid,text[])','public.library_block_jobs_waiting()','public.library_block_counts()']) f;
select ok(not bool_or(has_table_privilege(r, t, p)), 'no role writes blocks or their sources directly')
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['public.library_blocks','public.library_block_sources']) t,
       unnest(array['insert','update','delete','truncate']) p;
select ok(not bool_or(has_table_privilege('anon', t, 'select')), 'anon reads none')
  from unnest(array['public.library_blocks','public.library_block_sources']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.library_blocks'::regclass,
  'public.library_block_sources'::regclass)), 'row level security is on');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and (p.proname like '%library_block%' or p.proname like 'blocks_%' or p.proname like '%_blocks')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  'the helpers are private');

-- The table refuses a block with a picture or a link, whatever writes it.
select throws_ok($$insert into public.library_blocks(source, version, fingerprint, kind, roles, facts, blueprint, quality)
  values ('inbox', 1, pg_temp.fp(99), 'hero', '{headline}', '{}', pg_temp.section_bp() ||
    '{"x":{"src":"https://inbox.example/a.png"}}', 'passed')$$, '23514', null, 'a picture is refused even from the owner');
select throws_ok($$insert into public.library_blocks(tenant_id, source, version, fingerprint, kind, roles, facts, blueprint, quality)
  values (null, 'upload', 1, pg_temp.fp(98), 'hero', '{headline}', '{}', pg_temp.section_bp(), 'passed')$$, '23514', null,
  'a private block belongs to a workspace, a shared one to none');

-- A ready blueprint queues its blocks once.
select public.enqueue_inbox_poll('fake');
insert into public.competitor_captures(domain) values ('blocks-a.example'), ('blocks-b.example');
select set_config('test.m1', pg_temp.message(1, 'blocks-a.example')::text, true);
select set_config('test.m2', pg_temp.message(2, 'blocks-b.example')::text, true);
select set_config('test.m3', pg_temp.message(3, 'blocks-b.example')::text, true);
insert into public.email_sections(inbox_message_id, ordinal, html, kind, words, images, block_type, label_source, confidence,
    labelled_at, layout, purpose, styles, tag_state, tag_pass, tag_version)
  values (current_setting('test.m1')::uuid, 1, '<p>x</p>', 'design', 1, 0, 'hero_image', 'sample', 0.9, now(), 'full_width_image',
    'hook', '{bold}', 'tagged', 'sample', 'v1');
select pg_temp.ready(current_setting('test.m1')::uuid);
select is((select count(*)::int from public.platform_jobs where kind = 'design.blocks' and subject_key = 'inbox:' || current_setting('test.m1')),
  1, 'a ready blueprint queues its blocks');
insert into public.inbox_blueprints(inbox_message_id, version, state, failure) values (current_setting('test.m3')::uuid, 1, 'failed', 'too_tall');
select is((select count(*)::int from public.platform_jobs where kind = 'design.blocks' and subject_key = 'inbox:' || current_setting('test.m3')),
  0, 'a failed one queues nothing');
select pg_temp.ready(current_setting('test.m2')::uuid);

-- Only the job claims (service role), with the stored blueprint.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.claim_library_blocks()$$, '42501', null, 'an owner cannot claim');
select pg_temp.as_job();
update public.platform_jobs set available_at = now() + interval '1 day' where kind = 'design.blocks'
  and subject_key <> 'inbox:' || current_setting('test.m1');
select set_config('test.c1', pg_temp.claim()::text, true);
select is(current_setting('test.c1')::jsonb->>'subject', 'inbox:' || current_setting('test.m1'), 'the job claims its source');
select is(current_setting('test.c1')::jsonb->'blueprint', pg_temp.section_bp(), 'with the stored blueprint');
select ok((select lease_expires_at > now() + interval '4 minutes' from public.platform_jobs
  where id = (current_setting('test.c1')::jsonb->>'job')::uuid), 'leased for 5 minutes');

-- Malformed blocks are refused, nothing recorded.
select throws_ok(format($$select public.record_library_blocks(%L, %L, %L)$$, current_setting('test.c1')::jsonb->>'job',
  current_setting('test.c1')::jsonb->>'lease', jsonb_build_array(b)), '23514', null, 'a malformed block is refused')
  from unnest(array[
    pg_temp.block(1, 'nothex'), pg_temp.block(0, pg_temp.fp(1)), pg_temp.block(1, pg_temp.fp(1)) || '{"kind":"spacer"}',
    pg_temp.block(1, pg_temp.fp(1)) || '{"quality":"failed"}', pg_temp.block(1, pg_temp.fp(1), 'failed') || '{"failure":null}',
    pg_temp.block(1, pg_temp.fp(1), 'passed', pg_temp.section_bp() || '{"sections":[]}'),
    pg_temp.block(1, pg_temp.fp(1), 'passed', pg_temp.section_bp() || '{"z":{"href":"https://a.example/"}}')]) b;
select throws_ok(format($$select public.record_library_blocks(%L, gen_random_uuid(), '[]')$$,
  current_setting('test.c1')::jsonb->>'job'), 'PT409', null, 'a wrong lease records nothing');

-- Two sections of the same structure: one block, used twice.
select is(public.record_library_blocks((current_setting('test.c1')::jsonb->>'job')::uuid, (current_setting('test.c1')::jsonb->>'lease')::uuid,
  jsonb_build_array(pg_temp.block(1, pg_temp.fp(1)), pg_temp.block(2, pg_temp.fp(1)), pg_temp.block(3, pg_temp.fp(2), 'failed')))->>'new',
  '2', 'two new blocks');
select is((select uses from public.library_blocks where fingerprint = pg_temp.fp(1)), 2, 'near-identical sections are one block, used twice');
select is((select brands from public.library_blocks where fingerprint = pg_temp.fp(1)), 1, 'by one brand');
select is((select quality || '/' || failure from public.library_blocks where fingerprint = pg_temp.fp(2)), 'failed/not_alike',
  'a block that fails the gate is kept with its reason');
select is((select family || '/' || layout || '/' || purpose from public.library_blocks where fingerprint = pg_temp.fp(1)),
  'hero_image/full_width_image/hook', 'the section tagger''s labels come with it');
select is((select email_types::text || industries::text from public.library_blocks where fingerprint = pg_temp.fp(1)),
  '{launch}{skincare}', 'and its email''s labels');
select is((select status from public.platform_jobs where id = (current_setting('test.c1')::jsonb->>'job')::uuid), 'succeeded', 'the job is done');
select is((select count(*)::int from public.library_block_sources where inbox_message_id = current_setting('test.m1')::uuid), 3,
  'each section recorded once');

-- Another brand's email with the same structure: one more use, two brands;
-- a failed structure that now passes is kept.
update public.platform_jobs set available_at = now() where kind = 'design.blocks' and subject_key = 'inbox:' || current_setting('test.m2');
select set_config('test.c2', pg_temp.claim()::text, true);
select is(public.known_library_blocks(null, array[pg_temp.fp(1), pg_temp.fp(2)])::text, pg_temp.fp(1), 'the job draws only structures it does not have');
select public.record_library_blocks((current_setting('test.c2')::jsonb->>'job')::uuid, (current_setting('test.c2')::jsonb->>'lease')::uuid,
  jsonb_build_array(pg_temp.block(1, pg_temp.fp(1)), pg_temp.block(2, pg_temp.fp(2))));
select is((select uses || '/' || brands from public.library_blocks where fingerprint = pg_temp.fp(1)), '3/2', 'three uses by two brands');
select is((select quality from public.library_blocks where fingerprint = pg_temp.fp(2)), 'passed', 'a structure that now passes is kept');
select is((select count(*)::int from public.library_blocks where tenant_id is null), 2, 'still two shared blocks');

-- A retry records nothing twice.
update public.platform_jobs set status = 'leased', lease_token = (current_setting('test.c2')::jsonb->>'lease')::uuid,
  lease_expires_at = now() + interval '1 minute' where id = (current_setting('test.c2')::jsonb->>'job')::uuid;
select public.record_library_blocks((current_setting('test.c2')::jsonb->>'job')::uuid, (current_setting('test.c2')::jsonb->>'lease')::uuid,
  jsonb_build_array(pg_temp.block(1, pg_temp.fp(1))));
select is((select uses from public.library_blocks where fingerprint = pg_temp.fp(1)), 3, 'a retry adds no use');

-- A workspace's own upload: private blocks, its own scope.
reset role;
select set_config('test.u1', pg_temp.upload('00000000-0000-4000-8000-000000000101', 'measuring')::text, true);
update public.email_uploads set state = 'ready', blueprint = pg_temp.section_bp() where id = current_setting('test.u1')::uuid;
select is((select count(*)::int from public.platform_jobs where kind = 'design.blocks' and subject_key = 'upload:' || current_setting('test.u1')),
  1, 'an upload measured ready queues its blocks');
select pg_temp.as_job();
select set_config('test.c3', pg_temp.claim()::text, true);
select is(current_setting('test.c3')::jsonb->>'tenant', '00000000-0000-4000-8000-000000000101', 'with its workspace');
select public.record_library_blocks((current_setting('test.c3')::jsonb->>'job')::uuid, (current_setting('test.c3')::jsonb->>'lease')::uuid,
  jsonb_build_array(pg_temp.block(1, pg_temp.fp(1))));
select is((select count(*)::int from public.library_blocks where tenant_id = '00000000-0000-4000-8000-000000000101'), 1,
  'the same structure is a private block of its own, never a use of the shared one');
select is((select uses from public.library_blocks where fingerprint = pg_temp.fp(1) and tenant_id is null), 3, 'the shared block is unchanged');
select is(public.known_library_blocks('00000000-0000-4000-8000-000000000102', array[pg_temp.fp(1)])::text, null,
  'another workspace knows nothing of it');

-- Who reads what.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.library_blocks), 1, 'an owner reads only his own private block');
select is((select count(*)::int from public.library_block_sources), 0, 'and never where a block came from');
select throws_ok($$select * from public.library_block_counts()$$, '42501', null, 'nor the Admin''s count');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.library_blocks), 0, 'another workspace reads none of it');
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.library_blocks), 3, 'a platform admin reads every block');
select is((select sum(blocks)::int || '/' || sum(uses)::int from public.library_block_counts()), '3/6', 'and the count: 3 blocks, 6 sections');
select is((select sum(two_brands)::int from public.library_block_counts() where source = 'inbox'), 2, 'both used by two brands');
reset role;

-- Deleting the upload takes its private block with it.
delete from public.email_uploads where id = current_setting('test.u1')::uuid;
select is((select count(*)::int from public.library_blocks where tenant_id is not null), 0, 'a deleted upload leaves no private block');

-- An upload deleted while its blocks were checked: gone, the job cancelled.
select set_config('test.u2', pg_temp.upload('00000000-0000-4000-8000-000000000101', 'measuring')::text, true);
update public.email_uploads set state = 'ready', blueprint = pg_temp.section_bp() where id = current_setting('test.u2')::uuid;
select pg_temp.as_job();
set local role service_role;
select set_config('test.c4', pg_temp.claim()::text, true);
reset role;
update public.email_uploads set state = 'deleting' where id = current_setting('test.u2')::uuid;
select pg_temp.as_job();
set local role service_role;
select is(public.record_library_blocks((current_setting('test.c4')::jsonb->>'job')::uuid, (current_setting('test.c4')::jsonb->>'lease')::uuid,
  jsonb_build_array(pg_temp.block(1, pg_temp.fp(1))))->>'state', 'gone', 'an upload deleted meanwhile is gone');
reset role;
select is((select status from public.platform_jobs where id = (current_setting('test.c4')::jsonb->>'job')::uuid), 'cancelled', 'its job cancelled');

select * from finish();
rollback;
