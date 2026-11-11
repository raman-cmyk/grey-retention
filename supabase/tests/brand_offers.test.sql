begin;
select no_plan();
-- DSC-001. Tenant 101: owner ...001, admin ...006, staff ...005. Tenant 102 owner ...004. Operator ...002. Synthetic seed only.

-- The owner sets the max discount; a stale page is refused.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.set_max_discount('00000000-0000-4000-8000-000000000101',20,0),1,'the first max discount is revision 1');
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',25,0)$$,'PT409',null,'a second "first" save is a conflict');
select is(public.set_max_discount('00000000-0000-4000-8000-000000000101',25,1),2,'the owner raises the max discount');
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',30,1)$$,'PT409',null,'a stale revision is a conflict');
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',101,2)$$,'23514',null,'the max discount stays 0 to 100');
select is((select max_discount_percent from public.brand_offers),25,'the owner reads the saved max discount');

-- Codes: real, unique while active, not already expired.
select set_config('test.code',public.add_discount_code('00000000-0000-4000-8000-000000000101','WELCOME15',15,null)::text,true);
select ok(current_setting('test.code') <> '','the owner adds a code');
select lives_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','CANDLE10',10,now()+interval '7 days')$$,'a code with an expiry');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','welcome15',20,null)$$,'PT409',null,'the same code in other letters is refused');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','OLD20',20,now()-interval '1 day')$$,'23514',null,'an expired code is refused');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','BAD CODE',20,null)$$,'23514',null,'a code with a space is refused');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','ZERO',0,null)$$,'23514',null,'a code takes 1 to 100 percent');
select lives_ok($$select public.retire_discount_code(current_setting('test.code')::uuid)$$,'the owner retires a code');
select lives_ok($$select public.retire_discount_code(current_setting('test.code')::uuid)$$,'retiring twice is fine');
select lives_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','WELCOME15',15,null)$$,'a retired code can be added again');
select is((select count(*) from public.discount_codes where status='active'),2::bigint,'two active codes');

-- Direct writes are refused, even for the owner.
select throws_ok($$update public.brand_offers set max_discount_percent=90$$,'42501',null,'no direct update of the max discount');
select throws_ok($$insert into public.discount_codes(tenant_id,code,percent) values('00000000-0000-4000-8000-000000000101','DIRECT50',50)$$,'42501',null,'no direct insert of a code');
select throws_ok($$delete from public.discount_codes$$,'42501',null,'no direct delete of codes');

-- An admin may change them too.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select is(public.set_max_discount('00000000-0000-4000-8000-000000000101',15,2),3,'an admin lowers the max discount');

-- Staff read but cannot change.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select max_discount_percent from public.brand_offers),15,'staff read the max discount');
select is((select count(*) from public.discount_codes where status='active'),2::bigint,'staff read the codes');
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',50,3)$$,'42501',null,'staff cannot change the max discount');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','STAFF50',50,null)$$,'42501',null,'staff cannot add a code');
select throws_ok($$select public.retire_discount_code((select id from public.discount_codes where status='active' limit 1))$$,'42501',null,'staff cannot retire a code');

-- Another brand's owner sees and changes nothing.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.brand_offers)+(select count(*) from public.discount_codes),0::bigint,'another brand sees nothing');
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',90,3)$$,'42501',null,'another brand cannot change the max discount');
select throws_ok($$select public.add_discount_code('00000000-0000-4000-8000-000000000101','THEIRS90',90,null)$$,'42501',null,'another brand cannot add a code');
select throws_ok($$select public.retire_discount_code(gen_random_uuid())$$,'42501',null,'an unknown code is unavailable');

-- Operators read for support.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*) from public.discount_codes where status='active'),2::bigint,'an operator reads the codes');

-- No sign-in, no access.
reset role;
set local role anon;
select throws_ok($$select public.set_max_discount('00000000-0000-4000-8000-000000000101',10,3)$$,'42501',null,'anonymous callers are refused');

select * from finish();
rollback;
