begin;
select plan(24);

-- Brands: one with an approved Observer original, one Observer has not
-- collected, one holding an email from the earlier inbox (not Observer),
-- and one already requested a while ago.
insert into public.competitor_captures(domain,synthetic,alias_slug)
values ('curated-observer.test',false,'observer-curated'),('uncurated-observer.test',false,'observer-uncurated'),
  ('legacy-inbox.test',false,'legacy-inbox');
insert into public.competitor_captures(domain,synthetic,subscription_status,pending_since)
values ('pending-already.test',false,'pending','2026-01-01T00:00:00Z');
-- Tests are isolated transactions; an earlier inbox test cannot seed this mailbox.
insert into public.inbox_mailboxes(key,transport) values ('gmail','gmail_imap') on conflict (key) do nothing;
insert into public.inbox_messages(mailbox_id,message_key,uidvalidity,uid,transport_id,raw_path,raw_sha256,raw_bytes,received_at,synthetic,state,method,capture_id)
select m.id,repeat('a',64),999001,999001,'observer:fixture-email','gmail/'||repeat('a',64)||'.eml',repeat('a',64),100,now(),false,'assigned','alias',c.id
from public.inbox_mailboxes m,public.competitor_captures c where m.key='gmail' and c.domain='curated-observer.test';
insert into public.inbox_messages(mailbox_id,message_key,uidvalidity,uid,transport_id,raw_path,raw_sha256,raw_bytes,received_at,synthetic,state,method,capture_id)
select m.id,repeat('b',64),999001,999002,'999002','gmail/'||repeat('b',64)||'.eml',repeat('b',64),100,now(),false,'assigned','alias',c.id
from public.inbox_mailboxes m,public.competitor_captures c where m.key='gmail' and c.domain='legacy-inbox.test';
insert into public.competitor_emails(capture_id,external_id,received_at,subject,text_content,safe_html,micro,synthetic,inbox_message_id)
select c.id,'msg:legacy',now(),'Legacy newsletter','Hello','<p>Hello</p>','{}'::jsonb,false,m.id
from public.competitor_captures c,public.inbox_messages m where c.domain='legacy-inbox.test' and m.message_key=repeat('b',64);
-- Workspace 101 is a real store; 102 stays a sample store for now.
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000101';

select is((select count(*)::int from public.inbox_messages where transport_id='observer:fixture-email'),1,'the fixture includes one approved original');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- GROS-INS-002: a real brand Observer has not collected yet is a request, not a refusal.
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','uncurated-observer.test')$$,'the owner may request a real brand without an Observer original');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','brand-new-request.test')$$,'the owner may request a real brand nobody has seen yet');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'the owner may follow a real brand admitted by Observer');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','pending-already.test')$$,'the owner may follow a brand already requested by another store');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','legacy-inbox.test')$$,'23514',null,'a brand holding an email that no person rated through Observer is never followed');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','curated-observer.test')$$,'42501',null,'a different workspace cannot be selected without its owner authority');
reset role;

select is((select subscription_status from public.competitor_captures where domain='uncurated-observer.test'),'pending','a requested brand waits for Observer');
select ok((select pending_since is not null and alias_slug='observer-uncurated' from public.competitor_captures where domain='uncurated-observer.test'),'a request records when it was asked for and keeps an existing alias');
-- The inbox worker's own alias for this website (SHA-256 in Node).
select is((select alias_slug from public.competitor_captures where domain='brand-new-request.test'),'observer-0aef8bb4296ad3b5f8ce137d','a new request gets the alias the inbox worker uses');
select ok((select not synthetic and subscription_status='pending' and brand_name='brand-new-request.test' from public.competitor_captures where domain='brand-new-request.test'),'a new request is a real, pending brand named after its website');
select is((select subscription_status from public.competitor_captures where domain='curated-observer.test'),'not_subscribed','following a curated brand is not a new request');
select is((select pending_since from public.competitor_captures where domain='pending-already.test'),'2026-01-01T00:00:00Z'::timestamptz,'an existing request keeps when it was first asked for');
select is((select revision from public.competitor_subscriptions s join public.competitor_captures c on c.id=s.capture_id where s.tenant_id='00000000-0000-4000-8000-000000000101' and c.domain='curated-observer.test'),1,'following a new brand starts at revision one');

-- Three requests so far today (the curated brand is not one); six stopped ones make nine.
insert into public.competitor_captures(domain,synthetic)
select 'stopped-request-'||n||'.test',false from generate_series(1,6) n;
insert into public.competitor_subscriptions(tenant_id,capture_id,label,private_rules,created_by,active)
select '00000000-0000-4000-8000-000000000101',c.id,c.domain,'','00000000-0000-4000-8000-000000000001',false
from public.competitor_captures c where c.domain like 'stopped-request-%.test';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','tenth-request.test')$$,'the tenth new request in a day is accepted');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','one-too-many.test')$$,'PT429',null,'the eleventh new request in a day is refused');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','stopped-request-1.test')$$,'following a stopped request again is not a new request');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','sample-at-cap.example')$$,'a sample brand never counts as a request');
-- Workspace 102 is a sample store: it cannot ask for a real brand.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','sample-store-request.test')$$,'PT403',null,'a sample store cannot ask for a real brand');
reset role;
select ok((select subscription_status='pending' from public.competitor_captures where domain='stopped-request-1.test'),'a stopped brand followed again is requested again');
select ok((select subscription_status='not_subscribed' and alias_slug is null from public.competitor_captures where domain='sample-at-cap.example'),'a sample brand gets no Observer alias and no request');
update public.brand_profiles set synthetic=false where tenant_id='00000000-0000-4000-8000-000000000102';
-- Observer handles its requests: a week-old one raises no "subscribe again" task.
update public.competitor_captures set pending_since=now()-interval '8 days' where domain='uncurated-observer.test';
select is(public.check_pending_subscriptions(),0,'an Observer request never raises the manual sign-up task');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','other-workspace-request.test')$$,'the daily limit is per workspace');
reset role;
set local role anon;
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'42501',null,'anonymous callers cannot follow curated brands');
reset role;
select * from finish();
rollback;
