begin;
select plan(23);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04.
-- What is recorded for 101 from here on.
create temp table seen_from as select now() as at;
grant select on seen_from to authenticated;
create or replace function pg_temp.events(k text) returns setof public.workspace_events language sql as $$
  select * from public.workspace_events
  where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = k order by created_at, id
$$;

-- Nobody writes the record directly; the recorders are not callable.
select ok(not has_table_privilege('authenticated','public.workspace_events','insert,update,delete'),'members cannot write the record');
select ok(not has_table_privilege('anon','public.workspace_events','select'),'visitors cannot read it');
select ok(not has_function_privilege('authenticated','private.record_offer_limit_change()','execute')
  and not has_function_privilege('authenticated','private.record_discount_code_change()','execute')
  and not has_function_privilege('authenticated','private.record_klaviyo_connection_change()','execute')
  and not has_function_privilege('authenticated','private.record_klaviyo_key_change()','execute')
  and not has_function_privilege('service_role','private.record_klaviyo_key_change()','execute'),'the recorders are not callable');

-- The owner changes the max discount twice, then sets the same value.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.rev',coalesce((select revision from public.brand_offers where tenant_id='00000000-0000-4000-8000-000000000101'),0)::text,true);
select set_config('test.rev',public.set_max_discount('00000000-0000-4000-8000-000000000101',20,current_setting('test.rev')::integer)::text,true);
select set_config('test.rev',public.set_max_discount('00000000-0000-4000-8000-000000000101',25,current_setting('test.rev')::integer)::text,true);
select set_config('test.rev',public.set_max_discount('00000000-0000-4000-8000-000000000101',25,current_setting('test.rev')::integer)::text,true);
reset role;
select is((select count(*) from pg_temp.events('max_discount_changed') e where e.detail->>'to' = '25'),1::bigint,'the new max discount is recorded');
select is((select count(*) from pg_temp.events('max_discount_changed') e where e.created_at >= (select at from seen_from)),2::bigint,'twice: setting the same value again records nothing');
select is((select count(*) from pg_temp.events('max_discount_changed') e where e.detail->>'from' = '20' and e.detail->>'to' = '25'),1::bigint,'from and to');
select is((select actor_id from pg_temp.events('max_discount_changed') e where e.detail->>'to' = '25'),'00000000-0000-4000-8000-000000000001'::uuid,'and who did it');

-- A code added, then retired by hand.
set local role authenticated;
select set_config('test.code',public.add_discount_code('00000000-0000-4000-8000-000000000101','HIST10',10,null)::text,true);
select public.retire_discount_code(current_setting('test.code')::uuid);
reset role;
select is((select detail->>'code' || ' ' || (detail->>'percent') from pg_temp.events('discount_code_added') where entity_id = current_setting('test.code')::uuid),'HIST10 10','a code added, with its percent');
select is((select (detail->>'ended')::boolean from pg_temp.events('discount_code_retired') where entity_id = current_setting('test.code')::uuid),false,'retired by hand');
select is((select actor_id from pg_temp.events('discount_code_retired') where entity_id = current_setting('test.code')::uuid),'00000000-0000-4000-8000-000000000001'::uuid,'by the owner');

-- A code that ended is retired when the next code is added.
set local role authenticated;
select set_config('test.ending',public.add_discount_code('00000000-0000-4000-8000-000000000101','HISTEND',15,now() + interval '1 day')::text,true);
reset role;
update public.discount_codes set expires_at = now() - interval '1 minute' where id = current_setting('test.ending')::uuid;
set local role authenticated;
select public.add_discount_code('00000000-0000-4000-8000-000000000101','HISTNEXT',5,null);
reset role;
select is((select (detail->>'ended')::boolean from pg_temp.events('discount_code_retired') where entity_id = current_setting('test.ending')::uuid),true,'a code retired because it ended says so');
select ok((select actor_id is null from pg_temp.events('discount_code_retired') where entity_id = current_setting('test.ending')::uuid),'and the system did it, not the person adding the next code');

-- A live connect (connect_klaviyo_live): its sample step is not recorded,
-- the switch to live is, once.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
delete from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
select set_config('test.k0',(select count(*) from pg_temp.events('klaviyo_connection_changed'))::text,true);
select set_config('grey.live_klaviyo_check','on',true);
insert into public.workspace_connections (tenant_id, provider, mode, status, fixture_account)
values ('00000000-0000-4000-8000-000000000101','klaviyo','fixture','connected','history-test');
update public.workspace_connections set mode = 'live' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
select set_config('grey.live_klaviyo_check','',true);
select is((select count(*) from pg_temp.events('klaviyo_connection_changed')),current_setting('test.k0')::bigint + 1,'a live connect is one change');
select is((select count(*) from pg_temp.events('klaviyo_connection_changed') e where e.detail->>'to_mode' = 'live' and e.actor_id = '00000000-0000-4000-8000-000000000001'),1::bigint,'Klaviyo connected live, by the owner');

-- Disconnected: the mode put back to sample afterwards is not another change.
update public.workspace_connections set status = 'disconnected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
select is((select count(*) from pg_temp.events('klaviyo_connection_changed') e where e.detail->>'to_status' = 'disconnected'),1::bigint,'a disconnect is one change');
select is((select mode from public.workspace_connections where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo'),'fixture','(the mode was put back to sample)');

-- The system (no person) finds the key refused.
update public.workspace_connections set status = 'connected' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
select set_config('request.jwt.claims','',true);
update public.workspace_connections set status = 'expired' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
select ok((select bool_and(actor_id is null) and count(*) = 1 from pg_temp.events('klaviyo_connection_changed') e where e.detail->>'to_status' = 'expired'),'a change by the system has no person');
select set_config('test.k1',(select count(*) from pg_temp.events('klaviyo_connection_changed'))::text,true);
update public.workspace_connections set status = status where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
update public.workspace_connections set last_error = 'x' where tenant_id = '00000000-0000-4000-8000-000000000101' and provider = 'klaviyo';
insert into public.workspace_connections (tenant_id, provider, mode, status, fixture_account)
values ('00000000-0000-4000-8000-000000000101','shopify','fixture','connected','history-test')
on conflict (tenant_id, provider) do update set status = 'disconnected';
select is((select count(*) from pg_temp.events('klaviyo_connection_changed')),current_setting('test.k1')::bigint,'no change, other fields, or another provider record nothing');

-- The key, by its masked hint only.
delete from public.klaviyo_credentials where tenant_id = '00000000-0000-4000-8000-000000000101';
insert into public.klaviyo_credentials (tenant_id, secret_id, key_hint, klaviyo_account_id, api_revision)
values ('00000000-0000-4000-8000-000000000101', gen_random_uuid(), 'pk_abcde••••••••wxyz', 'AcctHist1', '2026-10-15');
update public.klaviyo_credentials set status = 'revoked' where tenant_id = '00000000-0000-4000-8000-000000000101';
select is((select count(*) from pg_temp.events('klaviyo_key_saved') e where e.detail = '{"hint":"pk_abcde••••••••wxyz"}'::jsonb),1::bigint,'a saved key is recorded by its masked hint only');
select is((select count(*) from pg_temp.events('klaviyo_key_refused')),1::bigint,'and a refused key');
select ok((select max(created_at) > min(created_at) from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and created_at >= (select at from seen_from)),'each change keeps its own time (in one transaction too)');

-- Members read their own workspace's record; another workspace reads none.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select ok((select count(*) from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101' and kind = 'discount_code_added') >= 1,'staff read the record');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.workspace_events where tenant_id = '00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace reads none of it');
reset role;

select * from finish();
rollback;
