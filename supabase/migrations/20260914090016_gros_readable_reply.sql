-- FIX-001: GROS replies in plain words.
-- Replaces the status reply from 20260914090011 that printed raw lineage JSON
-- (ids, file hashes) to brand owners. Same checks, locks, budget and proposal
-- behaviour; only the assistant message text changes. Raw lineage stays in
-- chat_messages.evidence for operators.
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
 body:='Here is where "'||c.title||'" stands.'
  ||E'\n\nGoal: '||coalesce(nullif(btrim(c.goal),''),'not set yet')
  ||E'\nCalendar: '||case c.calendar_state when 'proposed' then 'waiting for your approval' when 'approved' then 'approved' when 'rejected' then 'rejected' else c.calendar_state end
  ||E'\nCopy: '||case c.copy_state when 'draft' then 'draft' when 'pending_approval' then 'waiting for your approval' when 'approved' then 'approved' when 'rejected' then 'rejected' else c.copy_state end
  ||E'\nDesign: '||case c.design_state when 'unassigned' then 'no designer yet' when 'assigned' then 'with a designer' when 'submitted' then 'design ready for review' when 'revisions_requested' then 'changes requested' when 'owner_approved' then 'approved' else c.design_state end
  ||E'\nDelivery: '||case c.delivery_state when 'not_ready' then 'not ready yet' when 'ready' then 'ready to schedule' when 'scheduled' then 'scheduled' when 'sent' then 'sent' when 'failed' then 'failed - needs attention' when 'cancelled' then 'cancelled' when 'blocked' then 'blocked - needs attention' else 'in progress' end
  ||E'\n\nNext step: '||case
      when c.calendar_state<>'approved' then 'approve this campaign on the calendar.'
      when c.copy_state<>'approved' then 'review and approve the copy.'
      when c.design_state<>'owner_approved' then 'get the design done and approve it.'
      when c.delivery_state in ('not_ready','ready') then 'schedule it to send.'
      when c.delivery_state in ('failed','blocked') then 'check the delivery problem on the campaign page.'
      else 'nothing for you right now.' end
  ||case when c.lineage->>'origin'='owner_import' then E'\nStarted from: an email you added.' when c.lineage ? 'origin' then E'\nStarted from: '||replace(c.lineage->>'origin','_',' ')||'.' else '' end
  ||case when nullif(btrim(coalesce(c.reference_notes,'')),'') is not null then E'\nNotes: '||left(btrim(c.reference_notes),500) else '' end
  ||E'\n\nGROS can report campaign status today. Answers to open questions like yours are coming soon.';
 insert into public.chat_messages(tenant_id,conversation_id,actor_id,role,body) values(t,chat,auth.uid(),'user',question);
 if intent<>'explain' then
  payload:=case intent when 'edit_goal' then jsonb_build_object('goal',value) when 'select_reference' then jsonb_build_object('emailId',value) when 'schedule' then jsonb_build_object('packageId',(select id from public.delivery_packages where campaign_id=c.id and revision=c.delivery_revision)) else '{}'::jsonb end;
  body:=body||E'\n\nProposed change: '||case intent when 'edit_goal' then 'set the goal to "'||left(value,300)||'"' when 'select_reference' then 'use a reference email' when 'schedule' then 'schedule this campaign' when 'cancel' then 'cancel the scheduled send' when 'request_assignment' then 'ask Grey to assign a designer' end
   ||E'.\nNothing changes until you confirm it below. Editing the goal or reference resets creative approvals.';
  insert into public.chat_proposals(tenant_id,conversation_id,actor_id,campaign_id,kind,target_revisions,payload,consequence) values(t,chat,auth.uid(),c.id,intent,revisions,payload,'Explicit confirmation required. Material edits invalidate affected approvals; provider outcomes remain pending until confirmed.') returning id into proposal;
 end if;
 insert into public.chat_messages(tenant_id,conversation_id,actor_id,role,body,evidence) values(t,chat,auth.uid(),'assistant',left(body,8000),jsonb_build_object('campaignId',c.id,'revisions',revisions,'lineage',c.lineage));
 perform private.reconcile_budget(t,budget,800);return coalesce(proposal,op);
end $$;
