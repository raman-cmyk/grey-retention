begin;
select plan(83);

-- ONB-105: reviews reads and their findings. Owner ...01 and staff ...05 are
-- in workspace 101 (a synthetic brand, cedar-lane.example); owner ...04
-- runs workspace 102 (made a real brand below).
create function pg_temp.page(p text default '/products/weekend-knit', host text default 'cedar-lane.example') returns text
language sql as $$ select 'https://' || host || p $$;
create function pg_temp.q(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('source','reviews','topic','quotable_review','statement','A review by Maya R. that an email may quote.',
    'value',jsonb_build_object('author','Maya R.','url',pg_temp.page(),'rating',5,'date','2026-10-01'),
    'evidence',jsonb_build_object('url',pg_temp.page(),'quote','So soft and warm, and it does not itch at all.'),
    'confidence',0.9,'pass','sample','model',null) || extra
$$;
create function pg_temp.w(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('source','social','topic','customer_words','statement','Customers ask about more colours.','value','{}'::jsonb,
    'evidence',jsonb_build_object('url','https://www.instagram.com/p/SAMPLE01/','quote','come in a darker green'),
    'confidence',0.7,'pass','sample','model',null) || extra
$$;
create function pg_temp.s(r text default 'ready', so text default 'ready', analysis text default 'done') returns jsonb
language sql as $$
  select jsonb_build_object('reviews',jsonb_build_object('state',r),'social',jsonb_build_object('state',so),'analysis',analysis)
$$;
create function pg_temp.lease(j text) returns void language sql as $$
  update public.job_runs set status='running', lease_token='00000000-0000-4000-8000-00000000aaaa', lease_until=now()+interval '1 minute'
    where id=j::uuid
$$;
create function pg_temp.record(findings jsonb default jsonb_build_array(pg_temp.q(), pg_temp.w()),
    pages jsonb default jsonb_build_array(pg_temp.page()), posts jsonb default '["https://www.instagram.com/p/SAMPLE01/"]',
    summary jsonb default pg_temp.s(), job text default current_setting('test.job'), live boolean default false) returns jsonb
language sql as $$
  select public.record_review_findings(job::uuid,'00000000-0000-4000-8000-00000000aaaa',findings,pages,posts,summary,live)
$$;
create function pg_temp.job(tenant text, key text, mode text default 'sample', age interval default '0',
    domain text default 'cedar-lane.example') returns text language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at)
    values (tenant::uuid,'brand.read_reviews',key,jsonb_build_object('domain',domain,'mode',mode),
      (select profile_id from public.tenant_memberships where tenant_id=tenant::uuid and role='owner' limit 1), now()-age)
    returning id::text
$$;
create function pg_temp.as_owner(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.current(source text, tenant text default '00000000-0000-4000-8000-000000000101') returns integer
language sql as $$
  select count(*)::integer from public.brand_findings where tenant_id=tenant::uuid and source=$1 and superseded_at is null
$$;

-- Grants.
select ok(has_function_privilege('authenticated','public.start_reviews_reading(uuid)','execute')
  and not has_function_privilege('anon','public.start_reviews_reading(uuid)','execute')
  and not has_function_privilege('service_role','public.start_reviews_reading(uuid)','execute'),'only signed-in people start a read');
select ok(not bool_or(has_function_privilege(r,'public.record_review_findings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,boolean)','execute'))
  and has_function_privilege('service_role','public.record_review_findings(uuid,uuid,jsonb,jsonb,jsonb,jsonb,boolean)','execute'),
  'only the worker records reviews findings') from unnest(array['anon','authenticated']) r;

-- The findings contract: the reviews topics, each with its own shape.
select ok(private.finding_value_ok('quotable_review','{"author":"Maya R.","url":"https://cedar-lane.example/p"}')
  and private.finding_value_ok('quotable_review','{"author":"Maya R.","url":"https://cedar-lane.example/p","rating":5,"date":"2026-10-01"}'),
  'a quotable review names its author and page, with its stars and day when known');
select ok(not bool_or(private.finding_value_ok('quotable_review',v)),'and nothing else')
  from unnest(array['{"url":"https://cedar-lane.example/p"}','{"author":" ","url":"https://cedar-lane.example/p"}',
    '{"author":"Maya","url":"http://cedar-lane.example/p"}','{"author":"Maya","url":"https://cedar-lane.example/p","rating":4.5}',
    '{"author":"Maya","url":"https://cedar-lane.example/p","rating":6}','{"author":"Maya","url":"https://cedar-lane.example/p","date":"Oct 1"}',
    '{"author":"Maya","url":"https://cedar-lane.example/p","date":"2026-13-45"}','{"author":"Maya","url":"https://cedar-lane.example/p","date":"2026-02-30"}',
    '{"author":"\t\n","url":"https://cedar-lane.example/p"}',
    '{"author":"Maya","url":"https://cedar-lane.example/p","text":"x"}']::jsonb[]) v;
select ok(private.finding_value_ok('review_theme','{}') and private.finding_value_ok('objection','{}')
  and private.finding_value_ok('customer_words','{}') and not private.finding_value_ok('objection','{"x":1}')
  and private.finding_value_ok('promotion','{"kind":"gift"}') and private.finding_value_ok('performance','{}'),
  'themes, objections and customers'' words hold words only; the other topics are as before');

-- The owner starts a read: the brand's website is needed, once a day.
update public.brand_profiles set domain = '' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.start_reviews_reading('00000000-0000-4000-8000-000000000101')$$,'23514',null,
  'the brand''s website is needed first');
reset role;
update public.brand_profiles set domain = 'cedar-lane.example' where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select set_config('test.job',public.start_reviews_reading('00000000-0000-4000-8000-000000000101')::text,true);
select is(public.start_reviews_reading('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job'),
  'asking again the same day is the same read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.start_reviews_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot start a read');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.start_reviews_reading('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'nor another workspace''s owner');
reset role;
select is((select kind||'/'||status||'/'||(input->>'domain')||'/'||(input->>'mode') from public.job_runs
  where id=current_setting('test.job')::uuid),'brand.read_reviews/queued/cedar-lane.example/sample',
  'a synthetic brand''s read is queued on the samples');
update public.brand_profiles set synthetic=false, domain='north-studio.com' where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select set_config('test.real',public.start_reviews_reading('00000000-0000-4000-8000-000000000102')::text,true);
reset role;
select is((select input->>'mode' from public.job_runs where id=current_setting('test.real')::uuid),'live','a real brand reads its own pages');
update public.job_runs set status='failed', attempt=4, error_code='transient' where id=current_setting('test.real')::uuid;
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is(public.start_reviews_reading('00000000-0000-4000-8000-000000000102')::text,current_setting('test.real'),'a failed read');
reset role;
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.real')::uuid),'queued/0',
  'is started again with all its tries');

-- Only the onboarding readers' run takes it, as the worker.
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101')),0,
  'the workspace jobs never take a reviews read');
select is(public.source_readings_waiting(),2,'the readers'' run sees the reviews reads waiting');
select is((select kind from public.claim_source_reading()),'brand.read_reviews','and takes one');
reset role;
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.record()$$,'42501',null,'an owner cannot record findings');
reset role;

-- The worker records them: each cites a page or a post read here.
select pg_temp.lease(current_setting('test.job'));
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.fail_job(current_setting('test.job')::uuid,'00000000-0000-4000-8000-00000000aaaa','auth')$$,
  '42501',null,'an owner cannot fail a running reviews read');
reset role;
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select public.record_review_findings(current_setting('test.job')::uuid,'00000000-0000-4000-8000-00000000bbbb',
  '[]','[]','[]',pg_temp.s('skipped','skipped','skipped'),false)$$,'PT409',null,'only under the job''s lease');
select throws_ok(format('select pg_temp.record(''[]'',''[]'',''[]'',%L)', s),'23514',null,'refused summary: '||s)
  from unnest(array['{"reviews":{"state":"ready"},"social":{"state":"ready"}}',
    '{"reviews":{"state":"great"},"social":{"state":"none"},"analysis":"skipped"}',
    '{"reviews":{"state":"none","why":"x"},"social":{"state":"none"},"analysis":"skipped"}',
    '{"reviews":{"state":"skipped","reason":true},"social":{"state":"none"},"analysis":"skipped"}',
    '{"reviews":{"state":"skipped"},"social":{"state":"skipped"},"analysis":"done"}',
    '{"reviews":{"state":"none"},"social":{"state":"none"},"analysis":"skipped","x":1}']) s;
select throws_ok(format('select pg_temp.record(''[]'',%L::jsonb,%L::jsonb,pg_temp.s(''none'',''none'',''skipped''))', p, o),
    '23514',null,'refused pages or posts: '||p||' '||o)
  from (values ('["https://evil.example/products/a"]','[]'), ('["https://cedar-lane.example.evil/a"]','[]'),
    ('["http://cedar-lane.example/a"]','[]'), ('["https://cedar-lane.example/a","https://cedar-lane.example/a"]','[]'),
    ('[]','["https://evil.example/p/1"]'), ('[]','["https://instagram.com.evil/p/1"]'), ('[1]','[]')) x(p, o);
select throws_ok(format('select pg_temp.record(''[]'',''["https://cedar-lane.example/a"]'',''[]'',pg_temp.s(''skipped'',''none'',''skipped''))'),
  '23514',null,'a skipped source read no pages');
select throws_ok(format('select pg_temp.record(jsonb_build_array(%L::jsonb))', f),'23514',null,'refused finding: '||f::text)
  from unnest(array[
    -- A page or a post not read here.
    pg_temp.q(jsonb_build_object('evidence',jsonb_build_object('url',pg_temp.page('/products/other'),'quote','x'),
      'value',jsonb_build_object('author','Maya R.','url',pg_temp.page('/products/other')))),
    pg_temp.w(jsonb_build_object('evidence',jsonb_build_object('url','https://www.instagram.com/p/OTHER/','quote','x'))),
    -- A comment stored as a review, or a review as a comment.
    pg_temp.w(jsonb_build_object('source','reviews')),
    pg_temp.q(jsonb_build_object('source','social')),
    -- A quotable review naming another page than its evidence.
    pg_temp.q(jsonb_build_object('value',jsonb_build_object('author','Maya R.','url',pg_temp.page('/products/other')))),
    -- A topic its source cannot state here.
    pg_temp.w(jsonb_build_object('topic','tone')),
    pg_temp.q(jsonb_build_object('topic','returns','value',jsonb_build_object('days',30))),
    -- A quotable review is chosen by code: never a model's.
    pg_temp.q(jsonb_build_object('pass','model','model','gemini-2.5-flash')),
    pg_temp.q(jsonb_build_object('pass','code')),
    pg_temp.q(jsonb_build_object('evidence',jsonb_build_object('ref','review-data:'||pg_temp.page()))),
    pg_temp.w(jsonb_build_object('note','x')),
    pg_temp.w(jsonb_build_object('confidence',2)),
    -- A review app's rating cites the review data of a page read here, only.
    pg_temp.q(jsonb_build_object('topic','review_platform','value',jsonb_build_object('name','Judge.me','verified',false),
      'evidence',jsonb_build_object('ref','review-data:'||pg_temp.page('/products/other')))),
    pg_temp.q(jsonb_build_object('topic','review_platform','value',jsonb_build_object('name','Judge.me','verified',false))),
    pg_temp.q(jsonb_build_object('topic','review_platform','value',jsonb_build_object('name','Judge.me','verified',false),
      'evidence',jsonb_build_object('ref','review-data:'||pg_temp.page(),'quote','x')))]::jsonb[]) f;
select throws_ok($$select pg_temp.record(jsonb_build_array(pg_temp.q()),summary => pg_temp.s('none','ready'))$$,'23514',null,
  'findings only for a source that was read');
select throws_ok($$select pg_temp.record(live => true)$$,'23514',null,'a sample read is never stored as live');
select is(pg_temp.record(jsonb_build_array(pg_temp.q(), pg_temp.w(), jsonb_build_object('source','reviews','topic','review_platform',
    'statement','Product pages show reviews from Judge.me.','value',jsonb_build_object('name','Judge.me','verified',false,'rating',4.8),
    'evidence',jsonb_build_object('ref','review-data:'||pg_temp.page()),'confidence',0.8,'pass','sample','model',null)))
  ->>'findings','3','a read''s findings are stored at once');
select is((select status||'/'||(checkpoint->'reviews'->>'state')||'/'||(checkpoint->'social'->>'state')||'/'||(checkpoint->>'pages')
  from public.job_runs where id=current_setting('test.job')::uuid),'succeeded/ready/ready/1','and its job is finished');
select is(pg_temp.current('reviews'),2,'its review findings are current');
select is(pg_temp.current('social'),1,'and its social one');
reset role;
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.job')::uuid,'reviews','performance','What made money.',
    '{"ref":"x"}',0.5,'sample')$$,'23514',
  'new row for relation "brand_findings" violates check constraint "brand_findings_reviews_topics"','reviews state only what reviews can');
select throws_ok($$insert into public.brand_findings(tenant_id,run_id,source,topic,statement,value,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000101',current_setting('test.job')::uuid,'social','quotable_review','A review.',
    '{"author":"Maya","url":"https://www.instagram.com/p/1/"}','{"ref":"x"}',0.5,'sample')$$,'23514',
  'new row for relation "brand_findings" violates check constraint "brand_findings_social_topics"','social comments are never quotable reviews');

-- Members read them; another workspace does not.
set local role authenticated;
select pg_temp.as_owner('00000000-0000-4000-8000-000000000005');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'
  and source in ('reviews','social')),3,'staff read the reviews findings');
select pg_temp.as_owner('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000101'),0,
  'another workspace reads none');
reset role;

-- Each source on its own: a skipped one replaces nothing, a read one
-- with nothing there replaces its own; an older read finishing late
-- replaces nothing.
select set_config('test.two',pg_temp.job('00000000-0000-4000-8000-000000000101','two'),true);
select pg_temp.lease(current_setting('test.two'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record('[]','[]','[]',jsonb_build_object('reviews',jsonb_build_object('state','skipped',
  'reason','reviews_unavailable'),'social',jsonb_build_object('state','none'),'analysis','skipped'),current_setting('test.two'))$$,
  'a read with its reviews skipped and no comments');
select is(pg_temp.current('reviews'),2,'keeps the review findings');
select is(pg_temp.current('social'),0,'and replaces the social ones');
reset role;
select set_config('test.old',pg_temp.job('00000000-0000-4000-8000-000000000101','old',age => '1 hour'),true);
select pg_temp.lease(current_setting('test.old'));
set local role service_role;
select pg_temp.as_worker();
select is(pg_temp.record(job => current_setting('test.old'))->>'newerSocial','true','an older read finishing late');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.old')::uuid
  and source='social' and superseded_at is not null),1,'keeps its social findings already replaced');
select is(pg_temp.current('reviews'),2,'and the newer read''s review findings stay');
reset role;

-- A newer read that skipped its reviews makes no older read late for
-- reviews: only for the source it read.
select set_config('test.newest',pg_temp.job('00000000-0000-4000-8000-000000000101','newest',age => '-2 hours'),true);
select set_config('test.later',pg_temp.job('00000000-0000-4000-8000-000000000101','later',age => '-1 hour'),true);
select pg_temp.lease(current_setting('test.newest'));
select pg_temp.lease(current_setting('test.later'));
set local role service_role;
select pg_temp.as_worker();
select lives_ok($$select pg_temp.record(jsonb_build_array(pg_temp.w()),'[]',
  '["https://www.instagram.com/p/SAMPLE01/"]',jsonb_build_object('reviews',jsonb_build_object('state','skipped'),
  'social',jsonb_build_object('state','ready'),'analysis','done'),current_setting('test.newest'))$$,
  'the newest read skips its reviews and reads the comments');
select is(pg_temp.record(job => current_setting('test.later')),
  '{"findings": 2, "newerSocial": true, "newerReviews": false}'::jsonb,'a read before it finishing late');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.later')::uuid
  and source='reviews' and superseded_at is null),1,'has its review findings current');
select is(pg_temp.current('reviews'),1,'in place of the earlier ones');
select is((select count(*)::integer from public.brand_findings where run_id=current_setting('test.later')::uuid
  and source='social' and superseded_at is not null),1,'and its social findings kept already replaced');
reset role;

-- An expired reviews read: the workspace jobs leave it; the readers' run
-- takes it back.
select set_config('test.stale',pg_temp.job('00000000-0000-4000-8000-000000000101','stale'),true);
update public.job_runs set status='running', attempt=1, lease_token=gen_random_uuid(), lease_until=now()-interval '1 minute',
    available_at=now()-interval '1 hour'
  where id=current_setting('test.stale')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101')),0,'the workspace jobs');
select is((select status from public.job_runs where id=current_setting('test.stale')::uuid),'running',
  'never touch a reviews read whose lease ran out');
select ok(exists (select 1 from public.claim_source_reading() c where c.id=current_setting('test.stale')::uuid),
  'the readers'' run takes it back');
reset role;

-- A real brand: never the samples; its read clears sample findings.
select set_config('test.fake',pg_temp.job('00000000-0000-4000-8000-000000000102','fake',domain => 'north-studio.com'),true);
select pg_temp.lease(current_setting('test.fake'));
select pg_temp.lease(current_setting('test.real'));
insert into public.brand_findings(tenant_id,run_id,source,topic,statement,evidence,confidence,pass)
  values ('00000000-0000-4000-8000-000000000102',current_setting('test.real')::uuid,'reviews','review_theme','From the samples.',
    '{"url":"https://north-studio.com/p","quote":"Sample words."}',0.5,'sample'),
    ('00000000-0000-4000-8000-000000000102',current_setting('test.real')::uuid,'social','review_theme','From the sample comments.',
    '{"url":"https://www.instagram.com/p/1/","quote":"Sample words."}',0.5,'sample'),
    ('00000000-0000-4000-8000-000000000102',current_setting('test.real')::uuid,'social','objection','Read for real.',
    '{"url":"https://www.instagram.com/p/1/","quote":"Real words."}',0.5,'model');
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select pg_temp.record('[]','[]','[]',pg_temp.s('skipped','skipped','skipped'),current_setting('test.fake'))$$,
  '23514',null,'a real brand never gets the samples');
select throws_ok(format('select pg_temp.record(jsonb_build_array(%L::jsonb),''["https://shop.north-studio.com/p"]'',''[]'',%L::jsonb,current_setting(''test.real''),true)',
    f, coalesce(sm, '{"reviews":{"state":"ready"},"social":{"state":"skipped"},"analysis":"done"}')),'23514',null,'refused live finding: '||f::text)
  from (values
    (pg_temp.q(jsonb_build_object('value',jsonb_build_object('author','A','url','https://shop.north-studio.com/p'),
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','Lovely.'))), null),
    (pg_temp.q(jsonb_build_object('pass','code','model','x','value',jsonb_build_object('author','A','url','https://shop.north-studio.com/p'),
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','Lovely.'))), null),
    (jsonb_build_object('source','reviews','topic','objection','statement','Runs large.','value','{}'::jsonb,
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','runs large'),'confidence',0.7,'pass','model',
      'model','gemini-2.5-flash'), '{"reviews":{"state":"ready"},"social":{"state":"skipped"},"analysis":"skipped"}'),
    (jsonb_build_object('source','reviews','topic','objection','statement','Runs large.','value','{}'::jsonb,
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','runs large'),'confidence',0.7,'pass','code',
      'model',null), null),
    -- A quotable review or a review app is code's, never a model's.
    (pg_temp.q(jsonb_build_object('pass','model','model','gemini-2.5-flash','value',
      jsonb_build_object('author','A','url','https://shop.north-studio.com/p'),
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','Lovely.'))), null),
    (jsonb_build_object('source','reviews','topic','review_platform','statement','Judge.me.','value',
      jsonb_build_object('name','Judge.me','verified',false),'evidence',jsonb_build_object('ref','review-data:https://shop.north-studio.com/p'),
      'confidence',0.8,'pass','model','model','gemini-2.5-flash'), null),
    -- Sample findings on a live read.
    (pg_temp.q(jsonb_build_object('value',jsonb_build_object('author','A','url','https://shop.north-studio.com/p'),
      'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','Lovely.'))), null)) x(f, sm);
select is(pg_temp.record(jsonb_build_array(pg_temp.q(jsonb_build_object('pass','code','value',
    jsonb_build_object('author','A','url','https://shop.north-studio.com/p'),
    'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','Lovely.'))),
  jsonb_build_object('source','reviews','topic','objection','statement','Runs large.','value','{}'::jsonb,
    'evidence',jsonb_build_object('url','https://shop.north-studio.com/p','quote','runs large'),'confidence',0.7,'pass','model',
    'model','gemini-2.5-flash')),'["https://shop.north-studio.com/p"]','[]',
  '{"reviews":{"state":"ready"},"social":{"state":"skipped","reason":"social_not_set_up"},"analysis":"done"}',
  current_setting('test.real'),true)->>'findings','2',
  'a real brand''s own page (a subdomain): code''s quotable review and the model''s words');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000102'
  and pass='sample' and superseded_at is null),0,'and no sample finding stays, the skipped source''s too');
select is((select count(*)::integer from public.brand_findings where tenant_id='00000000-0000-4000-8000-000000000102'
  and source='social' and pass='model' and superseded_at is null),1,'while the skipped source''s real findings stay');
reset role;

select * from finish();
rollback;
