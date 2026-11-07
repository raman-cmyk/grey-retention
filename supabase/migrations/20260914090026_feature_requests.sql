-- UIR-020 Request a Feature (docs/OWNER_JOURNEYS.md §15).
--
-- A feature request is a support ticket of kind 'feedback' with a type:
-- feature (Feature Request), improvement (Improve Existing), bug (Bug) or
-- general (General Feedback). Its status on the page comes from the
-- ticket state the platform team sets in the admin support queue:
-- open = Open, in_progress = Planned, closed = Done. The first message is
-- the details; later messages are replies.
--
-- Any active member may send a request; the checks below match the page.

alter table public.support_tickets add column category text;
-- Older rows keep no type; new ones must be a feedback type.
alter table public.support_tickets add constraint support_tickets_category_valid
  check (category is null
    or (kind = 'feedback' and category in ('feature', 'improvement', 'bug', 'general')));

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
    or char_length(title) not between 2 and 200 or title ~ '[[:cntrl:]]'
    or char_length(body) not between 1 and 5000 then
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

-- Members only read tickets (RLS); they write through commands. The table
-- default grants also gave write and truncate rights, which RLS does not
-- cover for truncate.
revoke insert, update, delete, truncate on public.support_tickets, public.support_messages
  from public, anon, authenticated;

revoke all on function public.request_feature(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.request_feature(uuid, text, text, text) to authenticated;
