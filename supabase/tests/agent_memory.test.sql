begin;
select no_plan();
-- MEM-001. Tenant 101 owner = ...001, staff = ...005; tenant 102 owner = ...004; operator = ...002. Synthetic seed only.

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.brand_rule',public.add_memory_rule(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','kind','dont','rule','Do not lead with a discount in the subject',
  'why','Fewer opens over 6 sends','confidence',0.8,'source','results','evidenceCount',6,'idempotencyKey','learn:101:subject-discount'))::text,true);
select is(public.add_memory_rule(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','kind','dont','rule','Do not lead with a discount in the subject',
  'confidence',0.8,'source','results','idempotencyKey','learn:101:subject-discount'))::text,current_setting('test.brand_rule'),
  'a retried learning job gets the same rule back');
select is((select count(*) from public.agent_memory_rules where idempotency_key='learn:101:subject-discount'),1::bigint,'no duplicate rule');
select set_config('test.global_rule',public.add_memory_rule(jsonb_build_object(
  'kind','do','rule','Put the main button above the fold','confidence',0.7,'source','seed','industry','skincare',
  'appliesTo',null,'evidence',null,'idempotencyKey','seed:skincare:button'))::text,true);
select ok(current_setting('test.global_rule') <> '','JSON null lists fall back to empty');
select throws_ok($$select public.add_memory_rule(jsonb_build_object('kind','maybe','rule','x is not a rule','confidence',0.5,'source','seed','idempotencyKey','bad:kind:1'))$$,
  '23514',null,'a rule must be a do or a dont');
select throws_ok($$select public.add_memory_rule(jsonb_build_object('kind','do','rule','Valid rule text','confidence',15,'source','seed','idempotencyKey','bad:conf:1'))$$,
  '23514',null,'confidence stays between 0 and 1');
select is(public.save_brand_book('00000000-0000-4000-8000-000000000101','{"returns":"30 days"}'::jsonb,'brand-strategist'),1,'first Brand book is version 1');
select is(public.save_brand_book('00000000-0000-4000-8000-000000000101','{"returns":"60 days"}'::jsonb,'brand-strategist'),2,'next Brand book is version 2');
select throws_ok($$select public.save_brand_book(gen_random_uuid(),'{}'::jsonb,'x')$$,'42501',null,'no Brand book for an unknown workspace');
select set_config('test.run_key',gen_random_uuid()::text,true);
select set_config('test.run',public.record_agent_run(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','agent','section-tagger','version','v1','callerKey','section:1',
  'promptDigest',repeat('a',64),'ruleIds',jsonb_build_array(current_setting('test.brand_rule')),'verdict','ok','costMicro',58,
  'output','{"family":"hero"}'::jsonb,'runKey',current_setting('test.run_key')))::text,true);
select is(public.record_agent_run(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','agent','section-tagger','version','v1','callerKey','section:1',
  'promptDigest',repeat('a',64),'verdict','ok','runKey',current_setting('test.run_key')))::text,current_setting('test.run'),
  'a retried run write returns the same row');
select ok((select rule_ids=array[current_setting('test.brand_rule')::uuid] and cost_micro=58 from public.agent_runs where id=current_setting('test.run')::uuid),'run log keeps the rules used and the cost');
select lives_ok($$select public.record_agent_run(jsonb_build_object('agent','section-tagger','version','v1','callerKey','platform:1',
  'promptDigest',repeat('b',64),'verdict','ok','ruleIds',null,'runKey',gen_random_uuid()))$$,'platform runs (no workspace) are logged');
select throws_ok($$select public.record_agent_run(jsonb_build_object('agent','a','version','v','callerKey','k','promptDigest','not-a-digest','verdict','ok','runKey',gen_random_uuid()))$$,
  '23514',null,'a run needs a real prompt digest');

-- Rule updates: revision checked, retired is final.
select is(public.update_memory_rule(current_setting('test.brand_rule')::uuid,1,'active',0.6),2,'the worker weakens a rule');
select throws_ok($$select public.update_memory_rule(current_setting('test.brand_rule')::uuid,1,'active',0.5)$$,'PT409',null,'a stale revision is a conflict');
select is(public.update_memory_rule(current_setting('test.brand_rule')::uuid,2,'retired',0.6),3,'results retire the rule');
select throws_ok($$select public.update_memory_rule(current_setting('test.brand_rule')::uuid,3,'active',0.9)$$,'PT409',null,'a retired rule cannot come back');
select throws_ok($$select public.update_memory_rule(current_setting('test.brand_rule')::uuid,3,'paused',0.9)$$,'23514',null,'only known statuses');
select throws_ok($$select public.update_memory_rule(gen_random_uuid(),1,'retired',0.1)$$,'42501',null,'a missing rule is unavailable');

-- The worker writes only through the commands.
select throws_ok($$delete from public.agent_runs$$,'42501',null,'the worker cannot delete runs directly');
select throws_ok($$update public.agent_memory_rules set confidence=1$$,'42501',null,'the worker cannot change rules directly');

-- A caller with no role is refused.
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.record_agent_run(jsonb_build_object('runKey',gen_random_uuid()))$$,'42501',null,'no role, no write');

-- Owners read their own rules, Brand books and runs; never platform rows or other brands.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules),1::bigint,'owner sees only their own rule, not the platform rule');
select is((select max(version) from public.brand_books),2,'owner sees their Brand book versions');
select is((select count(*) from public.agent_runs),1::bigint,'owner sees their own run, not the platform run');
select throws_ok($$select public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101','kind','do','rule','Owner-made rule','confidence',1,'source','seed','idempotencyKey','owner:1'))$$,
  '42501',null,'owners cannot write rules');
select throws_ok($$select public.save_brand_book('00000000-0000-4000-8000-000000000101','{}'::jsonb,'x')$$,'42501',null,'owners cannot overwrite the Brand book');
select throws_ok($$insert into public.agent_memory_rules(kind,rule,confidence,source,idempotency_key) values('do','Inserted directly',1,'seed','direct:1')$$,'42501',null,'no direct inserts');
select throws_ok($$update public.brand_books set content='{}'::jsonb$$,'42501',null,'no direct updates');
select throws_ok($$delete from public.agent_runs$$,'42501',null,'no direct deletes');

-- Staff see the brand's rules and Brand book, but not AI cost and output.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_runs),0::bigint,'staff cannot read AI runs and their cost');
select is((select count(*) from public.agent_memory_rules),1::bigint,'staff can read the brand rules');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules)+(select count(*) from public.brand_books)+(select count(*) from public.agent_runs),0::bigint,
  'another brand''s owner sees nothing');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules),2::bigint,'an operator sees brand and platform rules');
select is((select count(*) from public.agent_runs),2::bigint,'an operator sees brand and platform runs');
select is((select count(*) from public.brand_books),2::bigint,'an operator sees Brand books');

select * from finish();
rollback;
