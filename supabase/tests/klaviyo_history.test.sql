begin;
select plan(63);

-- ONB-103: history reads, the stored history and its findings. Owner ...01
-- and staff ...05 are in workspace 101 (a synthetic brand); owner ...04 runs
-- workspace 102.
create function pg_temp.snap(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('currency','USD','timezone','America/Los_Angeles','sendsPerWeek',1.3,'usualSendTime','11:00',
    'sent',jsonb_build_array(jsonb_build_object('id','MsgA02','campaignId','CmpA02','name','20% off','subject','20% off knitwear',
      'preview',null,'sentAt','2026-11-05T18:00:00.000Z','recipients',2380,'opens',1050,'clicks',210,'orders',31,'revenue',3120,
      'revenuePerRecipient',1.31,'openRate',0.4412,'clickRate',0.0882,'unsubscribeRate',0.002)),
    'scheduled',jsonb_build_array(jsonb_build_object('id','MsgS01','campaignId','CmpS01','subject','Winter layers',
      'sendAt','2026-11-13T18:00:00.000Z','date','2026-11-13','audienceIds',jsonb_build_array('SegEng90'),'offer',false)),
    'flows',jsonb_build_array(jsonb_build_object('id','FlwCart','name','Abandoned cart','status','live','trigger','Metric',
      'recipients90d',1020,'orders90d',52,'revenue90d',5350.5)),
    'audiences',jsonb_build_array(jsonb_build_object('id','SegEng90','kind','segment','name','Engaged 90 days','active',true,'starred',true)),
    'flowsRead',true) || extra
$$;
create function pg_temp.f(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','performance','statement','The brand sends about 1.3 emails a week, most often at 11:00.',
    'value','{}'::jsonb,'evidence',jsonb_build_object('ref','klaviyo:campaigns'),'confidence',0.9,'pass','sample','model',null) || extra
$$;
create function pg_temp.s(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('state','ready','complete',true,'flowsRead',true) || extra
$$;
create function pg_temp.lease(j text) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute'
    where id=j::uuid
$$;
create function pg_temp.record(snapshot jsonb default pg_temp.snap(), findings jsonb default jsonb_build_array(pg_temp.f()),
    summary jsonb default pg_temp.s(), job text default current_setting('test.job'), live boolean default false) returns jsonb language sql as $$
  select public.record_klaviyo_history(job::uuid,'00000000-0000-4000-8000-00000000aaaa',snapshot,findings,summary,live)
$$;
create function pg_temp.job(tenant text, key text, mode text default 'fixture', age interval default '0') returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_history',key,jsonb_build_object('mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id::text
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;

-- Grants.
select ok(has_function_privilege('authenticated','public.start_history_reading(uuid)','execute')
  and not has_function_privilege('anon','public.start_history_reading(uuid)','execute')
  and not has_function_privilege('service_role','public.start_history_reading(uuid)','execute'),'only signed-in people start a read');
select ok(not bool_or(has_function_privilege(r,'public.record_klaviyo_history(uuid,uuid,jsonb,jsonb,jsonb,boolean)','execute'))
  and has_function_privilege('service_role','public.record_klaviyo_history(uuid,uuid,jsonb,jsonb,jsonb,boolean)','execute'),
  'only the worker records a history') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.klaviyo_history',p)),'browser roles cannot write the history')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.klaviyo_history','select'),'anonymous visitors cannot read it');
select ok(current_setting('server_version_num')::integer < 170000
  or not has_table_privilege('authenticated','public.klaviyo_history','maintain'),'nor maintain it');

-- The findings contract: `performance`, in words only, for the history.
select ok(private.finding_value_ok('performance','{}') and not private.finding_value_ok('performance','{"x":1}'),
  'performance holds words only');
select ok(private.finding_value_ok('returns','{"days":30}') and private.finding_value_ok('tone','{}'),'the other topics are as before');

-- The owner starts a read: Klaviyo connected, once a day.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.start_history_reading('00000000-0000-4000-8000-000000000101')$$,'23514',null,'Klaviyo must be connected first');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','connected')$$,'the owner connects sample Klaviyo');
select set_config('test.job',public.start_history_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_history_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),'asking again the same day is the same read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.start_history_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a read');
reset role;
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo','connected')$$,'a real brand on sample Klaviyo');
select throws_ok($$select public.start_history_reading('00000000-0000-4000-8000-000000000102')$$,'23514','Connect live Klaviyo first',
  'never reads the sample account');
reset role;

-- The workspace jobs never take it; the readers' run does.
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101') c where c.kind='brand.read_history'),0,
  'the workspace jobs never take a history read');
select ok(public.source_readings_waiting() >= 1,'the readers'' run sees it');
select is((select kind from public.claim_source_reading()),'brand.read_history','and claims it');
reset role;
update public.job_runs set status='queued', attempt=0, lease_token=null, lease_until=null where id=current_setting('test.job')::uuid;
select pg_temp.lease(current_setting('test.job'));
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.fail_job(current_setting('test.job')::uuid,'00000000-0000-4000-8000-00000000aaaa','auth')$$,
  '42501',null,'an owner cannot fail a running history read');
reset role;

-- Everything is checked before it is written.
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.record(pg_temp.snap(%L))', x),'23514',null,'refused history: '||x)
  from unnest(array['{"currency":"usd"}','{"usualSendTime":"10:30"}','{"sendsPerWeek":"two"}','{"sent":{}}','{"note":"x"}',
    '{"flowsRead":false}','{"sent":[{"id":"bad id","sentAt":"2026-11-05T18:00:00Z"}]}','{"sent":[{"id":"M1","sentAt":"yesterday"}]}',
    '{"scheduled":[{"id":"S1","sendAt":"2026-11-13T18:00:00Z","date":"13/11","audienceIds":[],"offer":false}]}',
    '{"audiences":[{"id":"A1","kind":"tag"}]}']) x;
select throws_ok($$select pg_temp.record(pg_temp.snap() - 'flows')$$,'23514',null,'every part of the history is there');
select throws_ok($$select pg_temp.record(pg_temp.snap(), '[]', pg_temp.s('{"state":"empty"}'))$$,'23514',null,
  'empty only when nothing was sent or scheduled');
select throws_ok(format('select pg_temp.record(pg_temp.snap(), jsonb_build_array(pg_temp.f(%L)))', x),'23514',null,'refused finding: '||x)
  from unnest(array['{"topic":"returns","value":{"days":30}}','{"topic":"claim","value":{"subject":"brand"}}',
    '{"evidence":{"url":"https://cedar-lane.example/"}}','{"evidence":{"ref":"klaviyo:campaign:a b"}}','{"pass":"code"}',
    '{"pass":"model","model":"gemini-2.5-flash"}','{"statement":"x"}','{"value":{"x":1}}']) x;
select throws_ok($$select pg_temp.record(pg_temp.snap(), '[]', pg_temp.s(), current_setting('test.job'), true)$$,'23514',null,
  'a sample read cannot say it is live');
select throws_ok($$select public.record_klaviyo_history(current_setting('test.job')::uuid,gen_random_uuid(),pg_temp.snap(),'[]',pg_temp.s(),false)$$,
  'PT409',null,'only with the job''s lease');

-- A read is stored at once and finishes its job.
select is(pg_temp.record(pg_temp.snap(), jsonb_build_array(pg_temp.f(), pg_temp.f('{"topic":"audience","statement":"Emails go to segments such as Engaged 90 days.","evidence":{"ref":"klaviyo:audiences"},"confidence":0.6}'))),
  '{"sent": 1, "newer": false, "findings": 2, "scheduled": 1}'::jsonb,'a history is stored at once');
reset role;
select results_eq($$select state, sent, scheduled, flows, audiences, flows_read, complete, live, snapshot->>'usualSendTime'
    from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'$$,
  $$values ('ready',1,1,1,1,true,true,false,'11:00')$$,'with its counts');
select is((select status||' '||(checkpoint->>'sent') from public.job_runs where id=current_setting('test.job')::uuid),'succeeded 1','and its job is finished');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
  and source='klaviyo_history' and superseded_at is null),2,'its findings are current');
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.job')::uuid,'klaviyo_history','returns','Returns.','{"ref":"klaviyo:campaigns"}',0.5,'code')$$,
  '23514',null,'a history states only what a history can');

-- Members read it; another workspace does not.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select state from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'),'ready','staff read the history');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'),0,'another workspace reads none');
reset role;

-- A newer read replaces it and the findings it states again; an older one
-- finishing late changes nothing.
select set_config('test.second',pg_temp.job('00000000-0000-4000-8000-000000000101','second'),true);
select pg_temp.lease(current_setting('test.second'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(pg_temp.snap('{"sendsPerWeek":2.5,"flowsRead":false,"flows":[]}'), jsonb_build_array(pg_temp.f()),
  pg_temp.s('{"flowsRead":false,"complete":false}'), current_setting('test.second'))$$,'a newer read without flows');
reset role;
select results_eq($$select (snapshot->>'sendsPerWeek')::numeric, flows, flows_read, complete from public.klaviyo_history
    where tenant_id='00000000-0000-4000-8000-000000000101'$$,
  $$values (2.5::numeric, 0, false, false)$$,'replaces the history');
select results_eq($$select topic, run_id::text from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
    and source='klaviyo_history' and superseded_at is null order by topic$$,
  $$values ('audience',current_setting('test.job')), ('performance',current_setting('test.second'))$$,
  'its performance replaces the earlier one; the earlier audience stays');
select set_config('test.old',pg_temp.job('00000000-0000-4000-8000-000000000101','old','fixture','1 hour'),true);
select pg_temp.lease(current_setting('test.old'));
set local role service_role;
select pg_temp.as_worker();
select is((pg_temp.record(pg_temp.snap('{"sendsPerWeek":9}'), jsonb_build_array(pg_temp.f()), pg_temp.s(), current_setting('test.old'))->>'newer')::boolean,
  true,'an older read finishing late is told');
reset role;
select is((select (snapshot->>'sendsPerWeek')::numeric from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'),
  2.5::numeric,'and changes nothing');

-- Klaviyo pausing a history read: its pace puts it back, the history stays.
select set_config('test.paced',pg_temp.job('00000000-0000-4000-8000-000000000101','paced'),true);
update public.job_runs set attempt=1 where id=current_setting('test.paced')::uuid;
select pg_temp.lease(current_setting('test.paced'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.paced')::uuid,'00000000-0000-4000-8000-00000000aaaa','rate_limited',90)$$,
  'a rate limit pauses a history read');
reset role;
select results_eq($$select status, attempt from public.job_runs where id=current_setting('test.paced')::uuid$$,
  $$values ('retry_wait',0)$$,'with its try given back');
select is((select state from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'),'ready','the history stays as it is');
select is((select count(*)::integer from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000101'),0,'and the catalog is not touched');

-- A refused key on a live history read: the history is marked paused (and
-- kept), the connection needs the owner.
update public.workspace_connections set mode='live' where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select set_config('test.live',public.start_history_reading('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select pg_temp.lease(current_setting('test.live'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(pg_temp.snap(), jsonb_build_array(pg_temp.f('{"pass":"code"}'),
  pg_temp.f('{"topic":"tone","statement":"Subject lines are short and plain.","pass":"model","model":"gemini-2.5-flash"}')),
  pg_temp.s(), current_setting('test.live'), true)$$,'a live history is stored, counted as code and in a model''s words');
reset role;
select set_config('test.live2',pg_temp.job('00000000-0000-4000-8000-000000000102','live2','live'),true);
select pg_temp.lease(current_setting('test.live2'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select public.pause_source_reading(current_setting('test.live2')::uuid,'00000000-0000-4000-8000-00000000aaaa','klaviyo_key_rejected')$$,
  'a refused key stops a live history read');
reset role;
select results_eq($$select state, reason, snapshot is not null from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000102'$$,
  $$values ('paused','klaviyo_key_rejected',true)$$,'the history says it is paused, and keeps what it had');
select is((select status from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000102' and provider='klaviyo'),
  'expired','the live connection needs the owner');
select is((select count(*)::integer from public.catalog_status where tenant_id='00000000-0000-4000-8000-000000000102'),0,
  'and the catalog status is not written');

-- An account that sent nothing: empty, and its findings all replaced.
select set_config('test.empty',pg_temp.job('00000000-0000-4000-8000-000000000101','empty'),true);
select pg_temp.lease(current_setting('test.empty'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(pg_temp.snap('{"sent":[],"scheduled":[],"usualSendTime":null,"sendsPerWeek":0}'), '[]',
  pg_temp.s('{"state":"empty","reason":"no_emails"}'), current_setting('test.empty'))$$,'an account that sent nothing');
reset role;
select results_eq($$select state, sent, reason from public.klaviyo_history where tenant_id='00000000-0000-4000-8000-000000000101'$$,
  $$values ('empty',0,'no_emails')$$,'is stored as empty');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
  and source='klaviyo_history' and superseded_at is null),0,'with no current findings');

select * from finish();
rollback;
