begin;
select plan(25);

-- Owner of workspace 101 (seed brand "Cedar Lane", approved).
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select ok((select approved_revision = revision from public.brand_profiles), 'seed brand starts approved');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',0,
    '{"brand_name":"Cedar Lane Goods","niche":"Outdoor layers","positioning":"Quiet weekend layers.","website":"cedar-lane.example"}'),
  1,'owner saves Identity; first revision');
select is(
  (select row(brand_name, domain, positioning, approved_revision is null)::text from public.brand_profiles),
  row('Cedar Lane Goods','cedar-lane.example','Quiet weekend layers.',true)::text,
  'Identity edit updates what the AI reads and clears the brand approval');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',0,'{"niche":"x"}')$$,
  'PT409',null,'a stale edit is refused, not overwritten');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',1,
    '{"brand_name":"Cedar Lane Goods","niche":"Outdoor layers and caps","positioning":"Quiet weekend layers.","website":"cedar-lane.example"}'),
  2,'editing a field the AI does not read is saved');
select is(
  (select revision from public.brand_profiles), 2,
  'unchanged AI inputs do not bump the brand revision again');

-- Field validation.
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',2,'{"unknown":"x"}')$$,'23514',null,'unknown field refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',2,jsonb_build_object('niche',repeat('x',201)))$$,'23514',null,'too-long text refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,'{"do":[1,2]}')$$,'23514',null,'non-text list item refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,'{"do":"one string"}')$$,'23514',null,'a list must be a list');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,jsonb_build_object('do',(select jsonb_agg('x'::text) from generate_series(1,16))))$$,'23514',null,'more than 15 items refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','vocabulary',0,'{"terms":[{"term":"a","definition":"b","extra":1}]}')$$,'23514',null,'term with extra keys refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,'{}','{nope}')$$,'23514',null,'locking an unknown field refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','pricing',0,'{}')$$,'23514',null,'unknown section refused');

-- Tone feeds voice and prohibitions; locks survive "Redo with AI".
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,
    '{"formality":"Casual","do":["Say what it is","Be brief"],"dont":["No hype"]}','{do}'),
  1,'owner saves Tone and locks the Do list');
select is(
  (select row(voice, prohibitions)::text from public.brand_profiles),
  row(E'Say what it is\nBe brief','No hype')::text,
  'Do / Don''t lists become the voice and prohibitions the AI reads');
select is(
  public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','tone',1,
    '{"formality":"Warm","do":["AI line"],"dont":["AI rule"]}'),
  2,'AI suggestion applied');
select is(
  (select row(content->>'formality', content->'do', content->'dont', source, locked)::text
     from public.brand_profile_sections where section='tone'),
  row('Warm','["Say what it is", "Be brief"]'::jsonb,'["AI rule"]'::jsonb,'sample','{do}'::text[])::text,
  'locked Do list kept; unlocked fields replaced; locks unchanged');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','tone',2,'{"made_up":"x"}')$$,'23514',null,'invalid suggestion refused');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',2,'{"do":[],"dont":[]}'),
  3,'clearing both lists is allowed');
select is(
  (select row(voice, prohibitions)::text from public.brand_profiles),
  row('','')::text,'empty lists clear the voice text instead of keeping old rules');

-- Staff read but cannot edit or redo.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.brand_profile_sections),2::bigint,'staff can read the profile');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',0,'{}')$$,'42501',null,'staff cannot edit');

-- Another workspace sees and changes nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.brand_profile_sections),0::bigint,'other workspace cannot read');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','tone',3,'{}')$$,'42501',null,'other workspace cannot redo');
reset role;

select * from finish();
rollback;
