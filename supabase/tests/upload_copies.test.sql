begin;
select plan(20);

-- DES-ENGINE-003b: Create email copies one of the workspace's own uploads.
-- Workspace 101: owner ...01; another workspace (102): owner ...04.
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.as_job() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true)
$$;
create function pg_temp.upload(t uuid, state text, design text default 'own') returns uuid language sql as $$
  insert into public.email_uploads (tenant_id, request_key, name, design, file_kind, byte_size, sha256, created_by, state,
      blueprint, failure, original_etag, html_etag, html_size)
    values (t, gen_random_uuid(), 'Mine', design, 'eml', 1, encode(extensions.digest(gen_random_uuid()::text, 'sha256'), 'hex'),
      (select profile_id from public.tenant_memberships where tenant_id = t and role = 'owner' limit 1), state,
      case when state = 'ready' then '{"version":1}'::jsonb end, case when state = 'failed' then 'not_valid' end,
      'a', 'b', 1)
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

select set_config('test.ready', pg_temp.upload('00000000-0000-4000-8000-000000000101', 'ready')::text, true);
select set_config('test.measuring', pg_temp.upload('00000000-0000-4000-8000-000000000101', 'measuring')::text, true);
select set_config('test.theirs', pg_temp.upload('00000000-0000-4000-8000-000000000102', 'ready')::text, true);
select set_config('test.other', pg_temp.upload('00000000-0000-4000-8000-000000000101', 'ready', 'other')::text, true);
select set_config('test.today', ((now() at time zone (select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'))::date)::text, true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e601', '00000000-0000-4000-8000-000000000101', current_setting('test.today')::date, 'planned',
   '{"offers":[]}', '{"mode":"auto"}',
   jsonb_build_object('slots', (select jsonb_agg(jsonb_build_object('date', (current_setting('test.today')::date + 2 + i)::text,
     'time', '10:00', 'emailType', 'launch')) from generate_series(0, 3) i)),
   '00000000-0000-4000-8000-000000000001');

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_builds' and column_name = 'upload_id'),
  'a build may copy an upload');
select throws_ok($$insert into public.email_copies (build_id, tenant_id, inbox_message_id, upload_id, input) values
  (gen_random_uuid(), '00000000-0000-4000-8000-000000000101', null, null, '{}')$$, '23514', null,
  'a copy is of an inspiration email or of an upload');

-- Create email from an upload: the owner, his own ready upload, Copy only.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'remix', null, current_setting('test.ready')::uuid)$$,
  '22023', 'Your own emails are copied', 'an upload is copied, never remixed');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'copy', gen_random_uuid(), current_setting('test.ready')::uuid)$$,
  '22023', 'Choose an inspiration email or one of your own', 'never with an inspiration email too');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'copy', null, current_setting('test.measuring')::uuid)$$,
  '22023', 'This email of yours is not one you can use', 'never an upload still being read');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'copy', null, current_setting('test.theirs')::uuid)$$,
  '22023', 'This email of yours is not one you can use', 'never another workspace''s upload');
select throws_ok($$select public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'copy', null, gen_random_uuid())$$,
  '22023', 'This email of yours is not one you can use', 'never an unknown one (the same refusal)');
select set_config('test.build', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0,
  'copy', null, current_setting('test.ready')::uuid)::text, true);
select set_config('test.build2', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 1,
  'copy', null, current_setting('test.other')::uuid)::text, true);
reset role;
select is((select mode || ':' || upload_id from public.email_builds where id = current_setting('test.build')::uuid),
  'copy:' || current_setting('test.ready'), 'the build copies the upload');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e601', 0, 'copy', null,
  current_setting('test.ready')::uuid)::text, current_setting('test.build'), 'clicking again returns the same build');
reset role;

-- The design step asks for the copy of its own upload.
select pg_temp.as_job();
set local role service_role;
select set_config('test.lease', pg_temp.to_design(current_setting('test.build')::uuid)::text, true);
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, null, '{}', 0, current_setting('test.other')::uuid)$$,
  'PT409', 'The email of yours has no blueprint', 'only the build''s own upload');
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, gen_random_uuid(), '{}', 0, current_setting('test.ready')::uuid)$$,
  '22023', 'Invalid copy input', 'an inspiration email or an upload, not both');
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, null, '{}', 0, null)$$,
  '22023', 'Invalid copy input', 'one of the two');
select is(public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, null, '{"keepLook":true}', 2,
  current_setting('test.ready')::uuid)->>'state', 'queued', 'the copy of its upload is queued');
select is((select (inbox_message_id is null)::text || ':' || upload_id || ':' || photos from public.email_copies where build_id = current_setting('test.build')::uuid),
  'true:' || current_setting('test.ready') || ':2', 'stored for the upload');
select is((select count(*)::int from public.platform_jobs where kind = 'design.copy' and subject_key = current_setting('test.build')), 1, 'with one copy job');
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, gen_random_uuid(), '{}', 0)$$,
  'PT409', 'This build copies another email', 'a build copies one email');
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, null, '{}', 0)$$,
  'PT409', 'This build copies another email', 'and asks for it the same way');
reset role;

-- 3a follow-ups: a retry of an unfinished add refreshes it; the sweep
-- forgets adds older than a day.
update public.email_uploads set state = 'saving', original_etag = null, html_etag = null, html_size = null, blueprint = null,
  updated_at = now() - interval '40 minutes' where id = current_setting('test.measuring')::uuid;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select id from public.add_email_upload('00000000-0000-4000-8000-000000000101',
  (select request_key from public.email_uploads where id = current_setting('test.measuring')::uuid), 'Mine', 'own', 'eml', 1,
  (select sha256 from public.email_uploads where id = current_setting('test.measuring')::uuid), '[]', '[]'))::text,
  current_setting('test.measuring'), 'a retry of an unfinished add resumes it');
reset role;
select ok((select updated_at > now() - interval '1 minute' from public.email_uploads where id = current_setting('test.measuring')::uuid),
  'and refreshes it, so a sweep meanwhile never takes it');
insert into public.email_upload_adds (tenant_id, added_at) values
  ('00000000-0000-4000-8000-000000000101', now() - interval '2 days'), ('00000000-0000-4000-8000-000000000101', now());
select pg_temp.as_job();
set local role service_role;
select * from public.email_uploads_to_clean();
reset role;
select is((select count(*)::int from public.email_upload_adds where added_at < now() - interval '1 day'), 0,
  'the sweep forgets adds older than a day, keeping the day''s');

select * from finish();
rollback;
