begin;
select plan(52);

-- PIC-29 part 2a: the words this brand never uses, kept by the history
-- read. Owner ...01 and staff ...05 are in workspace 101 (a synthetic
-- brand); owner ...04 runs workspace 102 (a real brand here). Reads are
-- started some minutes apart (`age`): a newer read's list is never replaced
-- by an older one.
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000102';

create function pg_temp.v(id text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('phrase',id,'state','never','removed',3,'kept',0,'instead',jsonb_build_array('quiet')) || extra
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
create function pg_temp.record(samples jsonb, job text default current_setting('test.job')) returns integer language sql as $$
  select public.record_never_words(job::uuid,'00000000-0000-4000-8000-00000000aaaa',samples)
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.count(tenant text) returns integer language sql as $$
  select count(*)::integer from public.brand_never_words where tenant_id=tenant::uuid
$$;
select null from (select set_config('test.job',pg_temp.job('00000000-0000-4000-8000-000000000101','never-1','20 minutes'),true)) x;
select null from (select set_config('test.job102',pg_temp.job('00000000-0000-4000-8000-000000000102','never-102','20 minutes'),true)) x;
select null from (select set_config('test.live102',pg_temp.job('00000000-0000-4000-8000-000000000102','never-102-live','20 minutes','live'),true)) x;
select null from (select set_config('test.catalog',pg_temp.job('00000000-0000-4000-8000-000000000101','never-catalog','20 minutes','fixture',
  'brand.read_catalog'),true)) x;
select null from (select set_config('test.expired',pg_temp.job('00000000-0000-4000-8000-000000000101','never-expired','20 minutes','fixture',
  'brand.read_history',now()-interval '1 second'),true)) x;

-- Grants: only the worker records; browser roles never write the table.
select ok(not bool_or(has_function_privilege(r,'public.record_never_words(uuid,uuid,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_never_words(uuid,uuid,jsonb)','execute'),
  'only the worker records voice samples') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_never_words',p)),'browser roles cannot write the samples')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.brand_never_words','select'),'anonymous visitors cannot read them');
select ok(current_setting('server_version_num')::integer < 170000
  or not bool_or(has_table_privilege(r,'public.brand_never_words','maintain')),'nor maintain them')
  from unnest(array['anon','authenticated']) r;
select ok((select relrowsecurity from pg_class where oid='public.brand_never_words'::regclass),'row level security is on');

-- An owner cannot call it, even with the lease; nor the worker's role
-- without the worker's sign-in.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.v('MsgA08')))$$,'42501',null,'an owner cannot record samples');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.v('MsgA08')))$$,'42501',null,
  'nor the worker''s role without its sign-in');
reset role;

-- Everything is checked before anything is written.
set local role service_role;
select pg_temp.as_worker();
select throws_ok(format('select pg_temp.record(%L::jsonb)', x),'23514',null,'refused words: '||left(x,60))
  from unnest(array[
    '{}',
    'null',
    '[1]',
    '[null]',
    (select jsonb_agg(pg_temp.v('word'||i))::text from generate_series(1,101) i),
    (select jsonb_agg(pg_temp.v('word'||i,'{"state":"watched"}'))::text from generate_series(1,101) i),
    jsonb_build_array(pg_temp.v('amazing','{"note":"x"}'))::text,
    jsonb_build_array(pg_temp.v('amazing') - 'kept')::text,
    jsonb_build_array(pg_temp.v(''))::text,
    jsonb_build_array(pg_temp.v(' amazing'))::text,
    jsonb_build_array(pg_temp.v(E'two\nlines'))::text,
    jsonb_build_array(pg_temp.v(repeat('a',171)))::text,
    jsonb_build_array(pg_temp.v('amazing','{"phrase":8}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"state":"banned"}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"removed":0}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"removed":"3"}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"removed":2.5}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"kept":-1}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"instead":"quiet"}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"instead":["a","b","c","d"]}'))::text,
    jsonb_build_array(pg_temp.v('amazing','{"instead":[3]}'))::text,
    jsonb_build_array(pg_temp.v('amazing'),pg_temp.v('amazing'))::text
  ]) x;
select throws_ok($$select public.record_never_words(current_setting('test.job')::uuid,gen_random_uuid(),'[]')$$,
  'PT409',null,'only with the job''s lease');
select throws_ok($$select pg_temp.record('[]',current_setting('test.expired'))$$,'PT409',null,'never with an expired lease');
select throws_ok($$select pg_temp.record('[]',current_setting('test.catalog'))$$,'23514',null,'only a history read keeps words');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.v('total game-changer')),current_setting('test.job102'))$$,'23514',null,
  'the sample account''s edits never for a real brand');

-- A read keeps its list.
select is(pg_temp.record(jsonb_build_array(pg_temp.v('amazing'),pg_temp.v('truly luxurious','{"state":"watched","removed":1,"kept":1,"instead":[]}'))),2,'two words kept');
select is(pg_temp.record(jsonb_build_array(pg_temp.v('total game-changer')),current_setting('test.live102')),1,'a real brand''s live read keeps its own');
reset role;
select results_eq($$select phrase, state, removed, kept, instead, run_id::text from public.brand_never_words
    where tenant_id='00000000-0000-4000-8000-000000000101' order by phrase$$,
  $$values ('amazing','never',3,0,'["quiet"]'::jsonb,current_setting('test.job')),
    ('truly luxurious','watched',1,1,'[]'::jsonb,current_setting('test.job'))$$,'with their state, counts and what he wrote instead');

-- Members read their own workspace's samples only.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.brand_never_words),2,'the owner reads the workspace''s words');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.brand_never_words),2,'so does staff');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select phrase from public.brand_never_words),'total game-changer','another workspace''s owner reads only theirs');
select throws_ok($$delete from public.brand_never_words$$,'42501',null,'and cannot delete');
reset role;

-- A newer read replaces them; an older one never does.
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.job2',pg_temp.job('00000000-0000-4000-8000-000000000101','never-2','10 minutes'),true)) x;
select is(pg_temp.record(jsonb_build_array(pg_temp.v('fabulous')),current_setting('test.job2')),1,'a newer read');
reset role;
select is((select string_agg(phrase||' '||(run_id::text=current_setting('test.job2'))::text,',') from public.brand_never_words
  where tenant_id='00000000-0000-4000-8000-000000000101'),'fabulous true','replaces the earlier list');
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.job0',pg_temp.job('00000000-0000-4000-8000-000000000101','never-0','30 minutes'),true)) x;
select is(pg_temp.record(jsonb_build_array(pg_temp.v('stale')),current_setting('test.job0')),0,'an older read, resumed late, writes nothing');
reset role;
select is((select string_agg(phrase,',') from public.brand_never_words where tenant_id='00000000-0000-4000-8000-000000000101'),
  'fabulous','the newer read''s list stays');

-- An older read than the stored history's keeps nothing either.
select null from (select set_config('test.hist102',pg_temp.job('00000000-0000-4000-8000-000000000102','never-102-hist','5 minutes','live'),true)) x;
insert into public.klaviyo_history(tenant_id,run_id,state,snapshot,live)
  values ('00000000-0000-4000-8000-000000000102',current_setting('test.hist102')::uuid,'ready','{}',true)
  on conflict (tenant_id) do update set run_id=excluded.run_id, state='ready', snapshot='{}';
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.mid102',pg_temp.job('00000000-0000-4000-8000-000000000102','never-102-mid','10 minutes','live'),true)) x;
select is(pg_temp.record('[]',current_setting('test.mid102')),0,'a read older than the stored history writes nothing');
reset role;
select is(pg_temp.count('00000000-0000-4000-8000-000000000102'),1,'and the list stays');

-- The caps exactly: 100 never used and 100 watched.
set local role service_role;
select pg_temp.as_worker();
select null from (select set_config('test.job3',pg_temp.job('00000000-0000-4000-8000-000000000101','never-3','1 minute'),true)) x;
select is(pg_temp.record((select jsonb_agg(pg_temp.v('word'||i)) || jsonb_agg(pg_temp.v('watch'||i,'{"state":"watched"}'))
    from generate_series(1,100) i),current_setting('test.job3')),200,'a hundred of each are kept');
select null from (select set_config('test.job4',pg_temp.job('00000000-0000-4000-8000-000000000101','never-4','30 seconds'),true)) x;
select is(pg_temp.record(jsonb_build_array(pg_temp.v(repeat('a',170)),pg_temp.v('Ünïcode wörd',
    '{"instead":["one","two","three"]}')),current_setting('test.job4')),2,'the longest phrase, any script, three swaps');
reset role;

-- A read that learned none clears them; never another workspace's.
select null from (select set_config('test.job5',pg_temp.job('00000000-0000-4000-8000-000000000101','never-5','10 seconds'),true)) x;
select is(pg_temp.record('[]',current_setting('test.job5')),0,'a read that learned none');
reset role;
select is(pg_temp.count('00000000-0000-4000-8000-000000000101'),0,'clears them');
select is(pg_temp.count('00000000-0000-4000-8000-000000000102'),1,'and never another workspace''s');

-- A finished read keeps nothing more.
update public.job_runs set status='succeeded' where id=current_setting('test.job5')::uuid;
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record('[]',current_setting('test.job5'))$$,'PT409',null,'a finished read cannot record');
reset role;

select * from finish();
rollback;
