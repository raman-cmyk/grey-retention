begin;
select plan(43);

-- Owner ...01 follows northwind.example (workspace 101); ...02 is a platform admin.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('sect-' || n, 'sha256'), 'hex') $$;
create function pg_temp.obj(bucket text, name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values (bucket, name) on conflict do nothing
$$;
create function pg_temp.sect(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('ordinal', n, 'html', '<tr><td>Row ' || n || '</td></tr>', 'text', 'Row ' || n, 'kind', 'text',
    'words', 2, 'images', 0, 'wideImages', 0, 'links', '[]'::jsonb) || extra
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot record sections, screenshots or labels')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_inbox_sections(uuid,uuid,text,jsonb,text,numeric)','public.record_inbox_screenshot(uuid,uuid,integer,integer,jsonb)',
         'public.record_inbox_labels(uuid,uuid,jsonb,jsonb,integer)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'the worker can')
  from unnest(array['public.record_inbox_sections(uuid,uuid,text,jsonb,text,numeric)','public.record_inbox_screenshot(uuid,uuid,integer,integer,jsonb)',
    'public.record_inbox_labels(uuid,uuid,jsonb,jsonb,integer)']) f;
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_inbox_screenshot' and pg_get_function_identity_arguments(p.oid) = 'job uuid, lease uuid, width integer, height integer'),
  'the old screenshot command without boxes is gone');
select ok(not bool_or(has_table_privilege(r, 'public.email_sections', p)),'browser roles cannot write sections')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not bool_or(has_table_privilege(r, t, 'maintain')),'browser roles cannot maintain the inbox tables')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.email_sections','public.inbox_messages','public.inbox_message_images','public.platform_jobs','public.ops_tasks']) t;

-- A followed sample brand and its email.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.example');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.admin_save_inbox_brand('northwind.example','northwind','Northwind','apparel');
reset role;
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.eml'), pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.html');
set local role service_role;
select set_config('test.poll',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.polllease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select set_config('test.email',(public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(1),'uid',1,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(1)||'.eml','rawSha256',pg_temp.k(1),
    'htmlPath','fake/'||pg_temp.k(1)||'.html','subject','Spring','text','Hello','aliasSlug','northwind'))->>'email'),true);
select set_config('test.message',(select id::text from public.inbox_messages where message_key=pg_temp.k(1)),true);
select set_config('test.job',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select set_config('test.lease',(select lease_token::text from public.platform_jobs where id=current_setting('test.job')::uuid),true);

-- Sections, once, with their marked copy stored first.
select throws_ok($$select public.record_inbox_sections(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'fake/'||pg_temp.k(9)||'.marked.html','[]')$$,'PT409','Stored copy missing','the marked copy must be stored first');
select throws_ok($$select public.record_inbox_sections(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'gmail/'||pg_temp.k(9)||'.marked.html','[]')$$,'23514',null,'the marked copy lives under the email''s mailbox');
select throws_ok($$select public.record_inbox_sections(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,null,(select jsonb_agg(pg_temp.sect(n)) from generate_series(1,41) n))$$,'23514',null,'at most 40 sections');
select throws_ok($$select public.record_inbox_sections(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,null,'[]')$$,'23514',null,'a poll job cannot record sections');
reset role;
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.marked.html');
set local role service_role;
select is(public.record_inbox_sections(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'fake/'||pg_temp.k(1)||'.marked.html',
  jsonb_build_array(pg_temp.sect(1), pg_temp.sect(2,'{"kind":"design","images":1,"wideImages":1,"words":0}'), pg_temp.sect(3)),'Light layers',0.67),3,'three sections recorded');
select is(public.record_inbox_sections(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'fake/'||pg_temp.k(1)||'.marked.html',
  jsonb_build_array(pg_temp.sect(1,'{"text":"changed"}')),'Other',0.1),3,'a retry records nothing twice');
select is((select marked_html_path||'/'||preheader||'/'||text_ratio from public.inbox_messages where id=current_setting('test.message')::uuid),
  'fake/'||pg_temp.k(1)||'.marked.html/Light layers/0.670','the email keeps its marked copy, preview line and text share');
select is((select text from public.email_sections where inbox_message_id=current_setting('test.message')::uuid and ordinal=1),'Row 1','the first record stays');
select ok((select available_at > now() + interval '50 minutes' from public.platform_jobs where kind='inbox.label' and subject_key=current_setting('test.message')),
  'its label job waits up to an hour for the screenshot crops');
select public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'[]');
select public.finish_platform_job(current_setting('test.job')::uuid,current_setting('test.lease')::uuid);

-- The screenshot with each section's box and crop; then one label job.
select set_config('test.shot',(select id::text from public.claim_platform_job(array['inbox.screenshot'])),true);
select set_config('test.shotlease',(select lease_token::text from public.platform_jobs where id=current_setting('test.shot')::uuid),true);
reset role;
select pg_temp.obj('inbox-assets','shot/'||current_setting('test.message')||'.jpg');
select pg_temp.obj('inbox-assets','sect/'||current_setting('test.message')||'/1.jpg');
set local role service_role;
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,900,
  '[{"ordinal":1,"top":0,"height":100},{"ordinal":2,"top":100,"height":500}]')$$,'PT409','Stored copy missing','each section crop must be uploaded');
reset role;
select pg_temp.obj('inbox-assets','sect/'||current_setting('test.message')||'/2.jpg');
set local role service_role;
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,900,
  '[{"top":0,"height":100}]')$$,'23514',null,'a box needs its section number');
select lives_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,900,
  '[{"ordinal":1,"top":0,"height":100},{"ordinal":2,"top":100,"height":500}]')$$,'the screenshot and two crops are recorded');
select is((select string_agg(ordinal||':'||coalesce(top::text,'-')||'+'||coalesce(height::text,'-'),',' order by ordinal) from public.email_sections where inbox_message_id=current_setting('test.message')::uuid),
  '1:0+100,2:100+500,3:-+-','each section knows where it sits');
select is((select count(*)::int from public.platform_jobs where kind='inbox.label' and subject_key=current_setting('test.message')),1,'one label job is queued');
select ok((select available_at <= now() from public.platform_jobs where kind='inbox.label' and subject_key=current_setting('test.message')),
  'the screenshot brings it forward');
select public.finish_platform_job(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid);

-- Labels and facts, once per version.
select set_config('test.label',(select id::text from public.claim_platform_job(array['inbox.label'])),true);
select set_config('test.labellease',(select lease_token::text from public.platform_jobs where id=current_setting('test.label')::uuid),true);
reset role;
update public.email_sections set block_type='hero_image', label_source='owner', confidence=1, labelled_at=now()
  where inbox_message_id=current_setting('test.message')::uuid and ordinal=2;
set local role service_role;
select throws_ok($$select public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,'[]','{}',0)$$,'23514',null,'a version is required');
select throws_ok($$select public.record_inbox_labels(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,'[]','{"version":1}',1)$$,'23514',null,'another kind of job cannot record labels');
select throws_ok($$select public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  '[{"ordinal":1,"type":"text","source":"owner","confidence":0.5}]','{"version":1}',1)$$,'23514',null,'the worker cannot label as the owner');
select throws_ok($$select public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  '[{"ordinal":1,"type":"text","source":"sample","confidence":"high"}]','{"version":1}',1)$$,'23514',null,'a confidence is a number from 0 to 1');
select throws_ok($$select public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  (select jsonb_agg(jsonb_build_object('ordinal',n,'type','text','source','sample','confidence',0.5)) from generate_series(1,41) n),'{"version":1}',1)$$,
  '23514',null,'at most 40 labels');
select throws_ok($$select public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  '[{"ordinal":1,"type":"not_a_block","source":"sample","confidence":0.5}]','{"version":1}',1)$$,'23514',null,'only the 20 block types or unsure');
select is(public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  '[{"ordinal":1,"type":"announcement_bar","source":"sample","confidence":0.7},{"ordinal":2,"type":"unsure","source":"sample","confidence":0.2},{"ordinal":3,"type":"text","source":"sample","confidence":0.7}]',
  '{"version":1,"angle":"launch"}',1),'{"already": false, "sections": 2}'::jsonb,'labels and facts are recorded (the owner''s section is not counted)');
select is((select string_agg(ordinal||':'||block_type||'/'||label_source,',' order by ordinal) from public.email_sections where inbox_message_id=current_setting('test.message')::uuid),
  '1:announcement_bar/sample,2:hero_image/owner,3:text/sample','a label the owner gave is never overwritten');
select is((select facts->>'angle' from public.competitor_emails where id=current_setting('test.email')::uuid),'launch','the competitor email gets its facts');
select is(public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,'[]','{"version":1,"angle":"sale"}',1),
  '{"already": true}'::jsonb,'an email is labelled once per version');
select is((select facts->>'angle' from public.inbox_messages where id=current_setting('test.message')::uuid),'launch','the first facts stay');
select is(public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  '[{"ordinal":1,"type":"offer_banner","source":"gemini","confidence":0.8},{"ordinal":2,"type":"text","source":"gemini","confidence":0.9},{"ordinal":3,"type":"cta","source":"gemini","confidence":0.9}]',
  '{"version":2,"angle":"sale"}',2),'{"already": false, "sections": 2}'::jsonb,'a new version labels the email again');
select is((select string_agg(ordinal||':'||block_type||'/'||label_source,',' order by ordinal) from public.email_sections where inbox_message_id=current_setting('test.message')::uuid)
  ||' '||(select facts->>'angle'||'/'||extraction_version from public.competitor_emails where id=current_setting('test.email')::uuid),
  '1:offer_banner/gemini,2:hero_image/owner,3:cta/gemini sale/2','it replaces the labels and facts, never the owner''s label');
select is(public.record_inbox_labels(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,'[]','{"version":1,"angle":"story"}',1),
  '{"already": true}'::jsonb,'an older version changes nothing');

-- Assigned later: the competitor email brings the facts along.
reset role;
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state, facts, labelled_at, extraction_version)
  select id, pg_temp.k(2), 1, 5, 10, 'Later', now(), true, 'too_large', '{"version":1,"angle":"sale"}', now(), 1
  from public.inbox_mailboxes where key='fake';
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
  select capture_id, 'msg:later', now(), 'x', 'x', '<p>x</p>', '{}', true, (select id from public.inbox_messages where message_key=pg_temp.k(2))
  from public.competitor_emails where id=current_setting('test.email')::uuid;
select is((select facts->>'angle'||'/'||extraction_version from public.competitor_emails where external_id='msg:later'),'sale/1','an email assigned later brings its facts');

-- An email without HTML is labelled at once (its facts come from its subject).
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_path, raw_sha256, raw_bytes, subject, received_at, synthetic, state)
  select id, pg_temp.k(4), 1, 7, 'fake/'||pg_temp.k(4)||'.eml', pg_temp.k(4), 10, 'Plain', now(), true, 'unassigned'
  from public.inbox_mailboxes where key='fake';
select is((select count(*)::int from public.platform_jobs j join public.inbox_messages m on j.subject_key = m.id::text
  where m.message_key = pg_temp.k(4) and j.kind = 'inbox.label' and j.available_at <= now()),1,'an email without HTML is queued for labelling at once');

-- An email photographed before it had sections is photographed again.
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(3)||'.eml'), pg_temp.obj('inbox-raw','fake/'||pg_temp.k(3)||'.html'),
  pg_temp.obj('inbox-raw','fake/'||pg_temp.k(3)||'.marked.html');
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_path, raw_sha256, raw_bytes, html_path, subject, received_at, synthetic, state)
  select id, pg_temp.k(3), 1, 6, 'fake/'||pg_temp.k(3)||'.eml', pg_temp.k(3), 10, 'fake/'||pg_temp.k(3)||'.html', 'Old', now(), true, 'unassigned'
  from public.inbox_mailboxes where key='fake';
update public.inbox_messages set screenshot_path = 'shot/'||id||'.jpg', screenshot_width = 600, screenshot_height = 900, screenshot_at = now()
  where message_key = pg_temp.k(3);
set local role service_role;
select set_config('test.old',(select id::text from public.inbox_messages where message_key=pg_temp.k(3)),true);
select set_config('test.oldjob',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select public.record_inbox_sections(current_setting('test.oldjob')::uuid,(select lease_token from public.platform_jobs where id=current_setting('test.oldjob')::uuid),
  'fake/'||pg_temp.k(3)||'.marked.html',jsonb_build_array(pg_temp.sect(1)));
select is((select count(*)::int from public.platform_jobs where kind='inbox.screenshot' and idempotency_key='inbox.screenshot:'||current_setting('test.old')||':sections'),1,
  'an email photographed before it had sections is photographed again for its crops');
reset role;

-- Who reads what.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.email_sections),0,'workspace members read no sections');
select is((select facts->>'angle' from public.competitor_emails where id=current_setting('test.email')::uuid),'sale','but they read the facts of a brand they follow');
select is((select count(*)::int from storage.objects where bucket_id='inbox-assets' and name like 'sect/%'),0,'and no section crop');
select is((select count(*)::int from storage.objects where bucket_id='inbox-assets' and name='shot/'||current_setting('test.message')||'.jpg'),1,'only the screenshot');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select is((select count(*)::int from public.competitor_emails where facts is not null),0,'another workspace reads none');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from public.email_sections),4,'platform admins read every section');

select * from finish();
rollback;
