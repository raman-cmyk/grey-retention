begin;
select plan(66);

-- Known starting point.
delete from public.holidays
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
delete from public.holiday_preferences
  where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
update public.tenants set timezone = 'Asia/Kathmandu' where id = '00000000-0000-4000-8000-000000000101';

-- Grants.
select ok(not has_table_privilege('authenticated','public.holidays','insert,update,delete,truncate'),'members cannot write holidays directly');
select ok(not has_table_privilege('anon','public.holidays','select,insert,update,delete,truncate'),'anon has no holiday access');
select ok(not has_table_privilege('service_role','public.holidays','select,insert,update,delete,truncate'),'service role has no holiday access');
select ok(has_table_privilege('authenticated','public.holidays','select'),'members can read holidays (RLS decides which)');
select ok(not has_table_privilege('anon','public.holiday_preferences','select'),'anon cannot read the country');
select ok(not has_table_privilege('authenticated','public.holiday_preferences','insert,update,delete,truncate'),'members cannot write the country directly');
select ok(not has_table_privilege('service_role','public.holiday_preferences','select,insert,update,delete,truncate'),'service role has no country access');
select ok(not has_function_privilege('anon','public.save_holiday(uuid,uuid,integer,text,date,text,boolean,text)','execute'),'anon cannot save');
select ok(not has_function_privilege('service_role','public.delete_holiday(uuid,uuid,integer)','execute'),'service role cannot delete');
select ok(not has_function_privilege('authenticated','private.next_occurrence(date,date)','execute'),'helpers stay private');

-- Yearly dates.
select is(private.next_occurrence('2020-03-14','2026-11-07'),'2027-03-14'::date,'a past date repeats next year');
select is(private.next_occurrence('2020-12-24','2026-11-07'),'2026-12-24'::date,'a later date repeats this year');
select is(private.next_occurrence('2020-11-07','2026-11-07'),'2026-11-07'::date,'today counts');
select is(private.next_occurrence('2020-01-01','2026-12-31'),'2027-01-01'::date,'across the new year');
select is(private.next_occurrence('2027-11-20','2026-11-07'),'2027-11-20'::date,'never before its own first date');
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

-- Validation (the page and the old command alike).
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'X','2027-01-01','event',false)$$,'23514',null,'a one-letter name is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,E'Drop\nBcc','2027-01-01','event',false)$$,'23514',null,'a name with a line break is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop',null,'event',false)$$,'23514',null,'a date is required');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Forever','infinity','event',false)$$,'23514',null,'an endless date is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Ancient','0044-03-15 BC','event',false)$$,'23514',null,'a date outside 1900–2999 is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','sale',false)$$,'23514',null,'an unknown type is refused');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','event',null)$$,'23514',null,'repeats must be yes or no');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Summer drop','2027-01-01','event',false,repeat('x',2001))$$,'23514',null,'notes over 2000 characters are refused');
select throws_ok($$select public.add_holiday('00000000-0000-4000-8000-000000000101','  ','2027-01-01','')$$,'23514',null,'the old command refuses a blank name');
select throws_ok($$select public.add_holiday('00000000-0000-4000-8000-000000000101',E'Drop\nBcc','2027-01-01','')$$,'23514',null,'the old command refuses a two-line name');
select ok(public.add_holiday('00000000-0000-4000-8000-000000000101',' Old-style event ','2027-01-01','Note') is not null,'the old command still adds a one-off event');
select is((select row(kind, repeats_annually, name)::text from public.holidays where name = 'Old-style event'),row('event',false,'Old-style event')::text,'as a trimmed, one-off event');

-- Planning sees each entry on its date in the 30-day window; yearly ones on
-- their next date. Window for this start: 2026-11-07 to 2026-12-06 (Kathmandu).
reset role;
delete from public.holidays where tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Studio day','2026-11-10','event',false,'Original owner note')$$,'a one-off event in the window');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Founding day','2020-11-12','holiday',true,'')$$,'a yearly holiday from years ago');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Edge in','2026-12-06','event',false,'')$$,'an event on the last day of the window');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Edge out','2026-12-07','event',false,'')$$,'an event the day after the window');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Old launch','2025-01-01','event',false,'')$$,'a past one-off event');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Grand opening','2027-11-20','event',true,'')$$,'a yearly event that starts next year');
select lives_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Spring sale','2019-04-01','event',true,'')$$,'a yearly event outside the window');
reset role;
select is(
  (select jsonb_agg(x->>'name' || ' ' || (x->>'date') order by x->>'date')
     from jsonb_array_elements(private.planning_holidays('00000000-0000-4000-8000-000000000101','2026-11-06T18:20:00Z')) x),
  '["Studio day 2026-11-10", "Founding day 2026-11-12", "Edge in 2026-12-06"]'::jsonb,
  'planning sees one-off and yearly entries in the window only');
select is(
  (select x->>'kind' from jsonb_array_elements(private.planning_holidays('00000000-0000-4000-8000-000000000101','2026-11-06T18:20:00Z')) x where x->>'name'='Studio day'),
  'event','the type travels with it');
select is(
  private.planning_holidays('00000000-0000-4000-8000-000000000101','2026-11-06T18:20:00Z'),
  private.planning_holidays('00000000-0000-4000-8000-000000000101','2026-11-06T18:20:00Z'),
  'the same data and start give the same input (plan completion check)');
set local role authenticated;

-- Delete.
select set_config('test.id',(select id::text from public.holidays where name = 'Studio day'),true);
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',2)$$, current_setting('test.id')),
  'PT409',null,'deleting from a stale page is refused');
select lives_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',1)$$, current_setting('test.id')),
  'owner deletes the entry');
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',1)$$, current_setting('test.id')),
  'PT409','This entry was removed in another window','deleting twice says it is gone');
select throws_ok(
  format($$select public.save_holiday('00000000-0000-4000-8000-000000000101','%s',1,'Back again','2026-11-10','event',false,'')$$, current_setting('test.id')),
  'PT409','This entry was removed in another window','editing a deleted entry says it is gone');

-- Country for platform holidays.
select lives_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','AU')$$,'owner picks a country');
select is((select country from public.holiday_preferences),'AU','the country is saved');
select is((select count(*) from public.workspace_events where kind = 'holiday_country_set' and tenant_id = '00000000-0000-4000-8000-000000000101'),1::bigint,'choosing a country is logged');
select throws_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','FR')$$,'23514',null,'a country without a holiday set is refused');

-- Staff read; they cannot change anything.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.holidays),6::bigint,'staff can read the entries');
select is((select country from public.holiday_preferences),'AU','staff can read the country');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Staff day','2027-01-01','event',false)$$,'42501',null,'staff cannot add');
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000101','%s',1)$$, (select id from public.holidays where name = 'Founding day')),
  '42501',null,'staff cannot delete');
select throws_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','US')$$,'42501',null,'staff cannot change the country');

-- Another workspace sees and changes nothing.
select set_config('test.founding',(select id::text from public.holidays where name = 'Founding day'),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.holidays),0::bigint,'another workspace sees no entries');
select is((select count(*) from public.holiday_preferences),0::bigint,'another workspace sees no country');
select throws_ok($$select public.save_holiday('00000000-0000-4000-8000-000000000101',null,0,'Intruder','2027-01-01','event',false)$$,'42501',null,'another owner cannot add here');
select throws_ok($$select public.set_holiday_country('00000000-0000-4000-8000-000000000101','US')$$,'42501',null,'another owner cannot change the country here');
select throws_ok(
  format($$select public.save_holiday('00000000-0000-4000-8000-000000000102','%s',1,'Taken','2027-01-01','event',false,'')$$, current_setting('test.founding')),
  'PT409',null,'another owner cannot edit this workspace''s entry from their own');
select throws_ok(
  format($$select public.delete_holiday('00000000-0000-4000-8000-000000000102','%s',1)$$, current_setting('test.founding')),
  'PT409',null,'nor delete it');
reset role;
select is((select name from public.holidays where id = current_setting('test.founding')::uuid),'Founding day','the entry is unchanged');

select * from finish();
rollback;
