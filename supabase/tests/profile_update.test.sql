begin;
select plan(7);

-- UIR-014: the Profile page writes profiles directly; RLS and column
-- grants are the boundary.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

update public.profiles set full_name = 'Rae Sample Owner', job_title = 'Founder', phone = '+977 1 555 0101'
  where id = '00000000-0000-4000-8000-000000000001';
select is(
  (select row(full_name, job_title, phone)::text from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  row('Rae Sample Owner','Founder','+977 1 555 0101')::text,
  'a user updates their own name, job title and phone');
select ok(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000005') is not null,
  'a teammate''s row is visible');
update public.profiles set full_name = 'Taken over' where id = '00000000-0000-4000-8000-000000000005';
select isnt(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000005'),
  'Taken over', 'a teammate''s row cannot be changed');
select throws_ok(
  $$update public.profiles set status = 'inactive' where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'the account status cannot be changed');
select throws_ok(
  $$update public.profiles set id = id where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'other columns cannot be changed');

-- A deactivated profile can no longer change its details.
reset role;
update public.profiles set status = 'inactive' where id = '00000000-0000-4000-8000-000000000001';
set local role authenticated;
update public.profiles set full_name = 'Still here' where id = '00000000-0000-4000-8000-000000000001';
reset role;
select is(
  (select full_name from public.profiles where id = '00000000-0000-4000-8000-000000000001'),
  'Rae Sample Owner', 'a deactivated profile cannot update itself');

set local role anon;
select throws_ok(
  $$update public.profiles set full_name = 'x' where id = '00000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'anonymous callers cannot update profiles');
reset role;

select * from finish();
rollback;
