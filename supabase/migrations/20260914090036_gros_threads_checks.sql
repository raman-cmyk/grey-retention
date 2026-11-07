-- UIR-008 review fixes for 20260914090035 (rls-migration-reviewer).
--
-- 1. A question or chat name made only of tabs or new lines is refused, and
--    every run of white space in a title becomes one space (btrim alone
--    trims spaces only). Checked in start_conversation, rename_conversation
--    and ask_fixture_gros.
-- 2. The workspace answer skips campaigns the owner rejected on the
--    calendar (they keep superseded_by_plan null), and reads deliveries and
--    packages of this workspace only (defence in depth; campaigns already
--    were). "Waiting for approval" no longer says "your": a staff member
--    may be asking, and the approvals are the owner's.
-- 3. Indexes that match how the app reads: chats newest first per
--    workspace, and proposals by chat (for deleting a chat and its foreign
--    key check). The unused expression index from 090035 is dropped.
--
-- Deleting a chat removes ALL its proposals (the foreign key needs every
-- one gone), not only waiting ones. Changes already applied stay on the
-- campaign and in campaign_events. Deleting a shared chat also removes
-- what other members wrote in it; only its creator can do that.

drop index if exists public.conversations_recent;
create index conversations_threads
  on public.conversations (tenant_id, last_message_at desc nulls last, created_at desc);
create index chat_proposals_by_chat
  on public.chat_proposals (tenant_id, conversation_id);

create or replace function public.ask_fixture_gros(t uuid, chat uuid, campaign uuid, question text, intent text default 'explain', value text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns; conv public.conversations; proposal uuid; payload jsonb; body text;
  budget uuid; op uuid := gen_random_uuid(); revisions jsonb; zone text;
  last_sent record; next_send record; waiting int; library int; fmt text := 'Mon FMDD, YYYY';
begin
  if not private.chat_visible(t, chat) then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  perform private.require_member(t);
  select * into conv from public.conversations where id = chat and tenant_id = t for update;
  if conv.id is null then raise exception 'This chat was deleted. Start a new one.' using errcode = 'PT409'; end if;
  if conv.visibility = 'private' and conv.creator_id is distinct from auth.uid() then raise exception 'Conversation unavailable' using errcode = '42501'; end if;
  if conv.status <> 'active' or question is null or length(btrim(regexp_replace(question, '\s+', ' ', 'g'))) not between 1 and 5000 or intent is null
     or intent not in ('explain','edit_goal','select_reference','schedule','cancel','request_assignment') then
    raise exception 'Validated question and intent required' using errcode = '23514';
  end if;
  if campaign is null and intent <> 'explain' then
    raise exception 'Choose a campaign for this request' using errcode = '23514';
  end if;

  if campaign is null then
    -- A question about the whole workspace.
    select timezone into zone from public.tenants where id = t;
    select x.title, x.sent_at into last_sent from (
      select k.title, coalesce((
        select max(d.sent_at) from public.fixture_deliveries d
        join public.delivery_packages p on p.id = d.package_id and p.tenant_id = t
        where d.tenant_id = t and p.campaign_id = k.id and d.state = 'sent'), k.planned_at) as sent_at
      from public.campaigns k
      where k.tenant_id = t and k.delivery_state = 'sent' and k.superseded_by_plan is null
    ) x order by x.sent_at desc limit 1;
    select k.title, k.planned_at into next_send from public.campaigns k
    where k.tenant_id = t and k.superseded_by_plan is null and k.planned_at >= now()
      and k.delivery_state not in ('sent','cancelled') and k.calendar_state <> 'rejected'
    order by k.planned_at limit 1;
    select count(*)::int into waiting from public.campaigns k
    where k.tenant_id = t and k.superseded_by_plan is null and k.delivery_state not in ('sent','cancelled')
      and k.calendar_state <> 'rejected'
      and (k.calendar_state = 'proposed' or k.copy_state = 'pending_approval' or k.design_state = 'submitted');
    select (select count(*) from public.own_templates o where o.tenant_id = t)
         + (select count(*) from public.reference_imports r where r.tenant_id = t) into library;
    budget := private.reserve_budget(t, op::text, 'gros', 1000);
    body := 'Here is your workspace today.'
      || E'\n\n- **Last sent:** ' || case when last_sent.title is null then 'nothing has been sent yet.'
           else '"' || last_sent.title || '" on ' || to_char(last_sent.sent_at at time zone zone, fmt) || '.' end
      || E'\n- **Next planned send:** ' || case when next_send.title is null then 'nothing is planned yet.'
           else '"' || next_send.title || '" on ' || to_char(next_send.planned_at at time zone zone, fmt) || '.' end
      || E'\n- **Waiting for approval:** ' || case waiting when 0 then 'nothing.' when 1 then '1 campaign.' else waiting || ' campaigns.' end
      || E'\n- **Your library:** ' || case library when 1 then '1 saved layout or upload.' else library || ' saved layouts and uploads.' end
      || E'\n\nNext step: ' || case
           when waiting > 0 then 'review what is waiting for approval.'
           when next_send.title is null then 'plan your next campaigns on the calendar.'
           else 'choose a campaign below the message box to see where it stands.' end
      || E'\n\nGROS can report your campaigns today. Answers to open questions like yours are coming soon.';
    insert into public.chat_messages(tenant_id, conversation_id, actor_id, role, body) values (t, chat, auth.uid(), 'user', question);
    insert into public.chat_messages(tenant_id, conversation_id, actor_id, role, body, evidence)
      values (t, chat, auth.uid(), 'assistant', left(body, 8000),
              jsonb_build_object('scope', 'workspace', 'waiting', waiting, 'library', library));
    perform private.reconcile_budget(t, budget, 800);
    return op;
  end if;

  select * into c from public.campaigns where id = campaign and tenant_id = t;
  if c.id is null then raise exception 'Campaign unavailable' using errcode = '42501'; end if;
  if intent in ('schedule','cancel','request_assignment') then perform private.require_member(t, true); end if;
  if intent = 'schedule' and (c.delivery_state <> 'ready' or not exists(select 1 from public.delivery_packages where campaign_id = c.id and revision = c.delivery_revision)) then raise exception 'Current ready package required for scheduling proposal' using errcode = '23514'; end if;
  if intent = 'cancel' and c.delivery_state not in ('queued','scheduled','reconciling','failed') then raise exception 'Active delivery intent required for cancellation proposal' using errcode = '23514'; end if;
  if intent = 'request_assignment' and (c.calendar_state <> 'approved' or c.copy_state <> 'approved' or c.delivery_state not in ('not_ready','ready','cancelled','failed')) then raise exception 'Current owner-approved copy required for assignment request' using errcode = '23514'; end if;
  if intent = 'select_reference' and (c.delivery_state not in ('not_ready','ready','failed','cancelled') or (c.calendar_state = 'approved' and not private.is_active_member(t, array['owner']::public.tenant_role[]))) then raise exception 'Permitted editable draft required' using errcode = '23514'; end if;
  if intent = 'edit_goal' and (length(coalesce(value,'')) not between 1 and 5000 or c.delivery_state not in ('not_ready','ready','failed','cancelled') or (c.calendar_state = 'approved' and not private.is_active_member(t, array['owner']::public.tenant_role[]))) then raise exception 'Permitted editable draft required' using errcode = '23514'; end if;
  if intent = 'select_reference' and not exists(select 1 from public.competitor_emails e where e.id = nullif(value,'')::uuid and private.capture_access(e.capture_id)) then raise exception 'Subscribed reference required' using errcode = '42501'; end if;
  budget := private.reserve_budget(t, op::text, 'gros', 1000);
  revisions := jsonb_build_object('calendar', c.calendar_revision, 'copy', c.copy_revision, 'design', c.design_revision, 'delivery', c.delivery_revision);
  body := 'Here is where "' || c.title || '" stands.'
    || E'\n\nGoal: ' || coalesce(nullif(btrim(c.goal),''), 'not set yet')
    || E'\nCalendar: ' || case c.calendar_state when 'proposed' then 'waiting for your approval' when 'approved' then 'approved' when 'rejected' then 'rejected' else c.calendar_state end
    || E'\nCopy: ' || case c.copy_state when 'draft' then 'draft' when 'pending_approval' then 'waiting for your approval' when 'approved' then 'approved' when 'rejected' then 'rejected' else c.copy_state end
    || E'\nDesign: ' || case c.design_state when 'unassigned' then 'no designer yet' when 'assigned' then 'with a designer' when 'submitted' then 'design ready for review' when 'revisions_requested' then 'changes requested' when 'owner_approved' then 'approved' else c.design_state end
    || E'\nDelivery: ' || case c.delivery_state when 'not_ready' then 'not ready yet' when 'ready' then 'ready to schedule' when 'scheduled' then 'scheduled' when 'sent' then 'sent' when 'failed' then 'failed - needs attention' when 'cancelled' then 'cancelled' when 'blocked' then 'blocked - needs attention' else 'in progress' end
    || E'\n\nNext step: ' || case
        when c.calendar_state <> 'approved' then 'approve this campaign on the calendar.'
        when c.copy_state <> 'approved' then 'review and approve the copy.'
        when c.design_state <> 'owner_approved' then 'get the design done and approve it.'
        when c.delivery_state in ('not_ready','ready') then 'schedule it to send.'
        when c.delivery_state in ('failed','blocked') then 'check the delivery problem on the campaign page.'
        else 'nothing for you right now.' end
    || case when c.lineage->>'origin' = 'owner_import' then E'\nStarted from: an email you added.' when c.lineage ? 'origin' then E'\nStarted from: ' || replace(c.lineage->>'origin','_',' ') || '.' else '' end
    || case when nullif(btrim(coalesce(c.reference_notes,'')),'') is not null then E'\nNotes: ' || left(btrim(c.reference_notes),500) else '' end
    || E'\n\nGROS can report campaign status today. Answers to open questions like yours are coming soon.';
  insert into public.chat_messages(tenant_id, conversation_id, actor_id, role, body) values (t, chat, auth.uid(), 'user', question);
  if intent <> 'explain' then
    payload := case intent when 'edit_goal' then jsonb_build_object('goal', value) when 'select_reference' then jsonb_build_object('emailId', value) when 'schedule' then jsonb_build_object('packageId', (select id from public.delivery_packages where campaign_id = c.id and revision = c.delivery_revision)) else '{}'::jsonb end;
    body := body || E'\n\nProposed change: ' || case intent when 'edit_goal' then 'set the goal to "' || left(value,300) || '"' when 'select_reference' then 'use a reference email' when 'schedule' then 'schedule this campaign' when 'cancel' then 'cancel the scheduled send' when 'request_assignment' then 'ask Grey to assign a designer' end
      || E'.\nNothing changes until you confirm it below. Editing the goal or reference resets creative approvals.';
    insert into public.chat_proposals(tenant_id, conversation_id, actor_id, campaign_id, kind, target_revisions, payload, consequence)
      values (t, chat, auth.uid(), c.id, intent, revisions, payload, 'Explicit confirmation required. Material edits invalidate affected approvals; provider outcomes remain pending until confirmed.')
      returning id into proposal;
  end if;
  insert into public.chat_messages(tenant_id, conversation_id, actor_id, role, body, evidence)
    values (t, chat, auth.uid(), 'assistant', left(body, 8000), jsonb_build_object('campaignId', c.id, 'revisions', revisions, 'lineage', c.lineage));
  perform private.reconcile_budget(t, budget, 800);
  return coalesce(proposal, op);
end $$;

create or replace function public.start_conversation(t uuid, question text, campaign uuid default null, visibility text default 'private')
returns uuid language plpgsql security definer set search_path = '' as $$
declare chat uuid; clean text := btrim(regexp_replace(coalesce(question, ''), '\s+', ' ', 'g'));
begin
  perform private.require_member(t);
  if length(clean) not between 1 and 5000 then
    raise exception 'Type a question first' using errcode = '23514';
  end if;
  if visibility is null or visibility not in ('private','shared') then
    raise exception 'Choose private or shared' using errcode = '23514';
  end if;
  insert into public.conversations(tenant_id, creator_id, title, visibility)
    values (t, auth.uid(), left(clean, 80), start_conversation.visibility) returning id into chat;
  perform public.ask_fixture_gros(t, chat, campaign, question, 'explain', '');
  return chat;
end $$;

create or replace function public.rename_conversation(t uuid, chat uuid, title text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare conv public.conversations; clean text := btrim(regexp_replace(coalesce(title, ''), '\s+', ' ', 'g'));
begin
  perform private.require_member(t);
  select * into conv from public.conversations where id = chat and tenant_id = t for update;
  if conv.id is null then raise exception 'This chat was deleted.' using errcode = 'PT409'; end if;
  if conv.creator_id is distinct from auth.uid() then
    raise exception 'Only the person who started this chat can rename it' using errcode = '42501';
  end if;
  if length(clean) not between 1 and 200 then
    raise exception 'A chat name needs 1 to 200 characters' using errcode = '23514';
  end if;
  if clean = conv.title then return false; end if;
  update public.conversations set title = clean where id = chat;
  return true;
end $$;
