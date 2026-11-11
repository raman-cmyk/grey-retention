-- INB-004 review fixes for 20260914090044_inbox_ops.sql (a new file: the
-- first one is already shared).
--
-- * Every admin command that touches a sender's task locks that task first,
--   then the emails, then the brand, like the poll worker meets them, so an
--   email recorded at the same moment is never left without a task and two
--   admins never deadlock.
-- * An email without a sender domain finds its task by the task's key.
-- * Dismissing "unsubscribed us" (a misread notice) puts the brand back:
--   subscribed when a newsletter came after the notice, else waiting.
-- * The week's-wait check never repeats while an older task is still open.
-- * "Assign to this brand" closes only the tasks it locked, and refuses a
--   sender nothing waits from (so `gmail.com` cannot be claimed by mistake).

drop index if exists public.ops_tasks_subject;
create index inbox_messages_unassigned_sender on public.inbox_messages (from_domain) where state = 'unassigned';

-- The task keys an email's sender is filed under (see record_inbox_message).
create or replace function private.sender_task_keys(m public.inbox_messages)
returns text[] language sql immutable set search_path = '' as $$
  select array['inbox_unknown_sender:' || coalesce(m.from_domain, 'none')]
    || case when m.alias_slug is not null
         then array['inbox_sender_mismatch:' || m.alias_slug || ':' || md5(coalesce(m.from_domain, 'none'))]
         else '{}'::text[] end
$$;
revoke all on function private.sender_task_keys(public.inbox_messages) from public, anon, authenticated;

create or replace function public.admin_assign_inbox_message(message uuid, brand uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.inbox_messages; c public.competitor_captures; email uuid; t public.ops_tasks; next_one uuid; keys text[];
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  select * into m from public.inbox_messages where id = message;
  if m.id is null then raise exception 'Email or brand not found' using errcode = 'PT409'; end if;
  keys := private.sender_task_keys(m);
  -- Task, then email, then brand: the order the poll worker meets them in.
  perform 1 from public.ops_tasks where state = 'open' and dedupe_key = any(keys) for update;
  select * into m from public.inbox_messages where id = message for update;
  select * into c from public.competitor_captures where id = brand for update;
  if c.id is null then raise exception 'Email or brand not found' using errcode = 'PT409'; end if;
  email := private.assign_inbox_message(m, c);
  for t in select * from public.ops_tasks where state = 'open' and dedupe_key = any(keys) loop
    select o.id into next_one from public.inbox_messages o
      where o.state = 'unassigned' and o.id <> m.id and o.from_domain is not distinct from m.from_domain
        and (t.dedupe_key like 'inbox_unknown_sender:%' or o.alias_slug is not distinct from m.alias_slug)
      order by o.received_at limit 1;
    if next_one is null then
      update public.ops_tasks set state = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_at = now(),
          detail = detail || jsonb_build_object('assignedTo', c.id)
        where id = t.id and state = 'open';
    else
      update public.ops_tasks set subject_id = next_one, updated_at = now() where id = t.id and state = 'open';
    end if;
  end loop;
  return email;
end $$;

create or replace function public.admin_assign_sender(sender text, brand uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.competitor_captures; m public.inbox_messages; owner uuid; got text; n integer := 0; locked uuid[];
  clean text := lower(btrim(coalesce(sender, '')));
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if length(clean) > 253 or clean !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'Sender domains look like mail.northwind.com' using errcode = '23514';
  end if;
  -- The sender's open tasks first (only these are closed below), then
  -- every waiting email from it, then the brand.
  select coalesce(array_agg(o.id), '{}') into locked from (
    select o.id from private.sender_tasks(clean) t join public.ops_tasks o on o.id = t.id for update of o) o;
  perform 1 from public.inbox_messages
    where (from_domain = clean or from_domain like '%.' || clean) and state = 'unassigned' for update;
  select * into c from public.competitor_captures where id = brand for update;
  if c.id is null then raise exception 'Brand not found' using errcode = 'PT409'; end if;
  if (clean ~ '\.example$') is distinct from c.synthetic then
    raise exception 'Sample senders (.example) go to sample brands, real senders to real brands' using errcode = '23514';
  end if;
  if cardinality(locked) = 0 and not exists (select 1 from public.inbox_messages
      where (from_domain = clean or from_domain like '%.' || clean) and state = 'unassigned') then
    raise exception 'No email from % is waiting for a brand', clean using errcode = 'PT409';
  end if;
  select capture_id into owner from public.competitor_sender_domains where domain = clean for update;
  if owner is not null and owner <> c.id then
    raise exception 'Sender domain % belongs to another brand', clean using errcode = 'PT409';
  end if;
  insert into public.competitor_sender_domains(domain, capture_id) values (clean, c.id) on conflict (domain) do nothing
    returning domain into got;
  if got is null then
    select capture_id into owner from public.competitor_sender_domains where domain = clean;
    if owner is distinct from c.id then
      raise exception 'Sender domain % belongs to another brand', clean using errcode = 'PT409';
    end if;
  end if;
  for m in select * from public.inbox_messages
    where (from_domain = clean or from_domain like '%.' || clean) and state = 'unassigned'
    order by received_at
  loop
    perform private.assign_inbox_message(m, c);
    n := n + 1;
  end loop;
  update public.ops_tasks set state = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_at = now(),
      detail = detail || jsonb_build_object('assignedTo', c.id, 'assigned', n)
    where id = any(locked) and state = 'open';
  return n;
end $$;

-- An unsubscribed-us task: the brand first, then the task (the order the
-- poll worker flags a notice in). Done: we signed up again, so the brand
-- waits for its first newsletter. Dismissed: the notice was misread, so
-- the brand is subscribed again if a newsletter came after it, else waits.
create or replace function public.resolve_ops_task(task uuid, outcome text, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.ops_tasks; brand uuid; notice timestamptz;
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if outcome is null or outcome not in ('resolved','dismissed') then raise exception 'Invalid outcome' using errcode = '23514'; end if;
  if length(coalesce(note, '')) > 500 then raise exception 'Keep the note under 500 characters' using errcode = '23514'; end if;
  select * into t from public.ops_tasks where id = task;
  if t.id is null then raise exception 'This task no longer exists' using errcode = 'PT409'; end if;
  if t.kind = 'inbox_unsubscribed' and t.detail->>'brand' is not null then
    brand := (t.detail->>'brand')::uuid;
    perform 1 from public.competitor_captures where id = brand for update;
  end if;
  select * into t from public.ops_tasks where id = task for update;
  if t.state <> 'open' then raise exception 'This task is already closed' using errcode = 'PT409'; end if;
  if brand is not null then
    select received_at into notice from public.inbox_messages where id = t.subject_id;
    update public.competitor_captures
      set subscription_status = case
            when outcome = 'dismissed' and exists (select 1 from public.inbox_messages o
              where o.capture_id = brand and o.state = 'assigned' and o.signal is null
                and o.received_at > coalesce(notice, t.created_at)) then 'subscribed'
            else 'pending' end,
          pending_since = now()
      where id = brand and subscription_status = 'unsubscribed';
  end if;
  update public.ops_tasks
    set state = outcome, resolved_by = auth.uid(), resolved_at = now(), updated_at = now(),
        detail = case when nullif(btrim(coalesce(note, '')), '') is null then detail
                      else detail || jsonb_build_object('note', btrim(note)) end
    where id = task;
end $$;

-- Once per wait, and never while an older task for the brand is open.
create or replace function public.check_pending_subscriptions()
returns integer language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  for c in select cc.id, cc.domain, cc.alias_slug, coalesce(cc.pending_since, cc.created_at) as since
    from public.competitor_captures cc
    where cc.subscription_status = 'pending' and cc.alias_slug is not null
      and coalesce(cc.pending_since, cc.created_at) < now() - interval '7 days'
      and not exists (select 1 from public.inbox_messages o
        where o.capture_id = cc.id and o.state = 'assigned' and o.signal is null
          and o.received_at >= coalesce(cc.pending_since, cc.created_at))
      and not exists (select 1 from public.ops_tasks t
        where t.dedupe_key = 'inbox_pending_subscription:' || cc.id
          and (t.state = 'open' or t.created_at >= coalesce(cc.pending_since, cc.created_at)))
  loop
    perform private.open_ops_task('inbox_pending_subscription', 'inbox_pending_subscription:' || c.id, c.id,
      jsonb_build_object('brand', c.id, 'domain', c.domain, 'aliasSlug', c.alias_slug, 'since', c.since));
    n := n + 1;
  end loop;
  return n;
end $$;
