-- All mutation paths serialize on tenant before resource/job locks, including budget-trigger work.
create or replace function private.require_member(t uuid,owner_only boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_active_member(t,case when owner_only then array['owner']::public.tenant_role[] else null end) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if not private.is_active_member(t,case when owner_only then array['owner']::public.tenant_role[] else null end) then raise exception 'Access denied' using errcode='42501';end if;
end $$;

create or replace function private.worker_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tenants where id=t and status='active') and (private.is_active_member(t,array['owner']::public.tenant_role[]) or private.is_operator() or coalesce(auth.role()='service_role',false));
$$;
create or replace function private.onboarding_lease(job uuid,lease uuid) returns public.job_runs language plpgsql security definer set search_path='' as $$
declare j public.job_runs;t uuid;
begin
 select tenant_id into t from public.job_runs where id=job;
 if t is null or not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 select * into j from public.job_runs where id=job for update;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='40001';end if;return j;
end $$;
create or replace function public.claim_job(t uuid) returns setof public.job_runs language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 update public.job_runs set status=case when attempt>=4 then 'failed' else 'retry_wait' end,lease_token=null,lease_until=null,available_at=now(),error_code='stale_lease' where tenant_id=t and status in ('leased','running') and lease_until<now();
 select * into j from public.job_runs where tenant_id=t and status in ('queued','retry_wait') and attempt<4 and available_at<=now() order by available_at,created_at for update skip locked limit 1;
 if not found then return;end if;
 return query update public.job_runs set status='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning *;
end $$;
create function public.recover_expired_usage(t uuid) returns integer language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations;n integer:=0;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 for r in select * from public.usage_reservations u where u.tenant_id=t and u.state='reserved' and u.expires_at<=now() and not exists(select 1 from public.job_runs j where j.tenant_id=t and j.id::text=u.operation_id and j.status in ('running','leased') and j.lease_until>now()) for update loop
 perform private.reconcile_budget(t,r.id,0);n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.recover_expired_usage(uuid) from public,anon;
grant execute on function public.recover_expired_usage(uuid) to authenticated,service_role;
-- Explicit local-service dispatch uses the same validating domain RPCs as owner-driven fixtures.
grant execute on function public.finish_copy_job(uuid,uuid,jsonb),public.fixture_copy_preference(uuid,uuid),public.finish_onboarding_job(uuid,uuid,jsonb),public.finish_capture_job(uuid,uuid,jsonb),public.finish_playbook_job(uuid,uuid,jsonb),public.finish_plan_job(uuid,uuid,jsonb),public.finish_reminder_job(uuid,uuid),public.finish_render_job(uuid,uuid,jsonb) to service_role;
-- Existing messages get deterministic order; new inserts allocate an ordinal under the conversation lock.
alter table public.chat_messages add column message_index bigint;
with ranked as(select id,row_number() over(partition by conversation_id order by created_at,case role when 'user' then 0 else 1 end,id) as n from public.chat_messages) update public.chat_messages m set message_index=ranked.n from ranked where ranked.id=m.id;
alter table public.chat_messages alter column message_index set not null;
create unique index chat_message_order on public.chat_messages(conversation_id,message_index);
create function private.order_chat_message() returns trigger language plpgsql security definer set search_path='' as $$
begin perform 1 from public.conversations where id=new.conversation_id for update;select coalesce(max(message_index),0)+1 into new.message_index from public.chat_messages where conversation_id=new.conversation_id;return new;end $$;
create trigger chat_message_ordered before insert on public.chat_messages for each row execute function private.order_chat_message();
revoke all on function private.order_chat_message() from public,anon,authenticated;
create or replace function public.assign_campaign(t uuid,campaign uuid,designer uuid,expected_copy integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;a uuid;b public.brand_profiles;recipient uuid;
begin
 if not private.is_operator() then raise exception 'Platform assignment permission required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_state<>'approved' or c.copy_revision is distinct from expected_copy or c.calendar_state<>'approved' then raise exception 'Approved current brief required' using errcode='40001';end if;
 if c.design_state='owner_approved' or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Owner review or active delivery prevents reassignment' using errcode='23514';end if;
 select d.profile_id into recipient from public.designers d join public.designer_tenant_access x on x.designer_id=d.id join public.profiles p on p.id=d.profile_id where d.id=designer and d.status='active' and p.status='active' and x.tenant_id=t;
 if not found then raise exception 'Designer access required' using errcode='42501';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 select * into b from public.brand_profiles where tenant_id=t;
 update public.designer_assignments set state='cancelled',updated_at=now() where campaign_id=c.id and state<>'cancelled';
 insert into public.designer_assignments(tenant_id,campaign_id,designer_id,copy_revision,brief,due_at,assigned_by)
 values(t,c.id,designer,c.copy_revision,jsonb_build_object('title',c.title,'subject',v.subject,'preheader',v.preheader,'body',v.body,'cta',v.cta,'url',v.primary_url,'brandName',b.brand_name,'voice',b.voice,'prohibitions',b.prohibitions,'referenceStructure',c.reference_notes,'copyRevision',c.copy_revision,'assetPaths',jsonb_build_array()),now()+interval '24 hours',auth.uid()) returning id into a;
 update public.campaigns set design_state='assigned',design_revision=design_revision+1,delivery_state='not_ready',delivery_revision=delivery_revision+1,updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'designer_assigned',jsonb_build_object('assignmentId',a,'copyRevision',c.copy_revision));
 perform private.notify_review(t,recipient,'assignment',c.id,'Approved brief assigned. A 24-hour synthetic workflow SLA applies.');return a;
end $$;

create or replace function public.submit_design(assignment uuid,expected_revision integer,path text,notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.designer_assignments;c public.campaigns;s uuid;
begin
 if not private.assigned_designer(assignment) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=(select tenant_id from public.designer_assignments where id=assignment) for update;
 select * into a from public.designer_assignments where id=assignment for update;
 if not found or not private.assigned_designer(a.id) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 select * into c from public.campaigns where id=a.campaign_id for update;
 if c.design_revision is distinct from expected_revision or c.copy_revision<>a.copy_revision or c.copy_state<>'approved' then raise exception 'Stale design brief' using errcode='40001';end if;
 if a.state not in ('assigned','revisions_requested') then raise exception 'Submission not currently permitted' using errcode='23514';end if;
 if not exists(select 1 from public.verified_design_uploads u where u.storage_path=path and u.assignment_id=a.id and u.uploaded_by=auth.uid() and u.tenant_id=a.tenant_id) then raise exception 'Validated upload required' using errcode='23514';end if;
 insert into public.designer_submissions(tenant_id,assignment_id,revision,copy_revision,storage_path,notes,submitted_by) values(a.tenant_id,a.id,c.design_revision+1,c.copy_revision,path,notes,auth.uid()) returning id into s;
 update public.designer_assignments set state='submitted',updated_at=now() where id=a.id;
 update public.campaigns set design_revision=design_revision+1,design_state='submitted',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(a.tenant_id,c.id,auth.uid(),'design_submitted',jsonb_build_object('submissionId',s,'revision',c.design_revision+1));
 perform private.notify_owners(a.tenant_id,'design_review',c.id,'A new design version is ready for owner review.');return s;
end $$;

create or replace function public.record_design_upload(assignment uuid,actor uuid,path text,hash text,media_type text,byte_size integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.designer_assignments;
begin
 select * into a from public.designer_assignments where id=assignment;
 if not found or a.state not in ('assigned','revisions_requested') or not exists(select 1 from public.designers d join public.profiles p on p.id=d.profile_id join public.designer_tenant_access x on x.designer_id=d.id where d.id=a.designer_id and d.profile_id=actor and d.status='active' and p.status='active' and x.tenant_id=a.tenant_id) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=a.tenant_id for update;
 if split_part(path,'/',1)<>a.tenant_id::text or split_part(path,'/',2)<>a.id::text or not exists(select 1 from storage.objects o where o.bucket_id='designer-submissions' and o.name=path) then raise exception 'Stored artifact unavailable' using errcode='23514';end if;
 insert into public.verified_design_uploads(storage_path,tenant_id,assignment_id,uploaded_by,sha256,media_type,byte_size) values(path,a.tenant_id,a.id,actor,hash,media_type,byte_size);
end $$;

create or replace function public.record_asset_upload(t uuid,actor uuid,path text,filename text,hash text,media_type text,byte_size integer,source text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id and p.status='active' join public.tenants x on x.id=m.tenant_id and x.status='active' where m.tenant_id=t and m.profile_id=actor and m.status='active') then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if path<>(t||'/'||hash||'.'||(case media_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else 'invalid' end)) or not exists(select 1 from storage.objects where bucket_id='brand-assets' and name=path) then raise exception 'Verified private upload required' using errcode='23514';end if;
 insert into public.assets(tenant_id,storage_path,filename,sha256,media_type,byte_size,source,uploaded_by,synthetic) values(t,path,filename,hash,media_type,byte_size,source,actor,source='drive_fixture') on conflict(tenant_id,sha256) do update set sha256=excluded.sha256 returning id into result;return result;
end $$;

create or replace function public.invite_team(t uuid,email text,role public.tenant_role) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Team administrator required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if email is null or length(email)>254 or email !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' or role is null or role='owner' then raise exception 'Valid non-owner invite required' using errcode='23514';end if;
 insert into public.tenant_invites(tenant_id,email,role,token_hash,expires_at,invited_by) values(t,lower(btrim(email)),role,encode(extensions.digest(extensions.gen_random_bytes(32),'sha512'),'hex'),now()+interval '7 days',auth.uid()) returning public.tenant_invites.id into id;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'invitation_simulated',id,jsonb_build_object('role',role,'emailDelivery','simulated'));
 perform private.notify_owners(t,'team_invitation',id,'Team invitation persisted. Email delivery is simulated; no message was sent.');return id;
end $$;

create or replace function public.revoke_team_invite(t uuid,invite uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_active_member(t,array['owner','admin']::public.tenant_role[]) then raise exception 'Team administrator required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 update public.tenant_invites set revoked_at=now() where id=invite and tenant_id=t and accepted_at is null and revoked_at is null;
 if not found then raise exception 'Open invite unavailable' using errcode='23514';end if;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id) values(t,auth.uid(),'invitation_revoked',invite);
end $$;

create or replace function public.reply_support(t uuid,ticket uuid,expected_revision integer,body text,state text) returns void language plpgsql security definer set search_path='' as $$
declare r public.support_tickets;
begin
 if not private.is_active_member(t) and not private.is_operator() then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 select * into r from public.support_tickets where tenant_id=t and id=ticket for update;
 if r.id is null then raise exception 'Ticket unavailable' using errcode='42501';end if;
 if r.revision is distinct from expected_revision then raise exception 'Ticket changed; refresh' using errcode='40001';end if;
 insert into public.support_messages(tenant_id,ticket_id,actor_id,body) values(t,ticket,auth.uid(),body);
 update public.support_tickets set revision=revision+1,state=reply_support.state,updated_at=now() where id=r.id;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'support_replied',r.id,jsonb_build_object('state',state));
 perform private.notify_owners(t,'support_reply',r.id,'Support thread updated. Inspect its persisted reply and status.');
end $$;

create or replace function public.accept_team_invite(invite uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.tenant_invites;
begin
 select invitation.* into i from public.tenant_invites invitation join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=invitation.email where invitation.id=invite and private.is_profile_active();
 if i.id is null then raise exception 'Verified invite email required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=i.tenant_id for update;
 select * into i from public.tenant_invites where id=invite for update;
 if not exists(select 1 from public.tenants where id=i.tenant_id and status='active') then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if i.revoked_at is not null or i.expires_at<=now() then raise exception 'Invite revoked or expired' using errcode='23514';end if;
 if i.accepted_at is not null then return i.tenant_id;end if;
 insert into public.tenant_memberships(tenant_id,profile_id,role,status,invited_by,accepted_at) values(i.tenant_id,auth.uid(),i.role,'active',i.invited_by,now()) on conflict(tenant_id,profile_id) do update set status='active',accepted_at=now() where public.tenant_memberships.status<>'active';
 update public.tenant_invites set accepted_at=now() where id=i.id;return i.tenant_id;
end $$;

create or replace function public.ask_fixture_gros(t uuid,chat uuid,campaign uuid,question text,intent text default 'explain',value text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;conv public.conversations;proposal uuid;payload jsonb;body text;budget uuid;op uuid:=gen_random_uuid();revisions jsonb;
begin
 if not private.chat_visible(t,chat) then raise exception 'Conversation unavailable' using errcode='42501';end if;
 perform private.require_member(t);
 select * into conv from public.conversations where id=chat and tenant_id=t for update;
 if conv.visibility='private' and conv.creator_id is distinct from auth.uid() then raise exception 'Conversation unavailable' using errcode='42501';end if;
 if conv.status<>'active' or question is null or length(btrim(question)) not between 1 and 5000 or intent is null or intent not in ('explain','edit_goal','select_reference','schedule','cancel','request_assignment') then raise exception 'Validated question and intent required' using errcode='23514';end if;
 select * into c from public.campaigns where id=campaign and tenant_id=t;
 if c.id is null then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if intent in ('schedule','cancel','request_assignment') then perform private.require_member(t,true);end if;
 if intent='schedule' and (c.delivery_state<>'ready' or not exists(select 1 from public.delivery_packages where campaign_id=c.id and revision=c.delivery_revision)) then raise exception 'Current ready package required for scheduling proposal' using errcode='23514';end if;
 if intent='cancel' and c.delivery_state not in ('queued','scheduled','reconciling','failed') then raise exception 'Active delivery intent required for cancellation proposal' using errcode='23514';end if;
 if intent='request_assignment' and (c.calendar_state<>'approved' or c.copy_state<>'approved' or c.delivery_state not in ('not_ready','ready','cancelled','failed')) then raise exception 'Current owner-approved copy required for assignment request' using errcode='23514';end if;
 if intent='select_reference' and (c.delivery_state not in ('not_ready','ready','failed','cancelled') or (c.calendar_state='approved' and not private.is_active_member(t,array['owner']::public.tenant_role[]))) then raise exception 'Permitted editable draft required' using errcode='23514';end if;
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
create function private.planning_holidays(t uuid,start_at timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'name',h.name,'date',h.event_date,'notes',h.notes) order by h.id),'[]'::jsonb) from public.holidays h join public.tenants tenant on tenant.id=h.tenant_id where h.tenant_id=t and h.event_date>=(start_at at time zone tenant.timezone)::date and h.event_date<((start_at+interval '30 days') at time zone tenant.timezone)::date;
$$;
create function private.planning_pinned_rules(t uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'evidenceHash',evidence_hash) order by id),'[]'::jsonb) from public.learned_rules where tenant_id=t and status='pinned';
$$;
create function private.plan_additional_inputs() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='calendar.plan' then new.input:=new.input||jsonb_build_object('holidays',private.planning_holidays(new.tenant_id,(new.input->>'startsAt')::timestamptz),'ownLearningRules',private.planning_pinned_rules(new.tenant_id));end if;return new;
end $$;
create trigger zz_plan_additional_inputs before insert on public.job_runs for each row execute function private.plan_additional_inputs();
revoke all on function private.planning_holidays(uuid,timestamptz),private.planning_pinned_rules(uuid),private.plan_additional_inputs() from public,anon,authenticated;

create or replace function public.finish_plan_job(job uuid,lease uuid,output jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.job_runs;pref public.planning_preferences;b public.brand_profiles;p public.playbooks;plan uuid;x jsonb;c public.campaigns;sequence uuid;entry_ids uuid[]:='{}';
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where tenants.id=j.tenant_id for update;
 if coalesce(j.input->'holidays','[]'::jsonb) is distinct from private.planning_holidays(j.tenant_id,(j.input->>'startsAt')::timestamptz) or coalesce(j.input->'ownLearningRules','[]'::jsonb) is distinct from private.planning_pinned_rules(j.tenant_id) then raise exception 'Workspace events or pinned learning changed' using errcode='40001';end if;
 if j.kind<>'calendar.plan' or (output->>'synthetic')::boolean is distinct from true or jsonb_typeof(output->'entries') is distinct from 'array' or jsonb_array_length(output->'entries')>30 then raise exception 'Invalid structured plan' using errcode='23514';end if;
 select * into pref from public.planning_preferences where tenant_id=j.tenant_id;
 select * into b from public.brand_profiles where tenant_id=j.tenant_id;
 select * into p from public.playbooks where id=(j.input->>'playbookId')::uuid and tenant_id=j.tenant_id;
 if not private.learning_ready(j.tenant_id) or b.revision is distinct from (j.input->>'brandRevision')::integer or pref.revision is distinct from (j.input->>'preferenceRevision')::integer or pref.generation is distinct from (j.input->>'generation')::integer or p.brand_revision is distinct from b.revision then raise exception 'Planning inputs changed' using errcode='40001';end if;
 if j.input->'ruleVersions' is distinct from (select coalesce(jsonb_object_agg(id::text,revision),'{}') from public.owner_rules where tenant_id=j.tenant_id and active) then raise exception 'Owner rules changed' using errcode='40001';end if;
 insert into public.calendar_plans(tenant_id,starts_at,input_revisions,lineage,synthetic,created_by) values(j.tenant_id,(j.input->>'startsAt')::timestamptz,j.input,jsonb_build_object('source','rolling_fixture','playbookId',p.id,'evidenceIds',to_jsonb(p.evidence_ids)),true,j.created_by) returning id into plan;
 -- Preserve approved entries and all prior rows/history; only supersede previous unapproved rolling drafts in range.
 update public.campaigns set superseded_by_plan=plan,calendar_state='rejected',updated_at=now() where tenant_id=j.tenant_id and lineage->>'source'='rolling_fixture' and calendar_state='proposed' and superseded_by_plan is null and planned_at>=(j.input->>'startsAt')::timestamptz and planned_at<(j.input->>'startsAt')::timestamptz+interval '30 days';
 for x in select value from jsonb_array_elements(output->'entries') loop
  if (x->>'plannedAt')::timestamptz<(j.input->>'startsAt')::timestamptz or (x->>'plannedAt')::timestamptz>=(j.input->>'startsAt')::timestamptz+interval '30 days' or (x->>'audienceId')::uuid is distinct from (j.input->>'audienceId')::uuid then raise exception 'Entry outside planned range/audience' using errcode='23514';end if;
  if nullif(x->>'holidayId','') is not null and not exists(select 1 from jsonb_array_elements(j.input->'holidays') h where h->>'id'=x->>'holidayId' and h->>'date'=((x->>'plannedAt')::timestamptz at time zone (select timezone from public.tenants where id=j.tenant_id))::date::text) then raise exception 'Event lineage must match the frozen local calendar date' using errcode='23514';end if;
  sequence:=null;
  if nullif(x->>'sequenceKey','') is not null then
   insert into public.campaign_sequences(tenant_id,plan_id,key,brief) values(j.tenant_id,plan,x->>'sequenceKey','Original educational sequence: opening then detail. No implied discount, deadline or borrowed creative.') on conflict(plan_id,key) do update set key=excluded.key returning id into sequence;
  end if;
  insert into public.campaigns(tenant_id,title,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,reference_notes,sequence_id,sequence_position,created_by,synthetic,lineage)
  values(j.tenant_id,x->>'title',x->>'goal',x->>'channel',(x->>'plannedAt')::timestamptz,(select timezone from public.tenants where id=j.tenant_id),(x->>'audienceId')::uuid,nullif(x->>'productId','')::uuid,nullif(x->>'offerId','')::uuid,x->>'referenceNotes',sequence,nullif(x->>'sequencePosition','')::integer,j.created_by,true,jsonb_build_object('source','rolling_fixture','planId',plan,'brandRevision',b.revision,'playbookId',p.id,'evidenceIds',to_jsonb(p.evidence_ids),'ruleVersions',j.input->'ruleVersions','ownLearningRules',j.input->'ownLearningRules','workspaceEventId',x->>'holidayId','productIds',case when nullif(x->>'productId','') is null then '[]'::jsonb else jsonb_build_array(x->>'productId') end,'offerRevision',(select revision from public.offers where id=nullif(x->>'offerId','')::uuid))) returning * into c;
  entry_ids:=array_append(entry_ids,c.id);
  insert into public.campaign_content(tenant_id,campaign_id,revision,created_by) values(j.tenant_id,c.id,1,j.created_by);
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(j.tenant_id,c.id,j.created_by,'fixture_plan_proposed',jsonb_build_object('planId',plan));
 end loop;
 for c in select * from public.campaigns where id=any(entry_ids) loop perform private.assert_campaign_guards(c,plan);end loop;
 update public.calendar_plans set lineage=lineage||jsonb_build_object('entryRevisions',(select jsonb_agg(jsonb_build_object('campaignId',id,'calendarRevision',calendar_revision)) from public.campaigns where id=any(entry_ids))) where id=plan;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('planId',plan,'entries',cardinality(entry_ids),'synthetic',true),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 perform private.notify_owners(j.tenant_id,'calendar_review',plan,'A guarded synthetic rolling plan is ready. Review exact entries before owner approval.');return plan;
end $$;

-- Business version/lease conflicts are final 409 responses, not SQL serialization failures.
-- PostgREST 14 retries application-raised 40001 indefinitely. Preserve prior migrations and ACLs:
-- replace only that literal in existing application function bodies, leaving actual DB errors alone.
do $$
declare fn record;definition text;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and position('''40001''' in p.prosrc)>0 loop
  definition:=pg_get_functiondef(fn.oid);
  execute replace(definition,'''40001''','''PT409''');
 end loop;
end $$;

-- Administrative design escalation is an audit event; it never changes creative approval.
create function public.escalate_design(t uuid,campaign uuid,expected_design integer,category text,reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;a public.designer_assignments;event uuid;
begin
 if not private.is_operator() then raise exception 'Platform operator required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 select * into c from public.campaigns where tenant_id=t and id=campaign for update;
 if c.id is null then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.design_revision is distinct from expected_design then raise exception 'Design workflow changed; refresh' using errcode='PT409';end if;
 if c.copy_state<>'approved' or c.calendar_state<>'approved' or c.design_state='owner_approved' then raise exception 'Current approved brief awaiting design review required' using errcode='23514';end if;
 if reason is null or length(btrim(reason)) not between 10 and 2000 or category is null or category not in ('blocked','sla_overdue','no_designer') then raise exception 'Validated issue and reason required' using errcode='23514';end if;
 select * into a from public.designer_assignments where tenant_id=t and campaign_id=c.id and state<>'cancelled' order by created_at desc limit 1;
 if category='sla_overdue' and (a.id is null or a.due_at>=now() or a.state not in ('assigned','revisions_requested')) then raise exception 'An overdue active designer SLA is required' using errcode='23514';end if;
 if category='no_designer' and a.id is not null then raise exception 'Active assignment already exists' using errcode='23514';end if;
 select e.id into event from public.campaign_events e where e.tenant_id=t and e.campaign_id=c.id and e.action='design_escalated' and not exists(select 1 from public.campaign_events r where r.tenant_id=t and r.campaign_id=c.id and r.action='design_escalation_resolved' and r.detail->>'escalationId'=e.id::text) order by e.created_at desc limit 1;
 if event is not null then return event;end if;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'design_escalated',jsonb_build_object('category',category,'reason',btrim(reason),'designRevision',c.design_revision,'copyRevision',c.copy_revision,'assignmentId',a.id,'dueAt',a.due_at)) returning id into event;
 perform private.notify_owners(t,'design_escalation',c.id,'An operator recorded a design workflow issue. Owner creative review and approval remain required.');return event;
end $$;
create function public.resolve_design_escalation(t uuid,escalation uuid,resolution text) returns void language plpgsql security definer set search_path='' as $$
declare e public.campaign_events;
begin
 if not private.is_operator() then raise exception 'Platform operator required' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 select * into e from public.campaign_events where tenant_id=t and id=escalation and action='design_escalated';
 if e.id is null then raise exception 'Escalation unavailable' using errcode='42501';end if;
 if resolution is null or length(btrim(resolution)) not between 10 and 2000 then raise exception 'Resolution notes required' using errcode='23514';end if;
 if exists(select 1 from public.campaign_events where tenant_id=t and campaign_id=e.campaign_id and action='design_escalation_resolved' and detail->>'escalationId'=e.id::text) then return;end if;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,e.campaign_id,auth.uid(),'design_escalation_resolved',jsonb_build_object('escalationId',e.id,'resolution',btrim(resolution)));
 perform private.notify_owners(t,'design_escalation_resolved',e.campaign_id,'An operator resolved the administrative design issue. This does not approve the creative version.');
end $$;
create function public.design_escalation_operations() returns table(campaign_id uuid,tenant_id uuid,title text,design_revision integer,assignment_id uuid,due_at timestamptz,escalation_id uuid,reason text,issue_state text,can_escalate boolean,sla_overdue boolean) language sql stable security definer set search_path='' as $$
 select c.id,c.tenant_id,c.title,c.design_revision,a.id,a.due_at,e.id,e.detail->>'reason',case when e.id is null then 'none' when exists(select 1 from public.campaign_events r where r.tenant_id=c.tenant_id and r.campaign_id=c.id and r.action='design_escalation_resolved' and r.detail->>'escalationId'=e.id::text) then 'resolved' else 'open' end,c.design_state<>'owner_approved',coalesce(a.state in ('assigned','revisions_requested') and a.due_at<now(),false)
 from public.campaigns c
 left join lateral(select * from public.designer_assignments where tenant_id=c.tenant_id and campaign_id=c.id and state<>'cancelled' order by created_at desc limit 1) a on true
 left join lateral(select * from public.campaign_events where tenant_id=c.tenant_id and campaign_id=c.id and action='design_escalated' order by created_at desc limit 1) e on true
 where private.is_operator() and c.copy_state='approved' and (c.design_state<>'owner_approved' or e.id is not null) order by c.planned_at;
$$;
revoke all on function public.escalate_design(uuid,uuid,integer,text,text),public.resolve_design_escalation(uuid,uuid,text),public.design_escalation_operations() from public,anon;
grant execute on function public.escalate_design(uuid,uuid,integer,text,text),public.resolve_design_escalation(uuid,uuid,text),public.design_escalation_operations() to authenticated;
