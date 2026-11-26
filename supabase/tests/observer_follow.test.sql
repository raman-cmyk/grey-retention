begin;
select plan(7);

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
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','uncurated-observer.test')$$,'23514',null,'a real brand without an Observer original is refused');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'the owner may follow a real brand admitted by Observer');
select is((select synthetic from public.competitor_captures where domain='curated-observer.test'),false,'the existing real capture remains real');
select is((select revision from public.competitor_subscriptions s join public.competitor_captures c on c.id=s.capture_id where s.tenant_id='00000000-0000-4000-8000-000000000101' and c.domain='curated-observer.test'),1,'following a new brand starts at revision one');
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','curated-observer.test')$$,'42501',null,'a different workspace cannot be selected without its owner authority');
reset role;
set local role anon;
select throws_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','curated-observer.test')$$,'42501',null,'anonymous callers cannot follow curated brands');
reset role;
select * from finish();
rollback;
