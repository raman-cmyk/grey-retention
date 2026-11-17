begin;
select plan(40);

-- REL-ONB2 part d1: the Site reader's founder finding, its note whole
-- sentences of the About page (`whole: true`). Owner ...01 and staff ...05
-- are in workspace 101 (cedar-lane.example); owner ...04 runs 102.
create function pg_temp.job(key text, age interval default '0') returns uuid language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values ('00000000-0000-4000-8000-000000000101','brand.read_site',key,jsonb_build_object('domain','cedar-lane.example'),
      '00000000-0000-4000-8000-000000000001',now()-age,'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id
$$;
create function pg_temp.founder(extra jsonb default '{}', evidence jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','founder','statement','Maya Lee, the founder, writes why she started.',
    'value',jsonb_build_object('name','Maya Lee','role','Founder'),
    'evidence',jsonb_build_object('url','https://cedar-lane.example/pages/about',
      'quote','I started Cedar Lane in my spare room in 2016.','page','about','whole',true) || evidence,
    'confidence',0.8,'pass','model','model','gemini-2.5-flash') || extra
$$;
create function pg_temp.returns(evidence jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','returns','statement','Returns within 30 days.','value',jsonb_build_object('days',30),
    'evidence',jsonb_build_object('url','https://cedar-lane.example/pages/returns','quote','Return any unworn item within 30 days.',
      'page','returns') || evidence,
    'confidence',0.7,'pass','model','model','gemini-2.5-flash')
$$;
create function pg_temp.pages() returns jsonb language sql as $$
  select '[{"url":"https://cedar-lane.example/","kind":"home","state":"read"},
    {"url":"https://cedar-lane.example/pages/about","kind":"about","state":"read"},
    {"url":"https://cedar-lane.example/pages/returns","kind":"returns","state":"read"}]'::jsonb
$$;
create function pg_temp.record(job uuid, findings jsonb) returns jsonb language sql as $$
  select public.record_site_findings(job,'00000000-0000-4000-8000-00000000aaaa',findings,pg_temp.pages(),true)
$$;
select set_config('test.job',pg_temp.job('founder-1','1 hour')::text,true);
select set_config('test.job2',pg_temp.job('founder-2')::text,true);

-- The founder's value: a name and an optional role, 1 to 60 characters each, nothing else.
select ok(private.finding_value_ok('founder', v), 'founder '||v::text) from (values
  ('{"name":"Maya Lee"}'::jsonb), ('{"name":"Maya Lee","role":"Founder & maker"}'),
  (jsonb_build_object('name',repeat('m',60),'role',repeat('r',60)))) as x(v);
select ok(not private.finding_value_ok('founder', v), 'founder '||v::text) from (values
  ('{}'::jsonb), ('{"name":""}'), ('{"name":"   "}'), ('{"name":5}'), (jsonb_build_object('name',repeat('m',61))),
  ('{"name":"Maya","role":""}'), (jsonb_build_object('name','Maya','role',repeat('r',61))), ('{"name":"Maya","role":1}'),
  ('{"name":"Maya","photo":"https://cedar-lane.example/m.jpg"}'), ('{"name":"Maya","note":"I knit."}')) as x(v);

-- Recording: the mark only on a founder's note from the About page, and always on one.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
-- Each refused by the function's own rule.
select throws_ok(format('select pg_temp.record(%L,%L)',current_setting('test.job'),jsonb_build_array(bad)),'23514',
  'Invalid finding','refused: '||why)
  from (values
    (pg_temp.founder('{}','{"whole":null}') #- '{evidence,whole}', 'a founder''s note without the mark'),
    (pg_temp.founder('{}','{"whole":false}'), 'the mark as false'),
    (pg_temp.founder('{}','{"whole":"true"}'), 'the mark as words'),
    (pg_temp.founder('{}','{"whole":1}'), 'the mark as a number'),
    (pg_temp.founder('{}','{"page":"home","url":"https://cedar-lane.example/"}'), 'a founder''s note from the home page'),
    (pg_temp.founder('{}','{"page":"returns","url":"https://cedar-lane.example/pages/returns"}'), 'or the returns page'),
    (pg_temp.returns('{"whole":true}'), 'the mark on another topic'),
    (pg_temp.founder('{}','{"sentences":2}'), 'another evidence key'),
    (pg_temp.founder('{}',jsonb_build_object('quote',repeat('I',301))), 'a note over 300 characters'),
    (pg_temp.founder('{}','{"url":"https://other.example/pages/about"}'), 'a note from another website'),
    (jsonb_set(pg_temp.founder(),'{evidence}','"x"'), 'evidence that is no object')) as x(bad, why);
-- Each refused by the value's own shape (`finding_value_ok`).
select throws_ok(format('select pg_temp.record(%L,%L)',current_setting('test.job'),jsonb_build_array(bad)),'23514',
  'new row for relation "brand_findings" violates check constraint "brand_findings_check"','refused: '||why)
  from (values
    (pg_temp.founder('{"value":{"name":"Maya Lee","photo":"x"}}'), 'a value of another shape'),
    (pg_temp.founder('{"value":{}}'), 'a founder without a name')) as x(bad, why);
select is((select count(*)::int from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'a refused run stores nothing');

select is(pg_temp.record(current_setting('test.job')::uuid,jsonb_build_array(pg_temp.founder(),pg_temp.returns())),
  '{"pages": 3, "findings": 2}'::jsonb,'a founder''s note from the About page is stored with the other findings');
select is((select value::text||' '||(evidence->'whole')::text||' '||(evidence->>'page') from public.brand_findings
    where run_id=current_setting('test.job')::uuid and topic='founder'),
  '{"name": "Maya Lee", "role": "Founder"} true about','with its name, role and whole-sentence mark');
select is((select evidence ? 'whole' from public.brand_findings where run_id=current_setting('test.job')::uuid and topic='returns'),
  false,'other findings carry no mark');
reset role;

-- The table holds the same rule for any writer.
create function pg_temp.copy(topic text, evidence text) returns text language sql as $$
  select format($q$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,value,evidence,confidence,pass)
    select tenant_id,run_id,source,topic,statement,value,%s,confidence,pass from public.brand_findings
      where run_id=current_setting('test.job')::uuid and topic=%L$q$, evidence, topic)
$$;
select throws_ok(pg_temp.copy(t, e),'23514',
  'new row for relation "brand_findings" violates check constraint "brand_findings_founder_whole"',why)
  from (values
    ('founder', $$evidence - 'whole'$$, 'a founder row needs the mark'),
    ('founder', $$evidence || '{"whole":false}'$$, 'never the mark as false'),
    ('founder', $$evidence || '{"whole":"true"}'$$, 'or as words'),
    ('founder', $$evidence || '{"page":"home"}'$$, 'only from the About page'),
    ('returns', $$evidence || '{"whole":true}'$$, 'no other row carries it')) as x(t, e, why);
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,value,evidence,confidence,pass)
  select tenant_id,run_id,'reviews',topic,statement,value,evidence,confidence,pass from public.brand_findings
    where run_id=current_setting('test.job')::uuid and topic='founder'$$,'23514',null,'only the Site reader states a founder');

-- A newer read of the About page replaces the note.
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.record(current_setting('test.job2')::uuid,jsonb_build_array(pg_temp.founder('{"value":{"name":"Maya Lee"}}',
    '{"quote":"I still knit every sample myself."}'))),'{"pages": 3, "findings": 1}'::jsonb,'a newer read');
select is((select string_agg((evidence->>'quote')||':'||(superseded_at is null),',' order by superseded_at is null) from public.brand_findings
    where tenant_id='00000000-0000-4000-8000-000000000101' and topic='founder'),
  'I started Cedar Lane in my spare room in 2016.:false,I still knit every sample myself.:true','replaces the earlier note');
reset role;

-- Members read their own workspace's note, and only theirs.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select value->>'name' from public.brand_findings where topic='founder' and superseded_at is null),'Maya Lee',
  'staff of the workspace read it');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.brand_findings where topic='founder'),0,'another workspace reads none');
reset role;

select * from finish();
rollback;
