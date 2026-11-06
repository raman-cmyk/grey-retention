begin;
select plan(24);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04. Operator ...02.
select ok(not has_table_privilege('authenticated','public.support_tickets','insert,update,delete'),'members cannot write tickets directly');
select ok(not has_table_privilege('authenticated','public.support_messages','insert,update,delete'),'members cannot write messages directly');
select ok(not has_function_privilege('anon','public.request_feature(uuid,text,text,text)','execute'),'anon cannot send a request');
select ok(not has_function_privilege('service_role','public.request_feature(uuid,text,text,text)','execute'),'the service role cannot send a request');
select throws_ok($$insert into public.support_tickets(tenant_id,creator_id,kind,subject,category) values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','support','Help','bug')$$,'23514',null,'only feedback tickets have a type');

-- Owner.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.request',public.request_feature('00000000-0000-4000-8000-000000000101','feature','  Add a duplicate campaign button ',E'\n  So I can reuse last week''s email.  \n')::text,true);
select is(
  (select row(kind, category, subject, state)::text from public.support_tickets where id = current_setting('test.request')::uuid),
  row('feedback','feature','Add a duplicate campaign button','open')::text,
  'the owner sends a request (subject trimmed, status Open)');
select is((select body from public.support_messages where ticket_id = current_setting('test.request')::uuid),'So I can reuse last week''s email.','the details are the first message, trimmed');
select is((select count(*) from public.workspace_events where kind = 'feature_requested' and entity_id = current_setting('test.request')::uuid),1::bigint,'sending is logged');

-- Checks, like the page.
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','wish','Subject','Details')$$,'23514',null,'an unknown type is refused');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101',null,'Subject','Details')$$,'23514',null,'a type is required');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug','X','Details')$$,'23514',null,'a one-letter subject is refused');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug',E'Two\nlines','Details')$$,'23514',null,'a two-line subject is refused');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug',repeat('x',201),'Details')$$,'23514',null,'a subject over 200 characters is refused');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug','Subject',E' \n\t ')$$,'23514',null,'blank details are refused');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug','Subject',repeat('x',5001))$$,'23514',null,'details over 5000 characters are refused');

-- Staff can send too.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select lives_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','bug','The preview is blank','It shows nothing on my phone.')$$,'staff send a request');
select is((select count(*) from public.support_tickets where kind = 'feedback'),2::bigint,'staff see the workspace''s requests');

-- The platform team replies and marks it Planned (in_progress).
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.reply_support('00000000-0000-4000-8000-000000000101',current_setting('test.request')::uuid,1,'Good idea, it is on our list.','in_progress')$$,'the platform team replies');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select state from public.support_tickets where id = current_setting('test.request')::uuid),'in_progress','the owner sees it as planned');
select is((select count(*) from public.support_messages where ticket_id = current_setting('test.request')::uuid),2::bigint,'and the reply');

-- Another workspace sees and sends nothing here.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is((select count(*) from public.support_tickets where tenant_id = '00000000-0000-4000-8000-000000000101'),0::bigint,'another workspace sees no requests');
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','feature','Sneaky','Not my workspace')$$,'42501',null,'another workspace cannot send here');

-- A deactivated member cannot send.
reset role;
update public.tenant_memberships set status = 'inactive' where profile_id = '00000000-0000-4000-8000-000000000005' and tenant_id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select public.request_feature('00000000-0000-4000-8000-000000000101','feature','Still here','Hello')$$,'42501',null,'a deactivated member cannot send');
select is((select count(*) from public.support_tickets),0::bigint,'nor read requests');

select * from finish();
rollback;
