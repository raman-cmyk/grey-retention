begin;
select plan(79);

-- Profiles: owner ...01 (workspace 101), platform admin ...02.
-- Real brands use .test domains; sample brands use .example.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('message-' || n, 'sha256'), 'hex') $$;
create function pg_temp.store(name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values ('inbox-raw', name) on conflict do nothing
$$;
-- A real message from the Gmail mailbox (pass synthetic/rawPath for the fake one).
create function pg_temp.msg(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('messageKey', pg_temp.k(n), 'uid', n, 'uidValidity', 7, 'rawBytes', 2048,
    'receivedAt', '2026-11-01T10:00:00Z', 'synthetic', false, 'kind', 'message',
    'rawPath', 'gmail/' || pg_temp.k(n) || '.eml', 'rawSha256', pg_temp.k(n), 'subject', 'Spring   sale ' || n,
    'text', 'Hello ' || n, 'fromAddress', 'news@mail.northwind.test', 'fromDomain', 'mail.northwind.test') || extra
$$;
create function pg_temp.sample(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.msg(n, jsonb_build_object('synthetic', true, 'rawPath', 'fake/' || pg_temp.k(n) || '.eml') || extra)
$$;

-- Grants: the worker's commands are for the service role only.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot run any worker command')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.enqueue_inbox_poll(text)','public.claim_platform_job(text[],text)','public.record_inbox_message(uuid,uuid,jsonb)',
         'public.advance_inbox_cursor(uuid,uuid,bigint,bigint)','public.finish_platform_job(uuid,uuid,jsonb)','public.fail_platform_job(uuid,uuid,text,text)']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'the worker can run its commands')
  from unnest(array['public.enqueue_inbox_poll(text)','public.claim_platform_job(text[],text)','public.record_inbox_message(uuid,uuid,jsonb)',
    'public.advance_inbox_cursor(uuid,uuid,bigint,bigint)','public.finish_platform_job(uuid,uuid,jsonb)','public.fail_platform_job(uuid,uuid,text,text)']) f;
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'the private helpers are not callable by any API role')
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['private.platform_lease(uuid,uuid)','private.open_ops_task(text,text,uuid,jsonb)']) f;
select ok(not has_function_privilege('anon','public.admin_save_inbox_brand(text,text,text,text,text[])','execute'),'anon cannot register brands');
select ok(not bool_or(has_table_privilege(r, 'public.' || t, p)),'browser roles cannot write the inbox tables')
  from unnest(array['anon','authenticated']) r,
       unnest(array['platform_jobs','inbox_mailboxes','inbox_messages','competitor_sender_domains','ops_tasks']) t,
       unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not bool_or(has_table_privilege('anon', 'public.' || t, 'select')),'anon cannot read the inbox tables')
  from unnest(array['platform_jobs','inbox_mailboxes','inbox_messages','competitor_sender_domains','ops_tasks']) t;
select is((select public from storage.buckets where id='inbox-raw'),false,'raw messages are in a private bucket');

-- Brands: platform admins only. A .example domain is a sample brand.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.admin_save_inbox_brand('northwind.test','northwind','Northwind','apparel')$$,'42501',null,'a workspace owner cannot register brands');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('test.brand',public.admin_save_inbox_brand('northwind.test','Northwind','Northwind Outdoor','apparel',array['northwind.test'])::text,true);
select set_config('test.other',public.admin_save_inbox_brand('cedar.test','cedar','Cedar Lane','home')::text,true);
select set_config('test.sample',public.admin_save_inbox_brand('juniper.example','juniper','Juniper','home')::text,true);
select is((select alias_slug||'/'||subscription_status||'/'||synthetic::text from public.competitor_captures where id=current_setting('test.brand')::uuid),'northwind/pending/false','a registered brand is real, has its alias and waits for its first email');
select is((select synthetic from public.competitor_captures where id=current_setting('test.sample')::uuid),true,'a .example brand is a sample brand');
select lives_ok($$select public.admin_save_inbox_brand('northwind.test','northwind','Northwind Outdoor','apparel',array['northwind.test'])$$,'saving a brand again with its own sender is fine');
select throws_ok($$select public.admin_save_inbox_brand('other.test','northwind','Other','home')$$,'PT409',null,'an alias belongs to one brand');
select throws_ok($$select public.admin_save_inbox_brand('cedar.test','cedar','Cedar Lane','home',array['northwind.test'])$$,'PT409',null,'a sender domain belongs to one brand');
select is((select capture_id::text from public.competitor_sender_domains where domain='northwind.test'),current_setting('test.brand'),'a refused save moves no sender domain');
select throws_ok($$select public.admin_save_inbox_brand('bad.test','x','Bad','home')$$,'23514',null,'an alias needs at least 2 characters');
select throws_ok($$select public.admin_save_inbox_brand('not a domain','okay','Bad','home')$$,'23514',null,'the brand domain is checked');
select throws_ok($$select public.admin_save_inbox_brand('bad.test','okay','Bad','home',array[null]::text[])$$,'23514',null,'an empty sender domain is refused in words');
select throws_ok($$insert into public.competitor_captures(domain, synthetic) values ('real.test', true)$$,'42501',null,'members cannot write brands directly');
reset role;
select throws_ok($$insert into public.competitor_captures(domain, synthetic) values ('real.test', true)$$,'23514',null,'a real domain can never be a sample brand');
select throws_ok($$insert into public.competitor_captures(domain, synthetic) values ('fake.example', false)$$,'23514',null,'a .example domain can never be a real brand');
select throws_ok($$insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic)
  values (current_setting('test.brand')::uuid, 'x', now(), 's', 't', 'h', '{}', false)$$,'23514',null,'a real email always comes from the inbox');

-- The worker: one poll job per mailbox, claimed with its cursor.
set local role service_role;
select set_config('test.job',public.enqueue_inbox_poll('gmail')::text,true);
select is(public.enqueue_inbox_poll('gmail')::text,current_setting('test.job'),'one active poll per mailbox');
select throws_ok($$select public.enqueue_inbox_poll('elsewhere')$$,'23514',null,'only known mailboxes');
select set_config('test.lease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'gmail')),true);
select is((select status from public.platform_jobs where id=current_setting('test.job')::uuid),'leased','the poll is leased');
select is((select count(*)::int from public.claim_platform_job(array['inbox.poll'])),0,'a leased job is not claimed twice');
select is((select count(*)::int from public.claim_platform_job(array['inbox.poll'],'fake')),0,'a worker claims only its own mailbox');

-- A stored copy must exist first.
select throws_ok($$select public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(1,'{"aliasSlug":"cedar"}'))$$,'PT409','Stored copy missing','nothing is recorded before its raw copy is stored');
reset role;
select pg_temp.store('gmail/'||pg_temp.k(n)||'.eml') from generate_series(1,12) n;
select pg_temp.store('fake/'||pg_temp.k(n)||'.eml') from generate_series(20,22) n;
set local role service_role;

-- Assignment: the alias first, then a registered sender domain (or its parent).
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(1,'{"aliasSlug":"cedar","fromDomain":"esp-mailer.test"}'))->>'brand'),current_setting('test.other'),'an email to the +alias of a brand without registered senders is that brand''s');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(2))->>'method'),'sender','an email from the brand''s mail subdomain is the brand''s');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(3,'{"aliasSlug":"northwind"}'))->>'method'),'alias','an email to the +alias from a registered sender is the brand''s');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(4,'{"aliasSlug":"northwind","fromDomain":"spoof.test"}'))->>'state'),'unassigned','an email to the +alias from an unregistered sender goes to a person');
select is((select detail->>'reason' from public.ops_tasks where dedupe_key='inbox_sender_mismatch:northwind:'||md5('spoof.test')),'sender_not_registered','the task says the sender is not registered');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(11,jsonb_build_object('aliasSlug','northwind','fromDomain',repeat('a',240)||'.spoof.test')))->>'state'),'unassigned','a forged 251-character sender domain still becomes a task');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(5,'{"aliasSlug":"juniper","fromDomain":"juniper.example"}'))->>'state'),'unassigned','real mail never lands in a sample brand');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(1))->>'duplicate'),'true','the same message is recorded once');
select is((select count(*)::int from public.inbox_messages where message_key=pg_temp.k(1)),1,'no second row for a repeat');
select is((select count(*)::int from public.competitor_emails where capture_id=current_setting('test.brand')::uuid and not synthetic and inbox_message_id is not null),2,'assigned emails become the brand''s real competitor emails');
select is((select subject from public.competitor_emails where external_id='msg:'||pg_temp.k(2)),'Spring sale 2','the subject is kept on one line');
select ok((select safe_html not like '%<script%' and safe_html like '%Hello 2%' from public.competitor_emails where external_id='msg:'||pg_temp.k(2)),'the preview is escaped text');
select is((select status||'/'||subscription_status from public.competitor_captures where id=current_setting('test.brand')::uuid),'live/subscribed','the first email marks the brand live and subscribed');

-- Unknown senders, parse failures and oversized messages go to people.
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(6,'{"fromDomain":"unknown.test"}'))->>'state'),'unassigned','an unknown sender is left unassigned');
select public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(7,'{"fromDomain":"unknown.test"}'));
select is((select occurrences from public.ops_tasks where dedupe_key='inbox_unknown_sender:unknown.test' and state='open'),2,'one open task per unknown sender, counted');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(8,'{"kind":"parse_failed","reason":"charset"}'))->>'state'),'parse_failed','a message that cannot be read is kept for a person');
select is((public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(9,'{"kind":"too_large","rawPath":null,"rawSha256":null,"rawBytes":30000000}'))->>'state'),'too_large','an oversized message is recorded without being stored');
select is((select count(*)::int from public.ops_tasks where kind in ('inbox_parse_failure','inbox_too_large')),2,'parse failures and oversized messages become tasks');
select throws_ok($$select public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.msg(10,'{"synthetic":true}'))$$,'23514',null,'a sample message cannot come from the Gmail mailbox');
select throws_ok($$select public.record_inbox_message(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,pg_temp.sample(20))$$,'23514',null,'stored copies live under their mailbox');
select throws_ok($$select public.record_inbox_message(current_setting('test.job')::uuid,gen_random_uuid(),pg_temp.msg(10))$$,'PT409','Stale platform job lease','a wrong lease is refused');

-- The cursor only moves forward; a new UIDVALIDITY starts over.
select public.advance_inbox_cursor(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,7,9);
select public.advance_inbox_cursor(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,7,3);
select is((select last_uid from public.inbox_mailboxes where key='gmail'),9::bigint,'the cursor never moves back');
select public.advance_inbox_cursor(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,8,2);
select is((select uidvalidity||'/'||last_uid from public.inbox_mailboxes where key='gmail'),'8/2','a new UIDVALIDITY starts the cursor over');

select lives_ok($$select public.finish_platform_job(current_setting('test.job')::uuid,current_setting('test.lease')::uuid,'{"recorded":3}')$$,'the poll finishes');
select ok((select last_polled_at is not null from public.inbox_mailboxes where key='gmail'),'the mailbox remembers when it was read');
select throws_ok($$select public.finish_platform_job(current_setting('test.job')::uuid,current_setting('test.lease')::uuid)$$,'PT409',null,'a finished job cannot be finished again');

-- The sample mailbox reaches sample brands only.
select set_config('test.fake',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.fakelease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select is((public.record_inbox_message(current_setting('test.fake')::uuid,current_setting('test.fakelease')::uuid,pg_temp.sample(20,'{"aliasSlug":"northwind"}'))->>'state'),'unassigned','sample mail never lands in a real brand, by alias or sender');
select is((public.record_inbox_message(current_setting('test.fake')::uuid,current_setting('test.fakelease')::uuid,pg_temp.sample(21,'{"aliasSlug":"juniper","fromDomain":"juniper.example"}'))->>'brand'),current_setting('test.sample'),'sample mail reaches its sample brand');
select is((select synthetic from public.competitor_emails where external_id='msg:'||pg_temp.k(21)),true,'a sample brand''s email stays a sample');
select public.finish_platform_job(current_setting('test.fake')::uuid,current_setting('test.fakelease')::uuid);

-- Failures retry with backoff; a failed login pauses the mailbox.
select set_config('test.job2',public.enqueue_inbox_poll('gmail')::text,true);
select set_config('test.lease2',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'gmail')),true);
select public.fail_platform_job(current_setting('test.job2')::uuid,current_setting('test.lease2')::uuid,'unavailable','imap_unavailable');
select ok((select status='retry_wait' and available_at>now() from public.platform_jobs where id=current_setting('test.job2')::uuid),'a passing failure retries later');
reset role;
update public.platform_jobs set available_at=now() where id=current_setting('test.job2')::uuid;
set local role service_role;
select set_config('test.lease2',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'gmail')),true);
select public.fail_platform_job(current_setting('test.job2')::uuid,current_setting('test.lease2')::uuid,'auth','imap_auth_failed');
select is((select status from public.platform_jobs where id=current_setting('test.job2')::uuid),'failed','a failed login is not retried');
select ok((select paused_until>now()+interval '5 hours' from public.inbox_mailboxes where key='gmail'),'a failed login pauses the mailbox for hours');
select is(public.enqueue_inbox_poll('gmail'),null,'no poll while the mailbox is paused');
select is((select count(*)::int from public.ops_tasks where kind='inbox_auth_failed' and state='open'),1,'a person is asked to check the login');
select throws_ok($$select public.fail_platform_job(current_setting('test.job2')::uuid,current_setting('test.lease2')::uuid,'nonsense','x')$$,'PT409',null,'a failed job cannot fail again');

-- After the pause, a good login lifts it and closes the login task.
reset role;
update public.inbox_mailboxes set paused_until=now()-interval '1 second' where key='gmail';
set local role service_role;
select set_config('test.job3',public.enqueue_inbox_poll('gmail')::text,true);
select set_config('test.lease3',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'gmail')),true);
select public.finish_platform_job(current_setting('test.job3')::uuid,current_setting('test.lease3')::uuid);
select is((select paused_until from public.inbox_mailboxes where key='gmail'),null,'a good poll lifts the pause');
select is((select state from public.ops_tasks where kind='inbox_auth_failed'),'resolved','a good poll closes the login task');

-- A lease that expires is recovered: retried, or failed with a task after the 4th attempt.
select set_config('test.job4',public.enqueue_inbox_poll('gmail')::text,true);
select set_config('test.lease4',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'gmail')),true);
reset role;
update public.platform_jobs set lease_expires_at=now()-interval '1 second' where id=current_setting('test.job4')::uuid;
set local role service_role;
select throws_ok($$select public.advance_inbox_cursor(current_setting('test.job4')::uuid,current_setting('test.lease4')::uuid,8,5)$$,'PT409',null,'an expired lease cannot move the cursor');
select is((select attempt from public.claim_platform_job(array['inbox.poll'],'gmail')),2,'an expired poll is taken over as the next attempt');
reset role;
update public.platform_jobs set attempt=4, lease_expires_at=now()-interval '1 second' where id=current_setting('test.job4')::uuid;
set local role service_role;
select is((select count(*)::int from public.claim_platform_job(array['inbox.poll'],'gmail')),0,'an expired 4th attempt is not retried');
select is((select status||'/'||last_error_code from public.platform_jobs where id=current_setting('test.job4')::uuid),'failed/lease_expired','it fails as expired');
select is((select count(*)::int from public.ops_tasks where dedupe_key='job_failed:inbox.poll:gmail' and state='open'),1,'and a person is told');

-- Only inbox jobs move the mailbox cursor.
reset role;
insert into public.platform_jobs(kind, subject_key, idempotency_key) values ('inbox.assets','x','assets:x');
set local role service_role;
select set_config('test.lease5',(select lease_token::text from public.claim_platform_job(array['inbox.assets'])),true);
select throws_ok($$select public.advance_inbox_cursor((select id from public.platform_jobs where kind='inbox.assets'),current_setting('test.lease5')::uuid,8,5)$$,'23514',null,'another kind of job cannot move the cursor');

-- Nothing about the inbox reaches a workspace, and nobody writes it from the browser.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.competitor_sender_domains)+(select count(*)::int from public.inbox_mailboxes)+(select count(*)::int from public.inbox_messages)
  +(select count(*)::int from public.ops_tasks)+(select count(*)::int from public.platform_jobs),0,'workspace members read no inbox tables');
select is((select count(*)::int from public.competitor_captures where not synthetic)+(select count(*)::int from public.competitor_emails where not synthetic),0,'workspace members read no real brand and no real email');
select is((select count(*)::int from storage.objects where bucket_id='inbox-raw'),0,'workspace members read no raw message');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.test')$$,'23514',null,'a workspace still cannot follow a real brand');
select throws_ok($$update public.inbox_mailboxes set paused_until=null$$,'42501',null,'members cannot change a mailbox');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select ok((select count(*) from public.inbox_messages)=12 and (select count(*) from public.ops_tasks)>=6,'platform admins read the inbox and its tasks');
select is((select count(*)::int from storage.objects where bucket_id='inbox-raw'),0,'not even admins read raw messages from the browser');
select throws_ok($$delete from public.ops_tasks$$,'42501',null,'admins cannot delete tasks from the browser');
select throws_ok($$update public.platform_jobs set status='cancelled'$$,'42501',null,'admins cannot change jobs from the browser');

select * from finish();
rollback;
