begin;
select no_plan();
-- UI-ONBa. Tenant 101 (website cedar-lane.example): owner ...001, admin ...006,
-- staff ...005. Tenant 102 owner ...004. Synthetic seed only.

-- The step a refused finish names (its PT409 detail), or 'none'.
create function pg_temp.todo() returns text language plpgsql as $$
declare d text;
begin
  perform public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish');
  return 'none';
exception when sqlstate 'PT409' then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

-- The owner: nothing saved yet; finishing names the first step still to do.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.onboarding_steps),0::bigint,'no marks before the first step');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','store')$$,'23514',null,'Store is no mark: it is the saved website');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101',null)$$,'23514',null,'a step is needed');
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'PT409',null,'finishing before the Brand step is a conflict');
select is((select count(*) from public.onboarding_steps),0::bigint,'a refused step saves nothing');
select is(pg_temp.todo(),'brand','the conflict names Brand as the step to do');

-- Brand: confirmed for the saved website; again is fine and keeps the first time.
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'the owner confirms the brand');
select is((select brand_site from public.onboarding_steps),'cedar-lane.example','the mark keeps the website');
select set_config('test.confirmed',(select brand_confirmed_at::text from public.onboarding_steps),true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'confirming twice is fine');
select is((select brand_confirmed_at::text from public.onboarding_steps),current_setting('test.confirmed'),'a retry keeps the first time');
select is((select count(*) from public.onboarding_steps),1::bigint,'one row a workspace');

-- Finishing waits for Klaviyo, then the max discount, then Rivals.
select is(pg_temp.todo(),'klaviyo','then Klaviyo is the step to do');
select lives_ok($$select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','connected')$$,'the owner connects the sample Klaviyo');
select is(pg_temp.todo(),'discount','then the max discount');
select lives_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',20,0)$$,'the owner sets a max discount');
select is(pg_temp.todo(),'rivals','then Rivals');

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
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','finish')$$,'PT409',null,'its own workspace is not finished either');

-- Direct writes are refused, even for the owner.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$update public.onboarding_steps set finished_at=now()$$,'42501',null,'no direct update');
select throws_ok($$insert into public.onboarding_steps(tenant_id,finished_at) values('00000000-0000-4000-8000-000000000101',now())$$,'42501',null,'no direct insert');
select throws_ok($$delete from public.onboarding_steps$$,'42501',null,'no direct delete');

-- Rivals: following one brand is enough; a skip works too and is kept once.
select lives_ok($$select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.example')$$,'the owner follows a brand');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'following one brand lets the owner finish');
select ok((select finished_at is not null from public.onboarding_steps),'finished');
select set_config('test.finished',(select finished_at::text from public.onboarding_steps),true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','finish')$$,'finishing twice is fine');
select is((select finished_at::text from public.onboarding_steps),current_setting('test.finished'),'a retry keeps the first finish');
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'the owner skips Rivals');
select set_config('test.skipped',(select rivals_skipped_at::text from public.onboarding_steps),true);
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','rivals')$$,'skipping twice is fine');
select is((select rivals_skipped_at::text from public.onboarding_steps),current_setting('test.skipped'),'a retry keeps the first skip');

-- A website changed later: Brand takes the new one when confirmed again.
reset role;
update public.brand_profiles set domain='WWW.Cedar-Lane-Two.example' where tenant_id='00000000-0000-4000-8000-000000000101';
update public.onboarding_steps set brand_confirmed_at=now()-interval '1 day' where tenant_id='00000000-0000-4000-8000-000000000101';
set local role authenticated;
select lives_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000101','brand')$$,'the owner confirms the new website');
select is((select brand_site from public.onboarding_steps),'cedar-lane-two.example','the mark takes the new website, as the readers write it');
select ok((select brand_confirmed_at > now()-interval '1 hour' from public.onboarding_steps),'with a new time');

-- No website: Brand cannot be confirmed (tenant 102 drops its website).
reset role;
update public.brand_profiles set domain='' where tenant_id='00000000-0000-4000-8000-000000000102';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.save_onboarding_step('00000000-0000-4000-8000-000000000102','brand')$$,'PT409',null,'no website, no Brand');

-- The worker reads, but never writes or calls the owner's command.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select is((select count(*) from public.onboarding_steps),1::bigint,'the worker reads the marks');
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
