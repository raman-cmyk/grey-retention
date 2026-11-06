begin;
select plan(40);

-- Known starting point.
delete from public.holidays
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
delete from public.holiday_preferences
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
update public.tenants set timezone = 'Asia/Kathmandu' where id = '00000000-0000-4000-8000-000000000101';

-- Grants.
select ok(not has_table_privilege('authenticated','public.holidays','insert,update,delete,truncate'),'members cannot write holidays directly');
select ok(not has_table_privilege('anon','public.holiday_preferences','select'),'anon cannot read the country');
select ok(not has_table_privilege('authenticated','public.holiday_preferences','insert,update,delete,truncate'),'members cannot write the country directly');
select ok(not has_table_privilege('service_role','public.holiday_preferences','select,insert,update,delete'),'service role has no country access');
select ok(not has_function_privilege('anon','public.save_holiday(uuid,uuid,integer,text,date,text,boolean,text)','execute'),'anon cannot save');
select ok(not has_function_privilege('service_role','public.delete_holiday(uuid,uuid,integer)','execute'),'service role cannot delete');
select ok(not has_function_privilege('authenticated','private.next_occurrence(date,date)','execute'),'helpers stay private');

-- Yearly dates.
select is(private.next_occurrence('2020-03-14','2026-11-07'),'2027-03-14'::date,'a past date repeats next year');
select is(private.next_occurrence('2020-12-24','2026-11-07'),'2026-12-24'::date,'a later date repeats this year');
select is(private.next_occurrence('2020-11-07','2026-11-07'),'2026-11-07'::date,'today counts');
select is(private.next_occurrence('2024-02-29','2027-01-10'),'2027-02-28'::date,'29 February becomes 28 February in other years');
select is(private.next_occurrence('2024-02-29','2027-12-01'),'2028-02-29'::date,'and stays 29 February in leap years');

-- Owner of workspace 101.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$insert into public.holidays(tenant_id,name,event_date,created_by) values ('00000000-0000-4000-8000-000000000101','Direct','2027-01-01','00000000-0000-4000-8000-000000000001')$$,'42501',null,'owner cannot insert directly');
select set_config('test.id',
  (public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'  Brand anniversary ','2020-03-14','holiday',true,'Our biggest drop of the year.')->>'id'),
  true);
select is(
  (select row(name, event_date, kind, repeats_annually, notes, revision)::text from public.holidays),
  row('Brand anniversary','2020-03-14'::date,'holiday',true,'Our biggest drop of the year.',1)::text,
  'owner adds an entry (name trimmed)');
select is((select count(*) from public.workspace_events where kind='holiday_created' and entity_id=current_setting('test.id')::uuid),1::bigint,'adding is logged');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,1,'Summer drop','2027-06-01','event',false)$$,'PT409',null,'a new entry needs revision 0');
select is(
  public.save_holiday('00000000-0000-4000-8000-000000000101',current_setting('test.id')::uuid,1,'Brand birthday','2020-03-15','holiday',true,'')->>'revision',
  '2','owner edits the entry');
select throws_ok(
  format($$select public.save_holiday('00000000-0000-4000-8000-000000000101','%s',1,'Stale','2020-03-15','holiday',true,'')$$, current_setting('test.id')),
  'PT409','This entry changed in another window','a stale edit is refused');
select is((select name from public.holidays),'Brand birthday','the newer text is kept');

-- Validation.
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'X','2027-01-01','event',false)$$,'23514',null,'a one-letter name is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,E'Drop\nBcc','2027-01-01','event',false)$$,'23514',null,'a name with a line break is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop',null,'event',false)$$,'23514',null,'a date is required');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','sale',false)$$,'23514',null,'an unknown type is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','event',null)$$,'23514',null,'repeats must be yes or no');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','event',false,repeat('x',2001))$$,'23514',null,'notes over 2000 characters are refused');

-- Planning sees each entry on its date; repeating ones on their next date.
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Studio day',current_date + 3,'event',false,'Original owner note')$$,'owner adds a one-off event');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Founding day',((current_date + 5) - interval '3 years')::date,'holiday',true,'')$$,'owner adds a yearly holiday from years ago');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Old launch',current_date - 400,'event',false,'')$$,'a past one-off event');
reset role;
select is(
  (select jsonb_agg(x->>'name' order by x->>'date') from jsonb_array_elements(private.planning_holidays('00000000-0000-4000-8000-000000000101', now())) x),
  '["Studio day", "Founding day"]'::jsonb,
  'planning sees the one-off event and the yearly holiday, not past events');
select is(
  (select x->>'date' from jsonb_array_elements(private.planning_holidays('00000000-0000-4000-8000-000000000101', now())) x where x->>'name'='Founding day'),
  (current_date + 5)::text,
  'the yearly holiday is on this year''s date');
select is(
  (select x->>'kind' from jsonb_array_elements(private.planning_holidays('00000000-0000-4000-8000-000000000101', now())) x where x->>'name'='Studio day'),
  'event','the type travels with it');
set local role authenticated;

-- Delete.
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',1)$$, current_setting('test.id')),
  'PT409',null,'deleting from a stale page is refused');
select lives_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',2)$$, current_setting('test.id')),
  'owner deletes the entry');
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',2)$$, current_setting('test.id')),
  'PT409','This entry was removed in another window','deleting twice says it is gone');

-- Country for platform holidays.
select lives_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','AU')$$,'owner picks a country');
select is((select country from public.holiday_preferences),'AU','the country is saved');
select throws_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','FR')$$,'23514',null,'a country without a holiday set is refused');

-- Staff read; others are refused.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.holidays),3::bigint,'staff can read the entries');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Staff day','2027-01-01','event',false)$$,'42501',null,'staff cannot add');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.holidays),0::bigint,'another workspace sees nothing');
reset role;

select * from finish();
rollback;
