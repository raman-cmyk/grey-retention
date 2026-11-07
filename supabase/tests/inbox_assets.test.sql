begin;
select plan(38);

-- Owner ...01 follows northwind.example (workspace 101); owner ...04 is
-- another workspace (102); ...02 is a platform admin.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('asset-' || n, 'sha256'), 'hex') $$;
create function pg_temp.obj(bucket text, name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values (bucket, name) on conflict do nothing
$$;
create function pg_temp.img(ordinal int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('ordinal', ordinal, 'source', 'remote', 'sourceRef', 'https://mail.northwind.example/' || ordinal || '.png',
    'state', 'stored', 'path', 'img/' || pg_temp.k(ordinal) || '.png', 'sha256', pg_temp.k(ordinal), 'bytes', 100,
    'contentType', 'image/png') || extra
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot record images or screenshots')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_inbox_images(uuid,uuid,jsonb)','public.record_inbox_screenshot(uuid,uuid,integer,integer)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'the worker records images and screenshots')
  from unnest(array['public.record_inbox_images(uuid,uuid,jsonb)','public.record_inbox_screenshot(uuid,uuid,integer,integer)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'the trigger helpers are not callable')
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['private.inbox_assets_pending()','private.queue_inbox_assets()']) f;
select ok(not bool_or(has_table_privilege(r, 'public.inbox_message_images', p)),'browser roles cannot write the image list')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate']) p;
select is((select public from storage.buckets where id='inbox-assets'),false,'kept images and screenshots are in a private bucket');

-- A followed sample brand, and a sample email to its +alias.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.example');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('test.brand',public.admin_save_inbox_brand('northwind.example','northwind','Northwind','apparel')::text,true);
reset role;
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(100)||'.eml'), pg_temp.obj('inbox-raw','fake/'||pg_temp.k(100)||'.html'),
       pg_temp.obj('inbox-raw','fake/'||pg_temp.k(101)||'.eml');
set local role service_role;
select set_config('test.poll',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.polllease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select set_config('test.msg',(public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(100),'uid',1,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(100)||'.eml','rawSha256',pg_temp.k(100),
    'htmlPath','fake/'||pg_temp.k(100)||'.html','subject','Spring','text','Hello','aliasSlug','northwind',
    'fromAddress','news@mail.northwind.example','fromDomain','mail.northwind.example'))->>'email'),true);
select set_config('test.message',(select id::text from public.inbox_messages where message_key=pg_temp.k(100)),true);
select public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(101),'uid',2,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(101)||'.eml','rawSha256',pg_temp.k(101),
    'subject','Text only','text','Hello','aliasSlug','northwind'));

-- The same message again (a re-delivery) changes nothing.
select is((public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(100),'uid',3,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(100)||'.eml','rawSha256',pg_temp.k(100),
    'htmlPath','fake/'||pg_temp.k(100)||'.html','subject','Spring','text','Hello','aliasSlug','northwind'))->>'duplicate'),'true','a re-delivered email is a duplicate');

-- Recording an email with HTML queues its images; a text email does not.
select is((select assets_state from public.inbox_messages where id=current_setting('test.message')::uuid),'pending','an email with HTML waits for its images');
select is((select count(*)::int from public.platform_jobs where kind='inbox.assets' and subject_key=current_setting('test.message')),1,'its image job is queued once, also after the re-delivery');
select is((select assets_state from public.inbox_messages where message_key=pg_temp.k(101)),'none','a text email has no images to keep');
select is((select count(*)::int from public.platform_jobs where kind='inbox.assets'),1,'and no image job');

-- The image job.
select set_config('test.job',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select set_config('test.lease',(select lease_token::text from public.platform_jobs where id=current_setting('test.job')::uuid),true);
select throws_ok($$select public.record_inbox_images(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,'[]')$$,'23514',null,'a poll job cannot record images');
select throws_ok($$select public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,jsonb_build_array(pg_temp.img(1)))$$,'PT409','Stored copy missing','an image is recorded only once it is stored');
select throws_ok($$select public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,(select jsonb_agg(pg_temp.img(n)) from generate_series(1,61) n))$$,'23514',null,'at most 60 images per email');
select throws_ok($$select public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,jsonb_build_array(pg_temp.img(1,'{"state":"failed","failure":"broken"}')))$$,'23514',null,'a failed image keeps no stored copy');
select throws_ok($$select public.record_inbox_images(current_setting('test.job')::uuid,gen_random_uuid(),'[]')$$,'PT409',null,'a wrong lease is refused');
reset role;
select pg_temp.obj('inbox-assets','img/'||pg_temp.k(n)||'.png') from generate_series(1,2) n;
set local role service_role;
select is(public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,
  jsonb_build_array(pg_temp.img(1), pg_temp.img(2),
    jsonb_build_object('ordinal',3,'source','remote','sourceRef','https://mail.northwind.example/gone.png','state','failed','failure','broken'))),
  '{"failed": 1, "stored": 2}'::jsonb,'stored and failed images are counted');
select is((select assets_state||'/'||images_stored||'/'||images_failed from public.inbox_messages where id=current_setting('test.message')::uuid),'done/2/1','the email knows its images are kept');
select is((select count(*)::int from public.platform_jobs where kind='inbox.screenshot' and subject_key=current_setting('test.message')),1,'its screenshot is queued');
select is(public.record_inbox_images(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,
  jsonb_build_array(pg_temp.img(1), pg_temp.img(2,'{"sourceRef":"changed"}'))),
  '{"failed": 1, "stored": 2}'::jsonb,'a retry records nothing twice');
select is((select count(*)::int from public.inbox_message_images where inbox_message_id=current_setting('test.message')::uuid),3,'three rows, not five');
select is((select count(*)::int from public.platform_jobs where kind='inbox.screenshot'),1,'and one screenshot job');
select public.finish_platform_job(current_setting('test.job')::uuid,current_setting('test.lease')::uuid);

-- The screenshot job.
select set_config('test.shot',(select id::text from public.claim_platform_job(array['inbox.screenshot'])),true);
select set_config('test.shotlease',(select lease_token::text from public.platform_jobs where id=current_setting('test.shot')::uuid),true);
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,2400)$$,'PT409','Stored copy missing','a screenshot is recorded only once it is uploaded');
reset role;
select pg_temp.obj('inbox-assets','shot/'||current_setting('test.message')||'.jpg');
set local role service_role;
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,20000)$$,'23514',null,'the screenshot height is capped');
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,0,2400)$$,'23514',null,'the screenshot width is checked');
reset role;
insert into public.platform_jobs(kind, subject_key, idempotency_key) values ('inbox.assets', current_setting('test.message'), 'test:assets-again');
set local role service_role;
select set_config('test.job2',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select set_config('test.lease2',(select lease_token::text from public.platform_jobs where id=current_setting('test.job2')::uuid),true);
select throws_ok($$select public.record_inbox_screenshot(current_setting('test.job2')::uuid,current_setting('test.lease2')::uuid,600,2400)$$,'23514',null,'an image job cannot record a screenshot');
select lives_ok($$select public.record_inbox_screenshot(current_setting('test.shot')::uuid,current_setting('test.shotlease')::uuid,600,2400)$$,'the screenshot is recorded');
select is((select screenshot_path||'/'||screenshot_width||'x'||screenshot_height from public.inbox_messages where id=current_setting('test.message')::uuid),
  'shot/'||current_setting('test.message')||'.jpg/600x2400','on the email');
select is((select screenshot_path||'/'||screenshot_width||'x'||screenshot_height from public.competitor_emails where id=current_setting('test.msg')::uuid),
  'shot/'||current_setting('test.message')||'.jpg/600x2400','and on the competitor email the workspace sees');

-- A second sample brand that workspace 102 follows, with its own screenshot.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','cedar.example');
reset role;
select set_config('test.cedar',(select id::text from public.competitor_captures where domain='cedar.example'),true);
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_path, raw_sha256, raw_bytes, subject, received_at, synthetic, state)
  select id, pg_temp.k(200), 1, 9, 'fake/'||pg_temp.k(200)||'.eml', pg_temp.k(200), 10, 'Cedar', now(), true, 'unassigned'
  from public.inbox_mailboxes where key='fake';
select set_config('test.cedarmsg',(select id::text from public.inbox_messages where message_key=pg_temp.k(200)),true);
update public.inbox_messages set screenshot_path='shot/'||current_setting('test.cedarmsg')||'.jpg', screenshot_width=600, screenshot_height=900
  where id=current_setting('test.cedarmsg')::uuid;
select pg_temp.obj('inbox-assets','shot/'||current_setting('test.cedarmsg')||'.jpg');
-- Assigned later (as INB-004 will): the competitor email brings the screenshot along.
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_bytes, subject, received_at, synthetic, state)
  select id, pg_temp.k(201), 1, 10, 10, 'x', now(), true, 'too_large' from public.inbox_mailboxes where key='fake';
insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic, inbox_message_id)
  values (current_setting('test.cedar')::uuid, 'msg:cedar', now(), 'Cedar', 'Hello', '<p>Hello</p>', '{}', true, current_setting('test.cedarmsg')::uuid);
select is((select screenshot_path||'/'||screenshot_height from public.competitor_emails where external_id='msg:cedar'),
  'shot/'||current_setting('test.cedarmsg')||'.jpg/900','an email assigned later brings its screenshot along');
set local role service_role;

-- Storage: a follower reads the screenshot and images; nobody else does.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from storage.objects where bucket_id='inbox-assets'),1,'a member of a following workspace reads its screenshot');
select is((select name from storage.objects where bucket_id='inbox-assets'),'shot/'||current_setting('test.message')||'.jpg','and only that: kept images are for the platform');
select is((select count(*)::int from public.inbox_message_images),0,'but not the image list');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select is((select name from storage.objects where bucket_id='inbox-assets'),'shot/'||current_setting('test.cedarmsg')||'.jpg','another workspace reads only the screenshot of the brand it follows');
select is((select count(*)::int from storage.objects where bucket_id='inbox-raw'),0,'and no raw email');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select is((select count(*)::int from storage.objects where bucket_id='inbox-assets'),4,'platform admins read them all');
select is((select count(*)::int from public.inbox_message_images),3,'and the image list');

-- Unfollowing hides them again.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
reset role;
update public.competitor_subscriptions set active=false where tenant_id='00000000-0000-4000-8000-000000000101';
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id='inbox-assets'),0,'a workspace that stopped following reads none');
reset role;
select throws_ok($$update public.inbox_message_images set path='img/'||repeat('0',64)||'.png' where state='stored' and content_type='image/png'$$,'23514',null,'a stored copy is named by its own content');

select * from finish();
rollback;
