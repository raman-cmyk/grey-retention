begin;
select no_plan();
-- Original synthetic content only. Tenant 101 owner = ...001, staff = ...005, team admin = ...006; tenant 102 owner = ...004.
select set_config('test.hostile','<p>Hello</p><script>fetch("https://tracker.example")</script><img src="https://tracker.example/o.gif">',true);
select set_config('test.input',jsonb_build_object('subject','Original pasted note','body',current_setting('test.hostile'),'readable_text','Hello'||chr(10)||chr(10)||'Second'||chr(10)||chr(10)||'Third','source_description','A fictional newsletter','source_url','https://shop.example/spring')::text,true);
select set_config('test.key',gen_random_uuid()::text,true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.ref',public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb)::text,true);
select is(public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb),current_setting('test.ref')::uuid,'replayed import returns the same saved reference');
select is((select count(*) from public.reference_imports where tenant_id='00000000-0000-4000-8000-000000000101'),1::bigint,'replay creates no duplicate reference');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb||'{"subject":"Changed"}')$$,'PT409',null,'changed payload cannot reuse an import request');
select ok((select origin='owner_import' and original_body=current_setting('test.hostile') and readable_text not like '%<script%' and source_url='https://shop.example/spring' and created_by='00000000-0000-4000-8000-000000000001' from public.reference_imports where id=current_setting('test.ref')::uuid),'original is retained verbatim with owner-import provenance');
select is((select structure from public.reference_imports where id=current_setting('test.ref')::uuid),'["Opening","Body","Closing"]'::jsonb,'outline derived by the server from paragraph breaks');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"structure":["Hero","Trusted"]}')$$,'23514',null,'caller cannot supply structure or other fields');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"safe_html":"<p>trusted</p>"}')$$,'23514',null,'caller-generated trusted HTML is rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"source_url":"javascript:alert(1)"}')$$,'23514',null,'script URL rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"source_url":"https://user:secret@shop.example/"}')$$,'23514',null,'credential-bearing URL rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||jsonb_build_object('body',repeat('x',100001)))$$,'23514',null,'oversized original rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"readable_text":"   "}')$$,'23514',null,'empty readable text rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||jsonb_build_object('readable_text',repeat('x',20001)))$$,'23514',null,'readable text above the preview bound rejected');
select set_config('test.bound_ref',public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||jsonb_build_object('readable_text',repeat('x',19999)||' '))::text,true);
select is((select length(readable_text) from public.reference_imports where id=current_setting('test.bound_ref')::uuid),20000,'a preview cut at the bound is stored untrimmed so reopening can show the limit');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb||'{"subject":42}')$$,'23514',null,'non-text subject rejected');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',null,current_setting('test.input')::jsonb)$$,'23514',null,'missing request key rejected');
select throws_ok($$insert into public.reference_imports(tenant_id,created_by,subject,original_body,readable_text,structure) values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','Forged','x','x','["Opening"]')$$,'42501',null,'clients cannot insert references directly');
select throws_ok($$update public.reference_imports set subject='Edited' where id=current_setting('test.ref')::uuid$$,'42501',null,'original capture is immutable to clients');
select throws_ok($$select * from private.reference_import_requests$$,'42501',null,'receipts are not client-readable');
-- First draft from the imported reference keeps provenance and requires no approval bypass.
select set_config('test.draft_input',jsonb_build_object('title','Draft from pasted note','goal','Adapt this outline using original brand facts','channel','email_design','planned_at',now()+interval '30 days','audience_id','','product_id','','offer_id','','reference_notes','')::text,true);
select set_config('test.draft_key',gen_random_uuid()::text,true);
select set_config('test.campaign',public.create_first_draft('00000000-0000-4000-8000-000000000101',current_setting('test.draft_key')::uuid,'imported_reference',current_setting('test.draft_input')::jsonb,current_setting('test.ref')::uuid)::text,true);
select is(public.create_first_draft('00000000-0000-4000-8000-000000000101',current_setting('test.draft_key')::uuid,'imported_reference',current_setting('test.draft_input')::jsonb,current_setting('test.ref')::uuid),current_setting('test.campaign')::uuid,'replayed draft request reopens the same campaign');
select ok((select lineage->>'structureSource'='imported_reference' and lineage->>'structureId'=current_setting('test.ref') and lineage->>'origin'='owner_import' and lineage->>'analysis'='none' and lineage->'structure'='["Opening","Body","Closing"]'::jsonb and lineage->>'copyReusable'='false' and not synthetic from public.campaigns where id=current_setting('test.campaign')::uuid),'campaign lineage labels an owner import, not a competitor or synthetic source');
select ok((select calendar_state='proposed' and copy_state='draft' and design_state='unassigned' and delivery_state='not_ready' and reference_notes like 'Owner-imported reference%' from public.campaigns where id=current_setting('test.campaign')::uuid),'imported starting point does not approve, generate or schedule');
select ok(exists(select 1 from public.campaign_events where campaign_id=current_setting('test.campaign')::uuid and action='imported_reference_draft_created' and detail->>'approvalBypass'='false'),'draft creation from import is audited');
select throws_ok($$select public.create_first_draft('00000000-0000-4000-8000-000000000101',gen_random_uuid(),'imported_reference',current_setting('test.draft_input')::jsonb,gen_random_uuid())$$,'42501',null,'unknown imported source rejected');
select throws_ok($$select public.create_first_draft('00000000-0000-4000-8000-000000000101',gen_random_uuid(),'imported_reference',current_setting('test.draft_input')::jsonb)$$,'23514',null,'imported source requires an id');
-- Nonowners in the same tenant can read but never mutate.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.reference_imports where id=current_setting('test.ref')::uuid),1::bigint,'staff can read the tenant-private reference');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',gen_random_uuid(),current_setting('test.input')::jsonb)$$,'42501',null,'staff cannot import');
select throws_ok($$select public.create_first_draft('00000000-0000-4000-8000-000000000101',gen_random_uuid(),'imported_reference',current_setting('test.draft_input')::jsonb,current_setting('test.ref')::uuid)$$,'42501',null,'staff cannot draft from an import');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb)$$,'42501',null,'team admin cannot replay or import');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is((select count(*) from public.reference_imports),0::bigint,'designer cannot enumerate imported references');
-- Foreign owner: no read, no write, no replay, no source use.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.reference_imports where tenant_id='00000000-0000-4000-8000-000000000101'),0::bigint,'foreign owner cannot read another tenant import');
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb)$$,'42501',null,'foreign owner cannot replay or import');
select throws_ok($$select public.create_first_draft('00000000-0000-4000-8000-000000000102',gen_random_uuid(),'imported_reference',current_setting('test.draft_input')::jsonb,current_setting('test.ref')::uuid)$$,'42501',null,'foreign owner cannot use another tenant import');
select set_config('test.foreign_ref',public.import_pasted_reference('00000000-0000-4000-8000-000000000102',current_setting('test.key')::uuid,current_setting('test.input')::jsonb)::text,true);
select isnt(current_setting('test.foreign_ref'),current_setting('test.ref'),'request keys are scoped to actor and tenant');
reset role;
-- An actor who owns two workspaces cannot carry an import across them.
insert into public.tenant_memberships(tenant_id,profile_id,role,status) values('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','owner','active');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.create_first_draft('00000000-0000-4000-8000-000000000102',gen_random_uuid(),'imported_reference',current_setting('test.draft_input')::jsonb,current_setting('test.ref')::uuid)$$,'42501',null,'multi-workspace owner cannot use tenant 101 import in tenant 102');
select is(public.import_pasted_reference('00000000-0000-4000-8000-000000000101',current_setting('test.key')::uuid,current_setting('test.input')::jsonb),current_setting('test.ref')::uuid,'same request key in another membership still resolves per tenant');
reset role;
select ok(not has_table_privilege('anon','public.reference_imports','SELECT'),'anonymous callers cannot read imports');
select ok(not has_table_privilege('authenticated','public.reference_imports','INSERT,UPDATE,DELETE'),'authenticated clients have read-only table access');
select ok(not has_function_privilege('anon','public.import_pasted_reference(uuid,uuid,jsonb)','EXECUTE'),'anonymous callers cannot import');
select ok(not has_function_privilege('service_role','public.import_pasted_reference(uuid,uuid,jsonb)','EXECUTE'),'service role is not an owner bypass');
select ok((select relrowsecurity from pg_class where oid='public.reference_imports'::regclass) and (select relrowsecurity from pg_class where oid='private.reference_import_requests'::regclass),'RLS enabled on imports and receipts');
-- Bounded per-tenant volume.
insert into public.reference_imports(tenant_id,created_by,subject,original_body,readable_text,structure)
select '00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000004','Bulk fixture '||n,'x','x','["Opening"]' from generate_series(1,499) n;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.import_pasted_reference('00000000-0000-4000-8000-000000000102',gen_random_uuid(),current_setting('test.input')::jsonb)$$,'23514',null,'per-tenant import limit enforced');
reset role;
select * from finish();
rollback;
