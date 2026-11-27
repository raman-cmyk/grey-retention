begin;
select plan(29);

-- PICK-107 review fixes. Workspace 101: owner ...01, staff ...05, manager
-- (admin) ...06. Workspace 102: owner ...04.

create function pg_temp.items(t uuid, k text) returns integer language sql as $$
  select count(*)::integer from public.notifications where tenant_id = t and kind = k $$;
create function pg_temp.as_member(who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true) $$;
create function pg_temp.as_job() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
grant execute on function pg_temp.as_job() to service_role;

-- The finishes take the workspace first, as their source shows.
select ok(pg_get_functiondef(f) ~ 'from public\.tenants where id = t for share.*leased_', f::text || ' locks the workspace before its row')
  from unnest(array['public.finish_strategy_plan(uuid,uuid,jsonb)'::regprocedure,
    'public.finish_email_push(uuid,uuid,text,boolean)'::regprocedure]) f;
select ok(not has_function_privilege('authenticated', f, 'execute'), 'members cannot call ' || f::text)
  from unnest(array['public.finish_strategy_plan(uuid,uuid,jsonb)'::regprocedure,
    'public.finish_email_push(uuid,uuid,text,boolean)'::regprocedure]) f;

-- 1. The real plan finish and the real draft push, as the job.
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e911', '00000000-0000-4000-8000-000000000101', current_date + 1, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000001');
update public.strategy_runs set lease_token = '00000000-0000-4000-8000-00000000aa11', lease_until = now() + interval '5 minutes'
  where id = '00000000-0000-4000-8000-00000000e911';
-- Staff (...05) left the team before the plan was ready.
update public.tenant_memberships set status = 'inactive'
  where tenant_id = '00000000-0000-4000-8000-000000000101' and profile_id = '00000000-0000-4000-8000-000000000005';
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_strategy_plan('00000000-0000-4000-8000-00000000e911', '00000000-0000-4000-8000-00000000aa11',
  '{"slots":[{"date":"2026-12-01","time":"09:00"},{"date":"2026-12-03","time":"09:00"}]}')$$, 'the plan job finishes the plan');
reset role;
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'plan_ready'), 2, 'the owner and the manager are told');
select is((select count(*)::integer from public.notifications where recipient_id = '00000000-0000-4000-8000-000000000005'), 0,
  'someone no longer in the team is not');

insert into public.email_builds (id, tenant_id, run_id, slot, state, email, created_by, step, lease_token, lease_until) values
  ('00000000-0000-4000-8000-00000000b911', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e911', 0,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push', '00000000-0000-4000-8000-00000000aa12',
   now() + interval '5 minutes'),
  ('00000000-0000-4000-8000-00000000b912', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000e911', 1,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000001', 'push', '00000000-0000-4000-8000-00000000aa13',
   now() + interval '5 minutes');
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_email_push('00000000-0000-4000-8000-00000000b911', '00000000-0000-4000-8000-00000000aa12',
  'CmpF11', false)$$, 'the push job finishes the draft');
select throws_ok($$select public.finish_email_push('00000000-0000-4000-8000-00000000b911', '00000000-0000-4000-8000-00000000aa12',
  'CmpF11', false)$$, 'PT409', 'Lease unavailable', 'a retried push is refused');
reset role;
select is((select string_agg(distinct message, ',') from public.notifications where kind = 'drafts_ready'
  and entity_id = '00000000-0000-4000-8000-00000000e911'), '1 of 2 drafts is in Klaviyo', 'the draft is told once');
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'drafts_ready'), 2, 'to the two members still in the team');

-- 2. Email: the owner only; an emailed drafts item is closed.
select pg_temp.as_member('00000000-0000-4000-8000-000000000006');
set local role authenticated;
select throws_ok($$select public.set_notification_email('00000000-0000-4000-8000-000000000101', true)$$, '42501', null,
  'a manager cannot turn email on');
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.set_notification_email('00000000-0000-4000-8000-000000000101', true), true, 'the owner turns email on');
reset role;
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::integer from public.notification_settings), 0, 'another workspace cannot read the switch');
reset role;
-- Made "after" the switch, and the drafts item quiet for an hour.
update public.notifications set created_at = now() + interval '1 second', updated_at = now() - interval '61 minutes'
  where tenant_id = '00000000-0000-4000-8000-000000000101';
select pg_temp.as_job();
set local role service_role;
select is((select string_agg(recipient_id || ':' || kind, ',' order by kind) from public.claim_notification_emails(50)),
  '00000000-0000-4000-8000-000000000001:drafts_ready,00000000-0000-4000-8000-000000000001:plan_ready',
  'the owner alone is emailed the plan and the drafts');
-- The second draft, after the item was emailed, starts a new item.
select lives_ok($$select public.finish_email_push('00000000-0000-4000-8000-00000000b912', '00000000-0000-4000-8000-00000000aa13',
  'CmpF12', false)$$, 'a later draft');
reset role;
select is((select count(distinct event_key)::integer from public.notifications where kind = 'drafts_ready'
  and entity_id = '00000000-0000-4000-8000-00000000e911'), 2, 'does not join the item already emailed');
select is((select message from public.notifications where kind = 'drafts_ready' and event_key = 'drafts_ready:00000000-0000-4000-8000-00000000b911'
  and recipient_id = '00000000-0000-4000-8000-000000000001'), '1 of 2 drafts is in Klaviyo', 'which keeps what was emailed');
-- Results stay in the app.
insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned, status, sent_at) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000b911', '00000000-0000-4000-8000-00000000e911', 0,
   false, 'CmpF11', 'MsgF11', '{"date":"2026-12-01"}', 'sent', now() - interval '2 days');
update public.klaviyo_email_results set pulls = 1 where build_id = '00000000-0000-4000-8000-00000000b911';
update public.notifications set created_at = now() + interval '1 second' where kind = 'results_in';
select is(pg_temp.items('00000000-0000-4000-8000-000000000101', 'results_in'), 2, 'results are told in the app');
-- The owner's account is turned off: nothing is emailed to him any more.
update public.profiles set status = 'inactive' where id = '00000000-0000-4000-8000-000000000001';
update public.notifications set updated_at = now() - interval '61 minutes' where kind = 'drafts_ready';
select pg_temp.as_job();
set local role service_role;
select is((select count(*)::integer from public.claim_notification_emails(50)), 0,
  'results are not emailed, nor anything to someone no longer in the team');
reset role;
update public.profiles set status = 'active' where id = '00000000-0000-4000-8000-000000000001';
update public.tenant_memberships set status = 'active'
  where tenant_id = '00000000-0000-4000-8000-000000000101' and profile_id = '00000000-0000-4000-8000-000000000005';

-- 3. A notice never stops the work it reports, and leaves the caller's
-- lock wait as it was.
set local lock_timeout = '7s';
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e912', '00000000-0000-4000-8000-000000000102', current_date + 1, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000004');
update public.strategy_runs set state = 'planned', plan = '{"slots":[]}' where id = '00000000-0000-4000-8000-00000000e912';
select is(current_setting('lock_timeout'), '7s', 'the caller''s lock wait is restored');
select is(pg_temp.items('00000000-0000-4000-8000-000000000102', 'plan_ready'), 1, 'a normal notice is written');

create or replace function private.post_notice(t uuid, event text, item text, notice_kind text, entity uuid, words text, link text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_events (tenant_id, event_key, item_key) values (t, event, item);
  raise exception 'notice broke' using errcode = 'XX000';
end $$;
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, created_by) values
  ('00000000-0000-4000-8000-00000000e913', '00000000-0000-4000-8000-000000000102', current_date + 2, 'plan_queued',
   '{"offers":[]}', '{"mode":"auto"}', '00000000-0000-4000-8000-000000000004');
update public.strategy_runs set lease_token = '00000000-0000-4000-8000-00000000aa14', lease_until = now() + interval '5 minutes'
  where id = '00000000-0000-4000-8000-00000000e913';
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_strategy_plan('00000000-0000-4000-8000-00000000e913', '00000000-0000-4000-8000-00000000aa14',
  '{"slots":[]}')$$, 'a failing notice does not fail the plan');
reset role;
select is((select state from public.strategy_runs where id = '00000000-0000-4000-8000-00000000e913'), 'planned', 'the plan is kept');
select is((select count(*)::integer from public.notification_events where event_key = 'plan_ready:00000000-0000-4000-8000-00000000e913'),
  0, 'and the failed notice left nothing half written');

-- A cancelled (timed-out) notice too.
create or replace function private.post_notice(t uuid, event text, item text, notice_kind text, entity uuid, words text, link text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'canceling statement due to statement timeout' using errcode = 'query_canceled';
end $$;
insert into public.email_builds (id, tenant_id, run_id, slot, state, email, created_by, step, lease_token, lease_until) values
  ('00000000-0000-4000-8000-00000000b913', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000e912', 0,
   'push_queued', '{"html":""}', '00000000-0000-4000-8000-000000000004', 'push', '00000000-0000-4000-8000-00000000aa15',
   now() + interval '5 minutes');
select pg_temp.as_job();
set local role service_role;
select lives_ok($$select public.finish_email_push('00000000-0000-4000-8000-00000000b913', '00000000-0000-4000-8000-00000000aa15',
  'CmpF13', false)$$, 'a cancelled notice does not fail the draft');
reset role;
select is((select state from public.email_builds where id = '00000000-0000-4000-8000-00000000b913'), 'drafted', 'the draft is kept');
select is(pg_temp.items('00000000-0000-4000-8000-000000000102', 'drafts_ready'), 0, 'with no notice');
select is(current_setting('lock_timeout'), '7s', 'and the lock wait restored after a failure');

select * from finish();
rollback;
