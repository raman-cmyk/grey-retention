begin;
select plan(24);

-- ONB-065a and REAL-01a: the inbox brands a workspace may be
-- suggested, asked for by the app's server only, and the brands the owner
-- hides. Owner ...01 and staff ...05 are in sample workspace 101; owner
-- ...04 runs workspace 102.
insert into public.competitor_captures(domain, synthetic, brand_name, niche, subscription_status, last_received_at) values
  ('bark.example', true, 'Bark Co', 'Dog treats', 'subscribed', now() - interval '1 day'),
  ('wick.example', true, 'Wick', 'Scented candles', 'subscribed', now() - interval '2 days'),
  ('quiet.example', true, null, null, 'subscribed', null),
  ('pending.example', true, 'Pending', 'Dog treats', 'pending', now()),
  ('followed.example', true, 'Followed', 'Dog treats', 'subscribed', now()),
  ('dropped.example', true, 'Dropped', 'Dog treats', 'subscribed', now()),
  ('gone.example', true, 'Gone', 'Dog treats', 'unsubscribed', now()),
  ('never.example', true, 'Never', 'Dog treats', 'not_subscribed', now()),
  ('realbrand.test', false, 'Real Brand', 'Dog treats', 'subscribed', now()),
  ('otherreal.test', false, 'Other Real', 'Dog treats', 'subscribed', now() - interval '3 days');
insert into public.competitor_subscriptions(tenant_id, capture_id, label, active, created_by)
  select '00000000-0000-4000-8000-000000000101', c.id, c.brand_name, c.domain = 'followed.example', '00000000-0000-4000-8000-000000000001'
  from public.competitor_captures c where c.domain in ('followed.example', 'dropped.example');
-- Another workspace following a brand does not hide it from this one.
insert into public.competitor_subscriptions(tenant_id, capture_id, label, created_by)
  select '00000000-0000-4000-8000-000000000102', c.id, c.brand_name, '00000000-0000-4000-8000-000000000004'
  from public.competitor_captures c where c.domain = 'bark.example';
create function pg_temp.email(domain text, age interval, industry text default null) returns void language sql as $$
  insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic,
      labels_state, industry, email_type, offer_type, season, angle, brand_size, labels_confidence, labels_pass)
    select c.id, gen_random_uuid()::text, now() - age, 'x', 'x', '<p>x</p>', '{}', true,
      case when industry is not null then 'tagged' end, industry,
      case when industry is not null then 'other' end, case when industry is not null then 'none' end,
      case when industry is not null then 'none' end, case when industry is not null then 'other' end,
      case when industry is not null then 'unknown' end, case when industry is not null then 0.9 end,
      case when industry is not null then 'sample' end
    from public.competitor_captures c where c.domain = email.domain
$$;
create function pg_temp.ask(t text, since interval default '30 days') returns setof text language sql as $$
  select domain from public.suggestable_inbox_brands(t::uuid, now() - since)
$$;
select set_config('test.wick',(select id::text from public.competitor_captures where domain='wick.example'),true);
select set_config('test.followed',(select id::text from public.competitor_captures where domain='followed.example'),true);
select pg_temp.email('bark.example', '1 day', 'pet');
select pg_temp.email('bark.example', '3 days');
select pg_temp.email('bark.example', '5 days');
select pg_temp.email('bark.example', '40 days', 'pet');
select pg_temp.email('wick.example', '2 days', 'home');
select pg_temp.email('wick.example', '50 days', 'home');
select pg_temp.email('wick.example', '60 days', 'home');
select pg_temp.email('followed.example', '1 day');

-- Grants: the brands are the app's server's to ask for; hiding is a member command.
select ok(has_function_privilege('service_role','public.suggestable_inbox_brands(uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.suggestable_inbox_brands(uuid,timestamptz)','execute')
  and not has_function_privilege('anon','public.suggestable_inbox_brands(uuid,timestamptz)','execute'),
  'only the app''s server asks for inbox brands');
select ok(has_function_privilege('authenticated','public.hide_competitor(uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.unhide_competitor(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.hide_competitor(uuid,uuid)','execute'),
  'signed-in members may ask to hide, anonymous visitors not');
select ok(not bool_or(has_table_privilege(r,'public.competitor_hidden',p)),'browser roles cannot write the hidden list')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;

-- A member's own session cannot list them (no brands of other industries).
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select * from pg_temp.ask('00000000-0000-4000-8000-000000000101')$$,'42501',null,
  'a member cannot list inbox brands directly');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select array_agg(domain order by ord) from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101',
  now() - interval '30 days') with ordinality x(id, domain, brand_name, niche, synthetic, last_received_at, recent, labels, ord)),
  array['bark.example','wick.example','quiet.example'],
  'subscribed sample brands it never followed (another workspace''s follows aside), busiest first; never pending, unsubscribed, followed, once followed or real ones');
select is((select recent||' '||labels::text from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101',
  now() - interval '30 days') where domain = 'bark.example'), '3 {"pet": 2}',
  'its emails since the window, and the labels of all its emails');
select is((select recent||' '||labels::text from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101',
  now() - interval '30 days') where domain = 'quiet.example'), '0 {}', 'a brand with no emails yet');
select is((select brand_name||' '||niche||' '||synthetic from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101',
  now() - interval '30 days') where domain = 'wick.example'), 'Wick Scented candles true', 'its name and niche');
select throws_ok($$select * from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101', null)$$,'23514',null,
  'a window is needed');
select throws_ok($$select * from public.suggestable_inbox_brands(null, now())$$,'23514',null,'no workspace, no answer');
reset role;

-- The owner hides a brand: never suggested again, and no longer followed.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.wick')),'42501',null,'staff cannot hide a brand');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.wick')),'42501',null,'another workspace''s owner cannot');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',gen_random_uuid()),
  '23514',null,'an unknown brand cannot be hidden');
select lives_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.wick')),'the owner hides a brand');
select lives_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.wick')),'hiding twice is fine');
select lives_ok(format('select public.hide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.followed')),'and hides a brand it follows');
select is((select array_agg(capture_id::text order by capture_id::text) from public.competitor_hidden),
  (select array_agg(x order by x) from unnest(array[current_setting('test.wick'),current_setting('test.followed')]) x),
  'members read their workspace''s hidden brands');
reset role;
select is((select active from public.competitor_subscriptions s join public.competitor_captures c on c.id = s.capture_id
  where s.tenant_id='00000000-0000-4000-8000-000000000101' and c.domain='followed.example'),false,
  'a hidden brand is no longer followed');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select array_agg(x order by x) from pg_temp.ask('00000000-0000-4000-8000-000000000101') x),
  array['bark.example','quiet.example'],'a hidden brand is never suggested');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok(format('select public.unhide_competitor(%L,%L)','00000000-0000-4000-8000-000000000101',
  current_setting('test.wick')),'the owner shows it again');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok('wick.example' in (select pg_temp.ask('00000000-0000-4000-8000-000000000101')),'and it may be suggested again');
reset role;

-- A real store (Raman, 16 Nov) gets real brands, never a sample one.
update public.brand_profiles set synthetic = false, domain = 'north-studio.test'
  where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select array_agg(x order by x) from pg_temp.ask('00000000-0000-4000-8000-000000000102') x),
  array['otherreal.test','realbrand.test'],'a real store gets the inbox''s real brands');
reset role;

-- No brand profile yet: nothing.
delete from public.brand_profiles where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select count(*)::integer from pg_temp.ask('00000000-0000-4000-8000-000000000102')),0,
  'no brand profile yet: nothing');
reset role;

select ok(exists(select 1 from pg_indexes where indexname = 'competitor_emails_capture_industry'),
  'label counts have their own index');

select * from finish();
rollback;
