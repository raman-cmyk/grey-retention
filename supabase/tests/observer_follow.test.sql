begin;
select plan(13);

insert into public.competitor_captures(domain,synthetic,alias_slug)
values ('curated-observer.test',false,'observer-curated'),('uncurated-observer.test',false,'observer-uncurated');
-- Tests are isolated transactions; an earlier inbox test cannot seed this mailbox.
insert into public.inbox_mailboxes(key,transport) values ('gmail','gmail_imap') on conflict (key) do nothing;
insert into public.inbox_messages(mailbox_id,message_key,uidvalidity,uid,transport_id,raw_path,raw_sha256,raw_bytes,received_at,synthetic,state,method,capture_id)
select m.id,repeat('a',64),999001,999001,'observer:fixture-email','gmail/'||repeat('a',64)||'.eml',repeat('a',64),100,now(),false,'assigned','alias',c.id
from public.inbox_mailboxes m,public.competitor_captures c where m.key='gmail' and c.domain='curated-observer.test';

select is((select count(*)::int from public.inbox_messages where transport_id='observer:fixture-email'),1,'the fixture includes one approved original');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- GROS-INS-002: a real brand Observer has not collected yet is a request, not a refusal.
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','uncurated-observer.test')$$,'the owner may request a real brand without an Observer original');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','brand-new-request.test')$$,'the owner may request a real brand nobody has seen yet');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'the owner may follow a real brand admitted by Observer');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','curated-observer.test')$$,'42501',null,'a different workspace cannot be selected without its owner authority');
reset role;

select is((select subscription_status from public.competitor_captures where domain='uncurated-observer.test'),'pending','a requested brand waits for Observer');
select ok((select pending_since is not null and alias_slug='observer-uncurated' from public.competitor_captures where domain='uncurated-observer.test'),'a request records when it was asked for and keeps an existing alias');
select is((select alias_slug from public.competitor_captures where domain='brand-new-request.test'),'observer-'||left(encode(sha256(convert_to('brand-new-request.test','UTF8')),'hex'),24),'a new request gets the alias the inbox worker uses');
select ok((select not synthetic and subscription_status='pending' from public.competitor_captures where domain='brand-new-request.test'),'a new request is a real, pending brand');
select is((select subscription_status from public.competitor_captures where domain='curated-observer.test'),'not_subscribed','following a curated brand is not a new request');
select is((select revision from public.competitor_subscriptions s join public.competitor_captures c on c.id=s.capture_id where s.tenant_id='00000000-0000-4000-8000-000000000101' and c.domain='curated-observer.test'),1,'following a new brand starts at revision one');

-- Two requests so far today; eight stopped ones make ten.
insert into public.competitor_captures(domain,synthetic)
select 'stopped-request-'||n||'.test',false from generate_series(1,8) n;
insert into public.competitor_subscriptions(tenant_id,capture_id,label,private_rules,created_by,active)
select '00000000-0000-4000-8000-000000000101',c.id,c.domain,'','00000000-0000-4000-8000-000000000001',false
from public.competitor_captures c where c.domain like 'stopped-request-%.test';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','one-too-many.test')$$,'PT429',null,'at most 10 new requests a day per workspace');
reset role;
set local role anon;
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'42501',null,'anonymous callers cannot follow curated brands');
reset role;
select * from finish();
rollback;
