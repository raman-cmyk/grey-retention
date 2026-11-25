begin;
select plan(43);

-- DES-ENGINE-002: an Inspiration email's blueprint, measured once by the
-- browser job and kept without pictures or links.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('bp-' || n, 'sha256'), 'hex') $$;
create function pg_temp.bp(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'width', 600, 'page', '#f2f2f2', 'body', '#ffffff', 'bottom', 0,
    'margin', jsonb_build_object('top', 24, 'bottom', 24),
    'sections', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'kind', 'image', 'unsupported', null, 'background', '#f6f6f6',
        'items', jsonb_build_array(jsonb_build_object('type', 'image', 'src', null, 'href', null))),
      jsonb_build_object('ordinal', 2, 'kind', 'offer', 'unsupported', 'a countdown timer', 'background', null, 'items', '[]'::jsonb))) || extra
$$;
-- A blueprint whose first section's only part is `part`.
create function pg_temp.with_part(part jsonb) returns jsonb language sql as $$
  select pg_temp.bp() || jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('ordinal', 1, 'items', jsonb_build_array(part))))
$$;
create function pg_temp.claim(subject text) returns void language plpgsql as $$
begin
  perform set_config('test.job', (select id::text from public.claim_platform_job(array['inbox.blueprint'], subject)), true);
  perform set_config('test.lease', (select lease_token::text from public.platform_jobs where id = current_setting('test.job')::uuid), true);
end $$;
create function pg_temp.message(n int, marked boolean default true) returns uuid language sql as $$
  insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, marked_html_path)
    select id, pg_temp.k(n), 1, 7000 + n, 10, 'Email ' || n, now(), true, 'too_large',
      case when marked then 'fake/' || pg_temp.k(n) || '.marked.html' end
    from public.inbox_mailboxes where key = 'fake'
  returning id
$$;
create function pg_temp.assign(message uuid, n int) returns uuid language sql as $$
  insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
    select id, 'msg:bp' || n, now(), 'Email', 'x', '<p>x</p>', '{}', true, message
    from public.competitor_captures where domain = 'blueprints.example'
  returning id
$$;
create function pg_temp.jobs(message uuid) returns int language sql as $$
  select count(*)::int from public.platform_jobs where kind = 'inbox.blueprint' and subject_key = message::text
$$;

-- Grants and visibility.
select ok(not bool_or(has_function_privilege(r, f, 'execute')), 'browser roles cannot record or request blueprints')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_inbox_blueprint(uuid,uuid,jsonb,text)','public.request_inbox_blueprint(uuid)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')), 'the worker can')
  from unnest(array['public.record_inbox_blueprint(uuid,uuid,jsonb,text)','public.request_inbox_blueprint(uuid)']) f;
select ok(not bool_or(has_table_privilege(r, 'public.inbox_blueprints', p)), 'no role writes blueprints directly, not even the worker')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege('anon', 'public.inbox_blueprints', 'select'), 'anon cannot read them');
select ok((select relrowsecurity from pg_class where oid = 'public.inbox_blueprints'::regclass), 'row level security is on');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and (p.proname like '%inbox_blueprint%' or p.proname like 'blueprint_%')
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  'the helpers are private');

-- The table itself refuses pictures and links, whatever writes it.
select ok(private.blueprint_is_bare(pg_temp.bp()), 'a bare blueprint is bare');
select ok(not bool_or(private.blueprint_is_bare(pg_temp.with_part(p))), 'a picture or link in any key, of any type, is refused')
  from unnest(array[
    '{"type":"image","src":"https://inbox.example/a.png"}'::jsonb,
    '{"type":"image","src":{"a":1}}', '{"type":"image","src":7}', '{"type":"button","href":"https://x.example/"}',
    '{"type":"image","srcset":"a.png 2x"}', '{"type":"image","poster":"p.png"}', '{"type":"image","url":"x"}',
    '{"type":"text","runs":[{"text":"x","href":"mailto:a@b.example"}]}', '{"type":"text","background":"url(a.png)"}',
    '{"type":"text","background":"https://x.example/a.png"}', '{"type":"text","runs":[{"text":"see //cdn.example/a"}]}',
    '{"type":"text","runs":[{"text":"x"}],"style":"background:url (a.png)"}']) p;
reset role;
select public.enqueue_inbox_poll('fake');
select pg_temp.message(99);
select throws_ok($$insert into public.inbox_blueprints(inbox_message_id, version, state, blueprint, sections, unsupported)
  values ((select id from public.inbox_messages where message_key = pg_temp.k(99)), 1, 'ready',
    pg_temp.with_part('{"type":"image","src":"https://inbox.example/a.png"}'), 1, 0)$$,
  '23514', null, 'the table refuses a picture even from the database owner');

-- An email of a brand, with its marked copy.
insert into public.competitor_captures(domain) values ('blueprints.example');
select set_config('test.message', pg_temp.message(1)::text, true);
select set_config('test.email', pg_temp.assign(current_setting('test.message')::uuid, 1)::text, true);

select is(pg_temp.jobs(current_setting('test.message')::uuid), 0, 'nothing is measured before the screenshot');
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.message')::uuid;
select is(pg_temp.jobs(current_setting('test.message')::uuid), 1, 'the screenshot queues its blueprint');
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.message')::uuid;
select is(pg_temp.jobs(current_setting('test.message')::uuid), 1, 'a second screenshot queues nothing more');

-- An email no brand uses is not measured; assigned later, it is.
select set_config('test.lonely', pg_temp.message(2)::text, true);
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.lonely')::uuid;
select is(pg_temp.jobs(current_setting('test.lonely')::uuid), 0, 'an email no workspace can use is not measured');
select pg_temp.assign(current_setting('test.lonely')::uuid, 2);
select is(pg_temp.jobs(current_setting('test.lonely')::uuid), 1, 'assigned to a brand, it is queued');
-- Without a marked copy there is nothing to measure.
select set_config('test.plain', pg_temp.message(3, false)::text, true);
select pg_temp.assign(current_setting('test.plain')::uuid, 3);
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.plain')::uuid;
select is(pg_temp.jobs(current_setting('test.plain')::uuid), 0, 'an email without a marked copy is never queued');

-- The backfill's rule is the same one.
select ok(private.blueprint_wanted(current_setting('test.message')::uuid)
  and not private.blueprint_wanted(current_setting('test.plain')::uuid)
  and not private.blueprint_wanted(pg_temp.message(4)), 'one rule: used by a brand, marked and photographed');

-- Platform admins read blueprints; members of a workspace do not.
set local role service_role;
select is(public.request_inbox_blueprint(current_setting('test.email')::uuid), 'waiting', 'first use: it is waiting');
select is(public.request_inbox_blueprint(gen_random_uuid()), 'none', 'an unknown email has none');
select is(public.request_inbox_blueprint((select id from public.competitor_emails where external_id = 'msg:bp3')), 'none', 'an email without a marked copy has none');
select pg_temp.claim(current_setting('test.message'));
select is((select status from public.platform_jobs where id = current_setting('test.job')::uuid), 'leased', 'the browser claims it');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid)$$,
  '23514', null, 'a blueprint or a failure is needed');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.bp('{"version": 2}'))$$, '23514', null, 'only version 1');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.with_part('{"type":"image","src":"https://inbox.example/a.png"}'))$$,
  '23514', 'A stored blueprint keeps no picture or link', 'never a picture address');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid,
  pg_temp.with_part('{"type":"text","runs":[{"text":"x","href":"https://inbox.example/"}]}'))$$,
  '23514', 'A stored blueprint keeps no picture or link', 'never a link');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, gen_random_uuid(), pg_temp.bp())$$,
  'PT409', null, 'a stale lease records nothing');
select is(public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, pg_temp.bp()), 'ready',
  'the blueprint is recorded');
select is((select state || '/' || sections || '/' || unsupported from public.inbox_blueprints where inbox_message_id = current_setting('test.message')::uuid),
  'ready/2/1', 'with its sections and the ones that cannot be copied');
select is((select status from public.platform_jobs where id = current_setting('test.job')::uuid), 'succeeded', 'the job is finished');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, pg_temp.bp())$$,
  'PT409', null, 'a finished job records nothing more');
select is(public.request_inbox_blueprint(current_setting('test.email')::uuid), 'ready', 'the build reads it as ready');
select is((select count(*)::int from public.inbox_blueprints), 1, 'the worker reads the row');

reset role;
-- ...01 is a workspace owner, ...02 a platform admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select is((select count(*)::int from public.inbox_blueprints), 0, 'a workspace member sees no blueprint');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select is((select count(*)::int from public.inbox_blueprints), 1, 'a platform admin sees it');
reset role;
update public.inbox_messages set screenshot_at = now() + interval '1 minute' where id = current_setting('test.message')::uuid;
select is(pg_temp.jobs(current_setting('test.message')::uuid), 1, 'a measured email is never measured again');

-- Another kind of job, or an expired lease, records nothing.
set local role service_role;
select set_config('test.poll', public.enqueue_inbox_poll('fake')::text, true);
select set_config('test.polllease', (select lease_token::text from public.claim_platform_job(array['inbox.poll'], 'fake')), true);
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.poll')::uuid, current_setting('test.polllease')::uuid, pg_temp.bp())$$,
  '23514', 'Not a blueprint job', 'a poll job cannot record a blueprint');
select pg_temp.claim(current_setting('test.lonely'));
reset role;
update public.platform_jobs set lease_expires_at = now() - interval '1 second' where id = current_setting('test.job')::uuid;
set local role service_role;
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, pg_temp.bp())$$,
  'PT409', null, 'an expired lease records nothing');

-- An email that can never be measured is recorded as failed, with why.
reset role;
update public.platform_jobs set status = 'cancelled', lease_token = null, lease_expires_at = null where id = current_setting('test.job')::uuid;
select set_config('test.tall', pg_temp.message(6)::text, true);
select set_config('test.tallemail', pg_temp.assign(current_setting('test.tall')::uuid, 6)::text, true);
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.tall')::uuid;
set local role service_role;
select pg_temp.claim(current_setting('test.tall'));
select is((select status from public.platform_jobs where id = current_setting('test.job')::uuid), 'leased', 'the next email is claimed');
select throws_ok($$select public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, null, 'Too Tall')$$,
  '23514', null, 'a failure is a short code');
select is(public.record_inbox_blueprint(current_setting('test.job')::uuid, current_setting('test.lease')::uuid, null, 'too_tall'), 'failed',
  'a failure is recorded');
select is(public.request_inbox_blueprint(current_setting('test.tallemail')::uuid), 'failed', 'and the build reads it as failed');

-- A job that failed four times leaves no row: failed for a day, then tried once more.
reset role;
select set_config('test.flaky', pg_temp.message(7)::text, true);
select set_config('test.flakyemail', pg_temp.assign(current_setting('test.flaky')::uuid, 7)::text, true);
update public.inbox_messages set screenshot_at = now() where id = current_setting('test.flaky')::uuid;
update public.platform_jobs set status = 'failed', attempt = 4, finished_at = now()
  where kind = 'inbox.blueprint' and subject_key = current_setting('test.flaky');
set local role service_role;
select is(public.request_inbox_blueprint(current_setting('test.flakyemail')::uuid), 'failed', 'a job that failed four times reads as failed, with no row');
reset role;
update public.platform_jobs set finished_at = now() - interval '25 hours'
  where kind = 'inbox.blueprint' and subject_key = current_setting('test.flaky');
set local role service_role;
select is(public.request_inbox_blueprint(current_setting('test.flakyemail')::uuid), 'waiting', 'a day later it is queued again');
select is((select string_agg(status, ',' order by created_at, status) from public.platform_jobs
  where kind = 'inbox.blueprint' and subject_key = current_setting('test.flaky')), 'failed,queued', 'beside the old failed job, kept under another key');

select * from finish();
rollback;
