begin;
select plan(37);

-- PIC-23 part 2b: the owner's own words kept by the history read. Owner
-- ...01 and staff ...05 are in workspace 101 (a synthetic brand); owner ...04
-- runs workspace 102 (a real brand here).
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000102';

create function pg_temp.v(id text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('messageId',id,
    'text','Hi [first name], I started this shop in my garage with one sewing machine and a lot of stubbornness, and every shirt still gets checked by hand before it ships. Warmly, Maya',
    'weight',3,'words',30,'sentAt','2026-10-01T10:00:00.000Z') || extra
$$;
create function pg_temp.job(tenant text, key text, mode text default 'fixture', kind text default 'brand.read_history') returns text
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,status,lease_token,lease_until)
    values (tenant::uuid,kind,key,jsonb_build_object('mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1),
      'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id::text
$$;
create function pg_temp.record(samples jsonb, job text default current_setting('test.job')) returns integer language sql as $$
  select public.record_voice_samples(job::uuid,'00000000-0000-4000-8000-00000000aaaa',samples)
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
select set_config('test.job',pg_temp.job('00000000-0000-4000-8000-000000000101','voice-1'),true);
select set_config('test.job102',pg_temp.job('00000000-0000-4000-8000-000000000102','voice-102'),true);
select set_config('test.live102',pg_temp.job('00000000-0000-4000-8000-000000000102','voice-102-live','live'),true);
select set_config('test.catalog',pg_temp.job('00000000-0000-4000-8000-000000000101','voice-catalog','fixture','brand.read_catalog'),true);

-- Grants: only the worker records; browser roles never write the table.
select ok(not bool_or(has_function_privilege(r,'public.record_voice_samples(uuid,uuid,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_voice_samples(uuid,uuid,jsonb)','execute'),
  'only the worker records voice samples') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_voice_samples',p)),'browser roles cannot write the samples')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_voice_samples','select'),'anonymous visitors cannot read them');
select ok(current_setting('server_version_num')::integer < 170000
  or not has_table_privilege('authenticated','public.brand_voice_samples','maintain'),'nor maintain them');
select ok((select relrowsecurity from pg_class where oid='public.brand_voice_samples'::regclass),'row level security is on');

-- An owner cannot call it, even with the lease.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.v('MsgA08')))$$,'42501',null,'an owner cannot record samples');
reset role;

-- Everything is checked before anything is written.
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.record(%L::jsonb)', x),'23514',null,'refused samples: '||left(x,60))
  from unnest(array[
    '{}',
    '[1]',
    (select jsonb_agg(pg_temp.v('Msg'||i))::text from generate_series(1,21) i),
    jsonb_build_array(pg_temp.v('MsgA08','{"note":"x"}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08') - 'words')::text,
    jsonb_build_array(pg_temp.v('bad id'))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"text":""}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08',jsonb_build_object('text',repeat('a',8001))))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"weight":4}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"weight":"3"}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"words":24}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"words":30.5}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08','{"sentAt":"yesterday"}'))::text,
    jsonb_build_array(pg_temp.v('MsgA08'),pg_temp.v('MsgA08'))::text,
    (select jsonb_agg(pg_temp.v('Msg'||i,jsonb_build_object('text',repeat('a ',3800))))::text from generate_series(1,8) i)
  ]) x;
select throws_ok($$select public.record_voice_samples(current_setting('test.job')::uuid,gen_random_uuid(),'[]')$$,
  'PT409',null,'only with the job''s lease');
select throws_ok($$select pg_temp.record('[]',current_setting('test.catalog'))$$,'23514',null,'only a history read keeps samples');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.v('MsgB01')),current_setting('test.job102'))$$,'23514',null,
  'the sample account''s words never for a real brand');

-- A read keeps its samples; a later read replaces them.
select is(pg_temp.record(jsonb_build_array(pg_temp.v('MsgA08'),pg_temp.v('MsgA02','{"weight":1,"sentAt":null}'))),2,'two samples kept');
select is(pg_temp.record(jsonb_build_array(pg_temp.v('MsgB01')),current_setting('test.live102')),1,'a real brand''s live read keeps its own');
reset role;
select results_eq($$select message_id, weight::integer, words, sent_at, run_id::text from public.brand_voice_samples
    where tenant_id='00000000-0000-4000-8000-000000000101' order by message_id$$,
  $$values ('MsgA02',1,30,null::timestamptz,current_setting('test.job')),
    ('MsgA08',3,30,'2026-10-01T10:00:00Z'::timestamptz,current_setting('test.job'))$$,'with their weight, words and send time');

-- Members read their own workspace's samples only.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.brand_voice_samples),2,'the owner reads the workspace''s samples');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.brand_voice_samples),2,'so does staff');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select message_id from public.brand_voice_samples),'MsgB01','another workspace''s owner reads only theirs');
select throws_ok($$delete from public.brand_voice_samples$$,'42501',null,'and cannot delete');
reset role;

-- A later read replaces them; one that found none clears them.
set local role service_role;
select pg_temp.as_worker();
select set_config('test.job2',pg_temp.job('00000000-0000-4000-8000-000000000101','voice-2'),true);
select is(pg_temp.record(jsonb_build_array(pg_temp.v('MsgC01')),current_setting('test.job2')),1,'a later read');
reset role;
select is((select string_agg(message_id||' '||(run_id::text=current_setting('test.job2'))::text,',') from public.brand_voice_samples
  where tenant_id='00000000-0000-4000-8000-000000000101'),'MsgC01 true','replaces the earlier samples');
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.record('[]',current_setting('test.job2')),0,'a read that found none');
reset role;
select is((select count(*)::integer from public.brand_voice_samples where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'clears them');
select is((select count(*)::integer from public.brand_voice_samples where tenant_id='00000000-0000-4000-8000-000000000102'),1,
  'and never another workspace''s');

-- A finished read keeps nothing more.
update public.job_runs set status='succeeded' where id=current_setting('test.job2')::uuid;
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record('[]',current_setting('test.job2'))$$,'PT409',null,'a finished read cannot record');
reset role;

select * from finish();
rollback;
