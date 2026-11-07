begin;
select plan(73);

-- Owner ...01 and staff ...05 of workspace 101; platform admin ...02.
-- Brands, aliases and UIDs of their own, so data a browser journey left
-- behind never collides with them.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('ops4-' || n, 'sha256'), 'hex') $$;
create function pg_temp.obj(name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values ('inbox-raw', name) on conflict do nothing
$$;
create function pg_temp.msg(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('messageKey', pg_temp.k(n), 'uid', 9000 + n, 'uidValidity', 1, 'rawBytes', 900,
    'receivedAt', '2026-11-01T10:00:00Z', 'synthetic', true, 'kind', 'message',
    'rawPath', 'fake/' || pg_temp.k(n) || '.eml', 'rawSha256', pg_temp.k(n), 'subject', 'Hello ' || n, 'text', 'Hello') || extra
$$;
create function pg_temp.id(n int) returns uuid language sql as $$ select id from public.inbox_messages where message_key = pg_temp.k(n) $$;
create function pg_temp.rec(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select public.record_inbox_message(current_setting('test.poll')::uuid, current_setting('test.lease')::uuid, pg_temp.msg(n, extra))
$$;
create function pg_temp.flag(n int, sig text, url text default null, body text default null) returns jsonb language sql as $$
  select public.flag_inbox_message(current_setting('test.poll')::uuid, current_setting('test.lease')::uuid, pg_temp.k(n), sig, url, body)
$$;
create function pg_temp.status(brand text) returns text language sql as $$
  select subscription_status from public.competitor_captures where id = current_setting('test.' || brand)::uuid
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot run the worker commands')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.flag_inbox_message(uuid,uuid,text,text,text,text)','public.begin_confirmation_click(uuid,uuid,text)',
         'public.record_confirmation_click(uuid,uuid,text,text,integer,text)','public.check_pending_subscriptions()']) f;
select ok(not bool_or(has_function_privilege('anon', f, 'execute')),'anon cannot run the admin commands')
  from unnest(array['public.resolve_ops_task(uuid,text,text)','public.admin_assign_inbox_message(uuid,uuid)','public.admin_assign_sender(text,uuid)',
    'public.admin_label_section(uuid,text)','public.admin_inbox_brand_counts()']) f;
select ok(not bool_or(has_function_privilege('authenticated', f, 'execute')),'the helpers are private')
  from unnest(array['private.assign_inbox_message(public.inbox_messages,public.competitor_captures)','private.sender_tasks(text)']) f;
select ok(not bool_or(has_table_privilege(r, 'public.inbox_confirmation_clicks', p)),'nobody writes or maintains the click log from the browser')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','maintain']) p;
select ok(not has_table_privilege('anon', 'public.inbox_confirmation_clicks', 'select'),'and anon cannot read it');

-- Sample brands, then a poll records sample emails.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select set_config('test.north',public.admin_save_inbox_brand('tap-north.example','tapnorth','Tap North','apparel')::text,true);
select set_config('test.cedar',public.admin_save_inbox_brand('tap-cedar.example','tapcedar','Tap Cedar','home',array['news.tap-cedar.example'])::text,true);
select set_config('test.quiet',public.admin_save_inbox_brand('tap-quiet.example','tapquiet','Tap Quiet','beauty')::text,true);
reset role;
insert into public.competitor_captures(domain, synthetic, alias_slug, brand_name, niche, subscription_status)
  values ('tap-real.test', false, 'tapreal', 'Tap Real', 'home', 'pending');
select set_config('test.real',(select id::text from public.competitor_captures where domain='tap-real.test'),true);
select pg_temp.obj('fake/'||pg_temp.k(n)||'.eml') from generate_series(1,20) n;
set local role service_role;
select set_config('test.poll',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.lease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select pg_temp.rec(1,'{"aliasSlug":"tapnorth","subject":"Please confirm your subscription"}');
select pg_temp.rec(2,'{"aliasSlug":"tapcedar","fromDomain":"news.tap-cedar.example","subject":"You have been unsubscribed"}');
select pg_temp.rec(3,'{"fromDomain":"mail.unknown.example","subject":"Please confirm"}');
select pg_temp.rec(4,'{"fromDomain":"news.fir.example"}');
select pg_temp.rec(5,'{"fromDomain":"news.fir.example"}');
select pg_temp.rec(8,'{"aliasSlug":"tapcedar","fromDomain":"promo.other.example"}');
select pg_temp.rec(9,'{"aliasSlug":"tapquiet","subject":"Please confirm your subscription"}');
select pg_temp.rec(10,'{"fromDomain":"shop.pine.example","subject":"Spring"}');
select pg_temp.rec(12,'{"fromDomain":"news.birch.example"}');

-- Signals from the poll worker.
select throws_ok($$select pg_temp.flag(1,'spam')$$,'23514',null,'only known signals');
select throws_ok($$select public.flag_inbox_message(current_setting('test.poll')::uuid,current_setting('test.lease')::uuid,pg_temp.k(99),'opt_in')$$,
  'PT409','Unknown message','only recorded messages');
select is(pg_temp.flag(1,'opt_in','HTTPS://manage.kmail-lists.com/confirm?x=1'),'{"already": false}'::jsonb,'an opt-in confirmation from a known brand is flagged');
select is((select confirm_url from public.inbox_messages where id=pg_temp.id(1)),'https://manage.kmail-lists.com/confirm?x=1','its link is kept in a clean form');
select is((select count(*)::int from public.platform_jobs where kind='inbox.confirm'),1,'and the worker may open it');
select is((select count(*)::int from public.competitor_emails where inbox_message_id=pg_temp.id(1)),0,'a confirmation is not a newsletter: it leaves the library');
select is(pg_temp.status('north')||'/'||((select pending_since from public.competitor_captures where id=current_setting('test.north')::uuid) is not null)::text,
  'pending/true','and the brand waits for its first newsletter');
select is(pg_temp.flag(1,'opt_in','https://elsewhere.test/x'),'{"already": true}'::jsonb,'a message is flagged once');
select pg_temp.flag(2,'unsubscribed');
select is(pg_temp.status('cedar'),'unsubscribed','a brand that unsubscribed us says so');
select is((select count(*)::int from public.ops_tasks where kind='inbox_unsubscribed' and state='open'),1,'and a person is asked to resubscribe');
select pg_temp.flag(3,'opt_in','https://mail.unknown.example/confirm');
select is((select detail->>'reason' from public.ops_tasks where dedupe_key='inbox_opt_in:'||pg_temp.id(3)),'unknown_brand','an opt-in from an unknown brand is never opened: a person checks it');
select pg_temp.flag(9,'opt_in','http://tap-quiet.example/confirm');
select is((select detail->>'reason' from public.ops_tasks where dedupe_key='inbox_opt_in:'||pg_temp.id(9))||'/'||pg_temp.status('quiet'),
  'no_link/pending','a known brand''s confirmation without a usable link goes to a person, named as such');
select is(pg_temp.flag(10,null,null,'Spring sale starts now'),'{"signal": null}'::jsonb,'an ordinary email is noted');
select is((select text_part from public.inbox_messages where id=pg_temp.id(10)),'Spring sale starts now','with its text, kept for an admin assigning it');

-- The confirm click: begun once, logged once.
select set_config('test.confirm',(select id::text from public.claim_platform_job(array['inbox.confirm'])),true);
select set_config('test.clease',(select lease_token::text from public.platform_jobs where id=current_setting('test.confirm')::uuid),true);
select throws_ok($$select public.begin_confirmation_click(current_setting('test.poll')::uuid,current_setting('test.lease')::uuid,'x')$$,'23514',null,'a poll job cannot begin a click');
select throws_ok($$select public.flag_inbox_message(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,pg_temp.k(1),'opt_in')$$,'23514',null,'a confirm job cannot flag');
select is(public.begin_confirmation_click(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,'manage.kmail-lists.com'),true,'a click is begun');
select is(public.begin_confirmation_click(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,'manage.kmail-lists.com'),false,'and never begun twice');
select is(public.record_confirmation_click(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,'manage.kmail-lists.com','clicked',null,'manage.kmail-lists.com'),
  '{"already": false}'::jsonb,'what happened is recorded');
select is((select host||'/'||final_host||'/'||outcome from public.inbox_confirmation_clicks),'manage.kmail-lists.com/manage.kmail-lists.com/clicked','every click is logged, with where it ended');
select is(pg_temp.status('north'),'pending','a click proves nothing: the brand still waits for its first newsletter');
select is(public.record_confirmation_click(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,'manage.kmail-lists.com','failed',500),
  '{"already": true}'::jsonb,'a second record changes nothing');
select is((select count(*)::int from public.ops_tasks where dedupe_key='inbox_opt_in:'||pg_temp.id(1)),0,'and opens no task');
select throws_ok($$select public.record_confirmation_click(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid,'x','attempted')$$,'23514',null,'only real outcomes');
select public.finish_platform_job(current_setting('test.confirm')::uuid,current_setting('test.clease')::uuid);

-- Its first newsletter makes it subscribed; a later "confirm" email is ignored.
select pg_temp.rec(6,'{"aliasSlug":"tapnorth","subject":"New linen"}');
select is(pg_temp.status('north'),'subscribed','the first newsletter shows the brand is subscribed');
select pg_temp.rec(7,'{"aliasSlug":"tapnorth","subject":"Please confirm your subscription"}');
select is(pg_temp.flag(7,'opt_in','https://manage.kmail-lists.com/confirm?x=2'),'{"ignored": "subscribed", "already": false}'::jsonb,
  'a confirmation for a brand whose newsletters arrive is ignored');
select is((select count(*)::int from public.platform_jobs where kind='inbox.confirm'),1,'nothing more is opened');
select public.finish_platform_job(current_setting('test.poll')::uuid,current_setting('test.lease')::uuid);

-- Waiting a week: found once, never repeated, not after it is closed.
reset role;
update public.competitor_captures set pending_since=now()-interval '8 days' where id=current_setting('test.quiet')::uuid;
set local role service_role;
select is(public.check_pending_subscriptions(),1,'a brand waiting a week for its first newsletter is found');
select is(public.check_pending_subscriptions(),0,'once');

-- Only platform admins resolve, assign and label.
set local role authenticated;
select set_config('test.unsub',(select id::text from public.ops_tasks where kind='inbox_unsubscribed'),true);
select set_config('test.pending',(select id::text from public.ops_tasks where kind='inbox_pending_subscription'),true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.resolve_ops_task(current_setting('test.unsub')::uuid,'resolved')$$,'42501',null,'an owner cannot resolve tasks');
select throws_ok($$select public.admin_assign_sender('news.fir.example',current_setting('test.north')::uuid)$$,'42501',null,'an owner cannot assign emails');
select throws_ok($$select * from public.admin_inbox_brand_counts()$$,'42501',null,'or read the directory counts');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.admin_assign_inbox_message(pg_temp.id(4),current_setting('test.north')::uuid)$$,'42501',null,'staff cannot either');
select throws_ok($$select public.admin_label_section(gen_random_uuid(),'text')$$,'42501',null,'or label a section');
select is((select count(*)::int from public.ops_tasks),0,'and they read no tasks');
select is((select count(*)::int from public.inbox_confirmation_clicks),0,'or the click log');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.resolve_ops_task(current_setting('test.unsub')::uuid,'deleted')$$,'23514',null,'resolved or dismissed only');
select throws_ok($$select public.resolve_ops_task(gen_random_uuid(),'resolved')$$,'PT409','This task no longer exists','an unknown task says so');
select throws_ok($$select public.resolve_ops_task(current_setting('test.unsub')::uuid,'resolved',repeat('x',501))$$,'23514',null,'a note is short');
select lives_ok($$select public.resolve_ops_task(current_setting('test.unsub')::uuid,'resolved','Signed up again with the tapcedar alias')$$,'an admin resolves a task with a note');
select is((select state||'/'||(detail->>'note')||'/'||(resolved_by is not null)::text from public.ops_tasks where id=current_setting('test.unsub')::uuid)||'/'||pg_temp.status('cedar'),
  'resolved/Signed up again with the tapcedar alias/true/pending','we signed up again: the brand waits for its first newsletter');
select throws_ok($$select public.resolve_ops_task(current_setting('test.unsub')::uuid,'dismissed')$$,'PT409','This task is already closed','a closed task stays closed');
select lives_ok($$select public.resolve_ops_task(current_setting('test.pending')::uuid,'dismissed')$$,'a waiting brand''s task is dismissed');
set local role service_role;
select is(public.check_pending_subscriptions(),0,'and it does not come back');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);

-- Assign one email, or a whole sender.
select is((select count(*)::int from public.ops_tasks where state='open' and dedupe_key='inbox_unknown_sender:news.fir.example'),1,'two emails from one unknown sender are one task');
select lives_ok($$select public.admin_assign_inbox_message(pg_temp.id(4),current_setting('test.north')::uuid)$$,'an admin assigns one email');
select is((select state||'/'||(subject_id = pg_temp.id(5))::text from public.ops_tasks where dedupe_key='inbox_unknown_sender:news.fir.example'),'open/true',
  'its sender''s task stays open for the other email');
select is(public.admin_assign_sender('news.fir.example',current_setting('test.north')::uuid),1,'assigning the sender assigns the rest');
select is((select state from public.ops_tasks where dedupe_key='inbox_unknown_sender:news.fir.example')||'/'||
  (select capture_id::text from public.competitor_sender_domains where domain='news.fir.example'),'resolved/'||current_setting('test.north'),
  'its task closes and the sender is remembered for next time');
select throws_ok($$select public.admin_assign_sender('news.fir.example',current_setting('test.cedar')::uuid)$$,'PT409',null,'a sender belongs to one brand');
select throws_ok($$select public.admin_assign_sender('mail.acme.com',current_setting('test.north')::uuid)$$,'23514',null,'a real sender never goes to a sample brand');
select throws_ok($$select public.admin_assign_sender('news.pine.example',current_setting('test.real')::uuid)$$,'23514',null,'nor a sample sender to a real brand');
select is(public.admin_assign_sender('promo.other.example',current_setting('test.cedar')::uuid),1,'a sender not registered for its +alias is assigned');
select is((select state from public.ops_tasks where kind='inbox_unknown_sender' and detail->>'fromDomain'='promo.other.example'),'resolved','and its task closes');
select is(public.admin_assign_sender('birch.example',current_setting('test.quiet')::uuid),1,'a sender''s subdomains come along');
select is((select state from public.ops_tasks where dedupe_key='inbox_unknown_sender:news.birch.example'),'resolved','and their tasks close');
select lives_ok($$select public.admin_assign_inbox_message(pg_temp.id(10),current_setting('test.quiet')::uuid)$$,'an email without sections is assigned');
select is((select text_content from public.competitor_emails where inbox_message_id=pg_temp.id(10)),'Spring sale starts now','with its own text');
select throws_ok($$select public.admin_assign_inbox_message(pg_temp.id(10),current_setting('test.quiet')::uuid)$$,'PT409','Only an email waiting for a brand can be assigned','once');
select is(public.admin_assign_inbox_message(pg_temp.id(3),current_setting('test.quiet')::uuid),null::uuid,'a confirmation is assigned');
select is((select count(*)::int from public.competitor_emails where inbox_message_id=pg_temp.id(3)),0,'but never reaches the library');
reset role;
insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, raw_path, raw_sha256, raw_bytes, subject, received_at, synthetic, state)
  select id, pg_temp.k(13), 1, 9013, 'fake/'||pg_temp.k(13)||'.eml', pg_temp.k(13), 10, 'Waiting', now(), true, 'unassigned'
  from public.inbox_mailboxes where key='fake';
insert into public.email_sections(inbox_message_id, ordinal, html, text, kind, words, images)
  values (pg_temp.id(6), 1, '<tr><td>x</td></tr>', 'x', 'text', 1, 0);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_assign_inbox_message(pg_temp.id(13),current_setting('test.real')::uuid)$$,'23514',null,'sample mail never goes to a real brand');

-- A person's own label, apart from the machine's.
select set_config('test.section',(select id::text from public.email_sections where inbox_message_id=pg_temp.id(6)),true);
select lives_ok($$select public.admin_label_section(current_setting('test.section')::uuid,'hero_image')$$,'an admin labels a section by hand');
select is((select owner_block_type||'/'||(owner_labelled_by='00000000-0000-4000-8000-000000000002')::text||'/'||coalesce(block_type,'-')
  from public.email_sections where id=current_setting('test.section')::uuid),'hero_image/true/-','kept apart from the machine label');
select throws_ok($$select public.admin_label_section(current_setting('test.section')::uuid,'carousel')$$,'23514',null,'only the 20 block types or unsure');
select lives_ok($$select public.admin_label_section(current_setting('test.section')::uuid,null)$$,'null clears it');
select throws_ok($$select public.admin_label_section(gen_random_uuid(),'text')$$,'PT409',null,'an unknown section says so');

-- The directory's counts: newsletters only, and the sender domains.
select is((select emails||'/'||array_to_string(senders,',') from public.admin_inbox_brand_counts() where capture_id=current_setting('test.north')::uuid),
  '3/news.fir.example','a brand counts its newsletters (not its confirmations) and lists its senders');

select * from finish();
rollback;
