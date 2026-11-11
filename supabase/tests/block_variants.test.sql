begin;
select plan(66);

-- CI-002: the block library. Owner ...01 follows northwind.example
-- (workspace 101); ...02 is a platform admin; ...03 is a designer with no
-- workspace membership.
create function pg_temp.k(n int) returns text language sql as $$ select encode(extensions.digest('variants-' || n, 'sha256'), 'hex') $$;
create function pg_temp.obj(bucket text, name text) returns void language sql as $$
  insert into storage.objects(bucket_id, name) values (bucket, name) on conflict do nothing
$$;
create function pg_temp.sect(n int) returns jsonb language sql as $$
  select jsonb_build_object('ordinal', n, 'html', '<tr><td>Row ' || n || '</td></tr>', 'text', 'Row ' || n, 'kind', 'text',
    'words', 2, 'images', 0, 'wideImages', 0, 'links', '[]'::jsonb)
$$;
create function pg_temp.tag(n int, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('ordinal', n, 'state', 'tagged', 'family', 'product_feature', 'layout', 'image_left',
    'purpose', 'product_showcase', 'styles', '["photo_led"]'::jsonb, 'confidence', 0.8, 'pass', 'fast', 'model', 'gemini-2.5-flash-lite') || extra
$$;
create function pg_temp.section(n int) returns text language sql as $$
  select id::text from public.email_sections where inbox_message_id = current_setting('test.message')::uuid and ordinal = n
$$;
create function pg_temp.spec() returns jsonb language sql as $$
  select '{"rows":[{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false}]},
    {"width":0.5,"slots":[{"kind":"heading","size":"s"},{"kind":"price"}]}]}],"align":"left","background":"none","padding":"m"}'::jsonb
$$;
create function pg_temp.made(n int, fingerprint text, skeleton text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('section_id', pg_temp.section(n), 'state', 'made', 'skeleton_fingerprint', skeleton,
    'variant', jsonb_build_object('fingerprint', fingerprint, 'pass', 'maker', 'model', 'gemini-2.5-flash',
      'styles', '["photo_led"]'::jsonb, 'spec', pg_temp.spec()) || extra)
$$;
create function pg_temp.place(entries jsonb) returns jsonb language sql as $$
  select public.record_block_variants(current_setting('test.variant')::uuid, current_setting('test.variantlease')::uuid, entries)
$$;

-- Grants and the seeds.
select ok(not bool_or(has_function_privilege(r, f, 'execute')),'browser roles cannot place sections or read where variants came from')
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.record_block_variants(uuid,uuid,jsonb)','public.find_block_variants(text[])']) f;
select ok(bool_and(has_function_privilege('service_role', f, 'execute')),'the worker can')
  from unnest(array['public.record_block_variants(uuid,uuid,jsonb)','public.find_block_variants(text[])',
    'public.search_block_variants(jsonb,integer)']) f;
select ok(has_function_privilege('authenticated','public.search_block_variants(jsonb,integer)','execute')
  and not has_function_privilege('anon','public.search_block_variants(jsonb,integer)','execute'),
  'signed-in people may search the library; anonymous visitors may not');
select ok(not bool_or(has_table_privilege(r, 'public.block_variants', p)),'browser roles cannot write the library')
  from unnest(array['anon','authenticated']) r, unnest(array['insert','update','delete','truncate','references','trigger']) p;
select ok(not has_table_privilege('anon','public.block_variants','select'),'anonymous visitors cannot read it');
select is((select count(*)::int from public.block_variants where source = 'seed' and pass = 'seed' and evidence = 0 and model is null),20,
  'the 20 seed blocks are in the library');
select is((select count(distinct family)::int from public.block_variants),20,'one seed for each family');
select is((select count(*)::int from public.block_variants where key = family || '/seed'),20,'each seed is named <family>/seed');

-- A followed sample brand's email with four sections, tagged.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.subscribe_competitor('00000000-0000-4000-8000-000000000101','northwind.example');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.admin_save_inbox_brand('northwind.example','northwind','Northwind','apparel');
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.eml'), pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.html'),
  pg_temp.obj('inbox-raw','fake/'||pg_temp.k(1)||'.marked.html');
set local role service_role;
select set_config('test.poll',public.enqueue_inbox_poll('fake')::text,true);
select set_config('test.polllease',(select lease_token::text from public.claim_platform_job(array['inbox.poll'],'fake')),true);
select public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(1),'uid',9401,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-01T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(1)||'.eml','rawSha256',pg_temp.k(1),
    'htmlPath','fake/'||pg_temp.k(1)||'.html','subject','Spring','text','Hello','aliasSlug','northwind'));
select set_config('test.message',(select id::text from public.inbox_messages where message_key=pg_temp.k(1)),true);
select set_config('test.job',(select id::text from public.claim_platform_job(array['inbox.assets'])),true);
select public.record_inbox_sections(current_setting('test.job')::uuid,(select lease_token from public.platform_jobs where id=current_setting('test.job')::uuid),
  'fake/'||pg_temp.k(1)||'.marked.html',(select jsonb_agg(pg_temp.sect(n)) from generate_series(1,6) n),null,0.5);
select public.finish_platform_job(current_setting('test.job')::uuid,(select lease_token from public.platform_jobs where id=current_setting('test.job')::uuid));
reset role;
update public.platform_jobs set available_at = now() where kind = 'inbox.label' and subject_key = current_setting('test.message');
set local role service_role;
select set_config('test.label',(select id::text from public.claim_platform_job(array['inbox.label'])),true);
select set_config('test.labellease',(select lease_token::text from public.platform_jobs where id=current_setting('test.label')::uuid),true);
select public.record_section_tags(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,jsonb_build_array(
  pg_temp.tag(1), pg_temp.tag(2),
  pg_temp.tag(3,'{"family":"cta","layout":"single_column","purpose":"call_to_action","styles":["minimal"]}'),
  jsonb_build_object('ordinal',4,'state','untagged','pass','strong','model','gemini-2.5-flash'),
  pg_temp.tag(5,'{"family":"text","layout":"single_column","purpose":"story","styles":[]}'),
  pg_temp.tag(6,'{"family":"text","layout":"single_column","purpose":"story","styles":[]}')),'tags-v1');
select is((select count(*)::int from public.platform_jobs where kind='inbox.variant'),0,'no variant job before the email is tagged');
select public.record_inbox_tags(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  jsonb_build_object('state','tagged','industry','apparel','email_type','new_arrivals','offer_type','percent_off','season','spring',
    'angle','newness','brand_size','mid','confidence',0.75,'pass','strong','model','gemini-2.5-flash'),'{"version":2}',2);

-- The email's tags queue one variant job.
select is((select idempotency_key from public.platform_jobs where kind='inbox.variant'),
  'inbox.variant:'||current_setting('test.message')||':variants-v1','recording the tags queues the variant job, once');
select set_config('test.variant',(select id::text from public.claim_platform_job(array['inbox.variant'])),true);
select set_config('test.variantlease',(select lease_token::text from public.platform_jobs where id=current_setting('test.variant')::uuid),true);
select isnt(current_setting('test.variant'),'','the worker claims it');

-- Only well-formed entries, for this email's tagged sections.
select throws_ok($$select public.record_block_variants(current_setting('test.label')::uuid,current_setting('test.labellease')::uuid,
  jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11))))$$,'23514',null,'another kind of job cannot place sections');
select throws_ok($$select public.record_block_variants(current_setting('test.variant')::uuid,gen_random_uuid(),
  jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11))))$$,'PT409',null,'a stale lease cannot place sections');
select throws_ok($$select pg_temp.place('{}'::jsonb)$$,'23514',null,'a list of sections is required');
select throws_ok($$select pg_temp.place((select jsonb_agg(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11))) from generate_series(1,41)))$$,'23514',null,
  'at most 40 sections');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11)) || '{"section_id":"s1"}'))$$,'23514',null,
  'a section is named by its id');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11)) || '{"state":"copied"}'))$$,'23514',null,
  'made, matched or left out only');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,'abc',pg_temp.k(11))))$$,'23514',null,'a fingerprint is a sha-256');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),'abc')))$$,'23514',null,
  'a made variant keeps the fingerprint of the HTML structure');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11),'{"pass":"seed"}')))$$,'23514',null,
  'only the Variant maker or the HTML structure makes a variant');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11),'{"spec":{"rows":[]}}')))$$,'23514',null,
  'a variant has one to six rows');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11),
  jsonb_build_object('spec', jsonb_build_object('rows', pg_temp.spec()->'rows', 'pad', repeat('x', 8000))))))$$,'23514',null,'a variant is small');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11)) || jsonb_build_object('section_id',gen_random_uuid())))$$,
  '23514',null,'a section of another email cannot be placed');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(4,pg_temp.k(10),pg_temp.k(11))))$$,'23514',null,
  'an untagged section is not placed');
select throws_ok($$select pg_temp.place(jsonb_build_array(jsonb_build_object('section_id',pg_temp.section(3),'state','matched',
  'variant_id',gen_random_uuid(),'skeleton_fingerprint',pg_temp.k(30))))$$,'23514',null,'evidence goes to a variant that exists');
select throws_ok($$select pg_temp.place(jsonb_build_array(jsonb_build_object('section_id',pg_temp.section(3),'state','matched',
  'variant_id',(select id from public.block_variants where family='hero_image'),'skeleton_fingerprint',pg_temp.k(30))))$$,'23514',null,
  'and of the same family');
select is((select count(*)::int from public.block_variants),20,'nothing was added by a refused batch');

-- New structures, repeats, evidence for a seed, and sections left out.
select is(pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(10),pg_temp.k(11)))),
  '{"made": 1, "matched": 0, "dropped": 0}'::jsonb,'a new structure becomes a variant');
select is((select family||'/'||layout||'/'||purpose||'/'||array_to_string(styles,'+')||'/'||source||'/'||pass||'/'||model||'/'||evidence
    from public.block_variants where fingerprint=pg_temp.k(10)),
  'product_feature/image_left/product_showcase/photo_led/competitor/maker/gemini-2.5-flash/1',
  'with the section''s own tags, from a competitor, seen once');
select is((select key from public.block_variants where fingerprint=pg_temp.k(10)),'product_feature/'||left(pg_temp.k(10),16),
  'named by its family and fingerprint');
select throws_ok($$select pg_temp.place(jsonb_build_array(pg_temp.made(3,pg_temp.k(10),pg_temp.k(31))))$$,'23514',null,
  'a fingerprint belongs to one family');
select is(pg_temp.place(jsonb_build_array(pg_temp.made(2,pg_temp.k(10),pg_temp.k(12)),
    jsonb_build_object('section_id',pg_temp.section(3),'state','matched','variant_id',(select id from public.block_variants where family='cta'),
      'skeleton_fingerprint',pg_temp.k(30)),
    jsonb_build_object('section_id',pg_temp.section(5),'state','unusable','skeleton_fingerprint',pg_temp.k(50)),
    jsonb_build_object('section_id',pg_temp.section(6),'state','unusable','skeleton_fingerprint',null))),
  '{"made": 0, "matched": 2, "dropped": 2}'::jsonb,'the same structure again adds evidence instead of a copy');
select is((select evidence from public.block_variants where fingerprint=pg_temp.k(10)),2,'the variant has been seen twice');
select is((select evidence from public.block_variants where family='cta' and source='seed'),1,'a seed gains evidence too');
select is((select count(*)::int from public.block_variants),21,'one new variant in all');
select is((select string_agg(ordinal||':'||coalesce(variant_state,'-')||':'||(variant_id is not null)||':'||(skeleton_fingerprint is not null),
    ',' order by ordinal) from public.email_sections where inbox_message_id=current_setting('test.message')::uuid),
  '1:made:true:true,2:matched:true:true,3:matched:true:true,4:-:false:false,5:unusable:false:true,6:unusable:false:false',
  'each section knows what it became (an unusable structure is remembered only when a model answered)');
select is(pg_temp.place(jsonb_build_array(pg_temp.made(1,pg_temp.k(13),pg_temp.k(11)),
    jsonb_build_object('section_id',pg_temp.section(5),'state','no_structure'))),
  '{"made": 0, "matched": 0, "dropped": 0}'::jsonb,'a retry places nothing twice');
select is((select evidence from public.block_variants where fingerprint=pg_temp.k(10)),2,'and adds no evidence');
select ok(not exists(select 1 from public.block_variants where fingerprint=pg_temp.k(13)),'nor a variant');

-- What the library already knows, for the next email's structures.
select is((select jsonb_object_agg(fingerprint, coalesce(variant_id::text,'unusable'))
    from public.find_block_variants(array[pg_temp.k(10), pg_temp.k(12), pg_temp.k(50), pg_temp.k(99)])),
  jsonb_build_object(pg_temp.k(10),(select id::text from public.block_variants where fingerprint=pg_temp.k(10)),
    pg_temp.k(12),(select id::text from public.block_variants where fingerprint=pg_temp.k(10)),
    pg_temp.k(50),'unusable'),
  'a variant by its fingerprint, by a section with the same structure, or a structure found unusable');
select throws_ok($$select * from public.find_block_variants((select array_agg(pg_temp.k(n)) from generate_series(1,41) n))$$,'23514',null,
  'at most 40 structures at once');

-- Variant jobs are put back like tag jobs.
select public.defer_platform_job(current_setting('test.variant')::uuid,current_setting('test.variantlease')::uuid,0,'variants_continue');
select is((select status||'/'||attempt||'/'||last_error_code from public.platform_jobs where id=current_setting('test.variant')::uuid),
  'queued/0/variants_continue','a variant job put back keeps its tries');
reset role;
update public.inbox_messages set labelled_at = labelled_at + interval '1 second' where id = current_setting('test.message')::uuid;
select is((select count(*)::int from public.platform_jobs where kind='inbox.variant'),1,'a later change queues no second variant job');

select throws_ok($$update public.email_sections set variant_state='made' where id=pg_temp.section(4)::uuid$$,'23514',null,
  'a placed section is placed whole');

-- Mail from an unknown sender joins the library only once it is assigned.
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(n)||'.eml') from generate_series(4,5) n;
set local role service_role;
select public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(n),'uid',9400+n,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-03T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(n)||'.eml','rawSha256',pg_temp.k(n),
    'subject','Hello','text','Hello'))
  from generate_series(4,5) n;
reset role;
select set_config('test.unknown',(select id::text from public.inbox_messages where message_key=pg_temp.k(4)),true);
select set_config('test.unknown2',(select id::text from public.inbox_messages where message_key=pg_temp.k(5)),true);
insert into public.email_sections(inbox_message_id, ordinal, html, kind, words, images, block_type, label_source, labelled_at, layout, purpose,
    styles, confidence, tag_state, tag_pass, tag_version)
  select id, 1, '<tr><td>x</td></tr>', 'text', 1, 0, 'text', 'gemini', now(), 'single_column', 'story', '{}', 0.8, 'tagged', 'fast', 'tags-v1'
  from public.inbox_messages where id in (current_setting('test.unknown')::uuid, current_setting('test.unknown2')::uuid);
update public.inbox_messages set facts = '{"version":2}', extraction_version = 2, labelled_at = now()
  where id = current_setting('test.unknown')::uuid;
select is((select state||'/'||(select count(*) from public.platform_jobs j where j.kind='inbox.variant' and j.subject_key=m.id::text)
    from public.inbox_messages m where m.id = current_setting('test.unknown')::uuid),'unassigned/0',
  'a tagged email from an unknown sender is not placed');
update public.inbox_messages set state = 'assigned', method = 'admin',
    capture_id = (select id from public.competitor_captures where domain = 'northwind.example')
  where id = current_setting('test.unknown')::uuid;
select is((select count(*)::int from public.platform_jobs where kind='inbox.variant' and subject_key=current_setting('test.unknown')),1,
  'once an admin assigns it, it is queued for the library');
insert into public.platform_jobs(kind, subject_key, idempotency_key)
  values ('inbox.variant', current_setting('test.unknown2'), 'inbox.variant:' || current_setting('test.unknown2') || ':test');
set local role service_role;
select set_config('test.stray',(select id::text from public.claim_platform_job(array['inbox.variant'], current_setting('test.unknown2'))),true);
select throws_ok($$select public.record_block_variants(current_setting('test.stray')::uuid,
  (select lease_token from public.platform_jobs where id = current_setting('test.stray')::uuid),
  jsonb_build_array(jsonb_build_object('section_id',(select id from public.email_sections where inbox_message_id = current_setting('test.unknown2')::uuid),
    'state','no_structure')))$$,'23514',null,'an email not assigned to a brand is never placed');
reset role;

-- Search: signed-in members and the agents, by every label.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select * from public.search_block_variants()$$,'42501',null,'someone who is not in a workspace cannot search');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select * from public.search_block_variants()$$,'42501',null,'nor without a role in the token');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*)::int from public.search_block_variants('{}', 100)),21,'any workspace member can, the whole library');
select is((select count(*)::int from public.block_variants),0,'but not the table itself');
select is((select string_agg(key||':'||evidence, ',') from public.search_block_variants('{"family":"product_feature"}')),
  'product_feature/'||left(pg_temp.k(10),16)||':2,product_feature/seed:0','by family, most seen first, by name');
select is((select count(*)::int from public.search_block_variants('{"industry":"apparel"}')),0,
  'a member finds nothing by the emails'' labels that fewer than 3 brands sent');
select is((select string_agg(family, ',') from public.search_block_variants('{"style":["minimal"],"purpose":"call_to_action","source":"seed"}')),
  'cta','by style, purpose and source together');
select is((select count(*)::int from public.search_block_variants('{}', 3)),3,'a search returns at most what was asked');
select throws_ok($$select * from public.search_block_variants('{"brand":"northwind"}')$$,'23514',null,'never by brand');
select throws_ok($$select * from public.search_block_variants('{"family":5}')$$,'23514',null,'a label is a word or a list of words');
select throws_ok($$select * from public.search_block_variants('{"family":[]}')$$,'23514',null,'a list holds one to 20 words');
select throws_ok($$select * from public.search_block_variants('{}', 0)$$,'23514',null,'one to 100 results');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.block_variants),21,'a platform admin reads the table');
select is((select string_agg(family||':'||matches, ',') from public.search_block_variants('{"industry":"apparel","season":["spring","summer"]}')),
  'product_feature:2,cta:1','and searches by the emails'' labels with no minimum, most seen there first');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((select string_agg(family||':'||matches, ',') from public.search_block_variants('{"industry":"apparel"}')),
  'product_feature:2,cta:1','so do the agents');
select is((select count(*)::int from public.search_block_variants('{"industry":"home"}')),0,'none seen in another industry');
reset role;

-- Two more brands send the same product structure: now 3 brands.
select set_config('request.jwt.claims','',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.admin_save_inbox_brand('southwind.example','southwind','Southwind','apparel');
select public.admin_save_inbox_brand('eastwind.example','eastwind','Eastwind','apparel');
reset role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.obj('inbox-raw','fake/'||pg_temp.k(n)||'.eml') from generate_series(2,3) n;
set local role service_role;
select public.record_inbox_message(current_setting('test.poll')::uuid,current_setting('test.polllease')::uuid,
  jsonb_build_object('messageKey',pg_temp.k(n),'uid',9400+n,'uidValidity',1,'rawBytes',900,'receivedAt','2026-11-02T10:00:00Z',
    'synthetic',true,'kind','message','rawPath','fake/'||pg_temp.k(n)||'.eml','rawSha256',pg_temp.k(n),
    'subject','Spring','text','Hello','aliasSlug',(array['southwind','eastwind'])[n-1]))
  from generate_series(2,3) n;
reset role;
insert into public.email_sections(inbox_message_id, ordinal, html, kind, words, images, block_type, label_source, labelled_at, layout, purpose,
    styles, confidence, tag_state, tag_pass, tag_version, variant_id, variant_state, variant_version, skeleton_fingerprint)
  select m.id, 1, '<tr><td>x</td></tr>', 'design', 1, 1, 'product_feature', 'gemini', now(), 'image_left', 'product_showcase', '{photo_led}', 0.8,
    'tagged', 'fast', 'tags-v1', (select id from public.block_variants where fingerprint = pg_temp.k(10)), 'matched', 'variants-v1', pg_temp.k(10)
  from public.inbox_messages m where m.message_key in (pg_temp.k(2), pg_temp.k(3));
update public.inbox_messages set labels_state = 'tagged', industry = 'apparel', email_type = 'sale', offer_type = 'none', season = 'spring',
    angle = 'value', brand_size = 'mid', labels_confidence = 0.8, labels_pass = 'fast', labels_model = 'gemini-2.5-flash-lite',
    facts = '{"version":2}', extraction_version = 2, labelled_at = now()
  where message_key in (pg_temp.k(2), pg_temp.k(3));
select is((select count(distinct capture_id)::int from public.inbox_messages where state = 'assigned'),3,'three brands');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select string_agg(family||':'||matches, ',') from public.search_block_variants('{"industry":"apparel"}')),
  'product_feature:4','a member now finds the structure 3 brands sent, but not one only one brand sent');
reset role;
update public.tenant_memberships set status = 'inactive' where profile_id = '00000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select * from public.search_block_variants()$$,'42501',null,'a member who left cannot search');
reset role;

select * from finish();
rollback;
