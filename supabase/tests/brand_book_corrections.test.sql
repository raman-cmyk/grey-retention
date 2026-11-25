begin;
select no_plan();
-- ONB-058 (owner only since UI-BRAND-2). Tenant 101: owner ...001, admin ...006, staff ...005. Tenant 102 owner ...004. Operator ...002. Synthetic seed only.

-- Grants: members read, nobody writes directly, the worker reads.
select ok(not has_table_privilege('authenticated','public.brand_book_corrections','insert,update,delete,truncate,references,trigger,maintain'),'members cannot write corrections directly');
select ok(not has_table_privilege('anon','public.brand_book_corrections','select'),'visitors cannot read corrections');
select ok(has_table_privilege('service_role','public.brand_book_corrections','select')
  and not has_table_privilege('service_role','public.brand_book_corrections','insert,update,delete,truncate,references,trigger,maintain'),'the worker reads corrections and writes none');
select ok(not has_function_privilege('anon','public.correct_brand_book(uuid,text,text,text,text)','execute')
  and not has_function_privilege('service_role','public.correct_brand_book(uuid,text,text,text,text)','execute'),'only members can correct');
select ok(not has_function_privilege('anon','public.withdraw_brand_book_correction(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.withdraw_brand_book_correction(uuid,uuid)','execute'),'only members can withdraw');
select ok(not has_function_privilege('authenticated','private.record_brand_book_correction()','execute')
  and not has_function_privilege('authenticated','private.brand_fact_ok(text,text)','execute'),'the helpers are not callable');

-- The owner corrects lines.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Loud and bold.','replace','Calm and plain.'),null,'the owner replaces a line');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','marketing','Runs a summer sale.','remove',null),null,'and removes one');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering',null,'add','Linen clothing made in Portugal.'),null,'and adds one of his own');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.returnDays',null,'replace','30'),null,'and sets a fact');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.freeShipping',null,'replace','over 75'),null,'free shipping over an amount');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.deliveryDays',null,'replace','3-7'),null,'a delivery window');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.guaranteeDays',null,'remove',null),null,'and says there is no guarantee to state');
select is((select count(*)::integer from public.brand_book_corrections where withdrawn_at is null),7,'seven live corrections');

-- A newer correction of the same line withdraws the older.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Loud and bold.','replace','Quiet and warm.'),null,'the owner changes his mind');
select is((select value from public.brand_book_corrections where section = 'voice' and withdrawn_at is null),'Quiet and warm.','only the newer one is live');
select is((select count(*)::integer from public.brand_book_corrections where section = 'voice'),2,'the older one is kept, withdrawn');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering',null,'add','linen clothing made in portugal.')$$,'PT409',null,'the same added line twice is a conflict');

-- Withdrawing.
select lives_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where section = 'marketing' and withdrawn_at is null))$$,'the owner takes a correction back');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where section = 'marketing'))$$,'PT409',null,'taking it back twice is a conflict');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000ffff')$$,'PT409',null,'so is an unknown one');

-- The same line whatever its case and spacing.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','  LOUD   and bold. ','replace','Plain and warm.'),null,'the same line in other case and spacing');
select is((select count(*)::integer from public.brand_book_corrections where section = 'voice' and withdrawn_at is null),1,'withdraws the older correction');
select is((select value from public.brand_book_corrections where section = 'voice' and withdrawn_at is null),'Plain and warm.','the newest one is live');
select ok((select bool_and(replaced) from public.brand_book_corrections where section = 'voice' and withdrawn_at is not null),'replaced, not taken back');

-- A line the owner added: changing it adds his new words, removing it takes it back.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering','linen clothing MADE in portugal.','replace','Linen made in Porto.'),null,'he changes his own line');
select is((select value from public.brand_book_corrections where section = 'offering' and withdrawn_at is null),'Linen made in Porto.','his new words are the added line');
select is((select action from public.brand_book_corrections where section = 'offering' and withdrawn_at is null),'add','still an added line');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering','Linen made in Porto.','remove',null),null,'he removes his own line');
select is((select count(*)::integer from public.brand_book_corrections where section = 'offering' and withdrawn_at is null),0,'it is taken back');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering',null,'add','Linen made in Porto.'),null,'and can be added again');

-- At most 20 added lines per section.
select lives_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','customers.love',null,'add','Line ' || n) from generate_series(1,20) n$$,'twenty added lines');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','customers.love',null,'add','One more')$$,'PT409',null,'not a twenty-first');

-- Checks.
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.',null,'x')$$,'23514',null,'an action is needed');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','replace',E'\n\t ')$$,'23514',null,'blank words are no words');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.deliveryDays',null,'replace','3-95')$$,'23514',null,'delivery in at most 90 days');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.deliveryDays',null,'replace','0-0')$$,'23514',null,'and at least 1');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice',null,'remove',null)$$,'23514',null,'a line to remove needs its words');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','remove','x')$$,'23514',null,'removing takes no new words');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','replace',null)$$,'23514',null,'replacing needs new words');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','replace','  ')$$,'23514',null,'and not blank ones');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','add','x')$$,'23514',null,'an added line has no original');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.returnDays','30 days','replace','14')$$,'23514',null,'a fact has no original line');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.returnDays',null,'add','14')$$,'23514',null,'a fact is never added');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.returnDays',null,'replace','two weeks')$$,'23514',null,'days are a number');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.returnDays',null,'replace','4000')$$,'23514',null,'at most ten years');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.freeShipping',null,'replace','over $75')$$,'23514',null,'free shipping is always, never or over an amount');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.deliveryDays',null,'replace','7-3')$$,'23514',null,'a window starts before it ends');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','facts.deliveryDays',null,'replace','3-120')$$,'23514',null,'at most 90 days');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','products','x','remove',null)$$,'23514',null,'only the sections a correction may change');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','rewrite','x')$$,'23514',null,'only remove, replace or add');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Calm.','replace',repeat('x',301))$$,'23514',null,'at most 300 characters');
select throws_ok($$update public.brand_book_corrections set value = 'x'$$,'42501',null,'no direct update');
select throws_ok($$insert into public.brand_book_corrections (tenant_id, section, action, value) values ('00000000-0000-4000-8000-000000000101','voice','add','x')$$,'42501',null,'no direct insert');

-- The change history.
reset role;
select is((select count(*)::integer from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'brand_book_corrected'),31,'each correction is in the change history');
select is((select count(*)::integer from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'brand_book_correction_withdrawn'),2,'and each one taken back, never one a newer correction replaced');
select ok((select bool_and(e.actor_id = '00000000-0000-4000-8000-000000000001' and e.entity_id = c.id)
  from public.workspace_events e join public.brand_book_corrections c on c.id = e.entity_id
  where e.kind like 'brand_book_%'),'each names who did it and which correction');
select is((select detail from public.workspace_events where kind = 'brand_book_corrected' and detail->>'section' = 'facts.returnDays'),'{"action": "replace", "section": "facts.returnDays", "value": "30"}'::jsonb,'a fact says its checked value');
select is((select detail from public.workspace_events where kind = 'brand_book_corrected' order by created_at limit 1),'{"action": "replace", "section": "voice"}'::jsonb,'only the section and action, never the words');

-- UI-BRAND-2: the owner only. An admin, staff, another workspace and the
-- operator may not (a correction reaches the agents as the owner's words).
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','customers.who',null,'add','Women who travel.')$$,'42501',null,'an admin cannot correct');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where withdrawn_at is null limit 1))$$,'42501',null,'nor take one back');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice',null,'add','Fun.')$$,'42501',null,'staff cannot correct');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where withdrawn_at is null limit 1))$$,'42501',null,'nor take one back');
select is((select count(*)::integer from public.brand_book_corrections),31,'staff read the corrections');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice',null,'add','Fun.')$$,'42501',null,'another workspace cannot correct');
select is((select count(*)::integer from public.brand_book_corrections),0,'nor read them');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-00000000ffff')$$,'42501',null,'nor take one back');
reset role;
create temp table other_live as select id from public.brand_book_corrections where tenant_id = '00000000-0000-4000-8000-000000000101' and withdrawn_at is null and section = 'voice';
grant select on other_live to authenticated;
set local role authenticated;
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000102',(select id from other_live))$$,'PT409',null,'nor through its own workspace');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','voice','Loud and bold.','replace','Its own words.'),null,'its own correction of the same words');
reset role;
select is((select count(*)::integer from public.brand_book_corrections where id = (select id from other_live) and withdrawn_at is null),1,'leaves the other workspace''s correction live');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice',null,'add','Fun.')$$,'42501',null,'the operator cannot correct');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where tenant_id = '00000000-0000-4000-8000-000000000101' and withdrawn_at is null limit 1))$$,'42501',null,'nor take one back');
select is((select count(*)::integer from public.brand_book_corrections),32,'but reads them, every workspace''s');

select * from finish();
rollback;
