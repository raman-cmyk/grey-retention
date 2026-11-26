begin;
select plan(55);

-- PICK-99 review fixes: a design change only once seen twice, with its
-- evidence; the page claim keeps the sync's back-off; send times end with
-- the schedule; an operator clears a change seen in error, recorded.
-- Workspace 101 (owner ...01), operator ...02, workspace 102 (owner ...04).
select ok(not has_function_privilege('anon', 'public.clear_klaviyo_design_change(uuid,text)', 'execute'),
  'anonymous visitors cannot clear a design change');
select ok(has_function_privilege('authenticated', 'public.clear_klaviyo_design_change(uuid,text)', 'execute'),
  'a signed-in operator can ask (the function checks who)');
select ok(not has_function_privilege('service_role', 'public.clear_klaviyo_design_change(uuid,text)', 'execute'),
  'the service role cannot (the event names a person)');
select ok(not has_function_privilege(r, f, 'execute'), r||' cannot call '||f)
  from unnest(array['anon', 'authenticated']) r,
    unnest(array['private.klaviyo_design_evidence_ok(jsonb)', 'private.klaviyo_time_pattern()']) f;
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'clear_klaviyo_design_change'
    and p.prosecdef and p.proconfig @> array['search_path=""']), 1,
  'the clear runs as its owner with an empty search path');

insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e401','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}',
   '{"mode":"auto"}', jsonb_build_object('slots', jsonb_build_array(
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'offer'),
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'))),
   '00000000-0000-4000-8000-000000000001');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, klaviyo_campaign_id, sample_draft,
    created_by, step)
  select ('00000000-0000-4000-8000-00000000b40'||n)::uuid, '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-00000000e401', n - 1, ('00000000-0000-4000-8000-00000000c40'||n)::uuid, 'drafted',
    '{"html":""}', 'CmpE0'||n, false, '00000000-0000-4000-8000-000000000001', 'push'
  from generate_series(1, 4) n;
insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned)
  select '00000000-0000-4000-8000-000000000101', ('00000000-0000-4000-8000-00000000b40'||n)::uuid,
    '00000000-0000-4000-8000-00000000e401', n - 1, false, 'CmpE0'||n, 'MsgE0'||n,
    jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'))
  from generate_series(1, 4) n;

create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.b(n text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000b'||n)::uuid
$$;
create function pg_temp.lease(n text) returns uuid language sql as $$
  select lease_token from public.klaviyo_email_results where build_id = pg_temp.b(n)
$$;
create function pg_temp.save(n text, patch jsonb) returns void language sql as $$
  select public.save_klaviyo_result(pg_temp.b(n), pg_temp.lease(n), patch)
$$;
create function pg_temp.claim(n text, fresh integer default 600) returns integer language sql as $$
  select count(*)::integer from public.claim_klaviyo_result('00000000-0000-4000-8000-000000000101', pg_temp.b(n), fresh)
$$;
create function pg_temp.at(hours integer) returns text language sql as $$
  select to_jsonb(now() + make_interval(hours => hours))::text
$$;
create function pg_temp.evidence(checks integer default 1) returns text language sql as $$
  select jsonb_build_object('variation', 'VarA01', 'recorded', repeat('a', 16), 'current', repeat('b', 16),
    'firstSeenAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'lastSeenAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'checks', checks)::text
$$;
-- Lets every lease go (run as the test's own role).
create function pg_temp.release() returns void language sql as $$
  update public.klaviyo_email_results set lease_token = null, lease_until = null
$$;

set local role service_role;
select pg_temp.as_worker();

-- A design change only once seen twice, with its evidence.
select is(pg_temp.claim('401'), 1, 'a draft claimed for its page');
select throws_ok(format($$select pg_temp.save('401', '{"status":"draft","design_changed":true,"next_check_at":%s}')$$,
  pg_temp.at(1)),'23514',null,'no design change on a first sight (no evidence yet)');
select lives_ok(format($$select pg_temp.save('401', '{"status":"draft","design_evidence":%s,"next_check_at":%s}')$$,
  pg_temp.evidence(), pg_temp.at(1)), 'a first sight is kept as evidence');
select is((select row(design_changed, design_evidence->>'variation', (design_evidence->>'checks')::integer)::text
  from public.klaviyo_email_results where build_id = pg_temp.b('401')), '(f,VarA01,1)', 'evidence kept, not changed');
reset role;
update public.klaviyo_email_results set checked_at = now() - interval '11 minutes' where build_id = pg_temp.b('401');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('401'), 1, 'checked again');
select lives_ok(format($$select pg_temp.save('401', '{"status":"draft","design_changed":true,"design_evidence":%s,
  "next_check_at":%s}')$$, pg_temp.evidence(2), pg_temp.at(1)), 'the same difference seen again marks it changed');
select is((select row(design_changed, (design_evidence->>'checks')::integer)::text
  from public.klaviyo_email_results where build_id = pg_temp.b('401')), '(t,2)', 'changed, with its evidence');

-- Evidence of the right shape only; null clears it.
reset role;
select pg_temp.release();
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('402'), 1, 'another draft claimed');
select throws_ok(format($$select pg_temp.save('402', jsonb_build_object('status','draft','next_check_at',%s::jsonb,
  'design_evidence', %s::jsonb - 'checks'))$$, quote_literal(pg_temp.at(1)), quote_literal(pg_temp.evidence())),
  '23514', null, 'evidence needs its count');
select throws_ok(format($$select pg_temp.save('402', jsonb_build_object('status','draft','next_check_at',%s::jsonb,
  'design_evidence', %s::jsonb || '{"current":"<b>"}'))$$, quote_literal(pg_temp.at(1)), quote_literal(pg_temp.evidence())),
  '23514', null, 'what it shows now is a fingerprint or another template''s id');
select throws_ok(format($$select pg_temp.save('402', jsonb_build_object('status','draft','next_check_at',%s::jsonb,
  'design_evidence', %s::jsonb || '{"firstSeenAt":"2026-11-20T10:00:00"}'))$$, quote_literal(pg_temp.at(1)),
  quote_literal(pg_temp.evidence())), '23514', null, 'its times name their zone');
select throws_ok(format($$select pg_temp.save('402', jsonb_build_object('status','draft','next_check_at',%s::jsonb,
  'design_evidence', %s::jsonb || '{"extra":1}'))$$, quote_literal(pg_temp.at(1)), quote_literal(pg_temp.evidence())),
  '23514', null, 'and nothing else');
select lives_ok(format($$select pg_temp.save('402', '{"status":"draft","design_evidence":%s,"next_check_at":%s}')$$,
  pg_temp.evidence(), pg_temp.at(1)), 'evidence saved');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('402');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('402'), 1, 'claimed again');
select lives_ok(format($$select pg_temp.save('402', '{"status":"draft","design_evidence":null,"next_check_at":%s}')$$,
  pg_temp.at(1)), 'the design as left clears the evidence');
select is((select design_evidence from public.klaviyo_email_results where build_id = pg_temp.b('402')), null::jsonb,
  'no evidence left');

-- When and how it sends end with the schedule, through the save.
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('402');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('402'), 1, 'claimed again');
select throws_ok(format($$select pg_temp.save('402', '{"status":"scheduled","scheduled_for":"2030-01-14T09:00:00",
  "next_check_at":%s}')$$, pg_temp.at(1)),'23514',null,'a send time names its zone');
select lives_ok(format($$select pg_temp.save('402', '{"status":"scheduled","scheduled_for":%s,"send_strategy":"static",
  "next_check_at":%s}')$$, pg_temp.at(48), pg_temp.at(1)), 'scheduled with its time');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('402');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('402'), 1, 'a scheduled email is claimed');
select lives_ok(format($$select pg_temp.save('402', '{"status":"scheduled","scheduled_for":null,"next_check_at":%s}')$$,
  pg_temp.at(1)), 'still scheduled, its time no longer known');
select is((select row(status, scheduled_for, send_strategy)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('402')), '(scheduled,,static)', 'the time cleared, how kept');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('402');
set local role service_role;
select pg_temp.as_worker();
select pg_temp.claim('402');
select lives_ok(format($$select pg_temp.save('402', '{"status":"sending","scheduled_for":%s,"send_strategy":"static",
  "next_check_at":%s}')$$, to_jsonb(now() - interval '5 minutes')::text, pg_temp.at(1)), 'sending');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('402');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('402'), 1, 'a sending email is claimed for its page');
select lives_ok(format($$select pg_temp.save('402', '{"status":"sent","sent_at":%s,"next_check_at":%s}')$$,
  to_jsonb(now() - interval '5 minutes')::text, pg_temp.at(20)), 'then sent');
select is((select row(status, scheduled_for, send_strategy)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('402')), '(sent,,)', 'sent: no send time ahead, no strategy');
select is(pg_temp.claim('403'), 1, 'a third draft');
select lives_ok(format($$select pg_temp.save('403', '{"status":"scheduled","scheduled_for":%s,"send_strategy":"static",
  "next_check_at":%s}')$$, pg_temp.at(48), pg_temp.at(1)), 'scheduled');
reset role;
update public.klaviyo_email_results set checked_at = null where build_id = pg_temp.b('403');
set local role service_role;
select pg_temp.as_worker();
select pg_temp.claim('403');
select lives_ok(format($$select pg_temp.save('403', '{"status":"cancelled","final":true,"next_check_at":%s}')$$,
  to_jsonb(now())::text), 'cancelled in Klaviyo');
select is((select row(status, scheduled_for, send_strategy)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('403')), '(cancelled,,)', 'cancelled: the schedule is gone');
reset role;
update public.klaviyo_email_results set status = 'scheduled', final = false, scheduled_for = now() + interval '2 days',
  send_strategy = 'static', checked_at = null where build_id = pg_temp.b('404');
set local role service_role;
select pg_temp.as_worker();
select pg_temp.claim('404');
select lives_ok(format($$select pg_temp.save('404', '{"status":"deleted","final":true,"next_check_at":%s}')$$,
  to_jsonb(now())::text), 'deleted in Klaviyo');
select is((select row(status, scheduled_for, send_strategy)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('404')), '(deleted,,)', 'deleted: the schedule is gone');
reset role;
select throws_ok($$update public.klaviyo_email_results set send_strategy = 'static' where build_id = pg_temp.b('401')$$,
  '23514', null, 'a draft has no send strategy, even written directly');

-- The page claim: the sync's back-off, the hourly lease, its own lease.
update public.klaviyo_email_results set status = 'draft', final = false, checked_at = null, paused = 'klaviyo_key_rejected',
  next_check_at = now() + interval '6 hours', lease_token = null, lease_until = null where build_id = pg_temp.b('403');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('403'), 0, 'a paused check waits for its time, page or not');
reset role;
update public.klaviyo_email_results set next_check_at = now() - interval '1 minute' where build_id = pg_temp.b('403');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.claim('403'), 1, 'once due, the page reads it');
reset role;
update public.klaviyo_email_results set lease_until = now() - interval '1 second' where build_id = pg_temp.b('403');
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format($$select pg_temp.save('403', '{"status":"draft","next_check_at":%s}')$$, pg_temp.at(1)),
  'PT409', null, 'a save under an expired page lease is refused');
select is(pg_temp.claim('403'), 1, 'after the minute, the page claims it again');
reset role;
select pg_temp.release();
update public.klaviyo_email_results set paused = null, checked_at = null, next_check_at = now() - interval '1 minute'
  where build_id = pg_temp.b('403');
set local role service_role;
select pg_temp.as_worker();
select ok((select count(*) from public.claim_klaviyo_results(10) where build_id = pg_temp.b('403')) = 1,
  'the hourly run leases it (three minutes)');
select is(pg_temp.claim('403'), 0, 'the page waits while the hourly lease is live');
select throws_ok($$select pg_temp.claim('403', null)$$, '23514', null, 'a claim needs its cache time');
select is((select count(*)::integer from public.claim_klaviyo_result('00000000-0000-4000-8000-000000000101',
  gen_random_uuid(), 600)), 0, 'an unknown email is no row');

-- An operator clears a design change seen in error, recorded.
reset role;
select pg_temp.release();
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.clear_klaviyo_design_change(pg_temp.b('401'), 'Not mine')$$, '42501', null,
  'the owner cannot clear it');
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
select throws_ok($$select public.clear_klaviyo_design_change(pg_temp.b('401'), 'no')$$, '23514', null,
  'a reason is needed');
reset role;
update public.klaviyo_email_results set lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute'
  where build_id = pg_temp.b('401');
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
select throws_ok($$select public.clear_klaviyo_design_change(pg_temp.b('401'), 'Klaviyo re-saved our HTML')$$,
  'PT409', null, 'not while a check holds it');
reset role;
select pg_temp.release();
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
select lives_ok($$select public.clear_klaviyo_design_change(pg_temp.b('401'), '  Klaviyo re-saved our HTML ')$$,
  'an operator clears it, saying why');
reset role;
select is((select row(design_changed, design_evidence)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('401')), '(f,)', 'the change and its evidence are gone');
select is((select row(kind, actor_id, detail->>'reason', detail->>'wasChanged', detail->'evidence'->>'checks')::text
  from public.workspace_events where entity_id = pg_temp.b('401')),
  '(klaviyo_design_change_cleared,00000000-0000-4000-8000-000000000002,"Klaviyo re-saved our HTML",true,2)',
  'and the event keeps who, why and the evidence');

select * from finish();
rollback;
