begin;
select plan(48);

-- Workspace 101: owner ...01, staff ...05. Workspace 102: owner ...04.
-- Campaign ...601 belongs to workspace 101.

-- Grants: signed-in members only.
select ok(not has_function_privilege('anon','public.start_conversation(uuid,text,uuid,text)','execute'),'anon cannot start a chat');
select ok(not has_function_privilege('anon','public.rename_conversation(uuid,uuid,text)','execute'),'anon cannot rename a chat');
select ok(not has_function_privilege('anon','public.delete_conversation(uuid,uuid)','execute'),'anon cannot delete a chat');
select ok(has_function_privilege('authenticated','public.start_conversation(uuid,text,uuid,text)','execute'),'members can start a chat');
select ok(has_function_privilege('authenticated','public.rename_conversation(uuid,uuid,text)','execute'),'members can rename a chat');
select ok(has_function_privilege('authenticated','public.delete_conversation(uuid,uuid)','execute'),'members can delete a chat');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

-- A new chat is saved together with its first question and answer.
select set_config('test.chat',public.start_conversation('00000000-0000-4000-8000-000000000101','  How did   my last
email do?  ')::text,true);
select is((select title from public.conversations where id=current_setting('test.chat')::uuid),'How did my last email do?','the title comes from the first question, on one line');
select is((select visibility from public.conversations where id=current_setting('test.chat')::uuid),'private','a new chat is private');
select is((select message_count from public.conversations where id=current_setting('test.chat')::uuid),2,'question and answer are counted');
select ok((select last_message_at is not null from public.conversations where id=current_setting('test.chat')::uuid),'the last message time is kept');
update public.conversations set message_count=99, title='Changed directly' where id=current_setting('test.chat')::uuid;
select is((select message_count from public.conversations where id=current_setting('test.chat')::uuid),2,'members cannot change a chat directly (row security)');
select ok((select body like '%**Last sent:**%' and body like '%Next step:%' and body like '%Your library:%' and body not like '%{%'
  from public.chat_messages where conversation_id=current_setting('test.chat')::uuid and role='assistant'),'a question without a campaign gets a plain workspace answer');
select is((select evidence->>'scope' from public.chat_messages where conversation_id=current_setting('test.chat')::uuid and role='assistant'),'workspace','the answer records that it was about the whole workspace');
reset role;
select is((select (evidence->>'library')::int from public.chat_messages where conversation_id=current_setting('test.chat')::uuid and role='assistant'),
  (select count(*)::int from public.own_templates where tenant_id='00000000-0000-4000-8000-000000000101')
  +(select count(*)::int from public.reference_imports where tenant_id='00000000-0000-4000-8000-000000000101'),
  'the library count is this workspace''s own');
select ok(exists(select 1 from public.usage_reservations where tenant_id='00000000-0000-4000-8000-000000000101' and feature='gros' and state='reconciled'),
  'a workspace answer still spends and settles AI credits');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

-- A refused question saves nothing.
select set_config('test.before',(select count(*) from public.conversations)::text,true);
select throws_ok($$select public.start_conversation('00000000-0000-4000-8000-000000000101','   ')$$,'23514','Type a question first','an empty first question is refused');
select throws_ok($$select public.start_conversation('00000000-0000-4000-8000-000000000101',E'\n\t \n')$$,'23514','Type a question first','a first question of only tabs and new lines is refused');
select throws_ok($$select public.start_conversation('00000000-0000-4000-8000-000000000101','Hello','00000000-0000-4000-8000-000000000601','public')$$,'23514',null,'visibility is private or shared');
select throws_ok($$select public.start_conversation('00000000-0000-4000-8000-000000000101','About a missing campaign','00000000-0000-4000-8000-000000009999')$$,'42501',null,'a campaign from nowhere is refused');
select is((select count(*) from public.conversations)::text,current_setting('test.before'),'no empty chat is left behind');

-- A first question about one campaign.
select set_config('test.shared',public.start_conversation('00000000-0000-4000-8000-000000000101','Where does this one stand?','00000000-0000-4000-8000-000000000601','shared')::text,true);
select ok((select body like 'Here is where "%' from public.chat_messages where conversation_id=current_setting('test.shared')::uuid and role='assistant'),'a first question can be about one campaign');

-- Later questions: plain ones may skip the campaign, requests may not.
select lives_ok($$select public.ask_fixture_gros('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,null,'And now?','explain','')$$,'a later plain question needs no campaign');
select is((select message_count from public.conversations where id=current_setting('test.chat')::uuid),4,'every message is counted');
select throws_ok($$select public.ask_fixture_gros('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,null,'Change the goal','edit_goal','New goal')$$,'23514','Choose a campaign for this request','a change request still needs a campaign');
select set_config('test.proposal',public.ask_fixture_gros('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid,'00000000-0000-4000-8000-000000000601','Clarify the goal.','edit_goal','A synthetic goal for the thread test')::text,true);

-- Rename: only the starter, 1 to 200 characters, false when unchanged.
select ok(public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,'  Last email  '),'the starter renames the chat');
select is((select title from public.conversations where id=current_setting('test.chat')::uuid),'Last email','the new name is trimmed');
select ok(not public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,'Last email'),'the same name changes nothing');
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,'   ')$$,'23514',null,'an empty name is refused');
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,E'\t\n')$$,'23514',null,'a name of only tabs and new lines is refused');
select ok(public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,E'Last\temail\nnow'),'a name with tabs is saved');
select is((select title from public.conversations where id=current_setting('test.chat')::uuid),'Last email now','white space in a name becomes one space');
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid,repeat('x',201))$$,'23514',null,'a name over 200 characters is refused');

-- Staff see the shared chat but cannot rename or delete it, and never see
-- the private one.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select is((select count(*)::int from public.conversations where id in (current_setting('test.chat')::uuid,current_setting('test.shared')::uuid)),1,'staff see only the shared chat');
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid,'Mine now')$$,'42501',null,'staff cannot rename the owner''s shared chat');
select throws_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid)$$,'42501',null,'staff cannot delete the owner''s shared chat');
select throws_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.chat')::uuid)$$,'42501',null,'staff cannot delete the owner''s private chat');
select set_config('test.staff',public.start_conversation('00000000-0000-4000-8000-000000000101','A staff question')::text,true);
select is((select creator_id::text from public.conversations where id=current_setting('test.staff')::uuid),'00000000-0000-4000-8000-000000000005','staff can start their own chat');

-- Another workspace cannot touch these chats.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid,'Taken')$$,'42501',null,'another workspace cannot rename');
select throws_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid)$$,'42501',null,'another workspace cannot delete');
select throws_ok($$select public.start_conversation('00000000-0000-4000-8000-000000000101','Let me in')$$,'42501',null,'another workspace cannot start a chat here');
select throws_ok($$select public.ask_fixture_gros('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid,null,'Read it','explain','')$$,'42501',null,'another workspace cannot ask in a chat here');

-- The owner cannot see or delete the staff member's private chat.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select is((select count(*)::int from public.conversations where id=current_setting('test.staff')::uuid),0,'the owner cannot read a staff member''s private chat');
select throws_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid)$$,'42501',null,'the owner cannot delete a staff member''s chat');

-- Delete: the chat, its messages and waiting proposals go; only the fact is logged.
select lives_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid)$$,'the starter deletes the chat');
select is((select count(*)::int from public.chat_messages where conversation_id=current_setting('test.shared')::uuid)
  +(select count(*)::int from public.chat_proposals where conversation_id=current_setting('test.shared')::uuid),0,'its messages and proposals are gone');
reset role;
select is((select detail from public.workspace_events where kind='chat_deleted' and entity_id=current_setting('test.shared')::uuid),
  jsonb_build_object('visibility','shared','messages',4),'the log says a chat was deleted, without its words');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.delete_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid)$$,'PT409','This chat was already deleted.','deleting twice says it is already gone');
select throws_ok($$select public.rename_conversation('00000000-0000-4000-8000-000000000101',current_setting('test.shared')::uuid,'Too late')$$,'PT409','This chat was deleted.','renaming a deleted chat says it is gone');

select * from finish();
rollback;
