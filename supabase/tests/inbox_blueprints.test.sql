begin;
select plan(25);

-- DES-ENGINE-002: an Inspiration email's blueprint, measured once by the
-- browser job and kept without pictures or links.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('bp-' || n, 'sha256'), 'hex') $$;
create function pg_temp.bp(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 24, 'bottom', 24),
    'sections', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'kind', 'image', 'unsupported', null,
        'items', jsonb_build_array(jsonb_build_object('type', 'image', 'src', null, 'href', null))),
      jsonb_build_object('ordinal', 2, 'kind', 'offer', 'unsupported', 'a countdown timer', 'items', '[]'::jsonb))) || extra
$$;
create function pg_temp.claim() returns void language plpgsql as $$
begin
  perform set_config('test.job', (select id::text from public.claim_platform_job(array['inbox.blueprint'])), true);
  perform set_config('test.lease', (select lease_token::text from public.platform_jobs where id = current_setting('test.job')::uuid), true);
end $$;

-- Grants and visibility.
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'browser roles cannot record or request blueprints')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_inbox_blueprint(uuid,uuid,jsonb,text)','public.request_inbox_blueprint(uuid)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')), 'the worker can')
  from unnest(array['public.record_inbox_blueprint(uuid,uuid,jsonb,text)','public.request_inbox_blueprint(uuid)']) f;
select ok(not bool_or(has_table_privilege(r, 'public.inbox_blueprints', p)), 'browser roles cannot write blueprints')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon', 'public.inbox_blueprints', 'select'), 'anon cannot read them');
select ok((select relrowsecurity from pg_class where oid = 'public.inbox_blueprints'::regclass), 'row level security is on');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname like 'queue_inbox_blueprint%'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  'the queueing helpers are private');

-- An email of a brand, with its marked copy.
select public.enqueue_inbox_poll('fake');
insert into public.competitor_captures(domain) values ('blueprints.example');
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, marked_html_path)
  select id, pg_temp.k(1), 1, 7001, 10, 'Spring', now(), true, 'too_large', 'fake/' || pg_temp.k(1) || '.marked.html'
  from public.inbox_mailboxes where key = 'fake';
select set_config('test.message', (select id::text from public.inbox_messages where message_key = pg_temp.k(1)), true);
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
  select id, 'msg:bp1', now(), 'Spring', 'x', '<p>x</p>', '{}', true, current_setting('test.message')::uuid
  from public.competitor_captures where domain = 'blueprints.example';
select set_config('test.email', (select id::text from public.competitor_emails where external_id = 'msg:bp1'), true);

select is((select count(*)::int from public.platform_jobs where kind = 'inbox.blueprint' and subject_key = current_setting('test.message')), 0,
  'nothing is measured before the screenshot');
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.message')::uuid;
select is((select count(*)::int from public.platform_jobs where kind = 'inbox.blueprint' and subject_key = current_setting('test.message')), 1,
  'the screenshot queues its blueprint');
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.message')::uuid;
select is((select count(*)::int from public.platform_jobs where kind = 'inbox.blueprint' and subject_key = current_setting('test.message')), 1,
  'a second screenshot queues nothing more');

set local role service_role;
select is(public.request_inbox_blueprint(current_setting('test.email')::uuid), 'waiting', 'first use: it is waiting');
select is(public.request_inbox_blueprint(gen_random_uuid()), 'none', 'an unknown email has none');
select pg_temp.claim();
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid)$$,
  '23514', null, 'a blueprint or a failure is needed');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.bp('{"version": 2}'))$$, '23514', null, 'only version 1');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.bp() || jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('ordinal', 1,
    'items', jsonb_build_array(jsonb_build_object('type', 'image', 'src', 'https://inbox.example/a.png'))))))$$,
  '23514', 'A stored blueprint keeps no picture or link', 'never a picture address');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.bp() || jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('ordinal', 1,
    'items', jsonb_build_array(jsonb_build_object('type', 'text', 'runs', jsonb_build_array(jsonb_build_object('text', 'x', 'href', 'https://inbox.example/')))))))) $$,
  '23514', 'A stored blueprint keeps no picture or link', 'never a link');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, gen_random_uuid(), pg_temp.bp())$$,
  'PT409', null, 'a stale lease records nothing');
select is(public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, pg_temp.bp()), 'ready',
  'the blueprint is recorded');
select is((select state || '/' || sections || '/' || unsupported from public.inbox_blueprints where inbox_message_id = current_setting('test.message')::uuid),
  'ready/2/1', 'with its sections and the ones that cannot be copied');
select is((select status from public.platform_jobs where id = current_setting('test.job')::uuid), 'succeeded', 'the job is finished');
select is(public.request_inbox_blueprint(current_setting('test.email')::uuid), 'ready', 'the build reads it as ready');
reset role;
update public.inbox_messages set screenshot_at = now() + interval '1 minute' where id = current_setting('test.message')::uuid;
select is((select count(*)::int from public.platform_jobs where kind = 'inbox.blueprint' and subject_key = current_setting('test.message')), 1,
  'a measured email is never measured again');

-- An email that can never be measured is recorded as failed, with why.
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, marked_html_path)
  select id, pg_temp.k(2), 1, 7002, 10, 'Tall', now(), true, 'too_large', 'fake/' || pg_temp.k(2) || '.marked.html'
  from public.inbox_mailboxes where key = 'fake';
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
  select c.id, 'msg:bp2', now(), 'Tall', 'x', '<p>x</p>', '{}', true, m.id
  from public.competitor_captures c, public.inbox_messages m where c.domain = 'blueprints.example' and m.message_key = pg_temp.k(2);
set local role service_role;
select is(public.request_inbox_blueprint((select id from public.competitor_emails where external_id = 'msg:bp2')), 'waiting',
  'an email used before its screenshot is queued on first use');
select pg_temp.claim();
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, null, 'Too Tall')$$,
  '23514', null, 'a failure is a short code');
select is(public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, null, 'too_tall'), 'failed',
  'a failure is recorded');
select is(public.request_inbox_blueprint((select id from public.competitor_emails where external_id = 'msg:bp2')), 'failed',
  'and the build reads it as failed');

select * from finish();
rollback;
