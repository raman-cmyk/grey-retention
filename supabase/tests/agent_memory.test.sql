begin;
select no_plan();
-- MEM-001 part 2. Tenant 101 owner = ...001; tenant 102 owner = ...004; operator = ...002. Synthetic seed only.

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.brand_rule',public.add_memory_rule(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','kind','dont','rule','Do not lead with a discount in the subject',
  'why','Fewer opens over 6 sends','confidence',0.8,'source','results','evidenceCount',6))::text,true);
select set_config('test.global_rule',public.add_memory_rule(jsonb_build_object(
  'kind','do','rule','Put the main button above the fold','confidence',0.7,'source','seed','industry','skincare'))::text,true);
select throws_ok($$select public.add_memory_rule(jsonb_build_object('kind','maybe','rule','x is not a rule','confidence',0.5,'source','seed'))$$,
  '23514',null,'a rule must be a do or a dont');
select throws_ok($$select public.add_memory_rule(jsonb_build_object('kind','do','rule','Valid rule text','confidence',1.5,'source','seed'))$$,
  '23514',null,'confidence stays between 0 and 1');
select is(public.save_brand_book('00000000-0000-4000-8000-000000000101','{"returns":"30 days"}'::jsonb,'brand-strategist'),1,'first Brand book is version 1');
select is(public.save_brand_book('00000000-0000-4000-8000-000000000101','{"returns":"60 days"}'::jsonb,'brand-strategist'),2,'next Brand book is version 2');
select set_config('test.run',public.record_agent_run(jsonb_build_object(
  'tenantId','00000000-0000-4000-8000-000000000101','agent','section-tagger','version','v1','callerKey','section:1',
  'promptDigest',repeat('a',64),'ruleIds',jsonb_build_array(current_setting('test.brand_rule')),'verdict','ok','costMicro',58,
  'output','{"family":"hero"}'::jsonb))::text,true);
select ok((select rule_ids=array[current_setting('test.brand_rule')::uuid] and cost_micro=58 from public.agent_runs where id=current_setting('test.run')::uuid),'run log keeps the rules used and the cost');
select throws_ok($$select public.record_agent_run(jsonb_build_object('agent','a','version','v','callerKey','k','promptDigest','not-a-digest','verdict','ok'))$$,
  '23514',null,'a run needs a real prompt digest');
select lives_ok($$select public.update_memory_rule(current_setting('test.brand_rule')::uuid,'active',0.6)$$,'the worker can weaken a rule');
select throws_ok($$select public.update_memory_rule(gen_random_uuid(),'retired',0.1)$$,'PT409',null,'updating a missing rule is a conflict');

-- Owners read their own rules, Brand books and runs; never platform rules or other brands.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules),1::bigint,'owner sees only their own rule, not the platform rule');
select is((select max(version) from public.brand_books),2,'owner sees their Brand book versions');
select is((select count(*) from public.agent_runs),1::bigint,'owner sees their own runs');
select throws_ok($$select public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101','kind','do','rule','Owner-made rule','confidence',1,'source','seed'))$$,
  '42501',null,'owners cannot write rules directly');
select throws_ok($$select public.save_brand_book('00000000-0000-4000-8000-000000000101','{}'::jsonb,'x')$$,'42501',null,'owners cannot overwrite the Brand book');
select throws_ok($$insert into public.agent_memory_rules(kind,rule,confidence,source) values('do','Inserted directly',1,'seed')$$,'42501',null,'no direct inserts');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules)+(select count(*) from public.brand_books)+(select count(*) from public.agent_runs),0::bigint,
  'another brand''s owner sees nothing');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_memory_rules),2::bigint,'an operator sees brand and platform rules');

select * from finish();
rollback;
