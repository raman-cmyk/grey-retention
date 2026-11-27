begin;
select plan(102);

-- PICK-006: the brand's design tokens, kept by the Site reader's job, and
-- the owner's corrections of them in the Brand book. Owner ...01 and staff
-- ...05 are in workspace 101; owner ...04 runs workspace 102. Synthetic
-- seed only.
create function pg_temp.job(key text, kind text default 'brand.read_site', age interval default '0',
  domain text default 'WWW.Cedar-Lane.example') returns uuid
language sql as $$
  insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by,created_at,status,lease_token,lease_until)
    values ('00000000-0000-4000-8000-000000000101',kind,key,jsonb_build_object('domain',domain),
      '00000000-0000-4000-8000-000000000001', now()-age,
      'running','00000000-0000-4000-8000-00000000aaaa',now()+interval '1 minute')
    returning id
$$;
create function pg_temp.keep(job uuid, tokens jsonb) returns boolean language sql as $$
  select public.record_site_tokens(job,'00000000-0000-4000-8000-00000000aaaa',tokens)
$$;
create function pg_temp.as_member(sub text) returns void language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',sub,'role','authenticated')::text,true)
$$;
create function pg_temp.newest() returns integer language sql as $$
  select coalesce(max(version),0) from public.brand_books where tenant_id='00000000-0000-4000-8000-000000000101'
$$;
grant execute on function pg_temp.newest() to authenticated;
-- The calm sample site's tokens (`features/onboarding/site/sample.ts`).
create function pg_temp.calm() returns jsonb language sql as $$
  select '{"spacing.base":8,"spacing.steps":[8,16,24,32,48],"type.body":16,"type.h1":36,"type.h2":26,"type.h3":20,
    "type.lineHeight":1.6,"type.headingCase":"uppercase","radius.button":4,"radius.card":6,"radius.image":6,
    "button.style":"filled","button.paddingX":28,"button.paddingY":14,"button.case":"uppercase","button.weight":600}'::jsonb
$$;
select set_config('test.old',pg_temp.job('tokens-old',age=>'1 hour')::text,true);
select set_config('test.new',pg_temp.job('tokens-new')::text,true);
select set_config('test.other',pg_temp.job('tokens-catalog','brand.read_catalog')::text,true);
select set_config('test.nosite',pg_temp.job('tokens-nosite',domain=>'localhost')::text,true);
select set_config('test.expired',pg_temp.job('tokens-expired')::text,true);
update public.job_runs set lease_until = now() - interval '1 second' where id = current_setting('test.expired')::uuid;

-- Grants.
select ok(not bool_or(has_function_privilege(r,'public.record_site_tokens(uuid,uuid,jsonb)','execute'))
  and has_function_privilege('service_role','public.record_site_tokens(uuid,uuid,jsonb)','execute'),
  'only the worker keeps tokens') from unnest(array['anon','authenticated']) r;
select ok(not bool_or(has_table_privilege(r,'public.brand_tokens',p)),'browser roles cannot write tokens')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger','maintain']) p;
select ok(not has_table_privilege('service_role','public.brand_tokens','insert,update,delete,truncate,references,trigger,maintain')
  and has_table_privilege('service_role','public.brand_tokens','select'),'the worker reads tokens and writes them only through the command');
select ok(not has_table_privilege('anon','public.brand_tokens','select'),'anonymous visitors cannot read them');
select ok(not bool_or(has_function_privilege(r,f,'execute')),'nor run the checks: '||f)
  from unnest(array['anon','authenticated']) r,
    unnest(array['private.site_tokens_ok(jsonb)','private.token_number_ok(text,numeric)',
      'private.token_steps_ok(numeric[])','private.brand_token_ok(text,text)']) f
  group by f;
select ok(relrowsecurity,'row level security is on') from pg_class where oid = 'public.brand_tokens'::regclass;

-- Only the site read's own job, under its lease, with well-formed tokens.
set local role service_role;
select set_config('request.jwt.claims','{}',true);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'{}'),'42501',null,
  'the worker needs its role in the token');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok(format('select public.record_site_tokens(%L,gen_random_uuid(),%L)',current_setting('test.new'),'{}'),
  'PT409',null,'a wrong lease keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.expired'),'{}'),'PT409',null,
  'a lease that ran out keeps nothing');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.other'),'{}'),'23514',null,
  'another reader''s job cannot keep tokens');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.nosite'),'{}'),'23514',null,
  'a job without a real website keeps nothing');
select throws_ok(format($$insert into public.brand_tokens(tenant_id,run_id,domain,tokens)
  values('00000000-0000-4000-8000-000000000101',%L,'cedar-lane.example','{}')$$,current_setting('test.new')),'42501',null,
  'nor writes the table directly');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),bad),'23514',null,'refused: '||why)
  from (values
    (null::jsonb, 'nothing'),
    ('[]'::jsonb, 'a list, not a set'),
    ('{"radius.corner":4}'::jsonb, 'an unknown token'),
    ('{"radius.button":25}'::jsonb, 'corners over 24 px'),
    ('{"radius.card":-1}'::jsonb, 'corners under 0'),
    ('{"radius.image":4.5}'::jsonb, 'corners that are not whole'),
    ('{"type.body":13}'::jsonb, 'body text under 14 px'),
    ('{"type.h1":49}'::jsonb, 'a headline over 48 px'),
    ('{"type.lineHeight":1.9}'::jsonb, 'a line height over 1.8'),
    ('{"type.lineHeight":1.234}'::jsonb, 'a line height of three decimals'),
    ('{"type.lineHeight":1.53}'::jsonb, 'a line height off the 0.05 steps'),
    ('{"type.h2":37}'::jsonb, 'a section heading over 36 px'),
    ('{"type.h3":15}'::jsonb, 'a small heading under 16 px'),
    ('{"button.paddingX":11}'::jsonb, 'button side space under 12 px'),
    ('{"button.paddingX":49}'::jsonb, 'button side space over 48 px'),
    ('{"button.weight":300}'::jsonb, 'a weight under 400'),
    ('{"spacing.base":1}'::jsonb, 'a unit under 2 px'),
    ('{"type.body":"16"}'::jsonb, 'a size that is not a number'),
    ('{"button.weight":650}'::jsonb, 'a weight off the hundreds'),
    ('{"button.paddingY":21}'::jsonb, 'button space over 20 px'),
    ('{"button.style":"ghost"}'::jsonb, 'an unknown button style'),
    ('{"button.case":"lowercase"}'::jsonb, 'an unknown case'),
    ('{"type.headingCase":1}'::jsonb, 'a case that is not a word'),
    ('{"spacing.base":13}'::jsonb, 'a unit over 12 px'),
    ('{"spacing.steps":[8]}'::jsonb, 'a scale of one space'),
    ('{"spacing.steps":[16,8]}'::jsonb, 'a scale not smallest first'),
    ('{"spacing.steps":[8,8,16]}'::jsonb, 'a space twice'),
    ('{"spacing.steps":[8,65]}'::jsonb, 'a space over 64 px'),
    ('{"spacing.steps":[2,4,6,8,10,12,14,16,18,20,22]}'::jsonb, 'over 10 spaces'),
    ('{"spacing.steps":"8,16"}'::jsonb, 'a scale that is not a list'),
    ('{"spacing.steps":[8,"16"]}'::jsonb, 'a space that is not a number')
  ) as x(bad, why);

select ok(pg_temp.keep(current_setting('test.old')::uuid,pg_temp.calm()),'a read keeps its tokens');
select is((select tokens from public.brand_tokens where tenant_id='00000000-0000-4000-8000-000000000101'),pg_temp.calm(),
  'as given');
select is((select domain||' '||(run_id::text = current_setting('test.old')) from public.brand_tokens
  where tenant_id='00000000-0000-4000-8000-000000000101'),'cedar-lane.example true',
  'the row names its read and the plain website it was read from');
-- A newer read replaces the whole set; an older one finishing later changes nothing.
select ok(pg_temp.keep(current_setting('test.new')::uuid,'{"radius.button":24,"button.style":"outline"}'),
  'a newer read keeps its tokens');
select is((select tokens from public.brand_tokens where tenant_id='00000000-0000-4000-8000-000000000101'),
  '{"radius.button":24,"button.style":"outline"}'::jsonb,'the earlier set is replaced');
select ok(not pg_temp.keep(current_setting('test.old')::uuid,pg_temp.calm()),'an older read is too late');
select is((select tokens->>'button.style' from public.brand_tokens where tenant_id='00000000-0000-4000-8000-000000000101'),
  'outline','the newer set stays');
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),
  '{"radius.button":4,"radius.card":99}'),'23514',null,'one bad token refuses the set');
select is((select tokens->>'button.style' from public.brand_tokens where tenant_id='00000000-0000-4000-8000-000000000101'),
  'outline','and the set stays');
select ok(pg_temp.keep(current_setting('test.new')::uuid,'{}'),'the same read may keep none');
select ok(pg_temp.keep(current_setting('test.new')::uuid,pg_temp.calm()),'and keep them again');
select public.record_site_findings(current_setting('test.new')::uuid,'00000000-0000-4000-8000-00000000aaaa','[]','[]',false);
select throws_ok(format('select pg_temp.keep(%L,%L)',current_setting('test.new'),'{}'),'PT409',null,
  'a finished read keeps nothing');
reset role;

-- The workspace's members read them; another workspace and anonymous
-- visitors do not.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select is((select tokens->>'radius.button'||' '||domain from public.brand_tokens),'4 cedar-lane.example',
  'staff read their workspace''s tokens and where they came from');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select is((select count(*)::integer from public.brand_tokens),0,'another workspace''s owner reads none');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok('select count(*) from public.brand_tokens','42501',null,'an anonymous visitor reads none');
reset role;
select throws_ok($$update public.brand_tokens set tokens = '{"radius.button":"x"}'
  where tenant_id='00000000-0000-4000-8000-000000000101'$$,'23514',null,'the table refuses a bad set too');

-- The owner corrects a token in the Brand book, like a fact.
set local role authenticated;
select pg_temp.as_member('00000000-0000-4000-8000-000000000001');
select set_config('test.v',pg_temp.newest()::text,true);
select is(public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',current_setting('test.v')::int,
  '[{"section":"tokens.radius.button","action":"replace","value":"12"},
    {"section":"tokens.spacing.steps","action":"replace","value":"8, 16, 24"},
    {"section":"tokens.type.lineHeight","action":"replace","value":"1.55"},
    {"section":"tokens.button.style","action":"replace","value":"outline"},
    {"section":"facts.returnDays","action":"replace","value":"30"}]'::jsonb),5,'the owner corrects four tokens and a fact at once');
select is((select string_agg(section||'='||value,' ' order by section) from public.brand_book_corrections
  where tenant_id='00000000-0000-4000-8000-000000000101' and withdrawn_at is null and section like 'tokens.%'),
  'tokens.button.style=outline tokens.radius.button=12 tokens.spacing.steps=8, 16, 24 tokens.type.lineHeight=1.55',
  'each as its checked value');
select is((select count(*)::integer from public.job_runs where tenant_id='00000000-0000-4000-8000-000000000101'
  and kind='brand.write_book' and status in ('queued','retry_wait')),1,'the book is rewritten');
select throws_ok(format($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',%s,%L::jsonb)$$,
  current_setting('test.v'),bad),'23514',null,'refused: '||why)
  from (values
    ('[{"section":"tokens.radius.button","action":"replace","value":"30"}]', 'corners over 24 px'),
    ('[{"section":"tokens.radius.button","action":"replace","value":"12px"}]', 'a value with its unit'),
    ('[{"section":"tokens.type.body","action":"replace","value":"13"}]', 'body text under 14 px'),
    ('[{"section":"tokens.type.lineHeight","action":"replace","value":"2"}]', 'a line height over 1.8'),
    ('[{"section":"tokens.button.weight","action":"replace","value":"650"}]', 'a weight off the hundreds'),
    ('[{"section":"tokens.button.style","action":"replace","value":"ghost"}]', 'an unknown style'),
    ('[{"section":"tokens.button.case","action":"replace","value":"Capitals"}]', 'a case the app never writes'),
    ('[{"section":"tokens.spacing.steps","action":"replace","value":"16, 8"}]', 'a scale not smallest first'),
    ('[{"section":"tokens.spacing.steps","action":"replace","value":"8,16"}]', 'a scale the app never writes'),
    ('[{"section":"tokens.spacing.steps","action":"replace","value":"08, 16"}]', 'a space with a leading zero'),
    ('[{"section":"tokens.radius.button","action":"replace","value":"012"}]', 'a number with a leading zero'),
    ('[{"section":"tokens.type.lineHeight","action":"replace","value":"1.50"}]', 'a line height with a trailing zero'),
    ('[{"section":"tokens.type.lineHeight","action":"replace","value":"1.53"}]', 'a line height off the 0.05 steps'),
    ('[{"section":"tokens.type.h2","action":"replace","value":"40"}]', 'a section heading over 36 px'),
    ('[{"section":"tokens.button.paddingY","action":"replace","value":"7"}]', 'button space under 8 px'),
    ('[{"section":"tokens.radius.corner","action":"remove"}]', 'taking back an unknown token'),
    ('[{"section":"tokens.radius.corner","action":"replace","value":"4"}]', 'an unknown token'),
    ('[{"section":"tokens.radius.button","action":"add","value":"4"}]', 'an added token line'),
    ('[{"section":"tokens.radius.button","original":"12","action":"replace","value":"4"}]', 'a token named by its words'),
    ('[{"section":"tokens.radius.button","action":"replace","value":"4"},{"section":"tokens.radius.card","action":"replace","value":"99"}]',
      'one bad token refuses them all')
  ) as x(bad, why);
select is((select value from public.brand_book_corrections where tenant_id='00000000-0000-4000-8000-000000000101'
  and section='tokens.radius.button' and withdrawn_at is null),'12','nothing refused was kept');
-- A newer value withdraws the older; a removal gives the site's value back.
select is(public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',current_setting('test.v')::int,
  '[{"section":"tokens.radius.button","action":"replace","value":"6"}]'::jsonb),1,'he changes it again');
select is((select string_agg(value||':'||(withdrawn_at is null),',' order by created_at) from public.brand_book_corrections
  where tenant_id='00000000-0000-4000-8000-000000000101' and section='tokens.radius.button'),'12:false,6:true',
  'one live value a token');
select is(public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',current_setting('test.v')::int,
  '[{"section":"tokens.button.style","action":"remove"}]'::jsonb),1,'he takes the button style back to the site''s');
select is((select action from public.brand_book_corrections where tenant_id='00000000-0000-4000-8000-000000000101'
  and section='tokens.button.style' and withdrawn_at is null),'remove','recorded as a removal');
-- A book version newer than the one shown refuses a token correction.
select throws_ok(format($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',%s,
  '[{"section":"tokens.radius.button","action":"replace","value":"4"}]'::jsonb)$$,current_setting('test.v')::int + 1),'PT409',null,
  'a stale book version refuses it');
-- He takes a token correction back: the site's value returns.
select lives_ok(format($$select public.withdraw_brand_book_correction_at('00000000-0000-4000-8000-000000000101',%s,%L)$$,
  current_setting('test.v'),(select id from public.brand_book_corrections where tenant_id='00000000-0000-4000-8000-000000000101'
    and section='tokens.radius.button' and withdrawn_at is null)),'he takes the corner correction back');
select is((select count(*)::integer from public.brand_book_corrections where tenant_id='00000000-0000-4000-8000-000000000101'
  and section='tokens.radius.button' and withdrawn_at is null),0,'no live corner correction is left');
-- Staff, an admin and another workspace's owner cannot.
select pg_temp.as_member('00000000-0000-4000-8000-000000000006');
select throws_ok(format($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',%s,
  '[{"section":"tokens.radius.button","action":"replace","value":"4"}]'::jsonb)$$,current_setting('test.v')),'42501',null,
  'an admin cannot correct a token');
select pg_temp.as_member('00000000-0000-4000-8000-000000000005');
select throws_ok(format($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',%s,
  '[{"section":"tokens.radius.button","action":"replace","value":"4"}]'::jsonb)$$,current_setting('test.v')),'42501',null,
  'staff cannot correct a token');
select pg_temp.as_member('00000000-0000-4000-8000-000000000004');
select throws_ok(format($$select public.correct_brand_book_at('00000000-0000-4000-8000-000000000101',%s,
  '[{"section":"tokens.radius.button","action":"replace","value":"4"}]'::jsonb)$$,current_setting('test.v')),'42501',null,
  'nor another workspace''s owner');
reset role;

-- The change history says a token's checked value, as a fact's.
select is((select e.detail from public.workspace_events e join public.brand_book_corrections c on c.id = e.entity_id
  where c.section='tokens.radius.button' and c.value='6' and e.kind='brand_book_corrected'),
  '{"section":"tokens.radius.button","action":"replace","value":"6"}'::jsonb,'the history names the token and its value');
-- A line of what GROS saw is corrected as before.
select ok(not private.brand_fact_ok('facts.returnDays','4000') and private.brand_fact_ok('facts.returnDays','30')
  and private.brand_fact_ok('voice','Calm.') and private.brand_fact_ok('tokens.radius.card',null),
  'facts are checked as before, a line freely, a known token''s removal');
select ok(not private.brand_token_ok('tokens.radius.corner',null) and not private.brand_token_ok(null,'4')
  and private.brand_token_ok('tokens.spacing.steps','4, 8, 64') and private.brand_token_ok('tokens.type.lineHeight','1.2')
  and private.brand_token_ok('tokens.radius.card','0') and private.brand_token_ok('tokens.button.weight','800'),
  'an unknown token is refused even when taken back; the bounds are kept');
select throws_ok($$insert into public.brand_book_corrections(tenant_id,section,original,action,value)
  values('00000000-0000-4000-8000-000000000101','tokens.radius.card',null,'replace','99')$$,'23514',null,
  'the table never holds a token value the command would refuse');
select throws_ok($$insert into public.brand_book_corrections(tenant_id,section,original,action,value)
  values('00000000-0000-4000-8000-000000000101','tokens.radius.card','4','replace','8')$$,'23514',null,
  'the table never holds a token named by its words');
select throws_ok($$insert into public.brand_book_corrections(tenant_id,section,original,action,value)
  values('00000000-0000-4000-8000-000000000101','tokens.none','x','replace','8')$$,'23514',null,
  'nor an unknown section');

select * from finish();
rollback;
