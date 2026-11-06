begin;
select plan(57);

-- Workspace 101: owner ...01, staff ...05, manager ...06. Workspace 102: owner ...04.
delete from public.tenant_invites where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');

-- Grants: members write through the commands only.
select ok(not has_table_privilege('authenticated','public.tenant_memberships','insert'),'members cannot add memberships directly');
select ok(not has_table_privilege('authenticated','public.tenant_memberships','update'),'members cannot change memberships directly');
select ok(not has_table_privilege('authenticated','public.tenant_memberships','delete'),'members cannot remove memberships directly');
select ok(not has_table_privilege('authenticated','public.tenant_invites','insert,update,delete'),'members cannot write invites directly');
select ok(has_table_privilege('authenticated','public.tenant_memberships','select'),'members still read memberships (RLS decides which)');
select ok(not has_function_privilege('anon','public.team_members(uuid)','execute'),'anon cannot list the team');
select ok(not has_function_privilege('service_role','public.change_team_member(uuid,uuid,timestamptz,public.tenant_role,public.membership_status)','execute'),'service role cannot change members');
select ok(not has_function_privilege('authenticated','public.update_team_access(uuid,uuid,timestamptz,public.tenant_role,public.membership_status)','execute'),'the old access command is no longer offered');
select ok(has_function_privilege('authenticated','public.resend_team_invite(uuid,uuid)','execute'),'members may call resend (it checks the role)');

-- Owner.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(
  (select jsonb_agg(jsonb_build_object('email', email, 'role', role, 'me', is_me)) from public.team_members('00000000-0000-4000-8000-000000000101')),
  '[{"email":"owner@grey-retention.test","role":"owner","me":true},{"email":"staff@grey-retention.test","role":"staff","me":false},{"email":"team-admin@grey-retention.test","role":"admin","me":false}]'::jsonb,
  'the owner sees everyone with their email, owner first');
select throws_ok($$insert into public.tenant_invites(tenant_id,email,role,token_hash,expires_at,invited_by) values ('00000000-0000-4000-8000-000000000101','direct@example.com','staff',repeat('a',64),now()+interval '1 day','00000000-0000-4000-8000-000000000001')$$,'42501',null,'a direct invite insert is refused');
select throws_ok($$delete from public.tenant_memberships where profile_id='00000000-0000-4000-8000-000000000005'$$,'42501',null,'a direct membership delete is refused');

select set_config('test.invite',public.invite_team('00000000-0000-4000-8000-000000000101','  New.Person@Example.com ','staff')::text,true);
select is((select row(email, role)::text from public.tenant_invites where id = current_setting('test.invite')::uuid),row('new.person@example.com','staff')::text,'the owner invites (email lowercased and trimmed)');
select is((select count(*) from public.workspace_events where kind = 'invitation_simulated' and entity_id = current_setting('test.invite')::uuid),1::bigint,'the invite is logged as simulated');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','new.person@EXAMPLE.com','admin')$$,'PT409','Already invited','the same address cannot be invited twice');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','Staff@grey-retention.test','staff')$$,'PT409','Already a member','an active member cannot be invited');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','not-an-email','staff')$$,'23514',null,'an address without @ is refused');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','two words@example.com','staff')$$,'23514',null,'an address with a space is refused');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','boss@example.com','owner')$$,'23514',null,'nobody is invited as owner');

-- Resend and cancel.
reset role;
select set_config('test.token',(select token_hash from public.tenant_invites where id = current_setting('test.invite')::uuid),true);
update public.tenant_invites set created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = current_setting('test.invite')::uuid;
set local role authenticated;
select lives_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'an expired invite can be resent');
select ok((select expires_at > now() + interval '6 days' and token_hash <> current_setting('test.token') from public.tenant_invites where id = current_setting('test.invite')::uuid),'resending gives a new link and 7 more days');
select is((select count(*) from public.workspace_events where kind = 'invitation_resent' and entity_id = current_setting('test.invite')::uuid),1::bigint,'resending is logged');
select lives_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'the owner cancels the invite');
select throws_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'PT409','This invite was cancelled or accepted','cancelling twice says it is gone');
select throws_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'PT409','This invite was cancelled or accepted','a cancelled invite cannot be resent');
select lives_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','new.person@example.com','staff')$$,'after a cancel the address can be invited again');

-- An expired invite does not block a new one; it is cancelled instead.
reset role;
update public.tenant_invites set created_at = now() - interval '9 days', expires_at = now() - interval '1 day'
  where tenant_id = '00000000-0000-4000-8000-000000000101' and email = 'new.person@example.com' and revoked_at is null;
set local role authenticated;
select lives_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','new.person@example.com','admin')$$,'an expired invite does not block a new one');
select is((select count(*) from public.tenant_invites where email = 'new.person@example.com' and revoked_at is null and accepted_at is null),1::bigint,'one open invite per person');

-- Role and status changes.
select set_config('test.staff',(select id::text from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000005'),true);
select set_config('test.staff_at',(select updated_at::text from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000005'),true);
select set_config('test.owner',(select id::text from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000001' and tenant_id = '00000000-0000-4000-8000-000000000101'),true);
select set_config('test.owner_at',(select updated_at::text from public.tenant_memberships where id = current_setting('test.owner')::uuid),true);
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,current_setting('test.staff_at')::timestamptz - interval '1 second','admin','active')$$,'PT409','Membership changed','a change from a stale page is refused');
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,current_setting('test.staff_at')::timestamptz,'admin','active')$$,'the owner makes staff a manager');
select is((select role::text from public.tenant_memberships where id = current_setting('test.staff')::uuid),'admin','the role is saved');
select is((select count(*) from public.workspace_events where kind = 'membership_update' and entity_id = current_setting('test.staff')::uuid),1::bigint,'the change is logged');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.owner')::uuid,current_setting('test.owner_at')::timestamptz,'admin','active')$$,'42501','The owner''s access cannot be changed here','the owner row cannot be changed');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'owner','active')$$,'23514',null,'nobody is made owner here');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'staff','invited')$$,'23514',null,'status is active or inactive');
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'staff','inactive')$$,'the owner deactivates a teammate');
select is((select status::text from public.team_members('00000000-0000-4000-8000-000000000101') where id = current_setting('test.staff')::uuid),'inactive','a deactivated teammate stays on the list as inactive');

-- The deactivated teammate is out.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select throws_ok($$select * from public.team_members('00000000-0000-4000-8000-000000000101')$$,'42501',null,'a deactivated teammate cannot see the team');

-- Back in, as staff (the owner reactivates).
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'staff','active')$$,'the owner reactivates the teammate');
select set_config('test.open',(select id::text from public.tenant_invites where email = 'new.person@example.com' and revoked_at is null),true);

-- Manager.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select set_config('test.manager',(select id::text from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000006'),true);
select lives_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','helper@example.com','staff')$$,'a manager invites');
select lives_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.open')::uuid)$$,'a manager resends');
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'admin','active')$$,'a manager changes a teammate');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.owner')::uuid,current_setting('test.owner_at')::timestamptz,'staff','inactive')$$,'42501',null,'a manager cannot touch the owner');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.manager')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.manager')::uuid),'staff','active')$$,'42501','You cannot change your own access','nobody changes their own access');

-- Staff (made staff again by the owner) can look but not manage.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.staff')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.staff')::uuid),'staff','active')$$,'the owner sets staff back');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.team_members('00000000-0000-4000-8000-000000000101')),3::bigint,'staff can see the team');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','sneaky@example.com','staff')$$,'42501',null,'staff cannot invite');
select throws_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.open')::uuid)$$,'42501',null,'staff cannot resend');
select throws_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.open')::uuid)$$,'42501',null,'staff cannot cancel');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',current_setting('test.manager')::uuid,(select updated_at from public.tenant_memberships where id = current_setting('test.manager')::uuid),'staff','inactive')$$,'42501',null,'staff cannot change anyone');

-- Another workspace's owner sees and changes nothing here.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select * from public.team_members('00000000-0000-4000-8000-000000000101')$$,'42501',null,'another workspace cannot list this team');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','x@example.com','staff')$$,'42501',null,'another workspace cannot invite here');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000102',current_setting('test.staff')::uuid,now(),'admin','active')$$,'42501','Member unavailable','nor change a member from its own workspace');
select throws_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000102',current_setting('test.open')::uuid)$$,'42501','Invite unavailable','nor resend an invite from its own workspace');

-- A cancelled invite can never be accepted.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.late',public.invite_team('00000000-0000-4000-8000-000000000101','other-owner@grey-retention.test','staff')::text,true);
select lives_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.late')::uuid)$$,'the owner cancels the invite');
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.accept_team_invite(current_setting('test.late')::uuid)$$,'23514','Invite revoked or expired','a cancelled invite cannot be accepted');
reset role;
select is((select count(*) from public.tenant_memberships where tenant_id = '00000000-0000-4000-8000-000000000101' and profile_id = '00000000-0000-4000-8000-000000000004'),0::bigint,'and grants no membership');

select * from finish();
rollback;
