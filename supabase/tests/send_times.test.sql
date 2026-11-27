begin;
select plan(46);

-- PICK-97: the best send time per audience, kept by the history read.
-- Owner ...01 and staff ...05 are in workspace 101; owner ...04 runs
-- workspace 102. Reads are started some minutes apart (`age`): a newer
-- read's rows are never replaced by an older one.

create function pg_temp.facts(sends integer default 3) returns jsonb language sql as $$
  select jsonb_build_object('sends',sends,'leftOut',1,
    'firstSentAt',case when sends = 0 then null else '2026-11-02T14:00:00Z' end,
    'lastSentAt',case when sends = 0 then null else '2026-11-11T23:00:00Z' end,
    'recipients',3000,'opens',900,'clicks',60,'machineOpens',0,
    'hours',case when sends = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('hour',9,'sends',sends,'recipients',3000,'opens',900,'clicks',60,'machineOpens',0)) end,
    'weekdays',case when sends = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('weekday','Tue','sends',sends,'recipients',3000,'opens',900,'clicks',60,'machineOpens',0)) end)
$$;
create function pg_temp.t(id text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('audienceId',id,'facts',pg_temp.facts(),'bestHour',9,'bestWeekday','Tue',
    'compared',false,'reason','enough') || extra
$$;
-- The store's row with these facts changed, as the refused list's text.
create function pg_temp.tf(extra jsonb) returns text language sql as $$
  select jsonb_build_array(pg_temp.t('*',jsonb_build_object('facts',pg_temp.facts() || extra)))::text
$$;
create function pg_temp.job(tenant text, key text, age interval, mode text default 'fixture', kind text default 'brand.read_history',
    lease_until timestamptz default now()+interval '1 minute') returns text
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values (tenant::uuid,kind,key,jsonb_build_object('mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1),
      now()-age,'running','00000000-0000-4000-8000-00000000aaaa',lease_until)
    returning id::text
$$;
create function pg_temp.record(times jsonb, job text default current_setting('test.job'), tz text default 'America/New_York')
returns integer language sql as $$
  select public.record_send_times(job::uuid,'00000000-0000-4000-8000-00000000aaaa',tz,times)
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
select null from (select set_config('test.job',pg_temp.job('00000000-0000-4000-8000-000000000101','times-1','20 minutes'),true)) x;
select null from (select set_config('test.live102',pg_temp.job('00000000-0000-4000-8000-000000000102','times-102','20 minutes','live'),true)) x;
select null from (select set_config('test.catalog',pg_temp.job('00000000-0000-4000-8000-000000000101','times-catalog','20 minutes','fixture',
  'brand.read_catalog'),true)) x;
select null from (select set_config('test.expired',pg_temp.job('00000000-0000-4000-8000-000000000101','times-expired','20 minutes','fixture',
  'brand.read_history',now()-interval '1 second'),true)) x;

-- Grants: only the worker records; browser roles never write the table.
select ok(not bool_or(has_function_privilege(r,'public.record_send_times(uuid,uuid,text,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_send_times(uuid,uuid,text,jsonb)','execute'),
  'only the worker records send times') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.klaviyo_send_times',p)),'browser roles cannot write them')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.klaviyo_send_times','select'),'anonymous visitors cannot read them');
select ok((select relrowsecurity from pg_class where oid='public.klaviyo_send_times'::regclass),'row level security is on');

-- An owner cannot call it; nor the worker's role without its sign-in.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.t('*')))$$,'42501',null,'an owner cannot record send times');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.t('*')))$$,'42501',null,
  'nor the worker''s role without its sign-in');
reset role;

-- Everything is checked before anything is written.
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.record(%L::jsonb)', x),'23514',null,'refused send times: '||left(x,70))
  from unnest(array[
    '[]',
    '{}',
    '[1]',
    jsonb_build_array(pg_temp.t('SegA'))::text,
    jsonb_build_array(pg_temp.t('*'),pg_temp.t('*'))::text,
    jsonb_build_array(pg_temp.t('*','{"note":"x"}'))::text,
    jsonb_build_array(pg_temp.t('*') - 'reason')::text,
    jsonb_build_array(pg_temp.t('*'),pg_temp.t('bad id'))::text,
    jsonb_build_array(pg_temp.t('*','{"bestHour":23}'))::text,
    jsonb_build_array(pg_temp.t('*','{"bestHour":"9"}'))::text,
    jsonb_build_array(pg_temp.t('*','{"bestWeekday":"Monday"}'))::text,
    jsonb_build_array(pg_temp.t('*','{"bestHour":null}'))::text,
    jsonb_build_array(pg_temp.t('*','{"bestHour":null,"reason":"few_sends","compared":true,"bestWeekday":null}'))::text,
    jsonb_build_array(pg_temp.t('*','{"reason":"few_sends","bestHour":null}'))::text,
    jsonb_build_array(pg_temp.t('*','{"reason":"maybe"}'))::text,
    jsonb_build_array(pg_temp.t('*','{"compared":"yes"}'))::text,
    pg_temp.tf('{"extra":1}'),
    pg_temp.tf('{"sends":301}'),
    pg_temp.tf('{"opens":-1}'),
    pg_temp.tf('{"firstSentAt":"yesterday"}'),
    pg_temp.tf('{"firstSentAt":null}'),
    pg_temp.tf('{"hours":[{"hour":24,"sends":1,"recipients":1,"opens":1,"clicks":1,"machineOpens":0}]}'),
    pg_temp.tf('{"hours":[{"hour":9,"sends":1,"recipients":1,"opens":1,"clicks":1,"machineOpens":0},{"hour":9,"sends":1,"recipients":1,"opens":1,"clicks":1,"machineOpens":0}]}'),
    pg_temp.tf('{"weekdays":[{"weekday":"Someday","sends":1,"recipients":1,"opens":1,"clicks":1,"machineOpens":0}]}')
  ]) x;
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.t('*')),current_setting('test.job'),'Mars/Olympus')$$,
  '23514',null,'only a real timezone');
select throws_ok($$select public.record_send_times(current_setting('test.job')::uuid,gen_random_uuid(),'UTC',
  jsonb_build_array(pg_temp.t('*')))$$,'PT409',null,'only with the job''s lease');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.t('*')),current_setting('test.expired'))$$,'PT409',null,
  'never with an expired lease');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.t('*')),current_setting('test.catalog'))$$,'23514',null,
  'only a history read keeps send times');

-- A read keeps its rows: facts apart from the recommendation.
select is(pg_temp.record(jsonb_build_array(pg_temp.t('*','{"compared":true}'),
  pg_temp.t('SegVIP',jsonb_build_object('bestHour',null,'bestWeekday',null,'reason','few_sends','facts',pg_temp.facts(2))))),2,
  'the store and one segment kept');
select is(pg_temp.record(jsonb_build_array(pg_temp.t('*')),current_setting('test.live102')),1,'another workspace''s live read keeps its own');
reset role;
select results_eq($$select audience_id, best_hour::integer, best_weekday, compared, reason, timezone, live, run_id::text,
    (facts->>'sends')::integer from public.klaviyo_send_times
    where tenant_id='00000000-0000-4000-8000-000000000101' order by audience_id$$,
  $$values ('*',9,'Tue',true,'enough','America/New_York',false,current_setting('test.job'),3),
    ('SegVIP',null::integer,null::text,false,'few_sends','America/New_York',false,current_setting('test.job'),2)$$,
  'with the recommendation, its reason and the facts');
select is((select live from public.klaviyo_send_times where tenant_id='00000000-0000-4000-8000-000000000102'),true,
  'a live read''s rows say so');

-- Members read their own workspace's rows only.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.klaviyo_send_times),2,'the owner reads the workspace''s send times');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.klaviyo_send_times),2,'so does staff');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.klaviyo_send_times),1,'another workspace''s owner reads only theirs');
select throws_ok($$delete from public.klaviyo_send_times$$,'42501',null,'and cannot delete');
reset role;

-- A newer read replaces them; an older one never does.
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.job2',pg_temp.job('00000000-0000-4000-8000-000000000101','times-2','10 minutes'),true)) x;
select is(pg_temp.record(jsonb_build_array(pg_temp.t('*','{"bestHour":18}')),current_setting('test.job2'),'Europe/London'),1,'a newer read');
reset role;
select is((select string_agg(audience_id||' '||best_hour||' '||timezone,',') from public.klaviyo_send_times
  where tenant_id='00000000-0000-4000-8000-000000000101'),'* 18 Europe/London','replaces the earlier rows');
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.job0',pg_temp.job('00000000-0000-4000-8000-000000000101','times-0','30 minutes'),true)) x;
select is(pg_temp.record(jsonb_build_array(pg_temp.t('*','{"bestHour":7}')),current_setting('test.job0')),0,
  'an older read, resumed late, writes nothing');
reset role;
select is((select best_hour::integer from public.klaviyo_send_times where tenant_id='00000000-0000-4000-8000-000000000101'),18,
  'the newer rows stay');

select * from finish();
rollback;
