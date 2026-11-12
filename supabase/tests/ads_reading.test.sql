begin;
select plan(78);

-- ONB-104: ads reads and their findings. Owner ...01 and staff ...05 are in
-- workspace 101 (a synthetic brand, cedar-lane.example); owner ...04 runs
-- workspace 102 (made a real brand below).
create function pg_temp.ad(id text, link text default 'https://cedar-lane.example/') returns jsonb language sql as $$
  select jsonb_build_object('id',id,'link',link)
$$;
create function pg_temp.f(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('topic','promotion','statement','A live ad offers 20% off every knit.',
    'value',jsonb_build_object('kind','percent_off','percent',20),
    'evidence',jsonb_build_object('url','https://www.facebook.com/ads/library/?id=9001','quote','20% off every knit.'),
    'confidence',0.7,'pass','sample','model',null) || extra
$$;
create function pg_temp.lp(url text default 'https://cedar-lane.example/collections/knitwear') returns jsonb language sql as $$
  select pg_temp.f(jsonb_build_object('topic','landing_page','statement','Live ads send people to /collections/knitwear.',
    'value',jsonb_build_object('url',url)))
$$;
create function pg_temp.s(st text default 'ready', analysis text default 'done') returns jsonb language sql as $$
  select jsonb_build_object('state',st,'analysis',analysis)
$$;
create function pg_temp.lease(j text) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute'
    where id=j::uuid
$$;
create function pg_temp.record(findings jsonb default jsonb_build_array(pg_temp.f(), pg_temp.lp()),
    ads jsonb default jsonb_build_array(pg_temp.ad('9001'), pg_temp.ad('9002', null)), summary jsonb default pg_temp.s(),
    job text default current_setting('test.job'), live boolean default false) returns jsonb language sql as $$
  select public.record_ad_findings(job::uuid,'00000000-0000-4000-8000-00000000aaaa',findings,ads,summary,live)
$$;
create function pg_temp.job(tenant text, key text, mode text default 'sample', age interval default '0',
    domain text default 'cedar-lane.example') returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_ads',key,jsonb_build_object('domain',domain,'mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id::text
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.current_ads(tenant text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select count(*)::integer from public.brand_findings where tenant_id=tenant::uuid and source='ads' and superseded_at is null
$$;

-- Grants.
select ok(has_function_privilege('authenticated','public.start_ads_reading(uuid)','execute')
  and not has_function_privilege('anon','public.start_ads_reading(uuid)','execute')
  and not has_function_privilege('service_role','public.start_ads_reading(uuid)','execute'),'only signed-in people start a read');
select ok(not bool_or(has_function_privilege(r,'public.record_ad_findings(uuid,uuid,jsonb,jsonb,jsonb,boolean)','execute'))
  and has_function_privilege('service_role','public.record_ad_findings(uuid,uuid,jsonb,jsonb,jsonb,boolean)','execute'),
  'only the worker records ads findings') from unnest(array['anon','authenticated']) r;

-- The findings contract: the ads topics, each with its own shape.
select ok(bool_and(private.finding_value_ok('promotion',v)),'a promotion is a percentage, an amount, a gift or a bundle')
  from unnest(array['{"kind":"percent_off","percent":20}','{"kind":"amount_off","amount":10,"currency":"USD"}',
    '{"kind":"gift"}','{"kind":"bundle"}']::jsonb[]) v;
select ok(not bool_or(private.finding_value_ok('promotion',v)),'and nothing else')
  from unnest(array['{"kind":"percent_off","percent":95}','{"kind":"percent_off","percent":12.5}','{"kind":"percent_off"}',
    '{"kind":"amount_off","amount":10}','{"kind":"gift","percent":10}','{"kind":"free_shipping"}','{}']::jsonb[]) v;
select ok(private.finding_value_ok('landing_page','{"url":"https://cedar-lane.example/p"}')
  and not private.finding_value_ok('landing_page','{"url":"http://cedar-lane.example/p"}')
  and not private.finding_value_ok('landing_page','{"url":"https://cedar-lane.example/p","x":1}')
  and not private.finding_value_ok('landing_page','{}'),'a landing page is one https page');
select ok(private.finding_value_ok('angle','{}') and private.finding_value_ok('creative','{}')
  and not private.finding_value_ok('angle','{"x":1}') and private.finding_value_ok('performance','{}')
  and private.finding_value_ok('returns','{"days":30}'),'angle and creative hold words only; the other topics are as before');

-- The owner starts a read: the brand's website is needed, once a day.
update public.brand_profiles set domain = '' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.start_ads_reading('00000000-0000-4000-8000-000000000101')$$,'23514',null,
  'the brand''s website is needed first');
reset role;
update public.brand_profiles set domain = ' WWW.Cedar-Lane.example' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select set_config('test.job',public.start_ads_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_ads_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'asking again the same day is the same read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.start_ads_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.start_ads_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'nor another workspace''s owner');
reset role;
select is((select kind||'/'||status||'/'||(input->>'domain')||'/'||(input->>'mode') from public.job_runs
  where id=current_setting('test.job')::uuid),'brand.read_ads/queued/cedar-lane.example/sample',
  'a synthetic brand''s read is queued for its plain domain, on the sample ads');
update public.brand_profiles set synthetic=false, domain='north-studio.com' where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select set_config('test.real',public.start_ads_reading('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select is((select input->>'mode' from public.job_runs where id=current_setting('test.real')::uuid),'live','a real brand reads its live ads');
update public.job_runs set status='failed', attempt=4, error_code='transient' where id=current_setting('test.real')::uuid;
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is(public.start_ads_reading('00000000-0000-4000-8000-000000000102')::text,current_setting('test.real'),'a failed read');
reset role;
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.real')::uuid),'queued/0',
  'is started again with all its tries');

-- Only the onboarding readers' run takes it, as the worker.
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101') where kind='brand.read_ads'),0,
  'the workspace jobs never take an ads read');
select is(public.source_readings_waiting(),2,'the readers'' run sees the ads reads waiting');
select is((select kind from public.claim_source_reading()),'brand.read_ads','and takes the oldest');
reset role;
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record()$$,'42501',null,'an owner cannot record findings');
reset role;

-- The worker records them: each finding cites an ad kept in this read.
select pg_temp.lease(current_setting('test.job'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select public.record_ad_findings(current_setting('test.job')::uuid,'00000000-0000-4000-8000-00000000bbbb',
  '[]','[]',pg_temp.s('skipped','skipped'),false)$$,'PT409',null,'only under the job''s lease');
select throws_ok(format('select pg_temp.record(summary => %L)', s),'23514',null,'refused summary: '||s)
  from unnest(array['{"state":"great","analysis":"done"}','{"state":"ready"}','{"state":"ready","analysis":"done","why":"x"}']) s;
-- With no ads and no findings, so only the summary can be wrong.
select throws_ok(format('select pg_temp.record(''[]'',''[]'',%L)', s),'23514',null,'refused summary: '||s)
  from unnest(array['{"state":"none","analysis":"done"}','{"state":"skipped","analysis":"skipped","reason":"Not Set Up"}',
    '{"state":"skipped","analysis":"skipped","reason":true}']) s;
select throws_ok(format('select pg_temp.record(ads => %L)', a),'23514',null,'refused ads: '||a)
  from unnest(array['[]','[{"id":"../x","link":null}]','[{"id":"9001","link":"https://evil.example/"}]',
    '[{"id":"9001","link":"https://cedar-lane.example.evil/"}]','[{"id":"9001","link":null},{"id":"9001","link":null}]',
    '[{"id":"9001","link":null,"x":1}]']) a;
select throws_ok(format('select pg_temp.record(findings => jsonb_build_array(%L::jsonb))', f),'23514',null,'refused finding: '||f)
  from unnest(array[
    pg_temp.f(jsonb_build_object('evidence',jsonb_build_object('url','https://www.facebook.com/ads/library/?id=7777','quote','x'))),
    pg_temp.f(jsonb_build_object('evidence',jsonb_build_object('url','https://cedar-lane.example/?id=9001','quote','x'))),
    pg_temp.f(jsonb_build_object('evidence',jsonb_build_object('ref','meta:9001'))),
    pg_temp.lp('https://evil.example/collections'),
    pg_temp.f(jsonb_build_object('pass','code')),
    pg_temp.f(jsonb_build_object('pass','model','model','gemini-2.5-flash')),
    pg_temp.f(jsonb_build_object('topic','returns','value',jsonb_build_object('days',30))),
    pg_temp.f(jsonb_build_object('confidence',2)),
    pg_temp.f(jsonb_build_object('note','x'))]::text[]) f;
select throws_ok($$select pg_temp.record(findings => jsonb_build_array(pg_temp.f(jsonb_build_object('value',
  jsonb_build_object('kind','percent_off','percent',95)))))$$,'23514',null,'a promotion of a shape it cannot hold');
select throws_ok($$select pg_temp.record(live => true)$$,'23514',null,'a sample read is never stored as live');
select throws_ok($$select pg_temp.record(ads => '[]', summary => pg_temp.s('none','skipped'))$$,'23514',null,
  'no ads, no findings');
select is(pg_temp.record(),'{"ads": 2, "newer": false, "findings": 2}'::jsonb,'a read''s findings are stored at once');
select is((select status||'/'||(checkpoint->>'state')||'/'||(checkpoint->>'ads') from public.job_runs
  where id=current_setting('test.job')::uuid),'succeeded/ready/2','and its job is finished');
select is(pg_temp.current_ads(),2,'its findings are current');
reset role;
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.job')::uuid,'ads','performance','What made money.',
    '{"ref":"x"}',0.5,'sample')$$,'23514',
  'new row for relation "brand_findings" violates check constraint "brand_findings_ads_topics"','ads state only what ads can');

-- Members read them; another workspace does not.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
  and source='ads'),2,'staff read the ads findings');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'another workspace reads none');
reset role;

-- A skipped read replaces nothing; a read finding no ads replaces them all;
-- an older read finishing late replaces nothing.
select set_config('test.skip',pg_temp.job('00000000-0000-4000-8000-000000000101','skip'),true);
select pg_temp.lease(current_setting('test.skip'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record('[]','[]',jsonb_build_object('state','skipped','analysis','skipped','reason','library_refused'),
  current_setting('test.skip'))$$,'a skipped read is stored');
select is(pg_temp.current_ads(),2,'and replaces nothing');
reset role;
select set_config('test.none',pg_temp.job('00000000-0000-4000-8000-000000000101','none'),true);
select pg_temp.lease(current_setting('test.none'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record('[]','[]',pg_temp.s('none','skipped'),current_setting('test.none'))$$,
  'a read finding no live ads is stored');
select is(pg_temp.current_ads(),0,'and the ads findings are no longer current');
reset role;
select set_config('test.old',pg_temp.job('00000000-0000-4000-8000-000000000101','old',age => '1 hour'),true);
select pg_temp.lease(current_setting('test.old'));
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.record(job => current_setting('test.old'))->>'newer','true','an older read finishing late');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.old')::uuid
  and superseded_at is not null),2,'keeps its findings already replaced');
select is(pg_temp.current_ads(),0,'and replaces nothing');
reset role;

-- The sample ads only for a synthetic brand; a real brand's live read.
select set_config('test.fake',pg_temp.job('00000000-0000-4000-8000-000000000102','fake',domain => 'north-studio.com'),true);
select pg_temp.lease(current_setting('test.fake'));
select pg_temp.lease(current_setting('test.real'));
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record('[]','[]',pg_temp.s('skipped','skipped'),current_setting('test.fake'))$$,'23514',null,
  'a real brand never gets the sample ads');
select lives_ok($$select pg_temp.record('[]','[]',jsonb_build_object('state','skipped','analysis','skipped','reason','library_not_set_up'),
  current_setting('test.real'),true)$$,'a real brand''s read is skipped until a live library is chosen');
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.f(jsonb_build_object('pass','code','topic','creative',
  'statement','Most live ads are videos.','value','{}'::jsonb))),jsonb_build_array(pg_temp.ad('9001','https://north-studio.com/')),
  pg_temp.s(),current_setting('test.real'),true)$$,'PT409',null,'a finished read records nothing more');
reset role;

-- A real brand's live reads: each pass where it belongs, a subdomain is the
-- brand's own, a later skipped read never makes an older one late.
reset role;
select set_config('test.a',pg_temp.job('00000000-0000-4000-8000-000000000102','a','live','3 hours','north-studio.com'),true);
select set_config('test.b',pg_temp.job('00000000-0000-4000-8000-000000000102','b','live','2 hours','north-studio.com'),true);
select set_config('test.c',pg_temp.job('00000000-0000-4000-8000-000000000102','c','live','150 minutes','north-studio.com'),true);
select pg_temp.lease(current_setting('test.a'));
select pg_temp.lease(current_setting('test.b'));
select pg_temp.lease(current_setting('test.c'));
create function pg_temp.live_ads() returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.ad('8001','https://shop.north-studio.com/p'), pg_temp.ad('8002', null))
$$;
create function pg_temp.lf(extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.f(jsonb_build_object('evidence',
    jsonb_build_object('url','https://www.facebook.com/ads/library/?id=8001','quote','Twenty off.'))) || extra
$$;
create function pg_temp.live_findings() returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.lf(jsonb_build_object('topic','creative','statement','Most live ads are videos.','value','{}'::jsonb,'pass','code')),
    pg_temp.lf(jsonb_build_object('topic','landing_page','statement','Live ads send people to /p.',
      'value',jsonb_build_object('url','https://shop.north-studio.com/p'),'pass','code')),
    pg_temp.lf(jsonb_build_object('topic','angle','statement','Ads speak of quiet homes.','value','{}'::jsonb,
      'pass','model','model','gemini-2.5-flash')))
$$;
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.fail_job(current_setting('test.b')::uuid,'00000000-0000-4000-8000-00000000aaaa','auth')$$,
  '42501',null,'an owner cannot fail a running ads read');
reset role;
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.record(pg_temp.live_findings(),pg_temp.live_ads(),pg_temp.s(),current_setting('test.a'),true)->>'findings','3',
  'a live read stores code''s counts and the model''s words, a subdomain as the brand''s own');
select throws_ok(format('select pg_temp.record(jsonb_build_array(%L::jsonb),pg_temp.live_ads(),%L::jsonb,current_setting(''test.b''),true)',
    f, coalesce(sm, '{"state":"ready","analysis":"done"}')),'23514',null,'refused live finding: '||f::text)
  from (values
    (pg_temp.lf(jsonb_build_object('pass','code')), null),
    (pg_temp.lf(jsonb_build_object('topic','creative','statement','Videos.','value','{}'::jsonb,'pass','code','model','x')), null),
    (pg_temp.lf(jsonb_build_object('pass','model','model',' ')), null),
    (pg_temp.lf(), null),
    (pg_temp.lf(jsonb_build_object('pass','model','model','gemini-2.5-flash')), '{"state":"ready","analysis":"skipped"}'),
    (pg_temp.lf(jsonb_build_object('topic','landing_page','value',jsonb_build_object('url','https://xnorth-studio.com/p'),
      'pass','code')), null),
    (pg_temp.lf(jsonb_build_object('pass','model','model','m','value',
      jsonb_build_object('kind','amount_off','amount',0,'currency','USD'))), null)) x(f, sm);
select throws_ok(format('select pg_temp.record(''[]'',jsonb_build_array(pg_temp.ad(''8001'',%L)),pg_temp.s(''ready'',''skipped''),
    current_setting(''test.b''),true)', l),'23514',null,'refused live link: '||l)
  from unnest(array['https://xnorth-studio.com/p','https://north-studio.com:443/p','https://evil.example\.north-studio.com/x',
    'https://north-studio.com.evil/']) l;
reset role;
insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000102',current_setting('test.real')::uuid,'ads','angle','From when the brand was a sample.',
    '{"url":"https://www.facebook.com/ads/library/?id=1","quote":"Sample words."}',0.5,'sample');
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record('[]','[]',pg_temp.s('skipped','skipped'),current_setting('test.b'),true)$$,
  'a later live read is skipped');
select is(pg_temp.current_ads('00000000-0000-4000-8000-000000000102'),3,
  'and replaces only what was left from the sample ads');
select is(pg_temp.record(pg_temp.live_findings(),pg_temp.live_ads(),pg_temp.s(),current_setting('test.c'),true)->>'newer','false',
  'a read older than that skipped one, but newer than the last ready read, is not late');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.a')::uuid
  and superseded_at is not null),3,'and replaces the earlier read''s findings');
reset role;
select set_config('test.stale',pg_temp.job('00000000-0000-4000-8000-000000000102','stale','live','0','north-studio.com'),true);
update public.job_runs set status='running', lease_token=gen_random_uuid(), lease_until=now()-interval '1 minute'
  where id=current_setting('test.stale')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000102')),0,'the workspace jobs');
select is((select status from public.job_runs where id=current_setting('test.stale')::uuid),'running',
  'never touch an ads read whose lease ran out');
reset role;

select * from finish();
rollback;
