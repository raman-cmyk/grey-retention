alter table public.chat_proposals add constraint proposal_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
alter table public.assignment_requests add constraint request_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
create or replace function private.ensure_package_cycle(t uuid) returns public.package_cycles language plpgsql security definer set search_path='' as $$
declare p public.packages;c public.package_cycles;
begin
 perform 1 from public.tenants where id=t for update;
 select * into c from public.package_cycles where tenant_id=t and state='active' for update;
 if c.id is not null and c.ends_at>now() then return c;end if;
 if c.id is not null and c.reserved_micro>0 then raise exception 'Resolve outstanding usage before cycle renewal' using errcode='23514';end if;
 update public.package_cycles set state='closed' where tenant_id=t and state='active';
 select * into p from public.packages where name='Synthetic fixture starter' and active;
 if p.id is null then raise exception 'Active package required' using errcode='23514';end if;
 insert into public.package_cycles(tenant_id,package_id,snapshot,allocation_micro,daily_micro,ends_at) values(t,p.id,to_jsonb(p),p.allocation_micro,p.daily_micro,now()+make_interval(days=>p.cycle_days)) returning * into c;return c;
end $$;
create or replace function private.reserve_budget(t uuid,operation text,feature text,estimate bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.package_cycles;r public.usage_reservations;d date;daily bigint;alert text;
begin
 if operation is null or length(operation) not between 1 and 200 or feature is null or feature not in ('copy','design','assets','playbook','calendar','gros','learning') or estimate is null or estimate<1 or estimate>1000000000 then raise exception 'Invalid usage request' using errcode='23514';end if;
 c:=private.ensure_package_cycle(t);
 d:=(now() at time zone (select timezone from public.tenants where id=t))::date;
 select * into r from public.usage_reservations where tenant_id=t and operation_id=operation for update;
 if r.id is not null then
  if r.feature<>feature or r.estimate_micro<>estimate then raise exception 'Usage operation identity changed' using errcode='40001';end if;
  if r.state in ('reserved','reconciled') then return r.id;end if;
 end if;
 select coalesce(sum(case when state='reserved' then estimate_micro when state='reconciled' then actual_micro else 0 end),0) into daily from public.usage_reservations where cycle_id=c.id and local_date=d;
 if c.used_micro+c.reserved_micro+estimate>c.allocation_micro or daily+estimate>c.daily_micro then raise exception 'Fixture AI budget exhausted; approved delivery remains available' using errcode='23514';end if;
 insert into public.usage_reservations(tenant_id,cycle_id,operation_id,feature,estimate_micro,local_date) values(t,c.id,operation,feature,estimate,d) on conflict(tenant_id,operation_id) do update set cycle_id=excluded.cycle_id,state='reserved',actual_micro=null,local_date=excluded.local_date,expires_at=now()+interval '10 minutes' returning * into r;
 update public.package_cycles set reserved_micro=reserved_micro+estimate where id=c.id;
 foreach alert in array array[case when c.used_micro+c.reserved_micro+estimate>=c.allocation_micro*0.8 then 'cycle' end,case when daily+estimate>=c.daily_micro*0.8 then 'day:'||d end] loop
 if alert is not null then
 insert into public.budget_alerts(cycle_id,tenant_id,window_key) values(c.id,t,alert) on conflict do nothing;
 if found then perform private.notify_owners(t,'budget_soft_alert',c.id,'Synthetic fixture usage reached 80% of '||alert||' allowance. No paid provider was called.');end if;
 end if;end loop;return r.id;
end $$;
create or replace function private.reconcile_budget(t uuid,reservation uuid,actual bigint) returns void language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations;
begin
 perform 1 from public.tenants where id=t for update;
 select * into r from public.usage_reservations where id=reservation and tenant_id=t for update;
 if r.id is null or actual is null or actual<0 or actual>r.estimate_micro then raise exception 'Actual fixture usage must fit reservation' using errcode='23514';end if;
 if r.state='reconciled' and r.actual_micro=actual then return;end if;
 if r.state<>'reserved' then raise exception 'Usage reservation already closed' using errcode='40001';end if;
 update public.package_cycles set reserved_micro=reserved_micro-r.estimate_micro,used_micro=used_micro+actual where id=r.cycle_id;
 update public.usage_reservations set state=case when actual=0 then 'released' else 'reconciled' end,actual_micro=actual where id=r.id;
end $$;
create or replace function public.reserve_fixture_usage(t uuid,operation text,feature text,estimate bigint) returns uuid language plpgsql security definer set search_path='' as $$
begin if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;return private.reserve_budget(t,operation,feature,estimate);end $$;
create or replace function public.reconcile_fixture_usage(t uuid,reservation uuid,actual bigint) returns void language plpgsql security definer set search_path='' as $$
begin if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;perform private.reconcile_budget(t,reservation,actual);end $$;
create or replace function private.job_usage_completion() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations;
begin
 if new.status is distinct from old.status and new.status in ('succeeded','failed','retry_wait','cancelled') then
 select * into r from public.usage_reservations where tenant_id=new.tenant_id and operation_id=new.id::text and state='reserved';
 if r.id is not null then perform private.reconcile_budget(new.tenant_id,r.id,case when new.status='succeeded' then r.estimate_micro*8/10 else 0 end);end if;
 end if;return new;
end $$;
create trigger job_usage_terminal after update on public.job_runs for each row execute function private.job_usage_completion();
create or replace function public.define_fixture_package(name text,allocation bigint,daily bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 if not exists(select 1 from public.platform_admins a join public.profiles p on p.id=a.profile_id where a.profile_id=auth.uid() and a.role='super_admin' and a.active and p.status='active') then raise exception 'Super admin required' using errcode='42501';end if;
 insert into public.packages(name,allocation_micro,daily_micro) values(name,allocation,daily) on conflict on constraint packages_name_key do update set revision=public.packages.revision+1,allocation_micro=excluded.allocation_micro,daily_micro=excluded.daily_micro returning public.packages.id into id;return id;
end $$;
create or replace function public.assign_fixture_package(t uuid,package uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.packages;c uuid;
begin
 if not exists(select 1 from public.platform_admins a join public.profiles profile on profile.id=a.profile_id where a.profile_id=auth.uid() and a.role='super_admin' and a.active and profile.status='active') then raise exception 'Super admin required' using errcode='42501';end if;
 perform 1 from public.tenants where id=t for update;
 if exists(select 1 from public.package_cycles where tenant_id=t and state='active' and reserved_micro>0) then raise exception 'Resolve in-flight usage before changing package' using errcode='23514';end if;
 select * into p from public.packages where id=package and active;
 if p.id is null then raise exception 'Package unavailable' using errcode='23514';end if;
 update public.package_cycles set state='closed' where tenant_id=t and state='active';
 insert into public.package_cycles(tenant_id,package_id,snapshot,allocation_micro,daily_micro,ends_at) values(t,p.id,to_jsonb(p),p.allocation_micro,p.daily_micro,now()+make_interval(days=>p.cycle_days)) returning id into c;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'fixture_package_assigned',c,jsonb_build_object('packageId',p.id,'packageRevision',p.revision));return c;
end $$;
create or replace function public.create_conversation(t uuid,title text,visibility text default 'private') returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin perform private.require_member(t);insert into public.conversations(tenant_id,creator_id,title,visibility) values(t,auth.uid(),title,visibility) returning public.conversations.id into id;return id;end $$;
create or replace function public.set_conversation_visibility(t uuid,chat uuid,visibility text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t);
 update public.conversations set visibility=set_conversation_visibility.visibility where id=chat and tenant_id=t and creator_id=auth.uid();
 if not found then raise exception 'Only creator may change visibility' using errcode='42501';end if;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'chat_visibility_changed',chat,jsonb_build_object('visibility',visibility));
end $$;
create or replace function public.ask_fixture_gros(t uuid,chat uuid,campaign uuid,question text,intent text default 'explain',value text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;conv public.conversations;proposal uuid;payload jsonb;body text;budget uuid;op uuid:=gen_random_uuid();revisions jsonb;
begin
 if not private.chat_visible(t,chat) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 perform 1 from public.tenants where id=t for update;
 select * into conv from public.conversations where id=chat and tenant_id=t for update;
 if conv.status<>'active' or question is null or length(btrim(question)) not between 1 and 5000 or intent is null or intent not in ('explain','edit_goal','select_reference','schedule','cancel','request_assignment') then raise exception 'Validated question and intent required' using errcode='23514';end if;
 select * into c from public.campaigns where id=campaign and tenant_id=t;
 if c.id is null then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if intent in ('schedule','cancel','request_assignment') then perform private.require_member(t,true);end if;
 if intent='edit_goal' and (length(coalesce(value,'')) not between 1 and 5000 or c.delivery_state not in ('not_ready','ready','failed','cancelled') or (c.calendar_state='approved' and not private.is_active_member(t,array['owner']::public.tenant_role[]))) then raise exception 'Permitted editable draft required' using errcode='23514';end if;
 if intent='select_reference' and not exists(select 1 from public.competitor_emails e where e.id=nullif(value,'')::uuid and private.capture_access(e.capture_id)) then raise exception 'Subscribed reference required' using errcode='42501';end if;
 budget:=private.reserve_budget(t,op::text,'gros',1000);
 revisions:=jsonb_build_object('calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision,'delivery',c.delivery_revision);
 body:='Synthetic GROS: '||c.title||E'\nGoal: '||c.goal||E'\nCalendar/copy/design/delivery: '||c.calendar_state||' / '||c.copy_state||' / '||c.design_state||' / '||c.delivery_state||E'\nReason and evidence: '||c.lineage::text||E'\nReference notes: '||c.reference_notes||E'\nThis explanation uses authorized persisted inputs; no paid AI was called.';
 insert into public.chat_messages(tenant_id,conversation_id,actor_id,role,body) values(t,chat,auth.uid(),'user',question);
 if intent<>'explain' then
  payload:=case intent when 'edit_goal' then jsonb_build_object('goal',value) when 'select_reference' then jsonb_build_object('emailId',value) when 'schedule' then jsonb_build_object('packageId',(select id from public.delivery_packages where campaign_id=c.id and revision=c.delivery_revision)) else '{}'::jsonb end;
  body:=body||E'\nProposed '||intent||': '||payload::text||E'\nConfirming rechecks your current authority and every exact target revision. Draft/reference edits invalidate creative approvals; scheduling/cancellation queues a provider intent; assignment requests require admin assignment.';
  insert into public.chat_proposals(tenant_id,conversation_id,actor_id,campaign_id,kind,target_revisions,payload,consequence) values(t,chat,auth.uid(),c.id,intent,revisions,payload,'Explicit confirmation required. Material edits invalidate affected approvals; provider outcomes remain pending until confirmed.') returning id into proposal;
 end if;
 insert into public.chat_messages(tenant_id,conversation_id,actor_id,role,body,evidence) values(t,chat,auth.uid(),'assistant',left(body,8000),jsonb_build_object('campaignId',c.id,'revisions',revisions,'lineage',c.lineage));
 perform private.reconcile_budget(t,budget,800);return coalesce(proposal,op);
end $$;
create or replace function public.decide_chat_proposal(t uuid,proposal uuid,expected_hash text,decision text) returns void language plpgsql security definer set search_path='' as $$
declare p public.chat_proposals;c public.campaigns;input jsonb;
begin
 perform private.require_member(t);perform 1 from public.tenants where id=t for update;
 select * into p from public.chat_proposals where id=proposal and tenant_id=t for update;
 if p.id is null or not private.chat_visible(t,p.conversation_id) or p.actor_id<>auth.uid() then raise exception 'Only proposing actor may confirm or reject' using errcode='42501';end if;
 if p.payload_hash is distinct from expected_hash or decision is null or decision not in ('confirmed','rejected') then raise exception 'Unseen proposal payload' using errcode='40001';end if;
 if p.status=decision then return;end if;
 if p.status<>'pending' or p.expires_at<=now() then raise exception 'Proposal expired; ask again for current confirmation' using errcode='40001';end if;
 if decision='rejected' then update public.chat_proposals set status='rejected' where id=p.id;return;end if;
 select * into c from public.campaigns where id=p.campaign_id and tenant_id=t for update;
 if p.target_revisions is distinct from jsonb_build_object('calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision,'delivery',c.delivery_revision) then raise exception 'Target changed; request a new proposal' using errcode='40001';end if;
 input:=jsonb_build_object('title',c.title,'goal',c.goal,'channel',c.channel,'planned_at',c.planned_at,'audience_id',c.audience_id,'product_id',c.product_id,'offer_id',c.offer_id,'reference_notes',c.reference_notes);
 if p.kind='edit_goal' then perform public.save_campaign(t,c.id,c.calendar_revision,input||p.payload);
 elsif p.kind='select_reference' then
  if not exists(select 1 from public.competitor_emails e where e.id=(p.payload->>'emailId')::uuid and private.capture_access(e.capture_id)) then raise exception 'Reference visibility changed' using errcode='42501';end if;
  perform public.save_campaign(t,c.id,c.calendar_revision,input||jsonb_build_object('reference_notes','Structure evidence email '||(p.payload->>'emailId')||'; no competitor wording reused.'));
 elsif p.kind='schedule' then perform public.enqueue_delivery(t,(p.payload->>'packageId')::uuid,c.delivery_revision);
 elsif p.kind='cancel' then perform public.enqueue_cancel(t,c.id,c.delivery_revision);
 elsif p.kind='request_assignment' then
  perform private.require_member(t,true);
  if c.copy_state<>'approved' then raise exception 'Approved copy required for assignment request' using errcode='23514';end if;
  insert into public.assignment_requests(tenant_id,campaign_id,requested_by) values(t,c.id,auth.uid());
 end if;
 update public.chat_proposals set status='confirmed',confirmed_at=now() where id=p.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'gros_confirmed_'||p.kind,jsonb_build_object('proposalId',p.id,'payloadHash',p.payload_hash));
end $$;
create or replace function private.audit_team_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(coalesce(new.tenant_id,old.tenant_id),auth.uid(),'membership_'||lower(tg_op),coalesce(new.id,old.id),jsonb_build_object('beforeRole',case when tg_op='INSERT' then null else old.role end,'beforeStatus',case when tg_op='INSERT' then null else old.status end,'afterRole',case when tg_op='DELETE' then null else new.role end,'afterStatus',case when tg_op='DELETE' then null else new.status end));return coalesce(new,old);
end $$;
create trigger membership_event after insert or update or delete on public.tenant_memberships for each row execute function private.audit_team_change();
create or replace function public.update_team_access(t uuid,membership uuid,expected_at timestamptz,role public.tenant_role,status public.membership_status) returns void language plpgsql security definer set search_path='' as $$
declare m public.tenant_memberships;
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Team administrator required' using errcode='42501';end if;
 perform 1 from public.tenants where id=t for update;
 select * into m from public.tenant_memberships where id=membership and tenant_id=t for update;
 if m.id is null then raise exception 'Member unavailable' using errcode='42501';end if;
 if m.updated_at is distinct from expected_at then raise exception 'Membership changed' using errcode='40001';end if;
 if (m.role='owner' or role='owner') and not private.is_active_member(t,array['owner']::public.tenant_role[]) then raise exception 'Owner required for owner access' using errcode='42501';end if;
 update public.tenant_memberships set role=update_team_access.role,status=update_team_access.status where id=m.id;
end $$;
create or replace function public.invite_team(t uuid,email text,role public.tenant_role) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Team administrator required' using errcode='42501';end if;
 if email is null or length(email)>254 or email !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' or role is null or role='owner' then raise exception 'Valid non-owner invite required' using errcode='23514';end if;
 insert into public.tenant_invites(tenant_id,email,role,token_hash,expires_at,invited_by) values(t,lower(btrim(email)),role,encode(extensions.digest(extensions.gen_random_bytes(32),'sha512'),'hex'),now()+interval '7 days',auth.uid()) returning public.tenant_invites.id into id;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'invitation_simulated',id,jsonb_build_object('role',role,'emailDelivery','simulated'));
 perform private.notify_owners(t,'team_invitation',id,'Team invitation persisted. Email delivery is simulated; no message was sent.');return id;
end $$;
create or replace function public.revoke_team_invite(t uuid,invite uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Team administrator required' using errcode='42501';end if;
 update public.tenant_invites set revoked_at=now() where id=invite and tenant_id=t and accepted_at is null and revoked_at is null;
 if not found then raise exception 'Open invite unavailable' using errcode='23514';end if;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id) values(t,auth.uid(),'invitation_revoked',invite);
end $$;
create or replace function public.my_pending_invites() returns table(id uuid,tenant_name text,role public.tenant_role) language sql stable security definer set search_path='' as $$
 select i.id,t.name,i.role from public.tenant_invites i join public.tenants t on t.id=i.tenant_id and t.status='active' join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=i.email where i.accepted_at is null and i.revoked_at is null and i.expires_at>now() and private.is_profile_active();
$$;
create or replace function public.accept_team_invite(invite uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.tenant_invites;
begin
 select invitation.* into i from public.tenant_invites invitation join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=invitation.email where invitation.id=invite and private.is_profile_active() for update of invitation;
 if i.id is null then raise exception 'Verified invite email required' using errcode='42501';end if;
 if i.revoked_at is not null or i.expires_at<=now() then raise exception 'Invite revoked or expired' using errcode='23514';end if;
 if i.accepted_at is not null then return i.tenant_id;end if;
 insert into public.tenant_memberships(tenant_id,profile_id,role,status,invited_by,accepted_at) values(i.tenant_id,auth.uid(),i.role,'active',i.invited_by,now()) on conflict(tenant_id,profile_id) do update set status='active',accepted_at=now() where public.tenant_memberships.status<>'active';
 update public.tenant_invites set accepted_at=now() where id=i.id;return i.tenant_id;
end $$;
create or replace function public.add_holiday(t uuid,name text,event_date date,notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin perform private.require_member(t,true);insert into public.holidays(tenant_id,name,event_date,notes,created_by) values(t,name,event_date,coalesce(notes,''),auth.uid()) returning public.holidays.id into id;insert into public.workspace_events(tenant_id,actor_id,kind,entity_id) values(t,auth.uid(),'holiday_created',id);return id;end $$;
create or replace function public.open_support_ticket(t uuid,kind text,subject text,body text) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 perform private.require_member(t);insert into public.support_tickets(tenant_id,creator_id,kind,subject) values(t,auth.uid(),kind,subject) returning public.support_tickets.id into id;
 insert into public.support_messages(tenant_id,ticket_id,actor_id,body) values(t,id,auth.uid(),body);
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id) values(t,auth.uid(),'support_opened',id);return id;
end $$;
create or replace function public.reply_support(t uuid,ticket uuid,expected_revision integer,body text,state text) returns void language plpgsql security definer set search_path='' as $$
declare r public.support_tickets;
begin
 if not private.is_active_member(t) and not private.is_operator() then raise exception 'Access denied' using errcode='42501';end if;
 select * into r from public.support_tickets where tenant_id=t and id=ticket for update;
 if r.id is null then raise exception 'Ticket unavailable' using errcode='42501';end if;
 if r.revision is distinct from expected_revision then raise exception 'Ticket changed; refresh' using errcode='40001';end if;
 insert into public.support_messages(tenant_id,ticket_id,actor_id,body) values(t,ticket,auth.uid(),body);
 update public.support_tickets set revision=revision+1,state=reply_support.state,updated_at=now() where id=r.id;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'support_replied',r.id,jsonb_build_object('state',state));
 perform private.notify_owners(t,'support_reply',r.id,'Support thread updated. Inspect its persisted reply and status.');
end $$;
create policy operator_read on public.support_tickets for select to authenticated using(private.is_operator());
create policy operator_read on public.support_messages for select to authenticated using(private.is_operator());
create or replace function private.assignment_request_resolved() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.assignment_requests set state='assigned' where campaign_id=new.campaign_id and tenant_id=new.tenant_id and state='open';return new;end $$;
create trigger request_assigned after insert on public.designer_assignments for each row execute function private.assignment_request_resolved();
create or replace function public.operator_diagnostics() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_operator() then raise exception 'Operator permission required' using errcode='42501';end if;
 return jsonb_build_object(
 'tenants',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'timezone',t.timezone,'package',c.snapshot->>'name','usedMicro',c.used_micro,'reservedMicro',c.reserved_micro,'allocationMicro',c.allocation_micro)),'[]') from public.tenants t left join public.package_cycles c on c.tenant_id=t.id and c.state='active'),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]') from (select id,tenant_id,kind,status,attempt,failure_class,error_code,available_at,updated_at from public.job_runs order by updated_at desc limit 100)j),
 'connections',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from (select tenant_id,provider,status,last_sync_at from public.workspace_connections)c),
 'assignmentRequests',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,tenant_id,campaign_id,state,created_at from public.assignment_requests where state='open')r),
 'chats',(select jsonb_build_object('count',count(*),'privateCount',count(*) filter(where visibility='private')) from public.conversations));
end $$;
-- No raw chat, job input/checkpoint/output, provider configuration or credentials are diagnostic outputs.
revoke all on function private.ensure_package_cycle(uuid),private.reserve_budget(uuid,text,text,bigint),private.reconcile_budget(uuid,uuid,bigint),private.job_usage_completion(),private.audit_team_change(),private.assignment_request_resolved() from public,anon,authenticated;
do $$declare f text;begin foreach f in array array['public.reserve_fixture_usage(uuid,text,text,bigint)','public.reconcile_fixture_usage(uuid,uuid,bigint)','public.define_fixture_package(text,bigint,bigint)','public.assign_fixture_package(uuid,uuid)','public.create_conversation(uuid,text,text)','public.set_conversation_visibility(uuid,uuid,text)','public.ask_fixture_gros(uuid,uuid,uuid,text,text,text)','public.decide_chat_proposal(uuid,uuid,text,text)','public.update_team_access(uuid,uuid,timestamptz,public.tenant_role,public.membership_status)','public.invite_team(uuid,text,public.tenant_role)','public.revoke_team_invite(uuid,uuid)','public.my_pending_invites()','public.accept_team_invite(uuid)','public.add_holiday(uuid,text,date,text)','public.open_support_ticket(uuid,text,text,text)','public.reply_support(uuid,uuid,integer,text,text)','public.operator_diagnostics()'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
grant execute on function public.reserve_fixture_usage(uuid,text,text,bigint),public.reconcile_fixture_usage(uuid,uuid,bigint) to service_role;
grant execute on function private.is_operator() to authenticated;
create or replace function public.enqueue_health_check(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner uuid;d text;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 select m.profile_id into owner from public.tenant_memberships m join public.profiles p on p.id=m.profile_id where m.tenant_id=t and m.role='owner' and m.status='active' and p.status='active' order by m.created_at limit 1;
 if owner is null then return;end if;
 d:=(now() at time zone (select timezone from public.tenants where id=t))::date::text;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'ops.health','health:'||t||':'||d,jsonb_build_object('date',d),owner) on conflict(tenant_id,idempotency_key) do nothing;
end $$;
create or replace function public.finish_health_check(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;c public.workspace_connections;issues integer:=0;
begin
 j:=private.onboarding_lease(job,lease);if j.kind<>'ops.health' then raise exception 'Wrong health job' using errcode='23514';end if;
 for c in select * from public.workspace_connections where tenant_id=j.tenant_id and status<>'connected' loop
 issues:=issues+1;perform private.notify_owners(j.tenant_id,'connection_health',j.id,'Fixture '||c.provider||' connection is '||c.status||'. Inspect settings; no live provider was contacted.');end loop;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('synthetic',true,'issues',issues),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
revoke all on function public.enqueue_health_check(uuid),public.finish_health_check(uuid,uuid) from public,anon;
grant execute on function public.enqueue_health_check(uuid),public.finish_health_check(uuid,uuid) to authenticated,service_role;
-- Missing JWT role must deny worker authority, including direct SQL/fixture contexts.
create or replace function private.worker_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active_member(t,array['owner']::public.tenant_role[]) or private.is_operator() or coalesce(auth.role()='service_role',false);
$$;
revoke all on function private.worker_access(uuid) from public,anon,authenticated;
create or replace function public.fixture_usage_summary(t uuid) returns table(feature text,used_micro bigint,held_micro bigint,day_micro bigint) language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Usage reader required' using errcode='42501';end if;
 return query select u.feature,coalesce(sum(u.actual_micro) filter(where u.state='reconciled'),0)::bigint,coalesce(sum(u.estimate_micro) filter(where u.state='reserved'),0)::bigint,coalesce(sum(case when u.state='reserved' then u.estimate_micro when u.state='reconciled' then u.actual_micro else 0 end) filter(where u.local_date=(now() at time zone tenant.timezone)::date),0)::bigint from public.usage_reservations u join public.package_cycles c on c.id=u.cycle_id and c.state='active' join public.tenants tenant on tenant.id=u.tenant_id where u.tenant_id=t group by u.feature;
end $$;
revoke all on function public.fixture_usage_summary(uuid) from public,anon;
grant execute on function public.fixture_usage_summary(uuid) to authenticated;
