begin;
select plan(74);

-- PICK-107: notices for a ready plan, drafts in Klaviyo and first results.
-- Workspace 101: owner ...01, staff ...05, manager (admin) ...06.
-- Workspace 102: owner ...04.

-- Who may do what.
select ok(not bool_or(has_table_privilege(r, 'public.notification_events', p)), r || ' cannot touch the event ledger')
  from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete']) p
  group by r;
select ok(not bool_or(has_table_privilege(r, 'public.notifications', p)), r || ' cannot write notices directly')
  from unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p
  group by r;
select ok(not bool_or(has_table_privilege(r, 'public.notification_settings', p)), r || ' cannot write the email switch directly')
  from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['insert', 'update', 'delete', 'truncate']) p
  group by r;
select ok(not has_function_privilege('anon', f, 'execute'), 'anon cannot call ' || f)
  from unnest(array['public.mark_notifications_read(uuid,uuid[])', 'public.set_notification_email(uuid,boolean)',
    'public.claim_notification_emails(integer)']) f;
select ok(not has_function_privilege('authenticated', 'public.claim_notification_emails(integer)', 'execute'),
  'members cannot claim emails');
select ok(has_function_privilege('service_role', 'public.claim_notification_emails(integer)', 'execute'), 'the sweep claims emails');
select ok(not has_function_privilege(r, 'private.post_notice(uuid,text,text,text,uuid,text,text)', 'execute'),
  r || ' cannot post a notice') from unnest(array['anon', 'authenticated', 'service_role']) r;
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('public', 'mark_notifications_read'), ('public', 'set_notification_email'),
    ('public', 'claim_notification_emails'), ('private', 'post_notice'), ('private', 'notice_recipients'),
    ('private', 'notice_plan_ready'), ('private', 'notice_email_drafted'), ('private', 'notice_results_in'))
    and p.prosecdef and p.proconfig @> array['search_path=""']), 8,
  'each function runs as its owner with an empty search path');

create function pg_temp.items(t uuid, k text) returns integer language sql as $$
  select count(*)::integer from public.notifications where tenant_id = t and kind = k $$;
create function pg_temp.line(who uuid, k text) returns text language sql as $$
  select message from public.notifications where recipient_id = who and kind = k order by updated_at desc, created_at desc limit 1 $$;
create function pg_temp.as_member(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true) $$;

-- 1. A plan becomes ready through the plan job (its lease), once.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e901', '00000000-0000-4000-8000-000000000101', current_date + 1, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select set_config('test.lease', (select c.lease_token::text from public.claim_strategy_run('00000000-0000-4000-8000-00000000e901') c), true);
select lives_ok($$select public.finish_strategy_plan('00000000-0000-4000-8000-00000000e901', current_setting('test.lease')::uuid,
  '{"slots":[{"date":"2026-12-01","time":"09:00"}]}')$$, 'the plan job finishes the plan');
select throws_ok($$select public.finish_strategy_plan('00000000-0000-4000-8000-00000000e901', current_setting('test.lease')::uuid,
  '{"slots":[]}')$$, 'PT409', 'Lease unavailable', 'a retried finish is refused');
reset role;
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'plan_ready'), 3, 'each of the three members is told once');
select is(pg_temp.items('00000000-0000-4000-8000-000000000102', 'plan_ready'), 0, 'another workspace is not told');
select is((select row(message, href, read_at is null, event_key)::text from public.notifications
  where recipient_id = '00000000-0000-4000-8000-000000000001' and kind = 'plan_ready'),
  '("Your 15-day plan is ready",/plan,t,plan_ready:00000000-0000-4000-8000-00000000e901)', 'one plain line, a link, unread');
select is((select count(*)::integer from public.notification_events where event_key = 'plan_ready:00000000-0000-4000-8000-00000000e901'),
  1, 'the event is recorded once');

-- A replayed state change (the run going ready again) adds nothing and
-- keeps what was read.
update public.notifications set read_at = now() where recipient_id = '00000000-0000-4000-8000-000000000001' and kind = 'plan_ready';
update public.strategy_runs set state = 'plan_queued', plan = null where id = '00000000-0000-4000-8000-00000000e901';
update public.strategy_runs set state = 'planned', plan = '{"slots":[]}' where id = '00000000-0000-4000-8000-00000000e901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'plan_ready'), 3, 'a replay makes no second notice');
select ok((select read_at is not null from public.notifications
  where recipient_id = '00000000-0000-4000-8000-000000000001' and kind = 'plan_ready'), 'and does not mark it unread again');
-- Other updates of a planned run are not a new event.
update public.strategy_runs set updated_at = now() where id = '00000000-0000-4000-8000-00000000e901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'plan_ready'), 3, 'touching a planned run tells nobody');

-- 2. Drafts that finish close together are one item.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e902', '00000000-0000-4000-8000-000000000101', current_date - 30, 'planned',
   '{"offers":[]}', '{"mode":"auto"}',
   '{"slots":[{"date":"2026-12-01","time":"09:00"},{"date":"2026-12-03","time":"09:00"},{"date":"2026-12-05","time":"09:00"}]}',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e903', '00000000-0000-4000-8000-000000000102', current_date - 30, 'planned',
   '{"offers":[],"sample":true}', '{"mode":"auto"}',
   '{"slots":[{"date":"2026-12-01","time":"09:00"},{"date":"2026-12-02","time":"09:00"}]}',
   '00000000-0000-4000-8000-000000000004');
insert into public.email_builds (id, tenant_id, run_id, slot, state, email, created_by, step) values
  ('00000000-0000-4000-8000-00000000b901', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e902', 0,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push'),
  ('00000000-0000-4000-8000-00000000b902', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e902', 1,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push'),
  ('00000000-0000-4000-8000-00000000b903', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e902', 2,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push'),
  ('00000000-0000-4000-8000-00000000b904', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000e903', 0,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000004', 'push');
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpN01' where id = '00000000-0000-4000-8000-00000000b901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'drafts_ready'), 3, 'the first draft makes one item each');
select is(pg_temp.line('00000000-0000-4000-8000-000000000001', 'drafts_ready'), '1 of 3 drafts is in Klaviyo', 'counted against the plan');
update public.notifications set read_at = now() where recipient_id = '00000000-0000-4000-8000-000000000001' and kind = 'drafts_ready';
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpN02' where id = '00000000-0000-4000-8000-00000000b902';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'drafts_ready'), 3, 'the next draft joins the same item');
select is(pg_temp.line('00000000-0000-4000-8000-000000000001', 'drafts_ready'), '2 of 3 drafts are in Klaviyo', 'which now says two');
select ok((select read_at is null from public.notifications
  where recipient_id = '00000000-0000-4000-8000-000000000001' and kind = 'drafts_ready'), 'and is new again for who had read it');
select is((select count(distinct event_key)::integer from public.notifications where kind = 'drafts_ready'
  and tenant_id = '00000000-0000-4000-8000-000000000101'), 1, 'one item for the two drafts');
-- A draft long after the last one starts a new item.
update public.notifications set updated_at = now() - interval '2 hours', read_at = now()
  where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'drafts_ready';
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpN03' where id = '00000000-0000-4000-8000-00000000b903';
select is((select count(distinct event_key)::integer from public.notifications where kind = 'drafts_ready'
  and tenant_id = '00000000-0000-4000-8000-000000000101'), 2, 'a draft after an hour of quiet is a new item');
select is(pg_temp.line('00000000-0000-4000-8000-000000000005', 'drafts_ready'), '3 of 3 drafts are in Klaviyo', 'saying the plan''s count');
select is((select count(*)::integer from public.notifications where tenant_id = '00000000-0000-4000-8000-000000000101'
  and kind = 'drafts_ready' and read_at is not null), 3, 'the older item stays read');
-- A replayed draft adds nothing.
update public.email_builds set state = 'push_queued', klaviyo_campaign_id = null where id = '00000000-0000-4000-8000-00000000b902';
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpN02' where id = '00000000-0000-4000-8000-00000000b902';
select is((select count(*)::integer from public.notification_events where event_key like 'drafted:%'
  and tenant_id = '00000000-0000-4000-8000-000000000101'), 3, 'each draft is one event');
select is(pg_temp.line('00000000-0000-4000-8000-000000000005', 'drafts_ready'), '3 of 3 drafts are in Klaviyo', 'and the item is unchanged');
-- A sample brand's draft says it is a sample.
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'sample-draft-n4', sample_draft = true
  where id = '00000000-0000-4000-8000-00000000b904';
select is(pg_temp.line('00000000-0000-4000-8000-000000000004', 'drafts_ready'), '1 of 2 sample drafts is ready', 'a sample draft is not called a Klaviyo draft');
select is(pg_temp.items('00000000-0000-4000-8000-000000000102', 'drafts_ready'), 1, 'told only in its own workspace');

-- 3. An email's first results.
insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned, status, sent_at) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000b901', '00000000-0000-4000-8000-00000000e902', 0,
   false, 'CmpN01', 'MsgN01', '{"date":"2026-12-01","time":"09:00"}', 'sent', now() - interval '2 days');
update public.klaviyo_email_results set checked_at = now() where build_id = '00000000-0000-4000-8000-00000000b901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'results_in'), 0, 'a status check is not results');
update public.klaviyo_email_results set pulls = 1, results_at = now() where build_id = '00000000-0000-4000-8000-00000000b901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'results_in'), 3, 'the first results tell every member');
select is((select row(message, href)::text from public.notifications
  where recipient_id = '00000000-0000-4000-8000-000000000006' and kind = 'results_in'),
  '("Results are in for the Tuesday, Dec 1 email",/plan/email/00000000-0000-4000-8000-00000000b901)', 'naming the email and opening it');
update public.klaviyo_email_results set pulls = 2 where build_id = '00000000-0000-4000-8000-00000000b901';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'results_in'), 3, 'the next daily read adds no item');

-- 4. Each person reads only their own items; mark as read is theirs.
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select count(*)::integer from public.notifications where event_key is not null), 4, 'staff read their own four items');
select is((select count(distinct recipient_id)::integer from public.notifications), 1, 'and nobody else''s');
select is((select count(*)::integer from public.notification_settings), 0, 'the email switch is not set yet');
select throws_ok($$select * from public.notification_events$$, '42501', null, 'the event ledger is closed');
select throws_ok($$update public.notifications set read_at = now()$$, '42501', null, 'nor can a notice be changed directly');
select is(public.mark_notifications_read('00000000-0000-4000-8000-000000000101',
  array[(select id from public.notifications where kind = 'results_in')]), 1, 'staff mark one item read');
select is((select count(*)::integer from public.notifications where read_at is null), 2, 'the other unread ones stay unread');
select is(public.mark_notifications_read('00000000-0000-4000-8000-000000000101',
  array[(select id from public.notifications where kind = 'results_in')]), 0, 'marking it again changes nothing');
select is(public.mark_notifications_read('00000000-0000-4000-8000-000000000101'), 2, 'mark all read');
select throws_ok($$select public.mark_notifications_read('00000000-0000-4000-8000-000000000102')$$, '42501', null,
  'not in another workspace');
select throws_ok($$select public.set_notification_email('00000000-0000-4000-8000-000000000101', true)$$, '42501', null,
  'staff cannot turn email on');
reset role;
select is((select count(*)::integer from public.notifications where recipient_id = '00000000-0000-4000-8000-000000000001'
  and read_at is null), 2, 'the owner''s items are still unread');

select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.notifications where tenant_id = '00000000-0000-4000-8000-000000000101'), 0,
  'another workspace reads none of them');
select is(public.mark_notifications_read('00000000-0000-4000-8000-000000000102',
  (select array_agg(id) from public.notifications)), 1, 'its owner marks only his own');
select throws_ok($$select public.set_notification_email('00000000-0000-4000-8000-000000000101', true)$$, '42501', null,
  'nor turns email on for another workspace');
reset role;
select is((select count(*)::integer from public.notifications where tenant_id = '00000000-0000-4000-8000-000000000101'
  and read_at is null and recipient_id = '00000000-0000-4000-8000-000000000001'), 2, 'which left workspace 101 alone');
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select throws_ok($$select public.mark_notifications_read('00000000-0000-4000-8000-000000000101')$$, '42501', null,
  'a call with no person marks nothing');
reset role;

-- 5. Email: off unless the owner turns it on, each item once.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::integer from public.claim_notification_emails(50)), 0, 'with email off nothing is emailed');
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role service_role;
select throws_ok($$select * from public.claim_notification_emails(50)$$, '42501', null, 'only the sweep claims');
reset role;

-- Items made before email was on are never emailed.
update public.notifications set created_at = created_at - interval '1 minute' where event_key is not null;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.set_notification_email('00000000-0000-4000-8000-000000000101', true), true, 'the owner turns email on');
select is(public.set_notification_email('00000000-0000-4000-8000-000000000101', true), false, 'again changes nothing');
select is((select email_on from public.notification_settings), true, 'members read the switch');
reset role;
select is((select count(*)::integer from public.workspace_events where kind = 'notification_email_set'
  and tenant_id = '00000000-0000-4000-8000-000000000101'), 1, 'the change is recorded once');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::integer from public.claim_notification_emails(50)), 0, 'older items are not emailed');
reset role;

-- A new ready plan after it: every member's item, once.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e904', '00000000-0000-4000-8000-000000000101', current_date + 2, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000001');
update public.strategy_runs set state = 'planned', plan = '{"slots":[]}' where id = '00000000-0000-4000-8000-00000000e904';
-- And a draft that joins nothing (its plan has no recent item) but is fresh.
insert into public.email_builds (id, tenant_id, run_id, slot, state, email, created_by, step) values
  ('00000000-0000-4000-8000-00000000b905', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e904', 0,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push');
update public.email_builds set state = 'drafted', klaviyo_campaign_id = 'CmpN05' where id = '00000000-0000-4000-8000-00000000b905';
select is(pg_temp.line('00000000-0000-4000-8000-000000000001', 'drafts_ready'), 'Your draft is in Klaviyo', 'a one-email plan''s draft');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select string_agg(kind || ':' || message, ',' order by recipient_id) from public.claim_notification_emails(50)),
  'plan_ready:Your 15-day plan is ready,plan_ready:Your 15-day plan is ready,plan_ready:Your 15-day plan is ready',
  'the new plan is emailed to each member; a fresh drafts item waits');
select is((select count(*)::integer from public.claim_notification_emails(50)), 0, 'a second sweep emails nothing again');
reset role;
select is((select count(*)::integer from public.notification_deliveries d join public.notifications n on n.id = d.notification_id
  where n.kind = 'plan_ready' and d.state = 'simulated' and d.provider = 'fixture'), 3, 'recorded as simulated, never as sent');
-- Once the drafts item has been quiet for an hour, it goes.
update public.notifications set updated_at = now() - interval '61 minutes'
  where kind = 'drafts_ready' and entity_id = '00000000-0000-4000-8000-00000000e904';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::integer from public.claim_notification_emails(50)), 3, 'the settled drafts item is emailed');
reset role;
-- Turned off: nothing more goes.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.set_notification_email('00000000-0000-4000-8000-000000000101', false), true, 'the owner turns email off');
reset role;
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e905', '00000000-0000-4000-8000-000000000101', current_date + 3, 'offers_ready',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000001');
update public.strategy_runs set state = 'plan_queued' where id = '00000000-0000-4000-8000-00000000e905';
update public.strategy_runs set state = 'planned', plan = '{"slots":[]}' where id = '00000000-0000-4000-8000-00000000e905';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::integer from public.claim_notification_emails(50)), 0, 'with email off again, nothing goes');
reset role;

select * from finish();
rollback;
