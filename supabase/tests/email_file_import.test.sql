begin;
select no_plan();
-- Original synthetic data only. Tenant 101 owner = ...001, staff = ...005, team admin = ...006, designer = ...003; tenant 102 owner = ...004.
-- Storage uploads are simulated by inserting the object row exactly as the Storage API would after a server write.
select set_config('test.t','00000000-0000-4000-8000-000000000101',true);
select set_config('test.sha',repeat('a1',32),true);
select set_config('test.key',gen_random_uuid()::text,true);

-- Admission happens before any write: actor/tenant/request/file-bound, no job yet.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.admit',(select row_to_json(a)::text from public.admit_email_file_upload(current_setting('test.t')::uuid,current_setting('test.key')::uuid,
  jsonb_build_object('sha256',current_setting('test.sha'),'byteSize',1200,'kind','eml','fileName','Spring note.eml','title','')) a),true);
select set_config('test.imp',current_setting('test.admit')::jsonb->>'import_id',true);
select ok(current_setting('test.admit')::jsonb->>'state'='uploading' and (current_setting('test.admit')::jsonb->>'needs_upload')::boolean
  and current_setting('test.admit')::jsonb->>'storage_path'=current_setting('test.t')||'/'||current_setting('test.sha')||'.eml','admission reserves an upload path before any write');
select ok((select job_id is null and state='uploading' and created_by='00000000-0000-4000-8000-000000000001' and upload_expires_at>now() from public.email_file_imports where id=current_setting('test.imp')::uuid),'no durable job exists before the stored object is confirmed');
select is((select import_id::text from public.admit_email_file_upload(current_setting('test.t')::uuid,current_setting('test.key')::uuid,
  jsonb_build_object('sha256',current_setting('test.sha'),'byteSize',1200,'kind','eml','fileName','Spring note.eml','title',''))),current_setting('test.imp'),'replayed admission returns the same frozen receipt');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,current_setting('test.key')::uuid,
  jsonb_build_object('sha256',repeat('b2',32),'byteSize',1200,'kind','eml','fileName','Spring note.eml','title',''))$$,'PT409',null,'a request key cannot be reused for a different file');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('b2',32),'byteSize',4194305,'kind','eml','fileName','big.eml'))$$,'23514',null,'raw bound is 4 MiB');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('b2',32),'byteSize',10,'kind','zip','fileName','a.zip'))$$,'23514',null,'unsupported kinds are rejected');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('b2',32),'byteSize',10,'kind','eml','fileName','../x.eml'))$$,'23514',null,'path-like names are rejected');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('b2',32),'byteSize',10,'kind','eml','fileName','x.eml','storagePath','x'))$$,'23514',null,'callers cannot supply storage paths');
select throws_ok($$select public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)$$,'23514',null,'finalizing before the object is stored fails');
select ok((select job_id is null from public.email_file_imports where id=current_setting('test.imp')::uuid),'a failed finalize enqueues nothing');
select throws_ok($$insert into storage.objects(bucket_id,name) values('email-imports',current_setting('test.t')||'/'||repeat('c3',32)||'.eml')$$,'42501',null,'signed-in users cannot write the private bucket');
select throws_ok($$insert into public.email_file_imports(tenant_id,created_by,file_name,file_kind,media_type,byte_size,sha256,storage_path) values(current_setting('test.t')::uuid,auth.uid(),'a.eml','eml','message/rfc822',1,repeat('d4',32),'x')$$,'42501',null,'clients cannot insert imports directly');
select throws_ok($$select * from private.email_file_import_requests$$,'42501',null,'receipts are private');
reset role;

-- A wrong-sized object (interrupted or forged write) is never accepted.
insert into storage.objects(bucket_id,name,metadata) values('email-imports',current_setting('test.t')||'/'||current_setting('test.sha')||'.eml','{"size":1199}');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)$$,'23514',null,'a stored object of the wrong size is refused');
reset role;
update storage.objects set metadata='{"size":1200}' where bucket_id='email-imports' and name=current_setting('test.t')||'/'||current_setting('test.sha')||'.eml';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select needs_upload from public.admit_email_file_upload(current_setting('test.t')::uuid,current_setting('test.key')::uuid,
  jsonb_build_object('sha256',current_setting('test.sha'),'byteSize',1200,'kind','eml','fileName','Spring note.eml','title',''))),false,'a replay after a lost upload response sees the stored object and skips re-upload');
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid),'queued','confirmed object enqueues the durable job');
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid),'queued','finalize replay is idempotent');
select is((select count(*) from public.job_runs where kind='email.import' and tenant_id=current_setting('test.t')::uuid),1::bigint,'exactly one job per import');
select ok((select j.status='queued' and j.input->>'importId'=current_setting('test.imp') and i.state='queued' from public.email_file_imports i join public.job_runs j on j.id=i.job_id where i.id=current_setting('test.imp')::uuid),'job and import are queued together');
-- The same bytes uploaded again reuse the admitted import and need no write.
select set_config('test.dup',(select row_to_json(a)::text from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',current_setting('test.sha'),'byteSize',1200,'kind','eml','fileName','Copy.eml')) a),true);
select ok(current_setting('test.dup')::jsonb->>'import_id'=current_setting('test.imp') and not (current_setting('test.dup')::jsonb->>'needs_upload')::boolean,'duplicate upload reuses the existing import');
select is((select count(*) from public.email_file_imports where tenant_id=current_setting('test.t')::uuid),1::bigint,'no duplicate import or object');
reset role;

-- Roles and tenants.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),jsonb_build_object('sha256',repeat('e5',32),'byteSize',10,'kind','txt','fileName','a.txt'))$$,'42501',null,'staff cannot upload');
select is((select count(*) from public.email_file_imports where id=current_setting('test.imp')::uuid),1::bigint,'staff can see import metadata in their workspace');
select is((select count(*) from storage.objects where bucket_id='email-imports'),0::bigint,'staff cannot read raw original files');
select throws_ok($$select public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)$$,'42501',null,'staff cannot finalize');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),jsonb_build_object('sha256',repeat('e5',32),'byteSize',10,'kind','text','fileName','a.txt'))$$,'42501',null,'team admin cannot upload');
select is((select count(*) from storage.objects where bucket_id='email-imports'),1::bigint,'team admin can read the referenced raw original');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.email_file_imports),0::bigint,'designer cannot enumerate imports');
select is((select count(*) from storage.objects where bucket_id='email-imports'),0::bigint,'designer cannot read raw files');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.email_file_imports where tenant_id=current_setting('test.t')::uuid),0::bigint,'another workspace cannot see imports');
select is((select count(*) from storage.objects where bucket_id='email-imports'),0::bigint,'another workspace cannot read raw files');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),jsonb_build_object('sha256',repeat('e5',32),'byteSize',10,'kind','text','fileName','a.txt'))$$,'42501',null,'foreign owner cannot upload into this workspace');
select throws_ok($$select public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)$$,'42501',null,'foreign owner cannot finalize');
select throws_ok($$select public.finalize_email_file_upload('00000000-0000-4000-8000-000000000102',current_setting('test.imp')::uuid)$$,'42501',null,'an import id cannot be finalized through another tenant');
reset role;

-- Worker RPCs are service-only; owner sessions cannot lease, forge output or fail work.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)$$,'42501',null,'owner session cannot claim file work');
select throws_ok($$select public.finish_email_file_import((select job_id from public.email_file_imports where id=current_setting('test.imp')::uuid),gen_random_uuid(),'{}')$$,'42501',null,'owner session cannot forge parsed output');
select throws_ok($$select public.fail_email_file_import((select job_id from public.email_file_imports where id=current_setting('test.imp')::uuid),gen_random_uuid(),'{"code":"internal"}')$$,'42501',null,'owner session cannot fail file work');
select is((select count(*) from public.claim_job(current_setting('test.t')::uuid) where kind='email.import'),0::bigint,'generic fixture runner never claims file imports');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*) from public.claim_job(current_setting('test.t')::uuid) where kind='email.import'),0::bigint,'service fixture runner never claims file imports');
select set_config('test.claim',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.imp')::uuid) c),true);
select ok((current_setting('test.claim')::jsonb->>'attempt')::int=1 and current_setting('test.claim')::jsonb->>'sha256'=current_setting('test.sha')
  and current_setting('test.claim')::jsonb->>'actor'='00000000-0000-4000-8000-000000000001','server worker leases the frozen file identity');
select is((select count(*) from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.imp')::uuid)),0::bigint,'a live lease cannot be claimed twice');
select throws_ok($$select * from public.claim_email_file_import('00000000-0000-4000-8000-000000000102',current_setting('test.imp')::uuid)$$,'42501',null,'a file cannot be claimed through another tenant');
reset role;
-- Legacy fixture helpers cannot recover, fail or finish file work, even with the exact lease.
update public.job_runs set lease_until=now()-interval '1 second' where id=(current_setting('test.claim')::jsonb->>'job_id')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.claim_job(current_setting('test.t')::uuid) where kind='email.import'),0::bigint,'legacy claim still ignores file work');
select is((select status from public.job_runs where id=(current_setting('test.claim')::jsonb->>'job_id')::uuid),'running','generic expired-lease sweep leaves file leases alone');
select throws_ok($$select public.fail_job((current_setting('test.claim')::jsonb->>'job_id')::uuid,(current_setting('test.claim')::jsonb->>'lease_token')::uuid,'transient')$$,'42501',null,'legacy fail_job refuses file work');
select throws_ok($$select public.finish_onboarding_job((current_setting('test.claim')::jsonb->>'job_id')::uuid,(current_setting('test.claim')::jsonb->>'lease_token')::uuid,'{"synthetic":true}')$$,'42501',null,'legacy fixture finishers refuse file work');
reset role;
-- Expired lease (worker restart) is recovered by the trusted claim, bounded by attempts.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.claim2',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.imp')::uuid) c),true);
select ok((current_setting('test.claim2')::jsonb->>'attempt')::int=2 and current_setting('test.claim2')::jsonb->>'lease_token'<>current_setting('test.claim')::jsonb->>'lease_token','expired lease is reclaimed with a new token');
select throws_ok($$select public.finish_email_file_import((current_setting('test.claim')::jsonb->>'job_id')::uuid,(current_setting('test.claim')::jsonb->>'lease_token')::uuid,'{}')$$,'PT409',null,'the old lease cannot finish');
select set_config('test.out',jsonb_build_object('sha256',current_setting('test.sha'),'subject','Spring note','body',E'<p>Spring <b>note</b></p>\n','readableText','Spring note',
  'format','html','headerSubject','Spring note','headerFrom','Cedar Lane <news@cedar-lane.example>','headerDate','2026-10-01T09:30:00.000Z','attachmentCount',1,'notes',jsonb_build_array('attachments_kept'))::text,true);
select throws_ok($$select public.finish_email_file_import((current_setting('test.claim2')::jsonb->>'job_id')::uuid,(current_setting('test.claim2')::jsonb->>'lease_token')::uuid,
  jsonb_set(current_setting('test.out')::jsonb,'{sha256}',to_jsonb(repeat('f6',32))))$$,'23514',null,'output for different bytes is refused');
select throws_ok($$select public.finish_email_file_import((current_setting('test.claim2')::jsonb->>'job_id')::uuid,(current_setting('test.claim2')::jsonb->>'lease_token')::uuid,
  jsonb_set(current_setting('test.out')::jsonb,'{body}',to_jsonb(repeat('x',100001))))$$,'23514',null,'decoded content above the editor bound is refused, never cut');
select throws_ok($$select public.finish_email_file_import((current_setting('test.claim2')::jsonb->>'job_id')::uuid,(current_setting('test.claim2')::jsonb->>'lease_token')::uuid,
  current_setting('test.out')::jsonb||'{"html":"<p>x</p>"}')$$,'23514',null,'unknown output fields are refused');
select set_config('test.ref',public.finish_email_file_import((current_setting('test.claim2')::jsonb->>'job_id')::uuid,(current_setting('test.claim2')::jsonb->>'lease_token')::uuid,current_setting('test.out')::jsonb)::text,true);
reset role;
select ok((select r.source_kind='file' and r.content_format='html' and r.origin='owner_import' and r.file_import_id=current_setting('test.imp')::uuid
  and r.original_body=E'<p>Spring <b>note</b></p>\n' and r.source_url is null from public.reference_imports r where r.id=current_setting('test.ref')::uuid),'parsed source is saved as an owner import linked to its file');
select ok((select i.state='succeeded' and i.reference_import_id=current_setting('test.ref')::uuid and i.header_from like 'Cedar Lane%' and i.attachment_count=1
  and j.status='succeeded' from public.email_file_imports i join public.job_runs j on j.id=i.job_id where i.id=current_setting('test.imp')::uuid),'import and job succeed together');
select throws_ok($$update public.email_file_imports set sha256=repeat('0',64) where id=current_setting('test.imp')::uuid$$,'42501',null,'file identity is immutable even to privileged sessions');
select throws_ok($$update public.email_file_imports set state='failed',failure_code='internal' where id=current_setting('test.imp')::uuid$$,'42501',null,'a success is final');

-- Trusted format: literal markup in a text file stays text; HTML without ordinary tags stays HTML.
insert into public.email_file_imports(tenant_id,created_by,state,file_name,file_kind,media_type,byte_size,sha256,storage_path,upload_expires_at)
  values(current_setting('test.t')::uuid,'00000000-0000-4000-8000-000000000001','uploading','literal.txt','text','text/plain',30,repeat('7a',32),current_setting('test.t')||'/'||repeat('7a',32)||'.txt',now()+interval '10 minutes'),
        (current_setting('test.t')::uuid,'00000000-0000-4000-8000-000000000001','uploading','plain.html','html','text/html',20,repeat('8b',32),current_setting('test.t')||'/'||repeat('8b',32)||'.html',now()+interval '10 minutes');
insert into private.email_file_import_requests(tenant_id,created_by,request_key,payload_hash,import_id)
  select tenant_id,created_by,gen_random_uuid(),'x',id from public.email_file_imports where sha256 in (repeat('7a',32),repeat('8b',32));
select set_config('test.id7',(select id::text from public.email_file_imports where sha256=repeat('7a',32)),true);
select set_config('test.id8',(select id::text from public.email_file_imports where sha256=repeat('8b',32)),true);
insert into storage.objects(bucket_id,name,metadata) values('email-imports',current_setting('test.t')||'/'||repeat('7a',32)||'.txt','{"size":30}'),('email-imports',current_setting('test.t')||'/'||repeat('8b',32)||'.html','{"size":20}');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.id7')::uuid),'queued','text file queued');
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.id8')::uuid),'queued','html file queued');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.c7',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.id7')::uuid) c),true);
select throws_ok($$select public.finish_email_file_import((current_setting('test.c7')::jsonb->>'job_id')::uuid,(current_setting('test.c7')::jsonb->>'lease_token')::uuid,
  jsonb_build_object('sha256',repeat('7a',32),'subject','Literal','body','Use <p> tags','readableText','Use <p> tags','format','html','attachmentCount',0))$$,'23514',null,'a text file cannot be promoted to HTML');
select set_config('test.ref7',public.finish_email_file_import((current_setting('test.c7')::jsonb->>'job_id')::uuid,(current_setting('test.c7')::jsonb->>'lease_token')::uuid,
  jsonb_build_object('sha256',repeat('7a',32),'subject','Literal','body',E'Use <p> and <svg> tags\r\n','readableText','Use <p> and <svg> tags','format','text','attachmentCount',0))::text,true);
select set_config('test.c8',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.id8')::uuid) c),true);
select set_config('test.ref8',public.finish_email_file_import((current_setting('test.c8')::jsonb->>'job_id')::uuid,(current_setting('test.c8')::jsonb->>'lease_token')::uuid,
  jsonb_build_object('sha256',repeat('8b',32),'subject','Entities only','body','Fish &amp; chips','readableText','Fish & chips','format','html','attachmentCount',0))::text,true);
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.res7',public.create_email_result(current_setting('test.t')::uuid,gen_random_uuid(),current_setting('test.ref7')::uuid,'copy','{}')::text,true);
select set_config('test.res8',public.create_email_result(current_setting('test.t')::uuid,gen_random_uuid(),current_setting('test.ref8')::uuid,'copy','{"textVersion":"Fish & chips"}')::text,true);
select ok((select s.format='text' and v.html is null and v.body_text=E'Use <p> and <svg> tags\r\n' and c.channel='email_text'
  from public.email_results r join public.email_sources s on s.id=r.source_id join public.email_result_revisions v on v.result_id=r.id and v.revision=1 join public.campaigns c on c.id=r.campaign_id
  where r.id=current_setting('test.res7')::uuid),'literal markup in a text file stays an exact text email');
select ok((select s.format='html' and v.html='Fish &amp; chips' and c.channel='email_design'
  from public.email_results r join public.email_sources s on s.id=r.source_id join public.email_result_revisions v on v.result_id=r.id and v.revision=1 join public.campaigns c on c.id=r.campaign_id
  where r.id=current_setting('test.res8')::uuid),'an HTML file without ordinary tags stays HTML');
select ok((select c.lineage->>'fileImportId' is not null from public.campaigns c join public.email_results r on r.campaign_id=c.id where r.id=current_setting('test.res7')::uuid),'campaign lineage links the uploaded file');
reset role;

-- Failures: transient retries are bounded; permanent parse failures are not retried.
insert into public.email_file_imports(tenant_id,created_by,state,file_name,file_kind,media_type,byte_size,sha256,storage_path)
  values(current_setting('test.t')::uuid,'00000000-0000-4000-8000-000000000001','uploading','bad.eml','eml','message/rfc822',40,repeat('9c',32),current_setting('test.t')||'/'||repeat('9c',32)||'.eml');
insert into private.email_file_import_requests(tenant_id,created_by,request_key,payload_hash,import_id)
  select tenant_id,created_by,gen_random_uuid(),'x',id from public.email_file_imports where sha256=repeat('9c',32);
insert into storage.objects(bucket_id,name,metadata) values('email-imports',current_setting('test.t')||'/'||repeat('9c',32)||'.eml','{"size":40}');
select set_config('test.bad',(select id::text from public.email_file_imports where sha256=repeat('9c',32)),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.bad')::uuid),'queued','third file queued');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.cb',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid) c),true);
select throws_ok($$select public.fail_email_file_import((current_setting('test.cb')::jsonb->>'job_id')::uuid,(current_setting('test.cb')::jsonb->>'lease_token')::uuid,'{"code":"internal","detail":"x"}')$$,'23514',null,'failure reports carry codes only');
select is(public.fail_email_file_import((current_setting('test.cb')::jsonb->>'job_id')::uuid,(current_setting('test.cb')::jsonb->>'lease_token')::uuid,'{"code":"storage_unavailable"}'),'retrying','storage outage retries automatically');
reset role;
update public.job_runs set available_at=now() where id=(current_setting('test.cb')::jsonb->>'job_id')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select set_config('test.cb',(select row_to_json(c)::text from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid) c),true);
select is(public.fail_email_file_import((current_setting('test.cb')::jsonb->>'job_id')::uuid,(current_setting('test.cb')::jsonb->>'lease_token')::uuid,'{"code":"malformed"}'),'failed','malformed file fails permanently');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select ok((select state='failed' and failure_code='malformed' from public.email_file_imports where id=current_setting('test.bad')::uuid),'failure is visible to the owner');
select throws_ok($$select public.retry_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid)$$,'23514',null,'a malformed file cannot be retried unchanged');
reset role;
update public.email_file_imports set failure_code='internal' where id=current_setting('test.bad')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.retry_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid),'queued','a temporary failure can be retried');
reset role;
-- A missing object is reported, not retried forever.
update storage.objects set name='removed/'||name where bucket_id='email-imports' and name=current_setting('test.t')||'/'||repeat('9c',32)||'.eml';
update public.email_file_imports set state='failed',failure_code='internal' where id=current_setting('test.bad')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.retry_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid),'failed','retry of a deleted object reports it missing');
select is((select failure_code from public.email_file_imports where id=current_setting('test.bad')::uuid),'source_missing','missing original is explained');
reset role;
update public.email_file_imports set failure_code='internal',retries=3 where id=current_setting('test.bad')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.retry_email_file_import(current_setting('test.t')::uuid,current_setting('test.bad')::uuid)$$,'23514',null,'manual retries are bounded');
reset role;

-- Paused workspace and removed uploader.
insert into public.email_file_imports(tenant_id,created_by,state,file_name,file_kind,media_type,byte_size,sha256,storage_path)
  values(current_setting('test.t')::uuid,'00000000-0000-4000-8000-000000000001','uploading','later.txt','text','text/plain',50,repeat('0d',32),current_setting('test.t')||'/'||repeat('0d',32)||'.txt');
insert into private.email_file_import_requests(tenant_id,created_by,request_key,payload_hash,import_id)
  select tenant_id,created_by,gen_random_uuid(),'x',id from public.email_file_imports where sha256=repeat('0d',32);
insert into storage.objects(bucket_id,name,metadata) values('email-imports',current_setting('test.t')||'/'||repeat('0d',32)||'.txt','{"size":50}');
select set_config('test.later',(select id::text from public.email_file_imports where sha256=repeat('0d',32)),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.finalize_email_file_upload(current_setting('test.t')::uuid,current_setting('test.later')::uuid),'queued','fourth file queued');
reset role;
update public.tenants set status='paused' where id=current_setting('test.t')::uuid;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok($$select * from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.later')::uuid)$$,'42501',null,'a paused workspace processes nothing');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),jsonb_build_object('sha256',repeat('e5',32),'byteSize',10,'kind','text','fileName','a.txt'))$$,'42501',null,'a paused workspace admits no uploads');
reset role;
update public.tenants set status='active' where id=current_setting('test.t')::uuid;
update public.profiles set status='inactive' where id='00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*) from public.claim_email_file_import(current_setting('test.t')::uuid,current_setting('test.later')::uuid)),0::bigint,'a removed uploader gets no lease');
reset role;
select is((select state||':'||failure_code from public.email_file_imports where id=current_setting('test.later')::uuid),'failed:actor_inactive','removed uploader is explained and not retried');
update public.profiles set status='active' where id='00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.retry_email_file_import(current_setting('test.t')::uuid,current_setting('test.later')::uuid)$$,'23514',null,'a removed-uploader failure is not retried in a loop');
reset role;

-- Capacity is reserved transactionally at admission: hourly, byte and expiry rules.
alter table public.email_file_imports disable trigger email_file_imports_frozen;
update public.email_file_imports set created_at=now()-interval '2 hours' where tenant_id=current_setting('test.t')::uuid;
alter table public.email_file_imports enable trigger email_file_imports_frozen;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- 24 reservations of 4 MiB (96 MiB) span two hours, since at most 20 are admitted per hour.
select lives_ok($$select count(*) from generate_series(1,12) g, lateral public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',lpad(to_hex(g),64,'0'),'byteSize',4194304,'kind','eml','fileName','big-'||g||'.eml'))$$,'twelve 4 MiB reservations fit');
reset role;
alter table public.email_file_imports disable trigger email_file_imports_frozen;
update public.email_file_imports set created_at=now()-interval '2 hours' where tenant_id=current_setting('test.t')::uuid;
alter table public.email_file_imports enable trigger email_file_imports_frozen;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select count(*) from generate_series(13,24) g, lateral public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',lpad(to_hex(g),64,'0'),'byteSize',4194304,'kind','eml','fileName','big-'||g||'.eml'))$$,'twelve more 4 MiB reservations fit (96 MiB reserved)');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('ee',32),'byteSize',4194304,'kind','eml','fileName','over.eml'))$$,'23514','File storage limit reached','reservations count against the 100 MiB cap before any write');
reset role;
-- An abandoned reservation without an object releases its capacity (a replay re-checks capacity; see the receipt replay test above).
select set_config('test.abandoned',(select id::text from public.email_file_imports where file_name='big-1.eml'),true);
update public.email_file_imports set upload_expires_at=now()-interval '1 second' where id=current_setting('test.abandoned')::uuid;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('ee',32),'byteSize',4194304,'kind','eml','fileName','takes-slot.eml'))$$,'expired reservation capacity is reusable');
select lives_ok($$select count(*) from generate_series(1,7) g, lateral public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',lpad(to_hex(1000+g),64,'0'),'byteSize',10,'kind','text','fileName','small-'||g||'.txt'))$$,'small files fill the hourly allowance');
select throws_ok($$select * from public.admit_email_file_upload(current_setting('test.t')::uuid,gen_random_uuid(),
  jsonb_build_object('sha256',repeat('ef',32),'byteSize',10,'kind','text','fileName','hourly.txt'))$$,'23514','File upload limit reached; try again later','hourly admission rate is bounded');
reset role;
select ok((select count(*)=20 from public.email_file_imports where tenant_id=current_setting('test.t')::uuid and created_at>now()-interval '1 hour'),'rejected admissions leave no rows');
select is((select count(*) from storage.objects where bucket_id='email-imports' and name like current_setting('test.t')||'/%'),4::bigint,'admission alone writes no objects');

select * from finish();
rollback;
