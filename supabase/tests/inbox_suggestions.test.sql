begin;
select plan(12);

-- ONB-065a: the inbox brands a workspace may be suggested. Owner ...01 and
-- staff ...05 are in sample workspace 101; owner ...04 runs workspace 102.
insert into public.competitor_captures(domain, synthetic, brand_name, niche, subscription_status, last_received_at) values
  ('bark.example', true, 'Bark Co', 'Dog treats', 'subscribed', now() - interval '1 day'),
  ('wick.example', true, 'Wick', 'Scented candles', 'subscribed', now() - interval '2 days'),
  ('quiet.example', true, null, null, 'subscribed', null),
  ('pending.example', true, 'Pending', 'Dog treats', 'pending', now()),
  ('followed.example', true, 'Followed', 'Dog treats', 'subscribed', now()),
  ('dropped.example', true, 'Dropped', 'Dog treats', 'subscribed', now()),
  ('gone.example', true, 'Gone', 'Dog treats', 'unsubscribed', now()),
  ('never.example', true, 'Never', 'Dog treats', 'not_subscribed', now()),
  ('realbrand.test', false, 'Real Brand', 'Dog treats', 'subscribed', now());
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
select pg_temp.email('bark.example', '1 day', 'pet');
select pg_temp.email('bark.example', '3 days');
select pg_temp.email('bark.example', '5 days');
select pg_temp.email('bark.example', '40 days', 'pet');
select pg_temp.email('wick.example', '2 days', 'home');
select pg_temp.email('wick.example', '50 days', 'home');
select pg_temp.email('wick.example', '60 days', 'home');
select pg_temp.email('followed.example', '1 day');

-- Grants.
select ok(has_function_privilege('authenticated','public.suggestable_inbox_brands(uuid,timestamptz)','execute')
  and not has_function_privilege('anon','public.suggestable_inbox_brands(uuid,timestamptz)','execute'),
  'signed-in members may ask, anonymous visitors not');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
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
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*)::integer from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101', now())),3,
  'staff may ask too');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select * from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000101', now())$$,'42501',null,
  'another workspace cannot ask');
reset role;

-- A real store gets none yet (who may see the inbox's real brands waits
-- for Raman), and never a sample one.
update public.brand_profiles set synthetic = false, domain = 'north-studio.test'
  where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000102', now())),0,
  'a real store gets no inbox brands yet');
reset role;

-- No brand profile yet: nothing.
delete from public.brand_profiles where tenant_id = '00000000-0000-4000-8000-000000000102';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::integer from public.suggestable_inbox_brands('00000000-0000-4000-8000-000000000102', now())),0,
  'no brand profile yet: nothing');
select throws_ok($$select * from public.suggestable_inbox_brands(null, now())$$,'42501',null,'no workspace, no answer');
reset role;

select ok(exists(select 1 from pg_indexes where indexname = 'competitor_emails_capture_industry'),
  'label counts have their own index');

select * from finish();
rollback;
