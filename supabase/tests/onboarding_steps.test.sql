begin;
select no_plan();
-- UI-ONBa (migration 20260914090089). Tenant 101 (website cedar-lane.example):
-- owner ...001, admin ...006, staff ...005. Tenant 102 (north-studio.example)
-- owner ...004. Synthetic seed only.

-- The step a refused finish names (its PT409 detail), or 'none'.
create function pg_temp.todo(t uuid) returns text language plpgsql as $$
declare d text;
begin
  perform public.save_onboarding_step(t, 'finish');
  return 'none';
exception when sqlstate 'PT409' then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

-- The seeded workspaces count as finished (seed.sql); these tests start
-- from no marks.
select is((select count(*) from public.onboarding_steps where finished_at is not null),2::bigint,'the seeded workspaces are finished');
delete from public.onboarding_steps;

-- The owner: nothing saved yet; finishing names the first step still to do.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.onboarding_steps),0::bigint,'no marks before the first step');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','store')$$,'23514',null,'Store is no mark: it is the saved website');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101',null)$$,'23514',null,'a step is needed');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'PT409',null,'finishing before the Brand step is a conflict');
select is((select count(*) from public.onboarding_steps),0::bigint,'a refused step saves nothing');
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'brand','the conflict names Brand as the step to do');

-- Brand: confirmed for the saved website; again is fine and keeps the first time.
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'the owner confirms the brand');
select is((select brand_site from public.onboarding_steps),'cedar-lane.example','the mark keeps the website');
select set_config('test.confirmed',(select brand_confirmed_at::text from public.onboarding_steps),true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'confirming twice is fine');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand','WWW.Cedar-Lane.example')$$,'confirming the website shown, written another way');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand','other-site.example')$$,'PT409',null,'a website changed in another window is not confirmed blind');
select is((select brand_confirmed_at::text from public.onboarding_steps),current_setting('test.confirmed'),'a retry keeps the first time');
select is((select count(*) from public.onboarding_steps),1::bigint,'one row a workspace');

-- Klaviyo: not connected, then expired, both block; connected counts.
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'klaviyo','then Klaviyo is the step to do');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','expired')$$,'an expired sample connection');
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'klaviyo','an expired Klaviyo blocks Finish');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','connected')$$,'the owner connects the sample Klaviyo');
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'discount','then the max discount');

-- A live connection counts only with its live key active.
reset role;
update public.workspace_connections set mode='live' where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo';
set local role authenticated;
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'klaviyo','a live connection without its live key blocks Finish');
reset role;
insert into public.klaviyo_credentials(tenant_id,secret_id,key_hint,klaviyo_account_id,api_revision,status)
  values('00000000-0000-4000-8000-000000000101',gen_random_uuid(),'pk_abcde••••••••wxyz','ACCT01','2026-10-15','revoked');
set local role authenticated;
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'klaviyo','a refused live key blocks Finish');
reset role;
update public.klaviyo_credentials set status='active' where tenant_id='00000000-0000-4000-8000-000000000101';
set local role authenticated;
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'discount','an active live key counts');
reset role;
update public.workspace_connections set mode='fixture' where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo';
set local role authenticated;
select lives_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',20,0)$$,'the owner sets a max discount');
select is(pg_temp.todo('00000000-0000-4000-8000-000000000101'),'rivals','then Rivals');

-- Staff, an admin and another workspace's owner set nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select brand_site from public.onboarding_steps),'cedar-lane.example','staff read the marks');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'42501',null,'staff cannot skip Rivals');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'42501',null,'staff cannot finish');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'42501',null,'an admin cannot confirm the brand (owner only)');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.onboarding_steps),0::bigint,'another workspace sees no marks');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'42501',null,'another workspace cannot skip Rivals');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'42501',null,'another workspace cannot finish');

-- Direct writes are refused, even for the owner.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.onboarding_steps set finished_at=now()$$,'42501',null,'no direct update');
select throws_ok($$insert into public.onboarding_steps(tenant_id,finished_at) values('00000000-0000-4000-8000-000000000101',now())$$,'42501',null,'no direct insert');
select throws_ok($$delete from public.onboarding_steps$$,'42501',null,'no direct delete');

-- Rivals skipped (no brand followed): Finish passes; both keep their first time.
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'the owner skips Rivals');
select set_config('test.skipped',(select rivals_skipped_at::text from public.onboarding_steps),true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'skipping twice is fine');
select is((select rivals_skipped_at::text from public.onboarding_steps),current_setting('test.skipped'),'a retry keeps the first skip');
select is((select count(*) from public.competitor_subscriptions where tenant_id='00000000-0000-4000-8000-000000000101' and active),0::bigint,'no brand followed');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'Finish after a Rivals skip');
select ok((select finished_at is not null from public.onboarding_steps),'finished');
select set_config('test.finished',(select finished_at::text from public.onboarding_steps),true);

-- A new website clears the Brand mark; a finished workspace stays finished.
reset role;
update public.brand_profiles set domain='WWW.Cedar-Lane-Two.example' where tenant_id='00000000-0000-4000-8000-000000000101';
set local role authenticated;
select ok((select brand_site is null and brand_confirmed_at is null from public.onboarding_steps),'a new website clears the Brand mark');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'a finish retry returns at once');
select is((select finished_at::text from public.onboarding_steps),current_setting('test.finished'),'and keeps the first finish');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'the owner confirms the new website');
select is((select brand_site from public.onboarding_steps),'cedar-lane-two.example','the mark takes the new website, as the readers write it');
reset role;
update public.brand_profiles set domain='cedar-lane-two.example' where tenant_id='00000000-0000-4000-8000-000000000101';
set local role authenticated;
select is((select brand_site from public.onboarding_steps),'cedar-lane-two.example','the same website written another way keeps the mark');

-- Tenant 102: the Brand undo, A then B then A, and Finish by following a brand.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'the owner confirms website A');
reset role;
update public.brand_profiles set domain='north-studio-b.example' where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select is(pg_temp.todo('00000000-0000-4000-8000-000000000102'),'brand','website B: Brand is to do again');
reset role;
update public.brand_profiles set domain='north-studio.example' where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select is(pg_temp.todo('00000000-0000-4000-8000-000000000102'),'brand','back to website A: Brand still needs a new look');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'the owner confirms website A again');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000102','klaviyo','connected')$$,'Klaviyo');
select lives_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000102',10,0)$$,'a max discount');
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000102','northwind.example')$$,'the owner follows a brand');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','finish')$$,'following one brand lets the owner finish');
select ok((select rivals_skipped_at is null and finished_at is not null from public.onboarding_steps where tenant_id='00000000-0000-4000-8000-000000000102'),'finished without a skip');

-- No website: Brand cannot be confirmed.
reset role;
update public.brand_profiles set domain='' where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'PT409',null,'no website, no Brand');
reset role;
update public.brand_profiles set domain=repeat('a',63)||'.'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',62)
  where tenant_id='00000000-0000-4000-8000-000000000102';
set local role authenticated;
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'PT409',null,'a website over 253 characters is no website');

-- The worker reads, but never writes or calls the owner's command.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*) from public.onboarding_steps),2::bigint,'the worker reads the marks');
select throws_ok($$update public.onboarding_steps set finished_at=null$$,'42501',null,'the worker cannot change a mark');
select throws_ok($$insert into public.onboarding_steps(tenant_id) values('00000000-0000-4000-8000-000000000102')$$,'42501',null,'the worker cannot add marks');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'42501',null,'the worker cannot call the owner command');

-- A paused workspace: its owner sets nothing.
reset role;
update public.tenants set status='paused' where id='00000000-0000-4000-8000-000000000102';
update public.brand_profiles set domain='north-studio.example' where tenant_id='00000000-0000-4000-8000-000000000102';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'42501',null,'a paused workspace cannot save a step');

-- No sign-in, no access.
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select count(*) from public.onboarding_steps$$,'42501',null,'anonymous callers cannot read the marks');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'42501',null,'anonymous callers are refused');

select * from finish();
rollback;
