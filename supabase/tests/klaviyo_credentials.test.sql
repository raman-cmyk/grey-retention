begin;
select plan(38);

-- Owner ...01 and staff ...05 of workspace 101; owner ...04 of workspace 102.
create function pg_temp.connect(k text, hint text, rev text default '2026-10-15', later text[] default '{}', account text default 'CdrG01') returns integer language sql as $$
  select public.connect_klaviyo_live('00000000-0000-4000-8000-000000000101', k, hint, 'Cedar Goods', account, rev, later,
    'America/Los_Angeles', 'https://cedar.example', 'USD', 'US')
$$;
create function pg_temp.stored() returns text language sql security definer as $$
  select s.decrypted_secret from public.klaviyo_credentials c join vault.decrypted_secrets s on s.id = c.secret_id
    where c.tenant_id = '00000000-0000-4000-8000-000000000101'
$$;
create function pg_temp.secrets() returns integer language sql security definer as $$
  select count(*)::int from vault.secrets where name = 'klaviyo_key:00000000-0000-4000-8000-000000000101'
$$;
create function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', sub, true), set_config('request.jwt.claim.role', 'authenticated', true)
$$;
create function pg_temp.mode() returns text language sql as $$
  select mode||'/'||status||'/'||coalesce(credential_hint,'-') from public.workspace_connections
    where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'
$$;

-- Grants.
select ok(not bool_or(has_function_privilege(r,'public.connect_klaviyo_live(uuid,text,text,text,text,text,text[],text,text,text,text)','execute')),
  'anon and the bare service role cannot connect Klaviyo') from unnest(array['anon','service_role']) r;
select ok(not bool_or(has_function_privilege(r,'public.klaviyo_api_key(uuid)','execute')),'browser roles never read a key back')
  from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role','public.klaviyo_api_key(uuid)','execute'),'the server can');
select ok(not has_column_privilege('authenticated','public.klaviyo_credentials','secret_id','select'),'members never see which Vault secret holds the key');
select ok(not bool_or(has_table_privilege(r,'public.klaviyo_credentials',p)),'nobody writes the credentials directly, not even the server')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['insert','update','delete','truncate']) p;
select ok(not bool_or(has_table_privilege(r,t,'select')),'anon reads nothing') from unnest(array['anon']) r,
  unnest(array['public.klaviyo_credentials','public.klaviyo_key_checks']) t;
select ok(not has_table_privilege('authenticated','public.klaviyo_key_checks','select'),'nor members the key-check log');

-- Key checks: owners only, at most 5 in 15 minutes.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
select throws_ok($$select public.begin_klaviyo_key_check('00000000-0000-4000-8000-000000000101')$$,'42501',null,'staff cannot check keys');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select lives_ok($$select public.begin_klaviyo_key_check('00000000-0000-4000-8000-000000000101') from generate_series(1,5)$$,'an owner checks a key');
select throws_ok($$select public.begin_klaviyo_key_check('00000000-0000-4000-8000-000000000101')$$,'PT409',null,'but not a sixth time in 15 minutes');

-- Only the owner connects, with a well-formed key that matches its hint.
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij')$$,'42501',null,'staff cannot connect');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij')$$,'42501',null,'nor another workspace''s owner');
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.connect('sk_live_0123456789abcdefghij','pk_SAMPL••••••••ghij')$$,'23514',null,'only a private key');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_OTHER••••••••zzzz')$$,'23514',null,'the hint must be the key''s');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPLE0123456789abcdefghij')$$,'23514','The hint does not match the key',
  'the key itself is never taken as its hint (no error can echo it)');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij','latest')$$,'23514',null,'a real revision');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij','2026-10-15',array['everything'])$$,'23514',null,'and scope names');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij','2026-10-15',
  (select array_agg('lists:read'::text) from generate_series(1,21)))$$,'23514',null,'at most 20 scopes');
select throws_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij','2026-10-15','{}','not an id!')$$,'23514',null,'a Klaviyo account id');
select lives_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij','2026-10-15',array['templates:read'])$$,'the owner connects');
select is(pg_temp.mode()||'/'||(select account_label from public.workspace_connections where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo'),
  'live/connected/pk_SAMPL••••••••ghij/Cedar Goods','a live connection');
select pg_temp.as_user('00000000-0000-4000-8000-000000000005');
select is((select key_hint||'/'||klaviyo_account_id||'/'||api_revision||'/'||array_to_string(later_missing,',')||'/'||status from public.klaviyo_credentials
  where tenant_id='00000000-0000-4000-8000-000000000101'),'pk_SAMPL••••••••ghij/CdrG01/2026-10-15/templates:read/active','members see what was checked');
select throws_ok($$select secret_id from public.klaviyo_credentials$$,'42501',null,'but not which secret holds the key');
select pg_temp.as_user('00000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.klaviyo_credentials),0,'another workspace sees nothing');
select throws_ok($$select public.klaviyo_api_key('00000000-0000-4000-8000-000000000101')$$,'42501',null,'and cannot read the key');
reset role;
select is(pg_temp.stored(),'pk_SAMPLE0123456789abcdefghij','the key is kept in Vault');
select throws_ok($$insert into public.workspace_connections(tenant_id, provider, mode, status, fixture_account)
  values ('00000000-0000-4000-8000-000000000102', 'drive', 'live', 'connected', 'fixture:x')$$,'23514',null,'only Klaviyo can be live');

-- A new key replaces the old one; the server reads it back only while connected.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select pg_temp.connect('pk_NEWKEY9876543210zyxwvutsrq','pk_NEWKE••••••••tsrq');
reset role;
select is(pg_temp.stored()||'/'||pg_temp.secrets(),'pk_NEWKEY9876543210zyxwvutsrq/1','a new key replaces the old one');
set local role service_role;
select throws_ok($$select public.klaviyo_api_key('00000000-0000-4000-8000-000000000101')$$,'42501',null,'only a request signed as the server reads it');
select set_config('request.jwt.claim.role','service_role',true);
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000101'),'pk_NEWKEY9876543210zyxwvutsrq','the server reads it back');
reset role;
update public.workspace_connections set status='expired' where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo';
set local role service_role;
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000101'),null,'not while the connection needs attention');
reset role;
update public.workspace_connections set status='connected' where tenant_id='00000000-0000-4000-8000-000000000101' and provider='klaviyo';

-- A sample connection replacing the live one forgets the key.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select public.connect_sample_provider('00000000-0000-4000-8000-000000000101','klaviyo','Other Shop','pk_OTHER••••••••zzzz');
reset role;
select is(pg_temp.mode()||'/'||pg_temp.secrets()||'/'||(select count(*) from public.klaviyo_credentials),'fixture/connected/pk_OTHER••••••••zzzz/0/0',
  'a sample connection over a live one forgets the key');

-- Disconnecting forgets the key; connecting again works.
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij');
select public.set_fixture_connection('00000000-0000-4000-8000-000000000101','klaviyo','disconnected');
reset role;
select is((select count(*)::int from public.klaviyo_credentials)+pg_temp.secrets(),0,'disconnecting deletes the stored key');
select is(pg_temp.mode(),'fixture/disconnected/pk_SAMPL••••••••ghij','and the connection is a sample one again');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(public.klaviyo_api_key('00000000-0000-4000-8000-000000000101'),null,'with no key to read');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select lives_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij')$$,'connecting again after a disconnect works');

-- A secret left behind under the workspace's name never blocks a connect.
reset role;
delete from public.klaviyo_credentials;
select vault.create_secret('pk_LEFTOVER000000000000000000', 'klaviyo_key:00000000-0000-4000-8000-000000000101');
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select lives_ok($$select pg_temp.connect('pk_SAMPLE0123456789abcdefghij','pk_SAMPL••••••••ghij')$$,'a leftover secret is replaced');
reset role;
select is(pg_temp.stored()||'/'||pg_temp.secrets(),'pk_SAMPLE0123456789abcdefghij/1','and only the new key is kept');

select * from finish();
rollback;
