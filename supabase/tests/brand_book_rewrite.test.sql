begin;
select no_plan();
-- UI-BRAND-2. Tenant 101: owner ...001, admin ...006, staff ...005. Tenant 102 owner ...004. Operator ...002. Synthetic seed only.

create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.as_worker() returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"service_role"}',true)
$$;
create function pg_temp.writes(tenant text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select count(*)::integer from public.job_runs where tenant_id=tenant::uuid and kind='brand.write_book'
$$;
create function pg_temp.waiting(tenant text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select count(*)::integer from public.job_runs where tenant_id=tenant::uuid and kind='brand.write_book' and status in ('queued','retry_wait')
$$;
create function pg_temp.lease(job text) returns uuid language sql as $$
  select lease_token from public.job_runs where id=job::uuid
$$;
create function pg_temp.newest(tenant text default '00000000-0000-4000-8000-000000000101') returns integer language sql as $$
  select coalesce(max(version),0) from public.brand_books where tenant_id=tenant::uuid
$$;
grant execute on function pg_temp.writes(text), pg_temp.waiting(text), pg_temp.lease(text), pg_temp.newest(text) to authenticated, service_role;

-- Grants: the owner's commands for members, the worker's for the worker only.
select ok(has_function_privilege('authenticated','public.correct_brand_book_at(uuid,integer,jsonb)','execute')
  and not has_function_privilege('anon','public.correct_brand_book_at(uuid,integer,jsonb)','execute')
  and not has_function_privilege('service_role','public.correct_brand_book_at(uuid,integer,jsonb)','execute'),'members call the correction command');
select ok(has_function_privilege('authenticated','public.withdraw_brand_book_correction_at(uuid,integer,uuid)','execute')
  and not has_function_privilege('anon','public.withdraw_brand_book_correction_at(uuid,integer,uuid)','execute'),'and the take-back command');
select ok(has_function_privilege('authenticated','public.retry_brand_book_write(uuid)','execute')
  and not has_function_privilege('anon','public.retry_brand_book_write(uuid)','execute'),'and Try again');
select ok(not has_function_privilege('authenticated','public.claim_brand_book_write(uuid)','execute')
  and has_function_privilege('service_role','public.claim_brand_book_write(uuid)','execute'),'only the worker claims a rewrite');
select ok(not has_function_privilege('authenticated','public.finish_brand_book_write(uuid,uuid,integer,jsonb,text)','execute')
  and has_function_privilege('service_role','public.finish_brand_book_write(uuid,uuid,integer,jsonb,text)','execute'),'and finishes one');
select ok(not has_function_privilege('authenticated','public.queue_brand_book_write_as_worker(uuid,text,text)','execute')
  and has_function_privilege('service_role','public.queue_brand_book_write_as_worker(uuid,text,text)','execute'),'and queues one for a read');
select ok(not has_function_privilege('authenticated','public.brand_book_writes_waiting()','execute')
  and has_function_privilege('service_role','public.brand_book_writes_waiting()','execute'),'and counts the waiting ones');
select ok(not has_function_privilege('authenticated','private.queue_brand_book_write(uuid,text,text,uuid)','execute')
  and not has_function_privilege('service_role','private.queue_brand_book_write(uuid,text,text,uuid)','execute')
  and not has_function_privilege('authenticated','private.require_brand_book_version(uuid,integer)','execute')
  and not has_function_privilege('authenticated','private.workspace_actor(uuid)','execute')
  and not has_function_privilege('authenticated','private.correct_brand_book_checked(uuid,text,text,text,text)','execute')
  and not has_function_privilege('authenticated','private.withdraw_brand_book_correction_checked(uuid,uuid)','execute'),'the helpers are not callable');

-- A Brand book to correct (version 1).
set local role service_role;
select pg_temp.as_worker();
select is(public.save_brand_book('00000000-0000-4000-8000-000000000101',
  '{"observed":{"voice":["Loud and bold."]}}'::jsonb,'brand-book@2'),1,'a first book');
reset role;
select is(pg_temp.writes(),0,'no rewrite is waiting yet');

-- Approving a brand version queues one rewrite, in the same transaction.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select set_config('test.rev',(select revision::text from public.brand_profiles where tenant_id='00000000-0000-4000-8000-000000000101'),true);
select lives_ok($$select public.save_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int,
  'Cedar Lane Goods','cedar-lane.example','Quiet layers.','Calm.','No claims.')$$,'the owner changes his brand');
select is(pg_temp.writes(),0,'saving alone rewrites nothing');
select lives_ok($$select public.approve_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int + 1)$$,'and approves it');
select is(pg_temp.writes(),1,'one rewrite is queued');
select is((select idempotency_key||'/'||status||'/'||(input->>'cause') from public.job_runs where kind='brand.write_book'),
  'brand-book:approved:'||(current_setting('test.rev')::int + 1)||'/queued/approved','named by the approved version');
select is((select created_by::text from public.job_runs where kind='brand.write_book'),'00000000-0000-4000-8000-000000000001','created by the owner');
select is((select count(*)::integer from public.job_runs where kind='brand.write_book'),1,'members read it');

-- The owner's corrections: against the version shown, owner only.
select is(public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,
  '[{"section":"voice","original":"Loud and bold.","action":"replace","value":"Calm and plain."},
    {"section":"facts.returnDays","action":"replace","value":"30"}]'::jsonb),2,'the owner makes two corrections at once');
select is((select count(*)::integer from public.brand_book_corrections where withdrawn_at is null),2,'both are live');
select is(pg_temp.writes(),1,'the waiting rewrite covers them (no second one)');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',0,
  '[{"section":"offering","action":"add","value":"Linen shirts."}]'::jsonb)$$,'PT409',null,'an older book version is refused');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Linen shirts."}]'::jsonb)$$,'PT409',null,'so is one never written');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',null,
  '[{"section":"offering","action":"add","value":"Linen shirts."}]'::jsonb)$$,'PT409',null,'a version is needed');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,
  '[{"section":"offering","action":"add","value":"Linen shirts."},{"section":"facts.returnDays","action":"replace","value":"two weeks"}]'::jsonb)$$,
  '23514',null,'one bad correction refuses them all');
select is((select count(*)::integer from public.brand_book_corrections where section='offering'),0,'and keeps none of them');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,'[]'::jsonb)$$,'23514',null,'at least one correction');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,
  (select jsonb_agg(jsonb_build_object('section','offering','action','add','value','Line '||n)) from generate_series(1,11) n))$$,
  '23514',null,'at most ten');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,'{"section":"voice"}'::jsonb)$$,'23514',null,'a list of corrections');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,'["voice"]'::jsonb)$$,'23514',null,'each one an object');
select throws_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',1,
  '00000000-0000-4000-8000-00000000ffff')$$,'PT409',null,'taking back an unknown correction is a conflict');

-- Re-approving the version already approved queues nothing more.
reset role;
update public.job_runs set status='succeeded' where kind='brand.write_book';
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select lives_ok($$select public.approve_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int + 1)$$,'approving it again');
select is(pg_temp.waiting(),0,'queues no rewrite');
reset role;
update public.job_runs set status='queued' where kind='brand.write_book';

-- The worker runs the rewrite: one at a time, under its lease.
set local role service_role;
select pg_temp.as_worker();
select is(public.brand_book_writes_waiting(),1,'one rewrite waiting');
select set_config('test.job',(select id::text from public.claim_brand_book_write('00000000-0000-4000-8000-000000000102')),true);
select is(current_setting('test.job'),'','a rewrite of another workspace is not claimed for this one');
select set_config('test.job',(select id::text from public.claim_brand_book_write('00000000-0000-4000-8000-000000000101')),true);
select isnt(current_setting('test.job'),'','the worker claims it');
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.job')::uuid),'running/1','running, first try');
select is((select count(*)::integer from public.claim_brand_book_write()),0,'nothing else to claim');
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job')::uuid,gen_random_uuid(),1,'{}'::jsonb,'brand-book@2')$$,
  'PT409',null,'finishing needs the lease');

-- The owner, an operator or any member never fails the worker's rewrite.
reset role;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.fail_job(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),'validation')$$,
  '42501',null,'the owner cannot fail a running rewrite, even with its lease');
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
select throws_ok($$select public.fail_job(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),'validation')$$,
  '42501',null,'nor the operator');

-- A change while it runs queues one more, never claimed beside the running one.
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is(public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,
  '[{"section":"offering","action":"add","value":"Linen shirts."}]'::jsonb),1,'the owner corrects while it runs');
select is(pg_temp.writes(),2,'a second rewrite is queued behind the running one');
reset role;
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_brand_book_write()),0,'never two rewrites of one workspace at once');

-- The book is saved with the finish, under the lease, on top of what it read.
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),
  0,'{"observed":{}}'::jsonb,'brand-book@2')$$,'PT409',null,'a write that read an older book never saves');
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),
  1,'"a book"'::jsonb,'brand-book@2')$$,'23514',null,'a book is an object');
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),
  1,'{}'::jsonb,'someone')$$,'23514',null,'written by a named writer');
select is(public.finish_brand_book_write(current_setting('test.job')::uuid,pg_temp.lease(current_setting('test.job')),
  1,'{"observed":{"voice":["Calm and plain."]}}'::jsonb,'brand-book@2'),2,'the worker saves the new book and finishes');
select is((select status||'/'||(checkpoint->>'version') from public.job_runs where id=current_setting('test.job')::uuid),'succeeded/2','succeeded, with the book written');
select is((select written_by||'/'||(content->'observed'->'voice'->>0) from public.brand_books where version=2 and tenant_id='00000000-0000-4000-8000-000000000101'),
  'brand-book@2/Calm and plain.','the new version');
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job')::uuid,gen_random_uuid(),2,null,null)$$,'PT409',null,'never twice');

-- A failed try waits to try again; Try again makes it due now.
select set_config('test.job2',(select id::text from public.claim_brand_book_write()),true);
select isnt(current_setting('test.job2'),'','the second one is claimed now');
select lives_ok($$select public.fail_job(current_setting('test.job2')::uuid,pg_temp.lease(current_setting('test.job2')),'transient')$$,'and fails once');
select is((select status from public.job_runs where id=current_setting('test.job2')::uuid),'retry_wait','it waits to try again');
-- A late finish of the failed try saves nothing.
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job2')::uuid,gen_random_uuid(),2,'{"x":1}'::jsonb,'brand-book@2')$$,
  'PT409',null,'a try that lost its lease never saves');
select is(pg_temp.newest(),2,'the book is unchanged');
reset role;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot try again');
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is(public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job2'),'the owner tries again: the same write');
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.job2')::uuid),'queued/0','due now, with its full tries');
select is(pg_temp.waiting(),1,'still one waiting');

-- A write that failed for good: Try again queues a new one, once.
reset role;
update public.job_runs set status='failed', attempt=4 where id=current_setting('test.job2')::uuid;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select set_config('test.job3',public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')::text,true);
select isnt(current_setting('test.job3'),current_setting('test.job2'),'a new write after a failed one');
select is(public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job3'),'clicking again changes nothing');
select is((select idempotency_key from public.job_runs where id=current_setting('test.job3')::uuid),'brand-book:retry:'||current_setting('test.job2'),'named by the write it retries');

-- A lost lease: Try again reuses that write rather than adding another.
reset role;
update public.job_runs set status='running', attempt=2, lease_token=gen_random_uuid(), lease_until=now() - interval '1 second'
  where id=current_setting('test.job3')::uuid;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select is(public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')::text,current_setting('test.job3'),'Try again after a lost lease reuses the write');
select is((select status||'/'||attempt||'/'||coalesce(lease_token::text,'none') from public.job_runs where id=current_setting('test.job3')::uuid),
  'queued/0/none','due now, its lease gone');
select is(pg_temp.waiting(),1,'still one waiting');

-- The worker recovers stale leases when it claims: tried again, or failed after four.
reset role;
update public.job_runs set status='running', attempt=2, lease_token=gen_random_uuid(), lease_until=now() - interval '1 second'
  where id=current_setting('test.job3')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select id::text||'/'||attempt from public.claim_brand_book_write('00000000-0000-4000-8000-000000000101')),
  current_setting('test.job3')||'/3','an expired lease is taken again, as its next try');
reset role;
update public.job_runs set attempt=4, lease_until=now() - interval '1 second' where id=current_setting('test.job3')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_brand_book_write('00000000-0000-4000-8000-000000000101')),0,'after four tries it is not claimed');
select is((select status||'/'||error_code from public.job_runs where id=current_setting('test.job3')::uuid),'failed/stale_lease','it failed for good');

-- One busy workspace never holds up another's rewrite.
select set_config('test.other',public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000102','read',gen_random_uuid()::text)::text,true);
select is((select created_by::text from public.job_runs where id=current_setting('test.other')::uuid),'00000000-0000-4000-8000-000000000004',
  'the worker queues a rewrite for the workspace owner');
select set_config('test.mine',public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000101','read',gen_random_uuid()::text)::text,true);
select throws_ok($$select public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000101','Read!','x')$$,'23514',null,'a plain cause');
reset role;
update public.job_runs set available_at=now() - interval '1 hour' where id=current_setting('test.mine')::uuid;
update public.job_runs set status='running', attempt=1, lease_token=gen_random_uuid(), lease_until=now() + interval '1 minute'
  where tenant_id='00000000-0000-4000-8000-000000000101' and kind='brand.write_book' and id<>current_setting('test.mine')::uuid
  and id=current_setting('test.job2')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select id::text from public.claim_brand_book_write()),current_setting('test.other'),'the global claim skips a workspace with a running rewrite');
select is((select count(*)::integer from public.job_runs where id=current_setting('test.mine')::uuid and status='queued'),1,'whose waiting one stays queued');

-- The fixture sweep never takes a rewrite, nor recovers its lease.
reset role;
update public.job_runs set lease_until=now() - interval '1 second' where id=current_setting('test.job2')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is((select count(*)::integer from public.claim_job('00000000-0000-4000-8000-000000000101') where kind='brand.write_book'),0,
  'the workspace jobs never take a rewrite');
select is((select status from public.job_runs where id=current_setting('test.job2')::uuid),'running','nor touch its expired lease');
select is((select status from public.job_runs where id=current_setting('test.mine')::uuid),'queued','it stays queued for its own worker');

-- Taking a correction back: against the version shown, and queues the rewrite.
reset role;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select throws_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',1,
  (select id from public.brand_book_corrections where section='offering' and withdrawn_at is null))$$,'PT409',null,'an older book version is refused');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',1,
  '[{"section":"offering","action":"add","value":"Wool too."}]'::jsonb)$$,'PT409',null,'the page from before the rewrite is refused');
select lives_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',2,
  (select id from public.brand_book_corrections where section='offering' and withdrawn_at is null))$$,'the owner takes one back on the new version');
select is(pg_temp.waiting(),1,'the waiting rewrite covers it');

-- Admins, staff, another workspace and the operator cannot use the owner's commands, old or new.
select pg_temp.as_member('00000000-0000-4000-8000-000000000006');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Wool."}]'::jsonb)$$,'42501',null,'an admin cannot type into the book');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000101','offering',null,'add','Wool.')$$,
  '42501',null,'nor through the older command');
select throws_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000101',
  (select id from public.brand_book_corrections where withdrawn_at is null limit 1))$$,'42501',null,'nor take one back through it');
select throws_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',2,
  (select id from public.brand_book_corrections where withdrawn_at is null limit 1))$$,'42501',null,'nor through the new one');
select throws_ok($$select public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')$$,'42501',null,'nor try again');
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Wool."}]'::jsonb)$$,'42501',null,'staff cannot');
reset role;
create temp table live_correction as select id from public.brand_book_corrections where tenant_id='00000000-0000-4000-8000-000000000101' and withdrawn_at is null limit 1;
grant select on live_correction to authenticated;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Wool."}]'::jsonb)$$,'42501',null,'another workspace cannot');
select throws_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',2,(select id from live_correction))$$,
  '42501',null,'nor take one back');
select throws_ok($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000102',0,(select id from live_correction))$$,
  'PT409',null,'nor through its own workspace');
select throws_ok($$select public.retry_brand_book_write('00000000-0000-4000-8000-000000000101')$$,'42501',null,'nor try again');
select is((select count(*)::integer from public.job_runs where kind='brand.write_book' and tenant_id='00000000-0000-4000-8000-000000000101'),0,'nor read its rewrites');
select pg_temp.as_member('00000000-0000-4000-8000-000000000002');
select throws_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Wool."}]'::jsonb)$$,'42501',null,'the operator cannot');
select throws_ok($$select public.claim_brand_book_write()$$,'42501',null,'members cannot claim a rewrite');
select throws_ok($$select public.brand_book_writes_waiting()$$,'42501',null,'nor count them');
reset role;
select is((select count(*)::integer from public.brand_book_corrections where id=(select id from live_correction) and withdrawn_at is null),1,
  'the other workspace''s correction stays live');

-- Retries stay bounded: the worker's own causes (a read, a stale book)
-- reuse a waiting write without giving it more tries; the owner's do.
update public.job_runs set status='retry_wait', attempt=3 where id=current_setting('test.mine')::uuid;
set local role service_role;
select pg_temp.as_worker();
select is(public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000101','read',gen_random_uuid()::text)::text,
  current_setting('test.mine'),'a read reuses the waiting write');
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.mine')::uuid),'queued/3','with only the tries it has left');
select is(public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000101','stale','2026-11-25T10')::text,
  current_setting('test.mine'),'so does a stale book');
select is((select attempt from public.job_runs where id=current_setting('test.mine')::uuid),3,'still three tries used');
reset role;
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select lives_ok($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',2,
  '[{"section":"offering","action":"add","value":"Wool scarves."}]'::jsonb)$$,'the owner corrects again');
select is((select status||'/'||attempt from public.job_runs where id=current_setting('test.mine')::uuid),'queued/0','his change gives it its full tries');

-- A paused workspace's rewrite never saves; the worker queues for active profiles only.
reset role;
update public.job_runs set status='succeeded' where id=current_setting('test.job2')::uuid;
set local role service_role;
select pg_temp.as_worker();
select set_config('test.job4',(select id::text from public.claim_brand_book_write('00000000-0000-4000-8000-000000000101')),true);
select is(current_setting('test.job4'),current_setting('test.mine'),'the waiting rewrite is claimed');
reset role;
update public.tenants set status='paused' where id='00000000-0000-4000-8000-000000000101';
set local role service_role;
select pg_temp.as_worker();
select throws_ok($$select public.finish_brand_book_write(current_setting('test.job4')::uuid,pg_temp.lease(current_setting('test.job4')),
  2,'{"x":1}'::jsonb,'brand-book@2')$$,'42501',null,'a paused workspace''s book is never saved');
select is(pg_temp.newest(),2,'the book is unchanged');
reset role;
update public.tenants set status='active' where id='00000000-0000-4000-8000-000000000102';
update public.profiles set status='inactive' where id='00000000-0000-4000-8000-000000000004';
update public.job_runs set status='succeeded' where tenant_id='00000000-0000-4000-8000-000000000102' and kind='brand.write_book';
set local role service_role;
select pg_temp.as_worker();
select is(public.queue_brand_book_write_as_worker('00000000-0000-4000-8000-000000000102','read',gen_random_uuid()::text),null,
  'a workspace whose only member is inactive gets no rewrite queued for him');

select * from finish();
rollback;
