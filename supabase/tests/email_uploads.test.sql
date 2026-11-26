begin;
select plan(57);

-- DES-ENGINE-003a: "Add your own email". Workspace 101: owner ...01, staff
-- ...05, admin ...06; another workspace (102): owner ...04. An upload is a
-- private library item of its workspace; the owner or an admin adds and
-- deletes; a browser job measures it.
create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.sha(n int) returns text language sql as $$ select encode(extensions.digest('upload-' || n, 'sha256'), 'hex') $$;
create function pg_temp.pics(n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('index', i, 'type', 'image/png', 'width', 60, 'height', 30, 'bytes', 10 + i, 'from', 'file') order by i), '[]')
  from generate_series(0, n - 1) i
$$;
create function pg_temp.add(n int, design text default 'own', pictures jsonb default '[]', t uuid default '00000000-0000-4000-8000-000000000101')
returns uuid language sql as $$
  select id from public.add_email_upload(t, ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Upload ' || n, design,
    'eml', 1000, pg_temp.sha(n), pictures, '[]')
$$;
-- A stored file, as the server writes it (its own key).
create function pg_temp.store(path text, size int) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
    values ('email-uploads', path, jsonb_build_object('eTag', '"' || md5(path) || '"', 'size', size))
$$;
create function pg_temp.store_all(upload uuid, pictures int default 0) returns void language plpgsql as $$
declare base text := '00000000-0000-4000-8000-000000000101/' || upload || '/';
begin
  perform pg_temp.store(base || 'original.eml', 1000);
  perform pg_temp.store(base || 'email.html', 900);
  for i in 0..pictures - 1 loop perform pg_temp.store(base || 'picture-' || i || '.png', 10 + i); end loop;
end $$;
create function pg_temp.bp(src text default null, href text default null) returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 24, 'bottom', 24),
    'sections', jsonb_build_array(jsonb_build_object('ordinal', 1, 'kind', 'image', 'unsupported', null,
      'background', '#f6f6f6', 'items', jsonb_build_array(jsonb_build_object('type', 'image', 'src', src, 'href', href)))))
$$;

-- Grants, row level security and the private bucket.
select ok(not bool_or(has_table_privilege(r, 'public.email_uploads', p)), 'nobody writes uploads but the commands, not even the server')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon', 'public.email_uploads', 'select'), 'anon cannot read uploads');
select ok((select relrowsecurity from pg_class where oid = 'public.email_uploads'::regclass), 'row level security is on');
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'anon cannot add, finish or delete')
  from unnest(array['anon']) r,
       unnest(array['public.add_email_upload(uuid,uuid,text,text,text,integer,text,jsonb,jsonb)',
                    'public.finish_email_upload(uuid,uuid)', 'public.delete_email_upload(uuid,uuid)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'browsers cannot claim, record or hand back a measuring job')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.claim_email_upload()', 'public.record_email_upload(uuid,uuid,jsonb,text)',
                    'public.release_email_upload(uuid,uuid)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')), 'jobs can')
  from unnest(array['public.claim_email_upload()', 'public.record_email_upload(uuid,uuid,jsonb,text)',
                    'public.release_email_upload(uuid,uuid)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'the helpers and the failure trigger are not callable')
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['private.fail_email_upload()', 'private.upload_job_role()', 'private.require_upload_manager(uuid)',
                    'private.upload_picture_path(uuid,uuid,jsonb)']) f;
select is((select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'email-uploads'),
  'false:4194304:text/html,message/rfc822,image/png,image/jpeg,image/gif,image/webp', 'the files are private, at most 4 MiB, emails and pictures only');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%email-uploads%'), 0, 'no storage policy opens the bucket to a browser');

-- The owner adds an own design with two pictures.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('test.u1', pg_temp.add(1, 'own', pg_temp.pics(2))::text, true);
select is((select state from public.email_uploads where id = current_setting('test.u1')::uuid), 'saving', 'the row is saved before its files');
select is(pg_temp.add(1, 'own', pg_temp.pics(2))::text, current_setting('test.u1'), 'the same request and file give back the same upload');
select throws_ok($$select public.add_email_upload('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'X', 'own', 'eml', 1000, pg_temp.sha(99), '[]', '[]')$$,
  'PT409', 'This form was used for another file', 'the same request with another file is refused');
select throws_ok($$select public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid)$$,
  'PT409', 'The upload''s files are not stored', 'an upload is finished only once its files are stored');
reset role;
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u1') || '/original.eml', 1000);
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u1') || '/email.html', 900);
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u1') || '/picture-0.png', 10);
-- Picture 1 stored with another size than the row says.
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u1') || '/picture-1.png', 999);
set local role authenticated;
select throws_ok($$select public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid)$$,
  'PT409', 'A picture is not stored', 'every picture must be stored, at its own size');
reset role;
update storage.objects set metadata = jsonb_set(metadata, '{size}', '11')
  where bucket_id = 'email-uploads' and name like '%/' || current_setting('test.u1') || '/picture-1.png';
set local role authenticated;
select is(public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid), 'measuring', 'then it is queued to be measured');
select is(public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid), 'measuring', 'again: its state');
select ok((select bool_and(p ? 'etag') from public.email_uploads, jsonb_array_elements(pictures) p where id = current_setting('test.u1')::uuid),
  'each picture''s tag is pinned');
reset role;
select is((select count(*)::int from public.platform_jobs where kind = 'design.upload' and subject_key = current_setting('test.u1')), 1, 'with one measuring job');
set local role authenticated;

-- The original must be the file as admitted (its size).
select set_config('test.u13', pg_temp.add(13)::text, true);
reset role;
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u13') || '/original.eml', 999);
select pg_temp.store('00000000-0000-4000-8000-000000000101/' || current_setting('test.u13') || '/email.html', 900);
set local role authenticated;
select throws_ok($$select public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u13')::uuid)$$,
  'PT409', 'The upload''s files are not stored', 'the stored original must be the file as admitted');

-- Bounds and the kind of upload.
select throws_ok($$select pg_temp.add(2, 'other', pg_temp.pics(1))$$, '22023', 'Another brand''s pictures are not kept',
  'another brand''s pictures are never kept');
select throws_ok($$select pg_temp.add(3, 'own', pg_temp.pics(41))$$, '22023', 'Invalid pictures', 'at most 40 pictures');
select throws_ok($$select pg_temp.add(4, 'own', '[{"index":1,"type":"image/png","width":1,"height":1,"bytes":1,"from":"file"}]')$$,
  '22023', 'Invalid picture', 'pictures are numbered from 0');
select throws_ok($$select pg_temp.add(5, 'own', '[{"index":0,"type":"image/svg+xml","width":1,"height":1,"bytes":1,"from":"file"}]')$$,
  '22023', 'Invalid picture', 'PNG, JPEG, GIF or WebP only');
select throws_ok($$select pg_temp.add(6, 'own', '[{"index":0,"type":"image/png","width":1,"height":1,"bytes":4194304,"from":"file"}]')$$,
  '22023', 'Invalid picture', 'a picture is at most 3 MiB');
select throws_ok($$select pg_temp.add(7, 'mine')$$, '23514', null, 'own or other only');
select throws_ok($$select public.add_email_upload('00000000-0000-4000-8000-000000000101', gen_random_uuid(), E'Bad\nname', 'own', 'eml', 1000, pg_temp.sha(8), '[]', '[]')$$,
  '23514', null, 'a name has no control characters');
select lives_ok($$select pg_temp.add(9, 'other')$$, 'another brand''s email without pictures');

-- The admin adds and deletes; staff and other workspaces cannot.
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000000006');
set local role authenticated;
select lives_ok($$select set_config('test.u10', pg_temp.add(10)::text, true)$$, 'an admin adds an email');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
set local role authenticated;
select throws_ok($$select pg_temp.add(11)$$, '42501', 'Access denied', 'staff cannot add an email');
select throws_ok($$select public.delete_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid)$$,
  '42501', 'Access denied', 'nor delete one');
select is((select count(*)::int from public.email_uploads), 4, 'staff read the workspace''s own uploads');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.email_uploads), 0, 'another workspace reads none of them');
select throws_ok($$select pg_temp.add(12)$$, '42501', 'Access denied', 'nor adds to this workspace');
select throws_ok($$select public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid)$$,
  '42501', 'Access denied', 'nor finishes its upload');
select throws_ok($$select public.delete_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u1')::uuid)$$,
  '42501', 'Access denied', 'nor deletes it');
select throws_ok($$select public.delete_email_upload('00000000-0000-4000-8000-000000000102', current_setting('test.u1')::uuid)$$,
  'PT409', 'The upload is gone', 'nor reaches it from its own workspace');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.email_uploads), 0, 'a platform admin reads no workspace''s uploads');
reset role;

-- The browser job measures it (service role only).
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select * from public.claim_email_upload()$$, '42501', null, 'a browser cannot claim a measuring job');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('test.claim', (select row_to_json(c)::text from public.claim_email_upload() c), true);
select is((current_setting('test.claim')::jsonb->>'subject_key') || ':' || (current_setting('test.claim')::jsonb->>'design') || ':' ||
  (current_setting('test.claim')::jsonb->>'pictures'), current_setting('test.u1') || ':own:2', 'the job hands out the upload, its kind and its pictures');
select ok((select lease_expires_at > now() + interval '4 minutes' from public.platform_jobs
  where id = (current_setting('test.claim')::jsonb->>'id')::uuid), 'leased for 5 minutes');
select throws_ok($$select public.record_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, gen_random_uuid(), pg_temp.bp())$$,
  'PT409', null, 'only under its own lease');
select throws_ok($$select public.record_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, (current_setting('test.claim')::jsonb->>'lease_token')::uuid)$$,
  '23514', 'Give a blueprint or a failure', 'a blueprint or a failure');
select is(public.record_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, (current_setting('test.claim')::jsonb->>'lease_token')::uuid,
  pg_temp.bp('https://email-uploads.invalid/0.png', 'https://cedar-lane.example/')), 'ready', 'an own design keeps its pictures and links');
select is((select status from public.platform_jobs where id = (current_setting('test.claim')::jsonb->>'id')::uuid), 'succeeded', 'and its job is done');
reset role;

-- Another brand's email is kept bare.
update public.email_uploads set state = 'measuring', updated_at = now() where id = (select id from public.email_uploads where name = 'Upload 9');
insert into public.platform_jobs (kind, subject_key, idempotency_key)
  select 'design.upload', id::text, 'design.upload:' || id from public.email_uploads where name = 'Upload 9';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('test.claim', (select row_to_json(c)::text from public.claim_email_upload() c), true);
select is(current_setting('test.claim')::jsonb->>'design', 'other', 'another brand''s email');
select throws_ok($$select public.record_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, (current_setting('test.claim')::jsonb->>'lease_token')::uuid,
  pg_temp.bp('https://email-uploads.invalid/0.png'))$$, '23514', null, 'keeps no picture address');
select is(public.record_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, (current_setting('test.claim')::jsonb->>'lease_token')::uuid,
  pg_temp.bp()), 'ready', 'and is kept bare');

-- A job handed back (another engine version) waits; one failed four times fails its upload.
reset role;
select is((select count(*)::int from public.platform_jobs where subject_key = current_setting('test.u10')), 0, 'an upload never finished has no job');
select pg_temp.store_all(current_setting('test.u10')::uuid);
select pg_temp.as_user('00000000-0000-4000-8000-000000000006');
set local role authenticated;
select is(public.finish_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u10')::uuid), 'measuring', 'the admin''s upload is queued');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('test.claim', (select row_to_json(c)::text from public.claim_email_upload() c), true);
select public.release_email_upload((current_setting('test.claim')::jsonb->>'id')::uuid, (current_setting('test.claim')::jsonb->>'lease_token')::uuid);
select is((select status || ':' || attempt from public.platform_jobs where id = (current_setting('test.claim')::jsonb->>'id')::uuid),
  'retry_wait:0', 'a job handed back waits, no try counted');
reset role;
update public.platform_jobs set status = 'failed', finished_at = now() where id = (current_setting('test.claim')::jsonb->>'id')::uuid;
select is((select state || ':' || failure from public.email_uploads where id = current_setting('test.u10')::uuid), 'failed:measure_job_failed',
  'a job that failed for good fails its upload');

-- A paused workspace's upload waits.
update public.email_uploads set state = 'measuring', failure = null, updated_at = now() where id = current_setting('test.u10')::uuid;
update public.platform_jobs set status = 'queued', available_at = now(), attempt = 0, finished_at = null where subject_key = current_setting('test.u10');
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000101';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::int from public.claim_email_upload()), 0, 'a paused workspace''s upload is not handed out');
reset role;
select is((select status || ':' || last_error_code from public.platform_jobs where subject_key = current_setting('test.u10')),
  'retry_wait:workspace_inactive', 'it waits an hour, its try given back');
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000101';

-- The owner deletes an upload: the row goes, its waiting job is done.
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.delete_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u10')::uuid),
  '00000000-0000-4000-8000-000000000101/' || current_setting('test.u10') || '/', 'the owner deletes an upload, and is told its folder');
select is((select count(*)::int from public.email_uploads where id = current_setting('test.u10')::uuid), 0, 'its row is gone');
reset role;
select is((select status from public.platform_jobs where subject_key = current_setting('test.u10')), 'succeeded', 'its waiting job is done');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.delete_email_upload('00000000-0000-4000-8000-000000000101', current_setting('test.u10')::uuid)$$,
  'PT409', 'The upload is gone', 'deleting it again says it is gone');
reset role;

select * from finish();
rollback;
