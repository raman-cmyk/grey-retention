begin;
select no_plan();
-- UI-LRNa. Tenant 101 owner = ...001, staff = ...005, admin = ...006; tenant 102 owner = ...004. Synthetic seed only.

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.a',public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101',
  'kind','do','rule','Lead with one product','confidence',0.8,'source','results','idempotencyKey','lrn:101:a'))::text,true);
select set_config('test.b',public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101',
  'kind','dont','rule','Avoid all caps subjects','confidence',0.7,'source','inspector','idempotencyKey','lrn:101:b'))::text,true);
-- Low confidence and past its end: agents do not read it unless it is pinned.
select set_config('test.c',public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101',
  'kind','do','rule','Send on Sunday mornings','confidence',0.3,'source','results','expiresAt',now()-interval '1 day',
  'idempotencyKey','lrn:101:c'))::text,true);
select set_config('test.other',public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000102',
  'kind','do','rule','Show the vase first','confidence',0.9,'source','results','idempotencyKey','lrn:102:a'))::text,true);
select set_config('test.global',public.add_memory_rule(jsonb_build_object(
  'kind','do','rule','Keep one main button','confidence',0.9,'source','seed','idempotencyKey','lrn:global:a'))::text,true);
select set_config('test.industry',public.add_memory_rule(jsonb_build_object('industry','apparel',
  'kind','dont','rule','No size charts in the hero','confidence',0.9,'source','seed','idempotencyKey','lrn:apparel:a'))::text,true);
select ok((select bool_and(not pinned and retired_by is null and retired_at is null) from public.agent_memory_rules),'rules start unpinned and not removed');

-- Staff and admins read the rules but cannot change them.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,true)$$,'42501',null,'staff cannot pin');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1)$$,'42501',null,'staff cannot remove');
select throws_ok($$update public.agent_memory_rules set pinned=true$$,'42501',null,'staff cannot pin directly');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,true)$$,'42501',null,'an admin cannot pin');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1)$$,'42501',null,'an admin cannot remove');

-- Another workspace's owner reaches neither the workspace nor its rules.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,true)$$,'42501',null,'another owner cannot pin in this workspace');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000102',current_setting('test.a')::uuid,1,true)$$,'42501',null,'another owner cannot pin this workspace''s rule from their own');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000102',current_setting('test.a')::uuid,1)$$,'42501',null,'another owner cannot remove this workspace''s rule');

-- The platform operator reads every rule but changes none.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,true)$$,'42501',null,'the operator cannot pin');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1)$$,'42501',null,'the operator cannot remove');

-- The owner pins, with the revision the page read.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,true),2,'the owner pins a rule');
select ok((select pinned from public.agent_memory_rules where id=current_setting('test.a')::uuid),'the rule is pinned');
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,2,true),2,'pinning twice changes nothing');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,1,false)$$,'PT409',null,'a stale revision is a conflict');
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,2,false),3,'the owner unpins it');
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,2,false),3,'a retried unpin, read before the first, is not a conflict');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,3,null)$$,'23514',null,'pin or unpin, nothing else');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,null,true)$$,'23514',null,'pin needs the revision read');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.a')::uuid,null)$$,'23514',null,'remove needs the revision read');

-- Platform, industry and other workspaces' rules are out of reach.
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.global')::uuid,1,true)$$,'42501',null,'a global rule cannot be pinned');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.global')::uuid,1)$$,'42501',null,'a global rule cannot be removed');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.industry')::uuid,1,true)$$,'42501',null,'an industry rule cannot be pinned');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.industry')::uuid,1)$$,'42501',null,'an industry rule cannot be removed');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.other')::uuid,1)$$,'42501',null,'another workspace''s rule cannot be removed');

-- Browser roles still never write the table directly.
select throws_ok($$update public.agent_memory_rules set pinned=true$$,'42501',null,'the owner cannot pin directly');
select throws_ok($$update public.agent_memory_rules set status='retired'$$,'42501',null,'the owner cannot remove directly');
select throws_ok($$delete from public.agent_memory_rules$$,'42501',null,'the owner cannot delete rules');

-- Remove retires the rule (pinned or not) and records that the owner did it.
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.b')::uuid,1,true),2,'the owner pins the rule first');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.b')::uuid,1)$$,'PT409',null,'a stale remove is a conflict');
select is(public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.b')::uuid,2),3,'the owner removes the pinned rule at its new revision');
select ok((select status='retired' and retired_by='00000000-0000-4000-8000-000000000001'::uuid and retired_at is not null and not pinned
  from public.agent_memory_rules where id=current_setting('test.b')::uuid),'the rule is retired and unpinned, by the owner');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.b')::uuid,3)$$,'PT409',null,'a removed rule cannot be removed again');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.b')::uuid,3,true)$$,'PT409',null,'a removed rule cannot be pinned');

-- A pinned rule survives its end date and low confidence in the read.
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.c')::uuid,1,true),2,'the owner pins an old, unsure rule');
-- The filter `inUseFilter` (features/agents/memory.ts) sends, ordered as the Learned page asks.
select results_eq($$select id from public.agent_memory_rules
  where tenant_id='00000000-0000-4000-8000-000000000101' and status='active'
    and (pinned or (confidence >= 0.5 and (expires_at is null or expires_at > now())))
  order by pinned desc, confidence desc$$,
  $$values (current_setting('test.c')::uuid), (current_setting('test.a')::uuid)$$,
  'pinned first and kept past its end; the removed rule is gone');

-- The worker may weaken a pinned rule but never expire or retire it.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select public.update_memory_rule(current_setting('test.c')::uuid,2,'expired',0.3)$$,'PT409',null,'a pinned rule does not expire');
select throws_ok($$select public.update_memory_rule(current_setting('test.c')::uuid,2,'retired',0.3)$$,'PT409',null,'results do not retire a pinned rule');
select is(public.update_memory_rule(current_setting('test.c')::uuid,2,'active',0.1),3,'results can still weaken it');
select is(public.update_memory_rule(current_setting('test.a')::uuid,3,'expired',0.6),4,'an unpinned rule still expires');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.c')::uuid,3,false)$$,'42501',null,'the worker does not pin');
select throws_ok($$select public.retire_memory_rule('00000000-0000-4000-8000-000000000101',current_setting('test.c')::uuid,3)$$,'42501',null,'the worker does not remove');

-- At most 20 pinned rules per workspace.
do $$ begin
  for i in 1..20 loop
    perform public.add_memory_rule(jsonb_build_object('tenantId','00000000-0000-4000-8000-000000000101','kind','do',
      'rule','Extra rule number '||i,'confidence',0.6,'source','results','idempotencyKey','lrn:101:extra:'||i));
  end loop;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',m.id,1,true)
  from public.agent_memory_rules m where m.idempotency_key like 'lrn:101:extra:%' and m.idempotency_key <> 'lrn:101:extra:20'$$,'19 more pins');
select throws_ok($$select public.pin_memory_rule('00000000-0000-4000-8000-000000000101',m.id,1,true)
  from public.agent_memory_rules m where m.idempotency_key = 'lrn:101:extra:20'$$,'PT409','Too many pinned rules','the 21st pin is refused');
do $$ declare d text := 'no error';
begin
  perform public.pin_memory_rule('00000000-0000-4000-8000-000000000101',m.id,1,true)
    from public.agent_memory_rules m where m.idempotency_key = 'lrn:101:extra:20';
  perform set_config('test.detail',d,true);
exception when sqlstate 'PT409' then
  get stacked diagnostics d = pg_exception_detail;
  perform set_config('test.detail',d,true);
end $$;
select is(current_setting('test.detail'),'too_many_pins','the app can tell too many pins from a stale page');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is(public.pin_memory_rule('00000000-0000-4000-8000-000000000102',current_setting('test.other')::uuid,1,true),2,'the limit is per workspace: another owner still pins');

-- Only signed-in members may call the commands.
reset role;
select ok(not has_function_privilege('anon','public.pin_memory_rule(uuid,uuid,integer,boolean)','execute'),'anon cannot pin');
select ok(not has_function_privilege('anon','public.retire_memory_rule(uuid,uuid,integer)','execute'),'anon cannot remove');
select ok(not has_function_privilege('service_role','public.pin_memory_rule(uuid,uuid,integer,boolean)','execute')
  and not has_function_privilege('service_role','public.retire_memory_rule(uuid,uuid,integer)','execute'),'the worker has no grant on the owner commands');
select ok(has_function_privilege('authenticated','public.pin_memory_rule(uuid,uuid,integer,boolean)','execute'),'members may call pin');
select ok(has_function_privilege('authenticated','public.retire_memory_rule(uuid,uuid,integer)','execute'),'members may call remove');

select * from finish();
rollback;
