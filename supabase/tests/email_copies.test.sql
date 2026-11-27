begin;
select plan(66);

-- DES-ENGINE-002b2: "Use this design" with Copy. The design step asks for
-- a library copy of the chosen inspiration email; a browser job outside
-- the app makes it, uploads its cut photos and records it. Workspace 101:
-- owner ...01; another workspace (102): owner ...04.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('copy-' || n, 'sha256'), 'hex') $$;
create function pg_temp.bp() returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 24, 'bottom', 24),
    'sections', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'kind', 'image', 'unsupported', null, 'background', '#f6f6f6',
        'items', jsonb_build_array(jsonb_build_object('type', 'image', 'src', null, 'href', null)))))
$$;
create function pg_temp.message(n int) returns uuid language sql as $$
  insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, marked_html_path)
    select id, pg_temp.k(n), 1, 8000 + n, 10, 'Email ' || n, now(), true, 'too_large', 'fake/' || pg_temp.k(n) || '.marked.html'
    from public.inbox_mailboxes where key = 'fake'
  returning id
$$;
create function pg_temp.assign(message uuid, n int) returns uuid language sql as $$
  insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
    select id, 'msg:copy' || n, now(), 'Email', 'x', '<p>x</p>', '{}', true, message
    from public.competitor_captures where domain = 'copies.example'
  returning id
$$;
-- The build's lease for its next step (service role).
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
create function pg_temp.ask(input jsonb default '{"brand":{"name":"Cedar Studio"}}', photos int default 3,
  message uuid default current_setting('test.message')::uuid) returns jsonb language sql as $$
  select public.request_email_copy(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, message, input, photos)
$$;
create function pg_temp.copy(photos jsonb) returns jsonb language sql as $$
  select jsonb_build_object('html', '<p>copy</p>', 'sections', '[{"ordinal":1,"kind":"image","result":"copied","reason":null}]'::jsonb,
    'pass', true, 'leaks', '[]'::jsonb, 'footerAdded', false, 'photos', photos)
$$;

-- Grants, row level security and the private bucket.
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'browser roles cannot ask for, claim, record or hand back a copy')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.request_email_copy(uuid,uuid,uuid,jsonb,integer,uuid,uuid[])','public.claim_email_copy()',
                    'public.record_email_copy(uuid,uuid,jsonb,text)','public.release_email_copy(uuid,uuid)',
                    'public.clean_email_copy(uuid)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')), 'jobs can')
  from unnest(array['public.request_email_copy(uuid,uuid,uuid,jsonb,integer,uuid,uuid[])','public.claim_email_copy()',
                    'public.record_email_copy(uuid,uuid,jsonb,text)','public.release_email_copy(uuid,uuid)',
                    'public.clean_email_copy(uuid)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'the failure trigger and the role check are not callable')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['private.fail_email_copy()','private.copy_job_role()']) f;
select ok(exists (select 1 from pg_constraint where conrelid = 'public.email_copies'::regclass and contype = 'f'
  and pg_get_constraintdef(oid) like 'FOREIGN KEY (tenant_id, build_id) REFERENCES email_builds(tenant_id, id) ON DELETE CASCADE'),
  'a copy belongs to its build in the build''s own workspace');
select ok(not bool_or(has_table_privilege(r, 'public.email_copies', p)), 'nobody writes copies but the commands, not even the worker')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon', 'public.email_copies', 'select'), 'anon cannot read copies');
select ok((select relrowsecurity from pg_class where oid = 'public.email_copies'::regclass), 'row level security is on');
select is((select public::text || ':' || file_size_limit || ':' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'email-copies'),
  'false:3145728:image/jpeg', 'the cut photos are private JPEGs of at most 3 MiB');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') || coalesce(with_check, '')) like '%email-copies%'), 0, 'no storage policy opens the bucket to a browser');

-- An inspiration email with its measured blueprint, and one without.
insert into public.inbox_mailboxes(key, transport) values ('fake', 'fake') on conflict do nothing;
insert into public.competitor_captures(domain) values ('copies.example');
select set_config('test.message', pg_temp.message(1)::text, true);
select set_config('test.email', pg_temp.assign(current_setting('test.message')::uuid, 1)::text, true);
select set_config('test.bare', pg_temp.message(2)::text, true);
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.message')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('test.bjob', (select id::text from public.claim_platform_job(array['inbox.blueprint'], current_setting('test.message'))), true);
select public.record_inbox_blueprint(current_setting('test.bjob')::uuid,
  (select lease_token from public.platform_jobs where id = current_setting('test.bjob')::uuid), pg_temp.bp());
reset role;

-- Four planned emails of workspace 101.
select set_config('test.today', ((now() at time zone (select timezone from public.tenants where id = '00000000-0000-4000-8000-000000000101'))::date)::text, true);
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e501', '00000000-0000-4000-8000-000000000101', current_setting('test.today')::date, 'planned',
   '{"offers":[]}', '{"mode":"auto"}',
   jsonb_build_object('slots', (select jsonb_agg(jsonb_build_object('date', (current_setting('test.today')::date + 2 + i)::text,
     'time', '10:00', 'emailType', 'launch')) from generate_series(0, 3) i)),
   '00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select set_config('test.build', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e501', 0)::text, true);
select set_config('test.build2', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e501', 1)::text, true);
select set_config('test.build3', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e501', 2)::text, true);
select set_config('test.build4', public.create_email_build('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e501', 3)::text, true);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- Only the design step asks, under its own lease, for an email with a blueprint.
select set_config('test.lease', pg_temp.lease(current_setting('test.build')::uuid)::text, true);
select throws_ok($$select pg_temp.ask()$$, 'PT409', 'Only the design step copies an email', 'only the design step copies an email');
select public.finish_email_step(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, 'sections', '{"sendAt":"2027-01-01T10:00:00Z"}');
select public.finish_email_step(current_setting('test.build')::uuid, pg_temp.lease(current_setting('test.build')::uuid), 'content', '{"locked":true}');
select public.finish_email_step(current_setting('test.build')::uuid, pg_temp.lease(current_setting('test.build')::uuid), 'copy', '{"draft":{"subject":"Copy"}}');
select set_config('test.lease', pg_temp.lease(current_setting('test.build')::uuid)::text, true);
select throws_ok($$select public.request_email_copy(current_setting('test.build')::uuid, gen_random_uuid(), current_setting('test.message')::uuid, '{}', 0)$$,
  'PT409', 'Lease unavailable', 'only under the build''s own lease');
select throws_ok($$select public.request_email_copy(gen_random_uuid(), current_setting('test.lease')::uuid, current_setting('test.message')::uuid, '{}', 0)$$,
  'PT409', 'Lease unavailable', 'never for a build that is not there');
select throws_ok($$select pg_temp.ask(message => current_setting('test.bare')::uuid)$$, 'PT409', 'The inspiration email has no blueprint',
  'never an email with no measured blueprint');
select throws_ok($$select pg_temp.ask('[]')$$, '22023', 'Invalid copy input', 'its input is an object');
select throws_ok($$select pg_temp.ask(photos => 25)$$, '22023', 'Invalid copy input', 'at most 24 cut photos');
select is(pg_temp.ask()->>'state', 'queued', 'the first ask stores the copy and queues it');
select is(pg_temp.ask('{"other":true}')->>'state', 'queued', 'a later ask only reads it');
select is((select count(*)::int from public.platform_jobs where kind = 'design.copy' and subject_key = current_setting('test.build')), 1, 'with one copy job');
select is((select tenant_id::text || ':' || (input->'brand'->>'name') || ':' || photos from public.email_copies where build_id = current_setting('test.build')::uuid),
  '00000000-0000-4000-8000-000000000101:Cedar Studio:3', 'for the build''s workspace, with its first input');
select throws_ok($$select pg_temp.ask(message => current_setting('test.bare')::uuid)$$, 'PT409', 'This build copies another email',
  'a build copies one email');

-- It waits for its copy; the design studio's claim never takes it meanwhile.
select public.wait_email_round(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, '{"library":{"waits":1}}', 1800);
select is((select count(*)::int from public.claim_studio_build(current_setting('test.build')::uuid)), 0,
  'the design studio never takes a step waiting for its copy');
select is((select count(*)::int from public.claim_email_build(current_setting('test.build')::uuid)), 0, 'nor does the sweep before its time');

-- Waiting for its blueprint (no copy yet): the studio waits too, until its time is up.
select set_config('test.lease3', pg_temp.to_design(current_setting('test.build3')::uuid)::text, true);
select public.wait_email_round(current_setting('test.build3')::uuid, current_setting('test.lease3')::uuid, '{"library":{"waits":1}}', 1800);
select is((select count(*)::int from public.claim_studio_build(current_setting('test.build3')::uuid)), 0,
  'the design studio never takes a step waiting for its blueprint');
reset role;
update public.email_builds set not_before = now() - interval '1 second', updated_at = now() - interval '2 minutes'
  where id = current_setting('test.build3')::uuid;
set local role service_role;
select is((select count(*)::int from public.claim_studio_build(current_setting('test.build3')::uuid)), 1,
  'once its time is up, it takes it as before');

-- Members read their own workspace's copies; platform admins every copy.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.email_copies), 1, 'the workspace''s owner reads its copy');
select throws_ok($$insert into public.email_copies(build_id, tenant_id, inbox_message_id, input)
  values (current_setting('test.build2')::uuid, '00000000-0000-4000-8000-000000000101', current_setting('test.message')::uuid, '{}')$$,
  '42501', null, 'and cannot write one');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.email_copies), 0, 'another workspace''s owner reads none');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.email_copies), 1, 'a platform admin reads every copy');
reset role;
insert into storage.objects(bucket_id, name, metadata) values
  ('email-copies', '00000000-0000-4000-8000-000000000101/' || current_setting('test.build') || '/x/0.jpg', '{"size":1000,"mimetype":"image/jpeg"}');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'email-copies'), 0, 'no member reads the cut photos (signed links only)');
reset role;

-- Only jobs run the copy commands, even with the database role.
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
select throws_ok($$select public.claim_email_copy()$$, '42501', 'Only jobs copy emails', 'no claim without the job''s role');
select throws_ok($$select public.record_email_copy(gen_random_uuid(), gen_random_uuid(), failure => 'copy_failed')$$,
  '42501', 'Only jobs copy emails', 'no record without the job''s role');
select throws_ok($$select public.release_email_copy(gen_random_uuid(), gen_random_uuid())$$,
  '42501', 'Only jobs copy emails', 'no hand-back without the job''s role');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- A paused workspace's copy waits an hour, its try given back.
reset role;
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000101';
set local role service_role;
select is((select count(*)::int from public.claim_email_copy()), 0, 'a paused workspace''s copy is not handed out');
select is((select status || ':' || attempt || ':' || last_error_code || ':' || (available_at > now() + interval '59 minutes')
  from public.platform_jobs where kind = 'design.copy' and subject_key = current_setting('test.build')),
  'retry_wait:0:workspace_inactive:true', 'it waits an hour, no try counted');
reset role;
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000101';
update public.platform_jobs set available_at = now() where kind = 'design.copy' and subject_key = current_setting('test.build');
set local role service_role;

-- The browser job claims the copy for 10 minutes.
select set_config('test.job', (select id::text from public.claim_email_copy()), true);
select set_config('test.jl', (select lease_token::text from public.platform_jobs where id = current_setting('test.job')::uuid), true);
select is((select subject_key from public.platform_jobs where id = current_setting('test.job')::uuid), current_setting('test.build'), 'the browser claims the copy');
select ok((select lease_expires_at > now() + interval '9 minutes' from public.platform_jobs where id = current_setting('test.job')::uuid), 'for 10 minutes');
select is((select count(*)::int from public.claim_email_copy()), 0, 'one claim at a time');

-- What it records: a copy whose photos are all stored in this claim's folder.
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, gen_random_uuid(), pg_temp.copy('[0]'))$$,
  'PT409', null, 'under the job''s own lease');
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid)$$,
  '23514', 'Give a result or a failure', 'a result or a failure');
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, failure => 'Not plain')$$,
  '23514', 'Invalid failure', 'a failure is a short code');
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, pg_temp.copy('[0]') - 'sections')$$,
  '23514', 'Invalid copy', 'a copy has its sections');
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, pg_temp.copy('[3]'))$$,
  '23514', 'Invalid copy photo', 'only the photos it was given links for');
reset role;
insert into storage.objects(bucket_id, name, metadata) values
  ('email-copies', '00000000-0000-4000-8000-000000000101/' || current_setting('test.build') || '/' || current_setting('test.jl') || '/0.jpg',
   '{"size":1000,"mimetype":"image/jpeg","eTag":"\"e0\""}'),
  -- An older claim's photo, and one in another workspace's folder.
  ('email-copies', '00000000-0000-4000-8000-000000000101/' || current_setting('test.build') || '/' || gen_random_uuid() || '/1.jpg',
   '{"size":1000,"mimetype":"image/jpeg","eTag":"\"e1\""}'),
  ('email-copies', '00000000-0000-4000-8000-000000000102/' || current_setting('test.build') || '/' || current_setting('test.jl') || '/1.jpg',
   '{"size":1000,"mimetype":"image/jpeg","eTag":"\"e1\""}');
set local role service_role;
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, pg_temp.copy('[0,1]'))$$,
  '23514', 'Stored photo missing', 'a photo of another claim or another workspace is not this copy''s');
select is(public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, pg_temp.copy('[0]')), 'done', 'the copy is recorded');
select is((select state || ':' || (result->>'html') from public.email_copies where build_id = current_setting('test.build')::uuid), 'done:<p>copy</p>', 'and kept');
select is((select result->'stored' from public.email_copies where build_id = current_setting('test.build')::uuid),
  jsonb_build_array(jsonb_build_object('index', 0, 'path', '00000000-0000-4000-8000-000000000101/' || current_setting('test.build') || '/' || current_setting('test.jl') || '/0.jpg',
    'etag', '"e0"', 'size', 1000)), 'with each photo pinned: its claim''s path, tag and size');
select is((select status from public.platform_jobs where id = current_setting('test.job')::uuid), 'succeeded', 'its job is done');
select ok((select not_before <= now() from public.email_builds where id = current_setting('test.build')::uuid), 'the waiting design step is brought forward');
select throws_ok($$select public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, pg_temp.copy('[0]'))$$,
  'PT409', null, 'a copy is recorded once');
reset role;
update public.email_builds set updated_at = now() - interval '2 minutes' where id = current_setting('test.build')::uuid;
set local role service_role;
select set_config('test.lease', (select c.lease_token::text from public.claim_studio_build(current_setting('test.build')::uuid) c), true);
select ok(current_setting('test.lease') <> '', 'once its copy is done, the design studio takes it as before');
select is(pg_temp.ask()->>'state', 'done', 'and reads the done copy');
select lives_ok($$select public.clean_email_copy(current_setting('test.build')::uuid)$$, 'its photos'' removal is marked');
select ok((select cleaned_at is not null from public.email_copies where build_id = current_setting('test.build')::uuid), 'once');

-- A copy that cannot be made is recorded as failed, and the step goes on.
select set_config('test.lease', pg_temp.to_design(current_setting('test.build2')::uuid)::text, true);
select set_config('test.build', current_setting('test.build2'), true);
select is(pg_temp.ask()->>'state', 'queued', 'the second email asks for its copy');
select public.wait_email_round(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, '{"library":{"waits":1}}', 1800);
select set_config('test.job', (select id::text from public.claim_email_copy()), true);
select set_config('test.jl', (select lease_token::text from public.platform_jobs where id = current_setting('test.job')::uuid), true);
select is(public.record_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid, failure => 'copy_failed'), 'failed',
  'a copy that cannot be made is recorded as failed');
select is((select c.state || ':' || c.failure || ':' || j.status from public.email_copies c, public.platform_jobs j
  where c.build_id = current_setting('test.build')::uuid and j.id = current_setting('test.job')::uuid), 'failed:copy_failed:succeeded',
  'with its reason, its job done');
select ok((select not_before <= now() from public.email_builds where id = current_setting('test.build')::uuid), 'and the step goes on (coded blocks)');

-- A browser on another engine version hands its job back, no try counted.
select set_config('test.lease', pg_temp.to_design(current_setting('test.build4')::uuid)::text, true);
select set_config('test.build', current_setting('test.build4'), true);
select is(pg_temp.ask()->>'state', 'queued', 'the fourth email asks for its copy');
select public.wait_email_round(current_setting('test.build')::uuid, current_setting('test.lease')::uuid, '{"library":{"waits":1}}', 1800);
select set_config('test.job', (select id::text from public.claim_email_copy()), true);
select set_config('test.jl', (select lease_token::text from public.platform_jobs where id = current_setting('test.job')::uuid), true);
select throws_ok($$select public.release_email_copy(current_setting('test.job')::uuid, gen_random_uuid())$$, 'PT409', null,
  'only under the job''s own lease');
reset role;
insert into public.platform_jobs(kind, subject_key, idempotency_key) values ('inbox.variant', 'test-variant', 'test:copy.variant');
set local role service_role;
select set_config('test.vjob', (select id::text from public.platform_jobs where idempotency_key = 'test:copy.variant'), true);
select set_config('test.vl', (select lease_token::text from public.claim_platform_job(array['inbox.variant'])), true);
select throws_ok($$select public.release_email_copy(current_setting('test.vjob')::uuid, current_setting('test.vl')::uuid)$$, '23514', 'Not a copy job',
  'never another kind''s job');
select public.release_email_copy(current_setting('test.job')::uuid, current_setting('test.jl')::uuid);
select is((select status || ':' || attempt || ':' || last_error_code || ':' || (available_at > now() + interval '9 minutes')
  from public.platform_jobs where id = current_setting('test.job')::uuid), 'retry_wait:0:version_skew:true', 'handed back for 10 minutes, no try counted');

-- A copy job whose leases keep running out fails for good on the fourth,
-- and leaves its copy failed; the step goes on.
reset role;
update public.platform_jobs set attempt = 3, available_at = now() where id = current_setting('test.job')::uuid;
set local role service_role;
select set_config('test.jl', (select lease_token::text from public.claim_email_copy()), true);
reset role;
update public.platform_jobs set lease_expires_at = now() - interval '1 minute' where id = current_setting('test.job')::uuid;
-- A job with a key that is no build's, failing at the same time, stops nothing.
insert into public.platform_jobs(kind, subject_key, idempotency_key, status, attempt, lease_token, lease_expires_at)
  values ('design.copy', 'not-a-build', 'test:copy.bad', 'leased', 4, gen_random_uuid(), now() - interval '1 minute');
set local role service_role;
select lives_ok($$select public.claim_platform_job(array['studio.render'])$$, 'the lease recovery runs, past a job with a bad key');
select is((select status || ':' || last_error_code from public.platform_jobs where id = current_setting('test.job')::uuid), 'failed:lease_expired',
  'the fourth lease that ran out fails the job');
select is((select state || ':' || failure from public.email_copies where build_id = current_setting('test.build')::uuid), 'failed:copy_job_failed',
  'and its copy, with the reason');
select ok((select not_before <= now() from public.email_builds where id = current_setting('test.build')::uuid), 'the design step goes on (coded blocks)');
select set_config('test.lease', pg_temp.lease(current_setting('test.build')::uuid)::text, true);
select is(pg_temp.ask()->>'failure', 'copy_job_failed', 'which reads why');

select * from finish();
rollback;
