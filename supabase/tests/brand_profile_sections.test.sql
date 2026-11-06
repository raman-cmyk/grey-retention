begin;
select plan(67);

-- Known starting point, whatever earlier scripts did to the seed data.
delete from public.brand_profile_sections
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
update public.brand_profiles
  set approved_revision = revision, approved_by = '00000000-0000-4000-8000-000000000001', approved_at = now()
  where tenant_id = '00000000-0000-4000-8000-000000000101';
delete from public.brand_profiles where tenant_id = '00000000-0000-4000-8000-000000000102';
-- No campaign of workspace 101 is mid-delivery (other scripts may leave one).
update public.campaigns set delivery_state = 'not_ready'
  where tenant_id = '00000000-0000-4000-8000-000000000101'
    and delivery_state in ('queued','preparing','prepared','scheduling','scheduled','reconciling');
update public.campaigns set delivery_state = 'not_ready', calendar_state = 'approved'
  where id = '00000000-0000-4000-8000-000000000601';
select set_config('test.rev', revision::text, true) from public.brand_profiles
  where tenant_id = '00000000-0000-4000-8000-000000000101';

-- Grants: members only read; every write goes through the commands.
select ok(not has_table_privilege('anon','public.brand_profile_sections','select'),'anon cannot read sections');
select ok(not has_table_privilege('authenticated','public.brand_profile_sections','insert,update,delete,truncate'),'members cannot write the table directly');
select ok(not has_table_privilege('anon','public.brand_profile_sections','truncate'),'anon cannot truncate');
select ok(not has_table_privilege('service_role','public.brand_profile_sections','select,insert,update,delete'),'service role has no table access');
select ok(not has_function_privilege('anon','public.save_brand_section(uuid,text,integer,jsonb,text[],jsonb,integer)','execute'),'anon cannot save');
select ok(not has_function_privilege('service_role','public.apply_brand_suggestion(uuid,text,integer,jsonb)','execute'),'service role cannot redo');
select ok(not has_function_privilege('authenticated','private.save_brand_facts(uuid,text,jsonb,integer)','execute'),'helpers stay private');

-- Owner of workspace 101.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok(
  $$insert into public.brand_profile_sections(tenant_id,section,source) values ('00000000-0000-4000-8000-000000000101','audience','owner')$$,
  '42501',null,'owner cannot write the table directly');

-- Notes only: brand facts untouched, approval kept.
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',0,'{"niche":"Outdoor layers"}'),
  '{"revision":1,"brand_changed":false}'::jsonb,'owner saves Identity notes; first revision');
select is(
  (select row(revision = current_setting('test.rev')::int, approved_revision = revision)::text from public.brand_profiles),
  row(true,true)::text,'notes do not change the brand or its approval');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',0,'{"niche":"x"}')$$,
  'PT409',null,'a stale section edit is refused, not overwritten');

-- Brand facts on the same card.
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',1,'{"niche":"Outdoor layers"}','{}',
    (select jsonb_build_object('brand_name',brand_name,'domain',domain,'positioning',E'  '||positioning||E'\r\n') from public.brand_profiles),
    current_setting('test.rev')::int),
  '{"revision":2,"brand_changed":false}'::jsonb,'re-saving the same facts (extra spaces, Windows line ends) is not a change');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',2,'{"niche":"Outdoor layers"}','{}',
    '{"brand_name":"Cedar Lane Goods","domain":"cedar-lane.example","positioning":"Quiet weekend layers."}',
    current_setting('test.rev')::int),
  '{"revision":3,"brand_changed":true}'::jsonb,'changed facts are saved');
select is(
  (select row(brand_name, domain, positioning, revision - current_setting('test.rev')::int, approved_revision is null)::text from public.brand_profiles),
  row('Cedar Lane Goods','cedar-lane.example','Quiet weekend layers.',1,true)::text,
  'facts go to what the AI reads; brand revision bumps once; approval cleared');
select is(
  (select row(calendar_state, copy_state)::text from public.campaigns where id='00000000-0000-4000-8000-000000000601'),
  row('proposed','draft')::text,'unsent campaigns go back to draft (brand guard)');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}',
    '{"positioning":"Older text from a stale page"}',current_setting('test.rev')::int)$$,
  'PT409','Brand details changed in another window','a stale brand revision is refused (edit made elsewhere is kept)');
select is((select positioning from public.brand_profiles),'Quiet weekend layers.','stale facts were not written');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','{"brand_name":" C "}',current_setting('test.rev')::int + 1)$$,
  '23514','Brand name needs 2 to 120 characters','a one-letter brand name is refused');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','{"voice":"x"}',current_setting('test.rev')::int + 1)$$,
  '23514',null,'Identity cannot change the voice');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',0,'{}','{}','{"voice":"x"}',current_setting('test.rev')::int + 1)$$,
  '23514',null,'other sections carry no brand facts');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}',jsonb_build_object('positioning',repeat('x',5001)),current_setting('test.rev')::int + 1)$$,
  '23514',null,'positioning over 5000 characters refused');

-- Tone: voice and prohibitions are kept as written (no splitting or limits per line).
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',0,'{"formality":"Casual"}','{formality}',
    jsonb_build_object('voice',E'Use U.S. spelling. Write like Mr. Pemberly''s field notes.\n'||repeat('y',400),'prohibitions','No hype'),
    current_setting('test.rev')::int + 1),
  '{"revision":1,"brand_changed":true}'::jsonb,'owner saves Tone with its rules and locks Formality');
select is(
  (select row(voice, prohibitions)::text from public.brand_profiles),
  row(E'Use U.S. spelling. Write like Mr. Pemberly''s field notes.\n'||repeat('y',400),'No hype')::text,
  'Do / Don''t text is stored verbatim as the voice and prohibitions');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',1,'{"formality":"Casual"}','{formality}',
    '{"prohibitions":""}',current_setting('test.rev')::int + 2),
  '{"revision":2,"brand_changed":true}'::jsonb,'clearing Don''t is a change');
select is((select row(prohibitions, approved_revision)::text from public.brand_profiles),row('',null)::text,'Don''t cleared; approval cleared');

-- Active delivery: brand facts wait, with the brand guard's own message.
reset role;
update public.campaigns set delivery_state = 'scheduled' where id = '00000000-0000-4000-8000-000000000601';
set local role authenticated;
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',2,'{}','{}','{"prohibitions":"No hype"}',current_setting('test.rev')::int + 3)$$,
  '23514','Cancel or reconcile active delivery before correcting brand facts','facts cannot change while a campaign is being delivered');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',2,'{"formality":"Casual","energy":"Calm"}','{formality}',
    '{"prohibitions":""}',current_setting('test.rev')::int + 3),
  '{"revision":3,"brand_changed":false}'::jsonb,'notes still save during delivery when the facts are unchanged');
reset role;
update public.campaigns set delivery_state = 'not_ready' where id = '00000000-0000-4000-8000-000000000601';
set local role authenticated;

-- Field validation.
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{"unknown":"x"}')$$,'23514',null,'unknown field refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{"positioning":"x"}')$$,'23514',null,'brand facts are not section fields');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,jsonb_build_object('niche',repeat('x',201)))$$,'23514',null,'too-long text refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','vocabulary',0,'{"preferred":[1,2]}')$$,'23514',null,'non-text list item refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','vocabulary',0,'{"preferred":"one string"}')$$,'23514',null,'a list must be a list');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','vocabulary',0,jsonb_build_object('avoid',(select jsonb_agg('x'::text) from generate_series(1,16))))$$,'23514',null,'more than 15 items refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','vocabulary',0,'{"terms":[{"term":"a","definition":"b","extra":1}]}')$$,'23514',null,'term with extra keys refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',0,'{}','{nope}')$$,'23514',null,'locking an unknown field refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',0,'{}',array[null]::text[])$$,'23514',null,'a NULL lock is refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','pricing',0,'{}')$$,'23514',null,'unknown section refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','"x"',current_setting('test.rev')::int + 3)$$,'23514',null,'facts must be an object');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','{"brand_name":5}',current_setting('test.rev')::int + 3)$$,'23514',null,'facts must be text');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','{"brand_name":"Cedar Lane Goods"}',null)$$,'PT409',null,'facts without a brand revision are refused');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','tone',3,'{}','{}','{"voice":"x"}',current_setting('test.rev')::int + 2)$$,'PT409',null,'a stale brand revision is refused on Tone too');

-- Redo with AI: locked and omitted fields keep their value; facts never change.
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',0,
    '{"primary_persona":"Weekend walkers","age_range":"30-50","pain_points":["Scratchy wool"]}','{primary_persona,primary_persona}'),
  '{"revision":1,"brand_changed":false}'::jsonb,'owner saves Audience and locks the persona (duplicates ignored)');
select is((select locked from public.brand_profile_sections where section='audience'),'{primary_persona}'::text[],'locks stored once');
select is(
  public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','audience',1,
    '{"primary_persona":"AI persona","motivations":["Sample: why customers choose you"]}'),
  2,'suggestion applied');
select is(
  (select row(content->>'primary_persona', content->>'age_range', content->'pain_points', content->'motivations', source)::text
     from public.brand_profile_sections where section='audience'),
  row('Weekend walkers','30-50','["Scratchy wool"]'::jsonb,'["Sample: why customers choose you"]'::jsonb,'sample')::text,
  'locked persona kept; omitted fields kept; suggested field added');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','audience',1,'{}')$$,'PT409',null,'a stale redo is refused');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','identity',3,'{"positioning":"AI text"}')$$,'23514',null,'a suggestion cannot change brand facts');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','audience',2,'{"made_up":"x"}')$$,'23514',null,'invalid suggestion refused');
select is(
  public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','vocabulary',0,'{"avoid":["Sample: words you never use"]}'),
  1,'a redo can create a section the owner never saved');
select is(
  (select row(revision - current_setting('test.rev')::int, prohibitions)::text from public.brand_profiles),
  row(3,'')::text,'no redo changed the brand');

-- The older brand commands (Get started) and this page never overwrite each other.
select lives_ok(
  $$select public.save_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int + 3,
    'Cedar Lane Goods','cedar-lane.example','Changed on Get started.','','')$$,
  'Get started saves the brand');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}',
    '{"positioning":"Text from a page opened earlier"}',current_setting('test.rev')::int + 3)$$,
  'PT409','Brand details changed in another window','a page opened before that save cannot overwrite it');
select is((select positioning from public.brand_profiles),'Changed on Get started.','the newer text is kept');
select throws_ok(
  $$select public.approve_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int + 3)$$,
  'PT409',null,'approving an older version is refused');
select lives_ok(
  $$select public.approve_brand('00000000-0000-4000-8000-000000000101',current_setting('test.rev')::int + 4)$$,
  'approving the current version works');
select ok((select approved_revision = revision from public.brand_profiles),'the current version is approved');

-- Staff and the team admin read but cannot edit or redo.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.brand_profile_sections),4::bigint,'staff can read the profile');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',2,'{}')$$,'42501',null,'staff cannot edit');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','audience',2,'{}')$$,'42501',null,'staff cannot redo');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','identity',3,'{}','{}','{"brand_name":"Admin pick"}',current_setting('test.rev')::int + 3)$$,'42501',null,'team admin cannot change brand facts');

-- Another workspace sees and changes nothing; its first Identity save creates its brand.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.brand_profile_sections),0::bigint,'other workspace cannot read');
select throws_ok($$select public.apply_brand_suggestion('00000000-0000-4000-8000-000000000101','audience',2,'{}')$$,'42501',null,'other workspace cannot redo');
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',2,'{}')$$,'42501',null,'other workspace cannot edit');
select throws_ok(
  $$select public.save_brand_section('00000000-0000-4000-8000-000000000102','tone',0,'{}','{}','{"voice":"Calm"}',0)$$,
  '23514','Save the Brand Identity first','Tone needs a brand first');
select is(
  public.save_brand_section('00000000-0000-4000-8000-000000000102','identity',0,'{}','{}','{"brand_name":"Juniper Supply","domain":"juniper.example"}',0),
  '{"revision":1,"brand_changed":true}'::jsonb,'first Identity save creates the brand');
select is((select row(brand_name, revision, approved_revision)::text from public.brand_profiles),row('Juniper Supply',1,null)::text,'new brand waits for approval');
reset role;

-- Anonymous callers get nothing.
set local role anon;
select throws_ok($$select public.save_brand_section('00000000-0000-4000-8000-000000000101','audience',2,'{}')$$,'42501',null,'anon cannot call the command');
reset role;

select * from finish();
rollback;
