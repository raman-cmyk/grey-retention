begin;
select plan(9);

-- REL-084: a workspace's members read their own workspace's fallbacks.
-- Workspace 101: owner ...01, staff ...05, admin ...06. Workspace 102:
-- owner ...04. Platform admin ...02.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'email-build','copy_failed',
  'Plain copy failed the code checks: price.','No email was built; the owner can create it again.',1,'{}','email-build:b1');
select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'content-locker','content_replaced',
  'a planned product is no longer in the catalog.','used another product.',0,'{}','content-locker:replaced:b1');
select public.record_fallback('00000000-0000-4000-8000-000000000102',null,'email-build','copy_failed',
  'Plain copy failed the code checks: claim.','No email was built; the owner can create it again.',1,'{}','email-build:b2');
select public.record_fallback(null,null,'section-tagger','tag_unsure','Two labels were below the confidence floor.',
  'Stored the section as untagged.',2,'{}','tagger:x');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks),2::bigint,'the owner reads their workspace''s fallbacks');
select is((select count(*) from public.agent_fallbacks where tenant_id is null),0::bigint,'but not the platform''s own');
select is((select reason from public.agent_fallbacks where dedupe_key='content-locker:replaced:b1'),
  'a planned product is no longer in the catalog.','with its plain reason');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks),2::bigint,'staff read them too');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace reads none of them');
select is((select count(*) from public.agent_fallbacks),1::bigint,'only its own');
select throws_ok($$update public.agent_fallbacks set reason='x'$$,'42501',null,'members still cannot change the log');
reset role;

-- A member the workspace removed reads nothing any more.
update public.tenant_memberships set status='inactive'
  where tenant_id='00000000-0000-4000-8000-000000000101' and profile_id='00000000-0000-4000-8000-000000000005';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks),0::bigint,'a removed member reads nothing');
reset role;

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks),4::bigint,'platform admins still read every entry');
reset role;

select * from finish();
rollback;
