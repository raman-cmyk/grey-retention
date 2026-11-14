begin;
select plan(146);

-- LRN-001: the results of every email we put into Klaviyo. Workspace 101
-- (owner ...01, staff ...05; a synthetic brand) and workspace 102 (owner
-- ...04; made a real brand with no brand profile here).
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))
  from unnest(array['anon', 'authenticated']) r,
    unnest(array['public.claim_klaviyo_results(integer)', 'public.save_klaviyo_result(uuid,uuid,jsonb)',
      'public.klaviyo_results_waiting()']) f;
select ok(has_function_privilege('service_role', f, 'execute'), 'the results run calls '||f)
  from unnest(array['public.claim_klaviyo_results(integer)', 'public.save_klaviyo_result(uuid,uuid,jsonb)',
    'public.klaviyo_results_waiting()']) f;
select ok(not has_function_privilege(r, 'private.adoptable_klaviyo_drafts()', 'execute'), r||' cannot list drafts to meet')
  from unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(not bool_or(has_table_privilege(r, 'public.klaviyo_email_results', p)), 'nobody writes the results directly')
  from unnest(array['anon', 'authenticated', 'service_role']) r,
    unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p;
select ok(not has_table_privilege('anon', 'public.klaviyo_email_results', 'select'), 'anonymous visitors cannot read them');
select ok(current_setting('server_version_num')::integer < 170000
  or not bool_or(has_table_privilege(r, 'public.klaviyo_email_results', 'maintain')), 'nor maintain them')
  from unnest(array['anon', 'authenticated', 'service_role']) r;
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('public', 'claim_klaviyo_results'), ('public', 'save_klaviyo_result'),
    ('public', 'klaviyo_results_waiting'), ('private', 'adoptable_klaviyo_drafts'))
    and p.prosecdef and p.proconfig @> array['search_path=""']), 4,
  'each of the four functions runs as its owner with an empty search path');

-- Plans and builds. 101: b201 a live draft built five days ago (its push
-- drafted, with its message), b202 a sample draft, b203 a live draft whose
-- push never finished, b205 still building, b207 a live draft built twelve
-- days ago, b208 a live draft whose plan slot is too large to keep, b210
-- a live draft drafted 31 days ago, b211 one with a subject too long to
-- keep, b212 a live draft built five days ago. 102 (a
-- real brand, no brand profile): b204 a sample draft (in no Klaviyo
-- account), b206 a live draft.
update public.brand_profiles set synthetic = false where tenant_id = '00000000-0000-4000-8000-000000000102';
delete from public.brand_profiles where tenant_id = '00000000-0000-4000-8000-000000000102';
insert into public.strategy_runs (id, tenant_id, start_on, state, pulse, offer_pick, plan, created_by) values
  ('00000000-0000-4000-8000-00000000e101','00000000-0000-4000-8000-000000000101',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   jsonb_build_object('slots', jsonb_build_array(
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'offer', 'angle', 'Weekend knit',
       'products', '[{"id":"p1","title":"Knit"}]'::jsonb, 'offer', '{"id":"o1","code":"KNIT10","percent":10}'::jsonb,
       'audience', '{"id":"LstAll","label":"Engaged 90 days"}'::jsonb),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date - 12, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story',
       'angle', repeat('x', 16000)),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'),
     jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'story'))),
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-00000000e102','00000000-0000-4000-8000-000000000102',current_date,'planned','{"offers":[]}','{"mode":"auto"}',
   '{"slots":[{"date":"2099-01-01","time":"10:00","emailType":"launch"},{"date":"2099-01-02","time":"10:00","emailType":"offer"}]}',
   '00000000-0000-4000-8000-000000000004');
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, klaviyo_campaign_id, sample_draft, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000b201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',0,
   '00000000-0000-4000-8000-00000000c201','drafted',
   '{"html":"<table></table>","subject":"Weekend knit","code":"KNIT10","approach":"A","plannedSendAt":"2026-11-18T12:15:00.000Z"}',
   'CmpR01',false,'00000000-0000-4000-8000-000000000001',now() - interval '5 days'),
  ('00000000-0000-4000-8000-00000000b202','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',1,
   '00000000-0000-4000-8000-00000000c202','drafted','{"html":"<table></table>","approach":"A"}',
   'sample-draft-00000000-0000-4000-8000-00000000c202',true,'00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b203','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',2,
   '00000000-0000-4000-8000-00000000c203','drafted','{"html":""}','CmpR03',false,'00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b205','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',3,
   '00000000-0000-4000-8000-00000000c205','build_queued',null,null,false,'00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b207','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',4,
   '00000000-0000-4000-8000-00000000c207','drafted','{"html":""}','CmpR07',false,'00000000-0000-4000-8000-000000000001',
   now() - interval '12 days'),
  ('00000000-0000-4000-8000-00000000b208','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',5,
   '00000000-0000-4000-8000-00000000c208','drafted','{"html":""}','CmpR08',false,'00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b211','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',7,
   '00000000-0000-4000-8000-00000000c211','drafted',jsonb_build_object('html','','subject',repeat('s', 201)),'CmpR11',false,
   '00000000-0000-4000-8000-000000000001',now()),
  ('00000000-0000-4000-8000-00000000b212','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',8,
   '00000000-0000-4000-8000-00000000c212','drafted','{"html":""}','CmpR12',false,'00000000-0000-4000-8000-000000000001',
   now() - interval '5 days'),
  ('00000000-0000-4000-8000-00000000b204','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e102',0,
   '00000000-0000-4000-8000-00000000c204','drafted','{"html":""}','sample-draft-x',true,'00000000-0000-4000-8000-000000000004',now()),
  ('00000000-0000-4000-8000-00000000b206','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e102',1,
   '00000000-0000-4000-8000-00000000c206','drafted','{"html":""}','CmpR06',false,'00000000-0000-4000-8000-000000000004',now());
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, klaviyo_campaign_id, sample_draft, created_by,
    created_at, updated_at) values
  ('00000000-0000-4000-8000-00000000b210','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000e101',6,
   '00000000-0000-4000-8000-00000000c210','drafted','{"html":""}','CmpR10',false,'00000000-0000-4000-8000-000000000001',
   now() - interval '31 days', now() - interval '31 days');
insert into public.klaviyo_draft_pushes (tenant_id, push_key, state, campaign_id, message_id, designs) values
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c210','drafted','CmpR10','MsgR10','A'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c211','drafted','CmpR11','MsgR11','A'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c212','drafted','CmpR12','MsgR12','A'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c201','drafted','CmpR01','MsgR01','both'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c203','started','CmpR03',null,null),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c207','drafted','CmpR07','Msg_R-07','A'),
  ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000c208','drafted','CmpR08','MsgR08','A'),
  ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000c206','drafted','CmpR06','MsgR06','A');

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
-- Makes a check due now, or moves its last read back (run as the test's own role).
create function pg_temp.due(n text) returns void language sql as $$
  update public.klaviyo_email_results set next_check_at = now() - interval '1 second' where build_id = pg_temp.b(n)
$$;
create function pg_temp.next(hours integer default 1) returns text language sql as $$
  select to_jsonb(now() + make_interval(hours => hours))::text
$$;
create function pg_temp.ago(hours integer) returns text language sql as $$
  select to_jsonb(now() - make_interval(hours => hours))::text
$$;
-- A whole read: what was read, and how.
create function pg_temp.read(pulls integer, extra text default '') returns text language sql as $$
  select format('{"pulls":%s,"results":[],"clicks":[],"complete":true,"context":{"reported":true}%s,"next_check_at":%s}',
    pulls, extra, pg_temp.next(24))
$$;

-- Only the results run, even with the database role.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.claim_klaviyo_results(5)$$,'42501',null,'no request role, no claim');
select throws_ok($$select public.klaviyo_results_waiting()$$,'42501',null,'no request role, no count');
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('201'), gen_random_uuid(), pg_temp.next()),'42501',null,'no request role, no save');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.claim_klaviyo_results(5)$$,'42501',null,'a member''s request cannot claim');
select throws_ok($$select public.klaviyo_results_waiting()$$,'42501',null,'nor ask what is waiting');
select pg_temp.as_worker();
select throws_ok($$select public.claim_klaviyo_results(0)$$,'23514',null,'a claim of nothing is refused');
select throws_ok($$select public.claim_klaviyo_results(101)$$,'23514',null,'and one of too many');

-- The drafts it meets: a live one with its message (also with _ or - in
-- its id, also in a workspace with no brand profile), a synthetic brand's
-- sample; never a push not finished, a build not drafted, a real brand's
-- sample, a draft too large to keep or drafted over 30 days ago (nor are
-- those counted waiting).
select is(public.klaviyo_results_waiting(), 5, 'five drafts wait to be met');
select is((select count(*)::integer from public.claim_klaviyo_results(2)), 2, 'a claim takes at most what it asks for');
select is((select count(*)::integer from public.klaviyo_email_results), 5, 'and meets every draft waiting');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 3, 'the next claim takes the ones left');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 0, 'a leased check is not taken twice');
select is(public.klaviyo_results_waiting(), 0, 'nothing waits while all are leased, nor the draft too large');
select is((select array_agg(build_id order by build_id) from public.klaviyo_email_results),
  array[pg_temp.b('201'), pg_temp.b('202'), pg_temp.b('206'), pg_temp.b('207'), pg_temp.b('212')],
  'the live drafts and the synthetic sample, nothing else');
select is((select row(sample, campaign_id, message_id, status, pulls, final, context)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('201')), '(f,CmpR01,MsgR01,draft,0,f,{})', 'a live draft starts as a draft with its message');
select is((select planned from public.klaviyo_email_results where build_id = pg_temp.b('201')),
  jsonb_build_object('date', to_char(current_date, 'YYYY-MM-DD'), 'time', '18:00', 'emailType', 'offer', 'angle', 'Weekend knit',
    'products', '[{"id":"p1","title":"Knit"}]'::jsonb, 'offer', '{"id":"o1","code":"KNIT10","percent":10}'::jsonb,
    'audience', '{"id":"LstAll","label":"Engaged 90 days"}'::jsonb, 'plannedSendAt', '2026-11-18T12:15:00.000Z',
    'subject', 'Weekend knit', 'code', 'KNIT10', 'approach', 'A', 'designs', 'both'),
  'it keeps what was planned and built: type, angle, products, offer, audience, send time, designs');
select is((select row(sample, message_id is null, planned->>'designs')::text from public.klaviyo_email_results
  where build_id = pg_temp.b('202')), '(t,t,A)', 'a sample draft has no message and design A');
select ok((select bool_and(lease_token is not null and lease_until > now()) from public.klaviyo_email_results), 'each claimed check is leased');

-- Only its own check, under its exact, unexpired lease.
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('201'), gen_random_uuid(), pg_temp.next()),'PT409',null,'not with another lease');
select throws_ok(format($$select public.save_klaviyo_result(%L, null, '{"next_check_at":%s}')$$,
  pg_temp.b('201'), pg_temp.next()),'PT409',null,'not with no lease');
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('999'), pg_temp.lease('201'), pg_temp.next()),'PT409',null,'not a check that does not exist');
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('206'), pg_temp.lease('201'), pg_temp.next()),'PT409',null,'not another workspace''s check with this lease');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok(format($$select pg_temp.save('201', '{"next_check_at":%s}')$$, pg_temp.next()),'42501',null,
  'a member''s request cannot save');
select pg_temp.as_worker();

-- Each outcome is checked before it is written.
select throws_ok(format('select pg_temp.save(%L, %L)', '201', x),'23514',null,'refused outcome: '||left(x, 120))
  from unnest(array[
    '{}',
    '[]',
    format('{"next_check_at":%s,"note":"x"}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"paused"}', pg_temp.next()),
    format('{"next_check_at":%s,"status":1}', pg_temp.next()),
    '{"next_check_at":"soon"}',
    format('{"next_check_at":%s}', pg_temp.ago(24)),
    format('{"next_check_at":%s}', pg_temp.next(24 * 9)),
    format('{"next_check_at":%s,"status":"sent"}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"sent","sent_at":%s}', pg_temp.next(), pg_temp.next(3)),
    format('{"next_check_at":%s,"status":"sent","sent_at":12}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"sent","sent_at":"-infinity"}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"sent","sent_at":"epoch"}', pg_temp.next()),
    -- Before the email was built (five days ago).
    format('{"next_check_at":%s,"status":"sent","sent_at":%s}', pg_temp.next(), pg_temp.ago(24 * 6)),
    -- A send time without the sent status.
    format('{"next_check_at":%s,"sent_at":%s}', pg_temp.next(), pg_temp.ago(1)),
    format('{"next_check_at":%s,"status":"deleted","sent_at":%s,"final":true}', pg_temp.next(), pg_temp.ago(1)),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{}}', pg_temp.next()),
    format('{"next_check_at":%s,"results":[]}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"deleted","final":true,"results":[{"variation":null,"statistics":{"recipients":5000}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"complete":false}', pg_temp.next()),
    format('{"next_check_at":%s,"context":{}}', pg_temp.next()),
    format('{"next_check_at":%s,"changed":"yes"}', pg_temp.next()),
    format('{"next_check_at":%s,"paused":"Rate Limited"}', pg_temp.next()),
    format('{"next_check_at":%s,"paused":7}', pg_temp.next()),
    format('{"next_check_at":%s,"final":true}', pg_temp.next()),
    format('{"next_check_at":%s,"status":"cancelled","final":"yes"}', pg_temp.next()),
    -- Its planned day is today: not stale.
    format('{"next_check_at":%s,"status":"stale","final":true}', pg_temp.next())
  ]) x;

-- A check saved: its outcome, the lease let go, looked at again when said.
select lives_ok(format($$select pg_temp.save('201', '{"status":"scheduled","changed":true,"paused":"rate_limited","next_check_at":%s}')$$,
  pg_temp.next()),'a scheduled draft changed in Klaviyo is saved');
select is((select row(status, changed, paused, lease_token is null, checked_at is not null)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('201')), '(scheduled,t,rate_limited,t,t)', 'with its status, the change seen and the lease let go');
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('201'), gen_random_uuid(), pg_temp.next()),'PT409',null,'a check saved cannot be saved again without a new lease');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 0, 'nor is it taken before its time');
select throws_ok(format($$select public.save_klaviyo_result(%L, null, '{"status":"draft","next_check_at":%s}')$$,
  pg_temp.b('201'), pg_temp.next()),'PT409',null,'a check not leased cannot be saved with no lease');

-- Taken again once due: a change seen stays seen; a pause lasts one check.
reset role;
select pg_temp.due('201');
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 1, 'a due check is taken again');
select lives_ok(format($$select pg_temp.save('201', '{"status":"sent","sent_at":%s,"changed":false,"next_check_at":%s}')$$,
  pg_temp.ago(25), pg_temp.next(1)),'a sent email is saved with its send time');
select is((select row(status, changed, paused is null, pulls)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('201')), '(sent,t,t,0)', 'it stays changed, and its pause is over');

-- A lease that ran out is refused, and the check is taken again.
reset role;
select pg_temp.due('201');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
reset role;
update public.klaviyo_email_results set lease_until = now() - interval '1 second' where build_id = pg_temp.b('201');
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.save(%L, %L)', '201', pg_temp.read(1)),'PT409',null,'a lease that ran out saves nothing');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 1, 'and its check is taken again');

-- Results: one read a day after the send and the last, with what was
-- read and how, three in all.
select throws_ok(format('select pg_temp.save(%L, %L)', '201', x),'23514',null,'refused results: '||left(x, 140))
  from unnest(array[
    -- Back from sent, or another send time.
    format('{"next_check_at":%s,"status":"draft"}', pg_temp.next()),
    format('{"next_check_at":%s,"sent_at":%s}', pg_temp.next(), pg_temp.ago(30)),
    -- Two reads at once, or a read without what was read or how.
    pg_temp.read(2),
    format('{"next_check_at":%s,"pulls":1,"results":[],"complete":true,"context":{}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"context":{}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true}', pg_temp.next()),
    -- How it was read, of another shape.
    pg_temp.read(1, ',"context":{"note":1}'),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{"currency":"usd"}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{"conversion":"viewed"}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{"reportFrom":"yesterday"}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{"botsLeftOut":-1}}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"results":[],"clicks":[],"complete":true,"context":{"sentAtFrom":"guess"}}', pg_temp.next()),
    -- Counts it never reads, or not counts.
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"A","statistics":{"likes":3}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"A","statistics":{"recipients":-1}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"A","statistics":{"open_rate":1.5}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"A","statistics":{"recipients":"9"}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"Var A/1","name":"Design A","design":"A","statistics":{}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"C","statistics":{}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"Design A","design":"none","statistics":{}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{"conversion":"none"},"clicks":[],"results":[]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{"clicksBy":"none"},"clicks":[],"results":[]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{"resultsKept":"yes"},"clicks":[],"results":[]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","name":"","design":"A","statistics":{}}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":[{"variation":"VarA01","statistics":{},"extra":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"clicks":[],"results":%s}', pg_temp.next(),
      (select jsonb_agg('{"variation":null,"statistics":{}}'::jsonb) from generate_series(1, 9))),
    -- Clicks of another shape, or more than a row holds.
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"ftp://x.example/a","section":null,"block":null,"clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":60,"block":"hero_product","clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":1,"block":null,"clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":1,"block":"Hero","clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"design":"C","url":"https://x.example/a","section":null,"block":null,"clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"design":"none","url":"https://x.example/a","section":null,"block":null,"clicks":1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":null,"block":null,"clicks":1,"unique":2}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":null,"block":null,"clicks":-1,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":[{"variation":null,"url":"https://x.example/a","section":null,"block":null,"clicks":1.5,"unique":1}]}', pg_temp.next()),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":%s}', pg_temp.next(),
      (select jsonb_agg('{"variation":null,"url":"https://x.example/a","section":null,"block":null,"clicks":1,"unique":1}'::jsonb)
        from generate_series(1, 201))),
    format('{"next_check_at":%s,"pulls":1,"complete":true,"context":{},"results":[],"clicks":%s}', pg_temp.next(),
      (select jsonb_agg(jsonb_build_object('variation', null, 'url', 'https://x.example/'||repeat('p', 1100), 'section', null,
        'block', null, 'clicks', 1, 'unique', 1)) from generate_series(1, 200)))
  ]) x;
select lives_ok(format($$select pg_temp.save('201', '{"pulls":1,"complete":false,"next_check_at":%s,
  "context":{"reportFrom":"2026-11-18T12:00:00.000Z","reportTo":"2026-11-21T12:00:00.000Z","currency":"USD","conversion":"placed_order",
    "attributionOpen":true,"sendStrategy":"static","sentAtFrom":"send_time","abSplit":true,"clicksBy":"message","botsLeftOut":3,"reported":true},
  "results":[{"variation":"VarA01","name":"Design A","design":"A","statistics":{"recipients":600,"open_rate":0.42,"conversion_value":90.5}},
             {"variation":"VarB01","name":"Design B","design":"B","statistics":{"recipients":590}}],
  "clicks":[{"variation":"VarA01","design":"A","url":"https://cedar-lane.example/p/1?utm_source=klaviyo","section":0,"block":"hero_product","clicks":11,"unique":10},
            {"variation":null,"design":null,"url":"http://manage.kmail-lists.com/u","section":null,"block":null,"clicks":1,"unique":1}]}')$$,
  pg_temp.next(24)),'the first read, a day after the send, is saved with each design''s results, each link''s clicks and how it was read');
select is((select row(pulls, jsonb_array_length(results), jsonb_array_length(clicks), results_at is not null, complete,
  context->>'currency', final)::text from public.klaviyo_email_results where build_id = pg_temp.b('201')),
  '(1,2,2,t,f,USD,f)', 'one read stored');

-- The next a day after the last read, even when the send was long ago.
reset role;
update public.klaviyo_email_results set sent_at = now() - interval '73 hours', next_check_at = now() - interval '1 second'
  where build_id = pg_temp.b('201');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
select throws_ok(format('select pg_temp.save(%L, %L)', '201', pg_temp.read(2)),'23514',null,
  'the second read waits a day after the first');
reset role;
update public.klaviyo_email_results set results_at = now() - interval '24 hours' where build_id = pg_temp.b('201');
set local role service_role;
select pg_temp.as_worker();
select lives_ok(format('select pg_temp.save(%L, %L)', '201',
  format('{"pulls":2,"results":[],"clicks":[],"complete":false,"context":{"reported":false,"resultsKept":true,"clicksKept":true},"next_check_at":%s}',
    pg_temp.next(24))),'the second read, a day after the first, keeping what was read before');

-- The third read ends it, and only then.
reset role;
update public.klaviyo_email_results set results_at = now() - interval '24 hours', next_check_at = now() - interval '1 second'
  where build_id = pg_temp.b('201');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
select throws_ok(format('select pg_temp.save(%L, %L)', '201', pg_temp.read(3)),'23514',null,'the third read must end it');
select lives_ok(format('select pg_temp.save(%L, %L)', '201', pg_temp.read(3, ',"final":true')),'the third read ends it');
select is((select row(status, pulls, final)::text from public.klaviyo_email_results where build_id = pg_temp.b('201')),
  '(sent,3,t)', 'sent, read three times, ended');
select is(public.klaviyo_results_waiting(), 0, 'an ended check is not counted waiting');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 0, 'nor taken again');
select throws_ok(format($$select public.save_klaviyo_result(%L, %L, '{"next_check_at":%s}')$$,
  pg_temp.b('201'), gen_random_uuid(), pg_temp.next()),'PT409',null,'nor saved again');

-- Deleted in Klaviyo after a read: the end, its read kept.
select lives_ok(format($$select pg_temp.save('212', '{"status":"sent","sent_at":%s,"next_check_at":%s}')$$,
  pg_temp.ago(25), pg_temp.next(0)),'another email sent a day ago');
reset role;
select pg_temp.due('212');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
select lives_ok(format('select pg_temp.save(%L, %L)', '212', pg_temp.read(1)),'its first read');
reset role;
select pg_temp.due('212');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
select lives_ok(format($$select pg_temp.save('212', '{"status":"deleted","final":true,"next_check_at":%s}')$$, pg_temp.next(0)),
  'a sent email deleted after a read ends');
select is((select row(status, pulls, sent_at is not null, final)::text from public.klaviyo_email_results
  where build_id = pg_temp.b('212')), '(deleted,1,t,t)', 'with its send time and read kept');

-- A sent email unread for ten days is closed, saying why; not sooner.
select lives_ok(format($$select pg_temp.save('207', '{"status":"sent","sent_at":%s,"next_check_at":%s}')$$,
  pg_temp.ago(24 * 9), pg_temp.next(0)),'a sent email nine days ago');
reset role;
select pg_temp.due('207');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
select throws_ok(format($$select pg_temp.save('207', '{"final":true,"paused":"klaviyo_key_rejected","next_check_at":%s}')$$,
  pg_temp.next(0)),'23514',null,'is not given up on before ten days');
reset role;
update public.klaviyo_email_results set sent_at = now() - interval '11 days' where build_id = pg_temp.b('207');
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format($$select pg_temp.save('207', '{"final":true,"next_check_at":%s}')$$, pg_temp.next(0)),'23514',null,
  'nor without saying why');
select lives_ok(format($$select pg_temp.save('207', '{"final":true,"paused":"klaviyo_key_rejected","next_check_at":%s}')$$,
  pg_temp.next(0)),'after ten days unread it is closed');

-- Cancelled and stale end it too; stale only long after its day.
select lives_ok(format($$select pg_temp.save('202', '{"status":"cancelled","final":true,"next_check_at":%s}')$$, pg_temp.next()),
  'a cancelled email ends');
reset role;
update public.klaviyo_email_results set planned = planned || '{"date":"not-a-date"}' where build_id = pg_temp.b('206');
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format($$select pg_temp.save('206', '{"status":"stale","final":true,"next_check_at":%s}')$$, pg_temp.next()),
  '23514',null,'a planned day that is not a day is refused as such');
select lives_ok(format($$select pg_temp.save('206', '{"status":"draft","next_check_at":%s}')$$, pg_temp.next()),
  'but every other outcome of that email is still saved');
reset role;
select pg_temp.due('206');
set local role service_role;
select pg_temp.as_worker();
do $$ begin perform public.claim_klaviyo_results(10); end $$;
reset role;
update public.klaviyo_email_results set planned = planned || '{"date":"2000-01-01"}' where build_id = pg_temp.b('206');
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format($$select pg_temp.save('206', '{"status":"stale","next_check_at":%s}')$$, pg_temp.next()),
  '23514',null,'stale must end it');
select lives_ok(format($$select pg_temp.save('206', '{"status":"stale","final":true,"next_check_at":%s}')$$, pg_temp.next()),
  'a draft two weeks past its day is stale');
select is((select array_agg(status order by build_id)::text from public.klaviyo_email_results), '{sent,cancelled,stale,sent,deleted}',
  'each ended as it was saved');

-- A paused workspace: its drafts are not met, its checks not taken, its
-- saves refused.
reset role;
insert into public.email_builds (id, tenant_id, run_id, slot, push_key, state, email, klaviyo_campaign_id, sample_draft, created_by) values
  ('00000000-0000-4000-8000-00000000b209','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000e102',2,
   '00000000-0000-4000-8000-00000000c209','drafted','{"html":""}','CmpR09',false,'00000000-0000-4000-8000-000000000004');
insert into public.klaviyo_draft_pushes (tenant_id, push_key, state, campaign_id, message_id, designs) values
  ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-00000000c209','drafted','CmpR09','MsgR09','A');
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000102';
set local role service_role;
select pg_temp.as_worker();
select is(public.klaviyo_results_waiting(), 0, 'a paused workspace''s draft does not wait');
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 0, 'nor is it met or taken');
reset role;
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000102';
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_klaviyo_results(10)), 1, 'once active again it is met and taken');
reset role;
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000102';
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format($$select pg_temp.save('209', '{"status":"scheduled","next_check_at":%s}')$$, pg_temp.next()),'PT409',null,
  'a workspace paused since its claim saves nothing');
reset role;
update public.tenants set status = 'active' where id = '00000000-0000-4000-8000-000000000102';

-- Members of the workspace read its results; another workspace, someone
-- with no membership and anonymous visitors do not.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.klaviyo_email_results), 4, 'the owner reads the workspace''s results');
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.klaviyo_email_results), 4, 'its staff read them too');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select array_agg(build_id order by build_id)::text from public.klaviyo_email_results),
  array[pg_temp.b('206'), pg_temp.b('209')]::text, 'another workspace''s owner reads only theirs');
select pg_temp.as_member('00000000-0000-4000-8000-0000000000ff');
select is((select count(*)::integer from public.klaviyo_email_results), 0, 'someone with no membership reads nothing');
reset role;
set local role anon;
select throws_ok($$select count(*) from public.klaviyo_email_results$$,'42501',null,'an anonymous visitor reads nothing');

-- A build deleted takes its results with it.
reset role;
delete from public.email_builds where id = pg_temp.b('202');
select is((select count(*)::integer from public.klaviyo_email_results where build_id = pg_temp.b('202')), 0,
  'a deleted build''s results go with it');

select * from finish();
rollback;
