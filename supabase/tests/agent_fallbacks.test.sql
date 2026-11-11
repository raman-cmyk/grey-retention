begin;
select plan(30);

-- Workspace 101 (owner ...01, campaign ...601), workspace 102 (campaign ...602),
-- platform admin ...02.
select ok(not has_table_privilege('authenticated','public.agent_fallbacks','insert,update,delete,truncate'),'members cannot write the fallback log');
select ok(not has_table_privilege('anon','public.agent_fallbacks','select'),'anon cannot read the fallback log');
select ok(not has_function_privilege('anon','public.record_fallback(uuid,uuid,text,text,text,text,integer,jsonb,text)','execute'),'anon cannot record a fallback');
select ok(not has_function_privilege('authenticated','public.record_fallback(uuid,uuid,text,text,text,text,integer,jsonb,text)','execute'),'members cannot record a fallback');
select ok(has_function_privilege('service_role','public.record_fallback(uuid,uuid,text,text,text,text,integer,jsonb,text)','execute'),'jobs record fallbacks');
select ok(not has_function_privilege('anon','public.admin_fallback_log(integer)','execute'),'anon cannot open the admin view');

-- A job records a copy check that kept failing.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.entry',public.record_fallback('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',
  'copy_check','copy_check_failed','The copy failed the brand check 3 times: a price that is not in the catalog.',
  'Kept the email out of Klaviyo and used plainer copy.',3,'{"rules":["price"]}','copy_check:601:1')::text,true);
select is((select row(agent,reason_code,attempts,occurrences,detail)::text from public.agent_fallbacks where id=current_setting('test.entry')::uuid),
  row('copy_check','copy_check_failed',3,1,'{"rules":["price"]}'::jsonb)::text,'the entry says which agent, why, and how many tries');
-- The same problem again keeps one row and counts it.
select is(public.record_fallback('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000601',
  'copy_check','copy_check_failed','  The copy failed again: a banned claim.  ',
  'Used plainer copy.',3,'{"rules":["claim"]}','copy_check:601:1'),current_setting('test.entry')::uuid,'a repeat updates the same entry');
select is((select row(occurrences,reason,fallback,detail)::text from public.agent_fallbacks where id=current_setting('test.entry')::uuid),
  row(2,'The copy failed again: a banned claim.','Used plainer copy.','{"rules":["claim"]}'::jsonb)::text,'it counts the repeat and keeps the latest reason');
-- The same key in another workspace is another problem.
select isnt(public.record_fallback('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000602',
  'copy_check','copy_check_failed','The copy failed the brand check 3 times.','Used plainer copy.',3,'{}','copy_check:601:1'),current_setting('test.entry')::uuid,'workspaces never share an entry');
-- Platform-wide work has no workspace, and still keeps one row per problem.
select set_config('test.platform',public.record_fallback(null,null,'section_tagger','tag_unsure','Two labels were below the confidence floor.','Stored the section as untagged.',2,'{}','tagger:abc')::text,true);
select is(public.record_fallback(null,null,'section_tagger','tag_unsure','Still unsure.','Stored the section as untagged.',2,'{}','tagger:abc'),current_setting('test.platform')::uuid,'a platform entry also keeps one row per problem');

-- Bad input is refused.
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000602','copy_check','copy_check_failed','Reason.','Fallback.',1,'{}','k1')$$,'22023','That campaign is not in this workspace.','a campaign from another workspace is refused');
select throws_ok($$select public.record_fallback(null,'00000000-0000-4000-8000-000000000601','copy_check','copy_check_failed','Reason.','Fallback.',1,'{}','k2')$$,'22023','A campaign fallback needs its workspace.','a campaign needs its workspace');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-0000000009ff',null,'copy_check','copy_check_failed','Reason.','Fallback.',1,'{}','k3')$$,'22023','Unknown workspace.','an unknown workspace is refused');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'Copy Check','copy_check_failed','Reason.','Fallback.',1,'{}','k4')$$,'23514',null,'the agent must be a short key');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'copy_check','copy_check_failed','   ','Fallback.',1,'{}','k5')$$,'23514',null,'a reason is required');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'copy_check','copy_check_failed','Reason.','Fallback.',11,'{}','k6')$$,'23514',null,'attempts stay small');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'copy_check','copy_check_failed','Reason.','Fallback.',1,'[]','k7')$$,'23514',null,'detail must be an object');
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'copy_check','copy_check_failed','Reason.',null,1,'{}','k8')$$,'22023',null,'what was done instead is required');
reset role;

-- Members cannot record one, even for their own workspace.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101',null,'copy_check','copy_check_failed','Reason.','Fallback.',1,'{}','k9')$$,'42501',null,'an owner cannot write the log');
select is((select count(*) from public.agent_fallbacks),0::bigint,'an owner does not read the log');
select throws_ok($$select * from public.admin_fallback_log()$$,'42501',null,'an owner cannot open the admin view');
reset role;

-- A platform admin reads every entry (names read here: admins cannot read workspaces).
select set_config('test.n101',(select name from public.tenants where id='00000000-0000-4000-8000-000000000101'),true);
select set_config('test.n102',(select name from public.tenants where id='00000000-0000-4000-8000-000000000102'),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.agent_fallbacks),3::bigint,'an admin reads the whole log');
select is((select count(*) from public.agent_fallbacks where tenant_id is null),1::bigint,'including platform-wide entries');
select is((select array_agg(coalesce(workspace,'(platform)') order by workspace nulls first) from public.admin_fallback_log()),
  array['(platform)']||(select array_agg(n order by n) from unnest(array[current_setting('test.n101'),current_setting('test.n102')]) n),
  'the admin view names each workspace');
select is((select count(*) from public.admin_fallback_log(1)),1::bigint,'the admin view takes a row limit');
select is((select reason from public.admin_fallback_log() where workspace=current_setting('test.n102')),'The copy failed the brand check 3 times.','with the reason in plain words');
reset role;

-- Deleting a campaign removes its entries.
insert into public.campaigns(id,tenant_id,title,channel,planned_at,timezone,created_by,synthetic) values
('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-000000000101','Short-lived email','email_design',now()+interval '3 days','UTC','00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select lives_ok($$select public.record_fallback('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-00000000f001','assembly','focus_unavailable','The product is out of stock.','Skipped this email.',1,'{}','assembly:f001')$$,'a job records an assembly fallback');
reset role;
delete from public.campaigns where id='00000000-0000-4000-8000-00000000f001';
select is((select count(*) from public.agent_fallbacks where dedupe_key='assembly:f001'),0::bigint,'a deleted campaign takes its entries with it');
select is((select count(*) from public.agent_fallbacks),3::bigint,'other entries stay');

select * from finish();
rollback;
