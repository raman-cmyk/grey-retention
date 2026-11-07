begin;
select plan(35);

-- Workspace 101: owner ...01, staff ...05, manager ...06. Workspace 102: owner ...04.
delete from public.tenant_invites where tenant_id in ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-000000000004';
insert into public.tenant_invites (tenant_id, email, role, token_hash, expires_at, invited_by)
values ('00000000-0000-4000-8000-000000000102', 'theirs@example.com', 'staff', repeat('b', 64), now() + interval '7 days', '00000000-0000-4000-8000-000000000004');
select set_config('test.theirs', (select id::text from public.tenant_invites where email = 'theirs@example.com'), true);

-- No direct writes at all, not even the column-level ones members had.
select ok(not has_any_column_privilege('authenticated','public.tenant_memberships','update'),'no column may be updated directly on memberships');
select ok(not has_any_column_privilege('authenticated','public.tenant_invites','update'),'no column may be updated directly on invites');
select ok(not has_function_privilege('anon','public.invite_team(uuid,text,public.tenant_role)','execute'),'anon cannot invite');
select ok(not has_function_privilege('anon','public.resend_team_invite(uuid,uuid)','execute'),'anon cannot resend');
select ok(not has_function_privilege('anon','public.revoke_team_invite(uuid,uuid)','execute'),'anon cannot cancel');
select ok(not has_function_privilege('anon','public.change_team_member(uuid,uuid,timestamptz,public.tenant_role,public.membership_status)','execute'),'anon cannot change members');
select ok(not has_function_privilege('service_role','public.team_members(uuid)','execute'),'service role cannot list the team');
select ok(not has_function_privilege('service_role','public.invite_team(uuid,text,public.tenant_role)','execute'),'service role cannot invite');
select ok(not has_function_privilege('service_role','public.update_team_access(uuid,uuid,timestamptz,public.tenant_role,public.membership_status)','execute'),'the retired command is closed to the service role too');
select ok(not has_function_privilege('authenticated','private.require_team_manager(uuid)','execute'),'helpers stay private');

-- Owner.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$update public.tenant_memberships set role = 'staff' where profile_id = '00000000-0000-4000-8000-000000000001'$$,'42501',null,'the owner cannot update their own row directly');
select set_config('test.invite',public.invite_team('00000000-0000-4000-8000-000000000101','late@example.com','staff')::text,true);
select lives_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'the owner cancels an invite');

-- Manager: no direct un-cancel, no owner role.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$update public.tenant_invites set revoked_at = null where id = current_setting('test.invite')::uuid$$,'42501',null,'a manager cannot un-cancel an invite directly');
select throws_ok($$update public.tenant_memberships set role = 'staff' where profile_id = '00000000-0000-4000-8000-000000000006'$$,'42501',null,'a manager cannot change their own row directly');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',(select id from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000005'),(select updated_at from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000005'),'owner','active')$$,'23514',null,'a manager cannot make an owner');

-- A deactivated teammate is reactivated, never re-invited.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',(select id from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000006'),(select updated_at from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000006'),'admin','inactive')$$,'the owner deactivates the manager');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','team-admin@grey-retention.test','staff')$$,'PT409','Deactivated member','a deactivated teammate cannot be invited again');
select is((select count(*) from public.team_members('00000000-0000-4000-8000-000000000101') where status = 'inactive'),1::bigint,'the owner sees deactivated teammates');

-- Staff do not see deactivated people.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select is((select count(*) from public.team_members('00000000-0000-4000-8000-000000000101')),2::bigint,'staff see active teammates only');
select is((select count(*) from public.team_members('00000000-0000-4000-8000-000000000101') where email = 'team-admin@grey-retention.test'),0::bigint,'not the deactivated manager''s email');

-- A deactivated manager can no longer manage.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','new@example.com','staff')$$,'42501',null,'a deactivated manager cannot invite');

-- Legacy 'invited' rows stay hidden and unchangeable; accepting applies the invited role.
reset role;
insert into public.tenant_memberships (tenant_id, profile_id, role, status)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000004', 'admin', 'invited');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is((select count(*) from public.team_members('00000000-0000-4000-8000-000000000101') where profile_id = '00000000-0000-4000-8000-000000000004'),0::bigint,'a legacy invited row is not listed');
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',(select id from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000004' and tenant_id = '00000000-0000-4000-8000-000000000101'),(select updated_at from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000004' and tenant_id = '00000000-0000-4000-8000-000000000101'),'admin','active')$$,'42501','Member unavailable','a legacy invited row cannot be switched on from the Team page');
select set_config('test.join',public.invite_team('00000000-0000-4000-8000-000000000101','other-owner@grey-retention.test','staff')::text,true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select lives_ok($$select public.accept_team_invite(current_setting('test.join')::uuid)$$,'the invited person accepts');
select is((select row(role, status)::text from public.tenant_memberships where tenant_id = '00000000-0000-4000-8000-000000000101' and profile_id = '00000000-0000-4000-8000-000000000004'),row('staff','active')::text,'with the invited role, not the old one');

-- Resend after the address joined says so.
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;
insert into public.tenant_invites (tenant_id, email, role, token_hash, expires_at, invited_by)
values ('00000000-0000-4000-8000-000000000101', 'other-owner@grey-retention.test', 'staff', repeat('c', 64), now() + interval '7 days', '00000000-0000-4000-8000-000000000001');
select set_config('test.old', (select id::text from public.tenant_invites where token_hash = repeat('c', 64)), true);
set local role authenticated;
select throws_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.old')::uuid)$$,'PT409','Already a member','resending to someone who joined says so');

-- Someone the workspace deactivated cannot use an old invite to get back in.
reset role;
update public.tenant_memberships set status = 'inactive' where tenant_id = '00000000-0000-4000-8000-000000000101' and profile_id = '00000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.accept_team_invite(current_setting('test.old')::uuid)$$,'PT409','Ask the workspace to reactivate you','a deactivated person cannot accept an old invite');

-- Another workspace's owner cannot change, resend or cancel here, and
-- cancelling an unknown invite says unavailable.
select throws_ok($$select public.change_team_member('00000000-0000-4000-8000-000000000101',(select id from public.tenant_memberships where profile_id = '00000000-0000-4000-8000-000000000005'),now(),'admin','active')$$,'42501',null,'another workspace cannot change members here');
select throws_ok($$select public.resend_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'42501',null,'nor resend here');
select throws_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.invite')::uuid)$$,'42501',null,'nor cancel here');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.revoke_team_invite('00000000-0000-4000-8000-000000000101',current_setting('test.theirs')::uuid)$$,'42501','Invite unavailable','another workspace''s invite is unavailable');

-- Expired invites cancelled on re-invite are logged.
reset role;
update public.tenant_invites set revoked_at = null, created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = current_setting('test.invite')::uuid;
set local role authenticated;
select lives_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','late@example.com','staff')$$,'re-inviting after expiry works');
select is((select count(*) from public.workspace_events where kind = 'invitation_revoked' and entity_id = current_setting('test.invite')::uuid and detail->>'reason' = 'expired'),1::bigint,'and the expired invite''s cancel is logged');

-- A paused workspace cannot be managed.
reset role;
update public.tenants set status = 'paused' where id = '00000000-0000-4000-8000-000000000101';
set local role authenticated;
select throws_ok($$select * from public.team_members('00000000-0000-4000-8000-000000000101')$$,'42501',null,'a paused workspace lists nothing');
select throws_ok($$select public.invite_team('00000000-0000-4000-8000-000000000101','paused@example.com','staff')$$,'42501',null,'and invites nothing');

select * from finish();
rollback;
