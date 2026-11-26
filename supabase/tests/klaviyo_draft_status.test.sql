begin;
select plan(44);

-- PICK-99: when Klaviyo will send a scheduled draft, whether its design
-- was changed there, and the owner's page asking for one email's check.
-- Workspace 101 (owner ...01) and workspace 102 (owner ...04).
select ok(not has_function_privilege(r, 'public.claim_klaviyo_result(uuid,uuid,integer)', 'execute'),
  r||' cannot claim one email''s check')
  from unnest(array['anon', 'authenticated']) r;
select ok(has_function_privilege('service_role', 'public.claim_klaviyo_result(uuid,uuid,integer)', 'execute'),
  'the service role claims one email''s check');
select ok(not has_function_privilege(r, 'public.save_klaviyo_result(uuid,uuid,jsonb)', 'execute'), r||' still cannot save')
  from unnest(array['anon', 'authenticated']) r;
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('public', 'claim_klaviyo_result'), ('public', 'save_klaviyo_result'))
    and p.prosecdef and p.proconfig @> array['search_path=""']), 2,
  'both run as their owner with an empty search path');
select ok(not bool_or(has_column_privilege(r, 'public.klaviyo_email_results', c, 'update')),
  'nobody writes the new columns directly')
  from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['scheduled_for', 'send_strategy', 'design_changed']) c;

insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e301','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}',
   '{"mode":"auto"}', jsonb_build_object('slots', jsonb_build_array(
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'offer'),
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'))),
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e302','00000000-0000-4000-8000-000000000102',current_date,'planned','{"offers":[]}',
   '{"mode":"auto"}', '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"}]}',
   '00000000-0000-4000-8000-000000000004');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, klaviyo_campaign_id, sample_draft,
    created_by, step) values
  ('00000000-0000-4000-8000-00000000b301','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',0,
   '00000000-0000-4000-8000-00000000c301','drafted','{"html":""}','CmpS01',false,'00000000-0000-4000-8000-000000000001','push'),
  ('00000000-0000-4000-8000-00000000b303','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e301',1,
   '00000000-0000-4000-8000-00000000c303','drafted','{"html":""}','CmpS03',false,'00000000-0000-4000-8000-000000000001','push'),
  ('00000000-0000-4000-8000-00000000b302','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e302',0,
   '00000000-0000-4000-8000-00000000c302','drafted','{"html":""}','CmpS02',false,'00000000-0000-4000-8000-000000000004','push');
insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000b301','00000000-0000-4000-8000-00000000e301',0,false,
   'CmpS01','MsgS01', jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'))),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000b303','00000000-0000-4000-8000-00000000e301',1,false,
   'CmpS03','MsgS03', jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'))),
  ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000b302','00000000-0000-4000-8000-00000000e302',0,false,
   'CmpS02','MsgS02', '{"date":"2099-01-01"}');

create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.b(n text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000b'||n)::uuid
$$;
create function pg_temp.t(n text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-000000000'||n)::uuid
$$;
create function pg_temp.lease(n text) returns uuid language sql as $$
  select lease_token from public.klaviyo_email_results where build_id = pg_temp.b(n)
$$;
create function pg_temp.save(n text, patch jsonb) returns void language sql as $$
  select public.save_klaviyo_result(pg_temp.b(n), pg_temp.lease(n), patch)
$$;
create function pg_temp.claim(t text, n text, fresh integer default 600) returns integer language sql as $$
  select count(*)::integer from public.claim_klaviyo_result(pg_temp.t(t), pg_temp.b(n), fresh)
$$;
create function pg_temp.at(hours integer) returns text language sql as $$
  select to_jsonb(now() + make_interval(hours => hours))::text
$$;

-- Only the service role, with a sensible cache.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.claim('101', '301')$$,'42501',null,'no request role, no claim');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.claim('101', '301')$$,'42501',null,'a member''s request cannot claim');
select pg_temp.as_worker();
select throws_ok($$select pg_temp.claim('101', '301', 59)$$,'23514',null,'a cache under a minute is refused');
select throws_ok($$select pg_temp.claim('101', '301', 3601)$$,'23514',null,'and one over an hour');
select throws_ok($$select count(*) from public.claim_klaviyo_result(null, pg_temp.b('301'))$$,'23514',null,
  'a claim needs its workspace');

-- One email's check, only in its own workspace, leased a minute.
select is(pg_temp.claim('102', '301'), 0, 'another workspace''s email is never claimed');
select is(pg_temp.claim('101', '301'), 1, 'its own workspace''s draft is claimed');
select ok((select lease_until between now() + interval '50 seconds' and now() + interval '61 seconds'
  from public.klaviyo_email_results where build_id = pg_temp.b('301')), 'leased for a minute');
select is(pg_temp.claim('101', '301'), 0, 'a leased check is not taken twice');
select is((select count(*)::integer from public.claim_klaviyo_results(10)
  where build_id = pg_temp.b('301')), 0, 'nor by the hourly run');

-- Scheduled in Klaviyo, with its time and how, and its design changed.
select lives_ok(format($$select pg_temp.save('301', '{"status":"scheduled","scheduled_for":%s,"send_strategy":"static",
  "design_changed":true,"next_check_at":%s}')$$, pg_temp.at(48), pg_temp.at(1)), 'a scheduled draft is saved with its time');
select is((select row(status, scheduled_for > now() + interval '47 hours', send_strategy, design_changed, changed,
  lease_token is null)::text from public.klaviyo_email_results where build_id = pg_temp.b('301')),
  '(scheduled,t,static,t,f,t)', 'its time, how, the design change; the lease let go');
select is(pg_temp.claim('101', '301'), 0, 'checked just now: the page reads what is saved (cached)');
reset role;
update public.klaviyo_email_results set checked_at = now() - interval '11 minutes' where build_id = pg_temp.b('301');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('101', '301'), 1, 'ten minutes on, the page reads it again');
select lives_ok(format($$select pg_temp.save('301', '{"status":"draft","design_changed":false,"next_check_at":%s}')$$,
  pg_temp.at(1)), 'back to a draft (the owner unscheduled it)');
select is((select row(status, scheduled_for, send_strategy, design_changed)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('301')), '(draft,,,t)', 'no longer scheduled: no time; a design change seen stays seen');

-- What a save may say about the send time, how, and the design.
reset role;
-- The hourly claim above leased the others: let them go.
update public.klaviyo_email_results set lease_token = null, lease_until = null where build_id <> pg_temp.b('301');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('101', '303'), 1, 'another draft claimed');
select throws_ok(format($$select pg_temp.save('303', '{"status":"draft","scheduled_for":%s,"next_check_at":%s}')$$,
  pg_temp.at(48), pg_temp.at(1)),'23514',null,'no send time for a draft');
select throws_ok(format($$select pg_temp.save('303', '{"status":"scheduled","scheduled_for":7,"next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'a send time is a time');
select throws_ok(format($$select pg_temp.save('303', '{"status":"scheduled","scheduled_for":"soon","next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'a real time');
select throws_ok(format($$select pg_temp.save('303', '{"status":"scheduled","scheduled_for":%s,"next_check_at":%s}')$$,
  pg_temp.at(24 * 600), pg_temp.at(1)),'23514',null,'not years ahead');
select throws_ok(format($$select pg_temp.save('303', '{"status":"scheduled","scheduled_for":%s,"next_check_at":%s}')$$,
  to_jsonb(now() - interval '30 days')::text, pg_temp.at(1)),'23514',null,'nor long before the email was built');
select throws_ok(format($$select pg_temp.save('303', '{"status":"scheduled","send_strategy":"Local Time","next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'how it sends is a plain word');
select throws_ok(format($$select pg_temp.save('303', '{"status":"draft","send_strategy":"static","next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'and only while scheduled');
select throws_ok(format($$select pg_temp.save('303', '{"status":"draft","design_changed":"yes","next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'a design change is true or false');
select lives_ok(format($$select pg_temp.save('303', '{"status":"sending","scheduled_for":%s,"send_strategy":"local_timezone",
  "next_check_at":%s}')$$, to_jsonb(now() - interval '10 minutes')::text, pg_temp.at(1)), 'sending, with its time');
select is((select row(status, send_strategy, scheduled_for < now())::text from public.klaviyo_email_results
  where build_id = pg_temp.b('303')), '(sending,local_timezone,t)', 'kept while sending');

-- Sent, final or a paused workspace: nothing to claim for a page.
reset role;
update public.klaviyo_email_results set status = 'sent', sent_at = now() - interval '1 hour', scheduled_for = null,
  send_strategy = null, checked_at = null where build_id = pg_temp.b('303');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('101', '303'), 0, 'a sent email''s page reads nothing (its results are the hourly run''s)');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('301');
update public.tenants set status = 'paused' where id = pg_temp.t('101');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('101', '301'), 0, 'a paused workspace''s email is not claimed');
reset role;
update public.tenants set status = 'active' where id = pg_temp.t('101');
update public.klaviyo_email_results set status = 'deleted', final = true, checked_at = null where build_id = pg_temp.b('301');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('101', '301'), 0, 'a deleted (final) email is not claimed');

-- The table keeps a send time only while scheduled or sending.
reset role;
select throws_ok($$update public.klaviyo_email_results set scheduled_for = now() where build_id = pg_temp.b('302')$$,
  '23514', null, 'a draft has no send time, even written directly');

-- Members read their own workspace's rows, with the new columns; never another's.
update public.klaviyo_email_results set status = 'scheduled', scheduled_for = now() + interval '2 days',
  send_strategy = 'static' where build_id = pg_temp.b('302');
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_email_results where build_id = pg_temp.b('302')
  and scheduled_for is not null and send_strategy = 'static'), 1, 'the owner reads his own email''s send time');
select is((select count(*)::integer from public.klaviyo_email_results where tenant_id = pg_temp.t('101')), 0,
  'and nothing of another workspace');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.klaviyo_email_results where build_id = pg_temp.b('302')), 0,
  'the other owner cannot read it');
select is((select count(*)::integer from public.klaviyo_email_results where build_id in (pg_temp.b('301'), pg_temp.b('303'))),
  2, 'but reads his own');
select throws_ok($$update public.klaviyo_email_results set design_changed = false where build_id = pg_temp.b('301')$$,
  '42501', null, 'a member cannot clear an edit');
select throws_ok($$select count(*) from public.claim_klaviyo_result(pg_temp.t('101'), pg_temp.b('301'), 600)$$,
  '42501', null, 'nor ask for a check from the browser');

select * from finish();
rollback;
