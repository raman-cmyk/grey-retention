begin;
select plan(45);

-- CI-001: email labels and multi-label section tags. Owner ...01 follows
-- northwind.example (workspace 101); ...02 is a platform admin; ...04 owns
-- workspace 102.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('tags-' || n, 'sha256'), 'hex') $$;
create function pg_temp.obj(bucket text, name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values (bucket, name) on conflict do nothing
$$;
create function pg_temp.sect(n int) returns jsonb language sql as $$
  select jsonb_build_object('ordinal', n, 'html', '<tr><td>Row ' || n || '</td></tr>', 'text', 'Row ' || n, 'kind', 'text',
    'words', 2, 'images', 0, 'wideImages', 0, 'links', '[]'::jsonb)
$$;
create function pg_temp.tag(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('ordinal', n, 'state', 'tagged', 'family', 'text', 'layout', 'single_column', 'purpose', 'story',
    'styles', '["text_led"]'::jsonb, 'confidence', 0.8, 'pass', 'fast', 'model', 'gemini-2.5-flash-lite') || extra
$$;
create function pg_temp.email(extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('state', 'tagged', 'industry', 'apparel', 'email_type', 'new_arrivals', 'offer_type', 'percent_off',
    'season', 'spring', 'angle', 'newness', 'brand_size', 'mid', 'confidence', 0.75, 'pass', 'strong', 'model', 'gemini-2.5-flash') || extra
$$;
create function pg_temp.sections(tags jsonb) returns integer language sql as $$
  select public.record_section_tags(current_setting('test.label')::uuid, current_setting('test.labellease')::uuid, tags, 'tags-v1')
$$;
create function pg_temp.record(email jsonb, version int default 2) returns jsonb language sql as $$
  select public.record_inbox_tags(current_setting('test.label')::uuid, current_setting('test.labellease')::uuid, email,
    '{"version":2,"angle":"launch"}', version)
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot record tags or put jobs back')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_section_tags(uuid,uuid,jsonb,text)','public.record_inbox_tags(uuid,uuid,jsonb,jsonb,integer)',
         'public.defer_platform_job(uuid,uuid,integer,text)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'the worker can')
  from unnest(array['public.record_section_tags(uuid,uuid,jsonb,text)','public.record_inbox_tags(uuid,uuid,jsonb,jsonb,integer)',
    'public.defer_platform_job(uuid,uuid,integer,text)']) f;
select ok(not has_function_privilege('service_role','public.record_inbox_labels(uuid,uuid,jsonb,jsonb,integer)','execute'),
  'the old one-of-20 command is retired, so an old worker cannot mark emails done');
select ok(not bool_or(has_table_privilege(r, 'public.competitor_emails', p)),'browser roles cannot write competitor emails')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;

-- A followed sample brand's email with three sections, then its tag job.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.example');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.admin_save_inbox_brand('northwind.example','northwind','Northwind','apparel');
reset role;
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.eml'), pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.html'),
  pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.marked.html');
set local role service_role;
select set_config('test.poll',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.polllease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select set_config('test.email',(public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(1),'uid',9301,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(1)||'.eml','rawSha256',pg_temp.k(1),
    'htmlPath','fake/'||pg_temp.k(1)||'.html','subject','Spring','text','Hello','aliasSlug','northwind'))->>'email'),true);
select set_config('test.message',(select id::text from public.inbox_messages where message_key=pg_temp.k(1)),true);
select set_config('test.job',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select public.record_inbox_sections(current_setting('test.job')::uuid,(select lease_token from public.platform_jobs where id=current_setting('test.job')::uuid),
  'fake/'||pg_temp.k(1)||'.marked.html',jsonb_build_array(pg_temp.sect(1),pg_temp.sect(2),pg_temp.sect(3)),null,0.5);
select public.finish_platform_job(current_setting('test.job')::uuid,(select lease_token from public.platform_jobs where id=current_setting('test.job')::uuid));
reset role;
-- No screenshot in this test: the tag job is due now.
update public.platform_jobs set available_at = now() where kind = 'inbox.label' and subject_key = current_setting('test.message');
set local role service_role;
select set_config('test.label',(select id::text from public.claim_platform_job(array['inbox.label'])),true);
select set_config('test.labellease',(select lease_token::text from public.platform_jobs where id=current_setting('test.label')::uuid),true);

-- Section tags: only what the lists allow, whole or not at all.
select throws_ok($$select public.record_section_tags(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_array(pg_temp.tag(1)),'tags-v1')$$,'23514',null,'another kind of job cannot record tags');
select throws_ok($$select public.record_section_tags(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  jsonb_build_array(pg_temp.tag(1)),'Tags v1!')$$,'23514',null,'a tag version is required');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"pass":"owner"}')))$$,'23514',null,
  'only the sample rules, the fast or the larger model tag');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"confidence":1.5}')))$$,'23514',null,'a confidence is from 0 to 1');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"ordinal":1.5}')))$$,'23514',null,'an ordinal is a section number');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"family":"countdown"}')))$$,'23514',null,'only the 20 families');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"family":"unsure"}')))$$,'23514',null,
  'a tagged section is never unsure');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1) - 'family'))$$,'23514',null,'a tagged section has a family');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"layout":"zigzag"}')))$$,'23514',null,'only the listed layouts');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"styles":["neon"]}')))$$,'23514',null,'only the listed styles');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1,'{"styles":["minimal","bold","dark","luxury"]}')))$$,'23514',null,
  'at most three styles');
select throws_ok($$select pg_temp.sections(jsonb_build_array(pg_temp.tag(1) - 'layout'))$$,'23514',null,'a tagged section has every label');
select throws_ok($$select pg_temp.sections((select jsonb_agg(pg_temp.tag(n)) from generate_series(1,41) n))$$,'23514',null,'at most 40 sections');

-- Stored a batch at a time: tags, untagged sections, the tag version.
select is(pg_temp.sections(jsonb_build_array(
    pg_temp.tag(1,'{"family":"announcement_bar","layout":"strip","purpose":"announcement","styles":[],"pass":"sample","model":null}'),
    jsonb_build_object('ordinal',2,'state','untagged','pass','strong','model','gemini-2.5-flash','family','hero_image'))),
  2,'a first batch of two sections is stored');
select is(pg_temp.sections(jsonb_build_array(pg_temp.tag(3,'{"styles":["minimal","minimal"]}'))),1,'then the rest');
select is((select string_agg(ordinal||':'||block_type||'/'||coalesce(layout,'-')||'/'||coalesce(purpose,'-')||'/'||coalesce(array_to_string(styles,'+'),'-')
    ||'/'||tag_state||'/'||tag_pass||'/'||label_source||'/'||tag_version, ',' order by ordinal) from public.email_sections where inbox_message_id=current_setting('test.message')::uuid),
  '1:announcement_bar/strip/announcement//tagged/sample/sample/tags-v1,2:unsure/-/-/-/untagged/strong/gemini/tags-v1,3:text/single_column/story/minimal/tagged/fast/gemini/tags-v1',
  'each section keeps its family, layout, purpose and styles (repeats dropped); an untagged one keeps none');
select is((select confidence from public.email_sections where inbox_message_id=current_setting('test.message')::uuid and ordinal=2),null,
  'an untagged section has no confidence');
select is((select labelled_at from public.inbox_messages where id=current_setting('test.message')::uuid),null,
  'the email is not done until its own labels are recorded');

-- The email's labels and facts, once per version.
select throws_ok($$select public.record_inbox_tags(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  pg_temp.email(),'{"version":2}',2)$$,'23514',null,'another kind of job cannot record labels');
select throws_ok($$select pg_temp.record(pg_temp.email(),0)$$,'23514',null,'a version is required');
select throws_ok($$select pg_temp.record(pg_temp.email('{"industry":"crypto"}'))$$,'23514',null,'only the listed industries');
select throws_ok($$select pg_temp.record(pg_temp.email() - 'season')$$,'23514',null,'a tagged email has every label');
select throws_ok($$select pg_temp.record(pg_temp.email('{"state":"maybe"}'))$$,'23514',null,'tagged or untagged only');
select is(pg_temp.record(pg_temp.email()),'{"already": false, "labels": "tagged"}'::jsonb,'labels and facts are recorded');
select is((select industry||'/'||email_type||'/'||offer_type||'/'||season||'/'||angle||'/'||brand_size||'/'||labels_confidence||'/'||labels_state||'/'||labels_pass||'/'||labels_model
    ||'/'||extraction_version from public.inbox_messages where id=current_setting('test.message')::uuid),
  'apparel/new_arrivals/percent_off/spring/newness/mid/0.75/tagged/strong/gemini-2.5-flash/2','the inbox copy keeps the email''s labels');
select is((select industry||'/'||email_type||'/'||season||'/'||labels_state||'/'||(facts->>'angle') from public.competitor_emails where id=current_setting('test.email')::uuid),
  'apparel/new_arrivals/spring/tagged/launch','so does the competitor email, with its facts');
select is(pg_temp.record(pg_temp.email('{"industry":"home"}')),'{"already": true}'::jsonb,'an email is tagged once per version');
select is((select industry from public.competitor_emails where id=current_setting('test.email')::uuid),'apparel','the first labels stay');
select is(pg_temp.record(jsonb_build_object('state','untagged','pass','strong','model',null),3),
  '{"already": false, "labels": "untagged"}'::jsonb,'a new version labels it again');
select is((select coalesce(industry,'-')||'/'||labels_state||'/'||coalesce(labels_confidence::text,'-') from public.competitor_emails where id=current_setting('test.email')::uuid),
  '-/untagged/-','an untagged email keeps no labels (left out of search)');

-- Put back without using a try (time up, or the platform's budget spent).
select throws_ok($$select public.defer_platform_job(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,0,'x')$$,
  '23514',null,'only tag jobs are put back');
select throws_ok($$select public.defer_platform_job(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,90000,'later')$$,
  '23514',null,'at most a day');
select set_config('test.attempt',(select attempt::text from public.platform_jobs where id=current_setting('test.label')::uuid),true);
select lives_ok($$select public.defer_platform_job(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,3600,'ai_cap_reached')$$,
  'a tag job is put back');
select is((select status||'/'||(attempt + 1)::text||'/'||last_error_code||'/'||(available_at > now() + interval '59 minutes')::text
    from public.platform_jobs where id=current_setting('test.label')::uuid),
  'queued/'||current_setting('test.attempt')||'/ai_cap_reached/true','queued for later, the try given back');
select throws_ok($$select public.defer_platform_job(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,0,'again')$$,
  'PT409',null,'its old lease is gone');
reset role;

-- Assigned later: the competitor email brings the labels along.
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, facts, labelled_at,
    extraction_version, industry, email_type, offer_type, season, angle, brand_size, labels_confidence, labels_state, labels_pass)
  select id, pg_temp.k(2), 1, 9302, 10, 'Later', now(), true, 'too_large', '{"version":2,"angle":"sale"}', now(), 2,
    'pet', 'sale', 'percent_off', 'none', 'value', 'small', 0.7, 'tagged', 'sample'
  from public.inbox_mailboxes where key='fake';
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
  select capture_id, 'msg:tags-later', now(), 'x', 'x', '<p>x</p>', '{}', true, (select id from public.inbox_messages where message_key=pg_temp.k(2))
  from public.competitor_emails where id=current_setting('test.email')::uuid;
select is((select industry||'/'||email_type||'/'||brand_size||'/'||labels_state||'/'||labels_pass from public.competitor_emails where external_id='msg:tags-later'),
  'pet/sale/small/tagged/sample','an email assigned later brings its labels');

-- Who reads what.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.email_sections where inbox_message_id=current_setting('test.message')::uuid),0,
  'workspace members read no section tags');
select is((select email_type from public.competitor_emails where external_id='msg:tags-later'),'sale',
  'but they read the labels of a brand they follow');
select throws_ok($$update public.competitor_emails set industry = 'home' where external_id = 'msg:tags-later'$$,'42501',null,
  'and cannot change them');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from public.competitor_emails where external_id='msg:tags-later'),0,'another workspace reads none');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.email_sections where inbox_message_id=current_setting('test.message')::uuid and tag_state is not null)
    ||'/'||(select labels_state from public.inbox_messages where id=current_setting('test.message')::uuid),
  '3/untagged','platform admins read the section tags and the inbox labels');
reset role;

select * from finish();
rollback;
