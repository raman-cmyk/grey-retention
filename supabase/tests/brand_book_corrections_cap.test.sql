begin;
select no_plan();
-- ONB-058b. Tenant 102 owner ...004. Synthetic seed only.

select has_index('public', 'brand_book_corrections', 'brand_book_corrections_live', 'the cap counts live corrections by workspace');
select has_index('public', 'brand_book_corrections', 'brand_book_corrections_made', 'books older than a correction are found by its time');
select has_index('public', 'brand_book_corrections', 'brand_book_corrections_withdrawn', 'and by the time it was taken back');

select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;

-- At most 200 live corrections a workspace, whatever lines they name.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','facts.returnDays',null,'replace','30'),null,'a fact');
select lives_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000102','marketing','Line ' || n || '.','remove',null)
  from generate_series(1,199) n$$,'and a hundred and ninety-nine lines');
select is((select count(*)::integer from public.brand_book_corrections
  where tenant_id = '00000000-0000-4000-8000-000000000102' and withdrawn_at is null),200,'two hundred live');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000102','marketing','Line 201.','remove',null)$$,
  'PT409','Too many corrections','not a two hundred and first');
select throws_ok($$select public.correct_brand_book('00000000-0000-4000-8000-000000000102','offering',null,'add','A line of his own.')$$,
  'PT409','Too many corrections','nor an added line');

-- Changing what he already corrected replaces the older correction: still allowed.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','marketing','line 7.','replace','His own words.'),null,
  'he can still change a line he corrected');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','facts.returnDays',null,'replace','45'),null,
  'and a fact he set');
select is((select count(*)::integer from public.brand_book_corrections
  where tenant_id = '00000000-0000-4000-8000-000000000102' and withdrawn_at is null),200,'still two hundred live');

-- Taking one back makes room again.
select lives_ok($$select public.withdraw_brand_book_correction('00000000-0000-4000-8000-000000000102',
  (select id from public.brand_book_corrections where tenant_id = '00000000-0000-4000-8000-000000000102'
    and original = 'Line 1.' and withdrawn_at is null))$$,'he takes one back');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','offering',null,'add','A line of his own.'),null,
  'and has room for another');

-- His own added line at the cap: changing it and removing it still work.
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','offering','a line of his own.','replace','His new line.'),null,
  'he changes his own line at the cap');
select is((select value from public.brand_book_corrections where tenant_id = '00000000-0000-4000-8000-000000000102'
  and section = 'offering' and withdrawn_at is null),'His new line.','his new words are the added line');
select is((select count(*)::integer from public.brand_book_corrections
  where tenant_id = '00000000-0000-4000-8000-000000000102' and withdrawn_at is null),200,'still two hundred live');
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000102','offering','His new line.','remove',null),null,
  'and removes it');
select is((select count(*)::integer from public.brand_book_corrections
  where tenant_id = '00000000-0000-4000-8000-000000000102' and withdrawn_at is null),199,'one fewer live');

-- Another workspace is not counted.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select isnt(public.correct_brand_book('00000000-0000-4000-8000-000000000101','voice','Loud.','remove',null),null,
  'another workspace corrects as usual');

select * from finish();
rollback;
