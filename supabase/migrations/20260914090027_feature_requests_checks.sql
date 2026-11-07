-- UIR-020 review fixes, applied together with 20260914090026 (neither has
-- reached production):
--   * only the platform team sets a feature request's status (Open,
--     Planned, Done); workspace members can still reply, but a member's
--     reply keeps the request's status (the old Support form offered a
--     status select for every ticket);
--   * a feedback ticket opened from the old Support form gets the type
--     General Feedback, so every request has a type;
--   * subjects must contain something visible, and the control-character
--     rule is spelled out so it does not depend on the database locale;
--   * the support tables follow the repo's grant pattern: members read
--     through RLS and hold no other rights; anon holds none.

create or replace function public.reply_support(t uuid, ticket uuid, expected_revision integer,
  body text, state text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.support_tickets;
begin
  if not private.is_active_member(t) and not private.is_operator() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  select * into r from public.support_tickets where tenant_id = t and id = ticket for update;
  if r.id is null then
    raise exception 'Ticket unavailable' using errcode = '42501';
  end if;
  if r.revision is distinct from expected_revision then
    raise exception 'Ticket changed; refresh' using errcode = 'PT409';
  end if;
  if r.kind = 'feedback' and not private.is_operator()
    and reply_support.state is distinct from r.state then
    raise exception 'Only the platform team sets a request''s status' using errcode = '42501';
  end if;
  insert into public.support_messages (tenant_id, ticket_id, actor_id, body)
  values (t, ticket, auth.uid(), reply_support.body);
  update public.support_tickets
  set revision = revision + 1, state = reply_support.state, updated_at = now()
  where id = r.id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
  values (t, auth.uid(), 'support_replied', r.id, jsonb_build_object('state', reply_support.state));
  perform private.notify_owners(t, 'support_reply', r.id,
    'Support thread updated. Inspect its persisted reply and status.');
end $$;

-- The old Support form: unchanged for support tickets; feedback opened
-- there is General Feedback.
create or replace function public.open_support_ticket(t uuid, kind text, subject text, body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare id uuid;
begin
  perform private.require_member(t);
  insert into public.support_tickets (tenant_id, creator_id, kind, subject, category)
  values (t, auth.uid(), open_support_ticket.kind, open_support_ticket.subject,
    case when open_support_ticket.kind = 'feedback' then 'general' end)
  returning support_tickets.id into id;
  insert into public.support_messages (tenant_id, ticket_id, actor_id, body)
  values (t, id, auth.uid(), open_support_ticket.body);
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
  values (t, auth.uid(), 'support_opened', id);
  return id;
end $$;

create or replace function public.request_feature(t uuid, category text, subject text, details text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
  title text := btrim(coalesce(request_feature.subject, ''));
  body text := btrim(coalesce(request_feature.details, ''), E' \t\r\n');
begin
  perform private.require_member(t);
  if request_feature.category is null
    or request_feature.category not in ('feature', 'improvement', 'bug', 'general')
    or char_length(title) not between 2 and 200
    or title ~ '[\x01-\x1f\x7f-\x9f]' or title !~ '[^[:space:]]'
    or char_length(body) not between 1 and 5000 or body !~ '[^[:space:]]' then
    raise exception 'Choose a type and fill in the subject and details' using errcode = '23514';
  end if;
  insert into public.support_tickets (tenant_id, creator_id, kind, subject, category)
  values (t, auth.uid(), 'feedback', title, request_feature.category)
  returning support_tickets.id into id;
  insert into public.support_messages (tenant_id, ticket_id, actor_id, body)
  values (t, id, auth.uid(), body);
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
  values (t, auth.uid(), 'feature_requested', id,
    jsonb_build_object('category', request_feature.category));
  return id;
end $$;

revoke all on public.support_tickets, public.support_messages from public, anon, authenticated;
grant select on public.support_tickets, public.support_messages to authenticated;

revoke all on function public.reply_support(uuid, uuid, integer, text, text),
  public.open_support_ticket(uuid, text, text, text),
  public.request_feature(uuid, text, text, text)
  from public, anon, service_role;
grant execute on function public.reply_support(uuid, uuid, integer, text, text),
  public.open_support_ticket(uuid, text, text, text),
  public.request_feature(uuid, text, text, text)
  to authenticated;
