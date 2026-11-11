-- INB-004 Inbox ops queue and admin brand directory (VISION §10, BUILD_BRIEF D7).
--
-- A person sees what the inbox could not handle and resolves it:
-- * an unknown sender: assign the email to a brand (and remember the sender);
-- * an email that could not be read or was too large;
-- * a double-opt-in confirmation: the worker opens the confirm link itself
--   only for a known brand and a known host, once, and logs it; otherwise a
--   person clicks it;
-- * a brand that unsubscribed us: resubscribe;
-- * a brand still pending a week after it was added (or resubscribed).
-- A brand counts as subscribed only once an ordinary newsletter arrives: a
-- confirmation email or a click is no proof. Confirmations and notices are
-- not newsletters, so they never reach the Inspiration library.
-- Also (for Lane A's Step 1 gate, BLK-003): a person's own label of a
-- section is kept apart from the machine label. Platform admins only.

create table public.inbox_confirmation_clicks (
  id uuid primary key default gen_random_uuid(),
  inbox_message_id uuid not null references public.inbox_messages(id),
  capture_id uuid not null references public.competitor_captures(id),
  -- The link's host, and where it ended after redirects.
  host text not null check (length(host) between 1 and 253),
  final_host text check (length(final_host) between 1 and 253),
  -- 'attempted' is written before the link is opened, so a retry after a
  -- crash never opens it a second time.
  outcome text not null check (outcome in ('attempted','clicked','failed','refused')),
  http_status integer check (http_status between 100 and 599),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inbox_message_id)
);
create index inbox_confirmation_clicks_capture on public.inbox_confirmation_clicks (capture_id);
create index ops_tasks_subject on public.ops_tasks (subject_id) where state = 'open';
alter table public.inbox_confirmation_clicks enable row level security;
create policy operator_read on public.inbox_confirmation_clicks for select to authenticated using (private.is_operator());
revoke insert, update, delete, truncate, references, trigger on public.inbox_confirmation_clicks from public, anon, authenticated;
revoke all on public.inbox_confirmation_clicks from anon;
grant select on public.inbox_confirmation_clicks to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.inbox_confirmation_clicks from public, anon, authenticated';
  end if;
end $$;

alter table public.inbox_messages
  -- The confirm link a worker may open, kept with the message.
  add column confirm_url text check (length(confirm_url) <= 2000 and confirm_url ~ '^https://'),
  add column signal text check (signal in ('opt_in','unsubscribed')),
  -- The text part of an email waiting for a brand (an assigned one keeps it
  -- on its competitor email), for when an admin assigns it.
  add column text_part text check (length(text_part) <= 10000);

-- Since when a brand waits for its first newsletter (added, resubscribed or
-- a confirmation seen); null means since it was added.
alter table public.competitor_captures add column pending_since timestamptz;

-- A person's own label, apart from the machine's (the Step 1 gate compares
-- the two); the machine never writes 'owner' any more.
alter table public.email_sections
  add column label_model text check (length(label_model) between 1 and 100),
  add column owner_block_type text check (owner_block_type in ('announcement_bar','header_logo','hero_product','hero_image','offer_banner',
    'text','steps','product_feature','product_grid_2col','product_grid_3col','category_tiles','image_text','founder_note','review_strip',
    'ugc_grid','before_after','faq','cta','signoff','footer','unsure')),
  add column owner_labelled_by uuid references public.profiles(id),
  add column owner_labelled_at timestamptz,
  add constraint email_sections_owner_label check ((owner_block_type is null) = (owner_labelled_at is null));
-- No command wrote an owner label before this migration; any test row that
-- did is moved to the person's columns.
update public.email_sections
  set owner_block_type = block_type, owner_labelled_at = labelled_at,
      block_type = null, label_source = null, confidence = null, labelled_at = null
  where label_source = 'owner';
alter table public.email_sections drop constraint email_sections_label_source_check;
alter table public.email_sections add constraint email_sections_label_source_check check (label_source in ('sample','gemini'));

-- The poll worker notes each recorded message (also when a retry finds it
-- already recorded): the text part of an unassigned email, and its signal,
-- an opt-in confirmation (with the link it found) or an "unsubscribed"
-- notice. A signal is acted on once.
create or replace function public.flag_inbox_message(job uuid, lease uuid, message_key text, signal text default null,
  confirm_url text default null, text_part text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; m public.inbox_messages; c public.competitor_captures; url text; newsletters boolean;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.poll' then raise exception 'Not an inbox job' using errcode = '23514'; end if;
  if flag_inbox_message.signal is not null and flag_inbox_message.signal not in ('opt_in','unsubscribed') then
    raise exception 'Invalid signal' using errcode = '23514';
  end if;
  select im.* into m from public.inbox_messages im
    join public.inbox_mailboxes b on b.id = im.mailbox_id
    where b.key = j.subject_key and im.message_key = flag_inbox_message.message_key
    for update of im;
  if m.id is null then raise exception 'Unknown message' using errcode = 'PT409'; end if;
  if m.state = 'unassigned' and m.text_part is null and nullif(btrim(coalesce(flag_inbox_message.text_part, '')), '') is not null then
    update public.inbox_messages set text_part = left(flag_inbox_message.text_part, 10000) where id = m.id;
  end if;
  if flag_inbox_message.signal is null then return jsonb_build_object('signal', null); end if;
  if m.signal is not null then return jsonb_build_object('already', true); end if;
  -- Only a well-formed https link is kept; anything else goes to a person.
  if length(flag_inbox_message.confirm_url) <= 2000 and flag_inbox_message.confirm_url ~* '^https://[^\s]+$' then
    url := 'https://' || substr(flag_inbox_message.confirm_url, 9);
  end if;
  select * into c from public.competitor_captures where id = m.capture_id for update;
  update public.inbox_messages
    set signal = flag_inbox_message.signal, confirm_url = case when flag_inbox_message.signal = 'opt_in' then url end
    where id = m.id;
  -- A confirmation or a notice is not a newsletter: out of the library.
  delete from public.competitor_emails where inbox_message_id = m.id;
  newsletters := c.id is not null and exists (select 1 from public.inbox_messages o
    where o.capture_id = c.id and o.id <> m.id and o.state = 'assigned' and o.signal is null);
  if flag_inbox_message.signal = 'unsubscribed' then
    if c.id is not null then
      update public.competitor_captures set subscription_status = 'unsubscribed', pending_since = null where id = c.id;
    end if;
    perform private.open_ops_task('inbox_unsubscribed', 'inbox_unsubscribed:' || coalesce(c.id::text, m.from_domain, 'unknown'), m.id,
      jsonb_build_object('brand', c.id, 'fromDomain', m.from_domain, 'aliasSlug', m.alias_slug));
  elsif c.id is null then
    perform private.open_ops_task('inbox_opt_in', 'inbox_opt_in:' || m.id, m.id,
      jsonb_build_object('fromDomain', m.from_domain, 'aliasSlug', m.alias_slug, 'reason', 'unknown_brand'));
  elsif newsletters and c.subscription_status = 'subscribed' then
    -- Its newsletters already arrive: nothing to confirm, nothing clicked.
    return jsonb_build_object('already', false, 'ignored', 'subscribed');
  else
    -- Not confirmed yet (the confirmation itself proves nothing).
    update public.competitor_captures
      set subscription_status = 'pending',
          pending_since = case when subscription_status = 'pending' then pending_since else now() end
      where id = c.id;
    if url is not null then
      insert into public.platform_jobs(kind, subject_key, idempotency_key)
        values ('inbox.confirm', m.id::text, 'inbox.confirm:' || m.id)
        on conflict do nothing;
    else
      perform private.open_ops_task('inbox_opt_in', 'inbox_opt_in:' || m.id, m.id,
        jsonb_build_object('brand', c.id, 'fromDomain', m.from_domain, 'aliasSlug', m.alias_slug, 'reason', 'no_link'));
    end if;
  end if;
  return jsonb_build_object('already', false);
end $$;

-- The confirm worker writes 'attempted' before it opens a link. False when
-- this email's click was already begun or logged (a retry): then nothing is
-- opened again.
create or replace function public.begin_confirmation_click(job uuid, lease uuid, host text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; m public.inbox_messages; logged uuid;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.confirm' then raise exception 'Not a confirm job' using errcode = '23514'; end if;
  select * into m from public.inbox_messages where id = j.subject_key::uuid for update;
  if m.capture_id is null or m.signal is distinct from 'opt_in' or m.confirm_url is null then
    raise exception 'Nothing to confirm' using errcode = 'PT409';
  end if;
  insert into public.inbox_confirmation_clicks(inbox_message_id, capture_id, host, outcome)
    values (m.id, m.capture_id, lower(left(coalesce(nullif(btrim(begin_confirmation_click.host), ''), 'unknown'), 253)), 'attempted')
    on conflict (inbox_message_id) do nothing
    returning id into logged;
  return logged is not null;
end $$;

-- The confirm worker records what happened to the click, once. A refused
-- or failed click becomes a task for a person. A click that worked changes
-- nothing on the brand: its first newsletter proves the subscription.
create or replace function public.record_confirmation_click(job uuid, lease uuid, host text, outcome text,
  http_status integer default null, final_host text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; m public.inbox_messages; logged uuid; clean text; reached text;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.confirm' then raise exception 'Not a confirm job' using errcode = '23514'; end if;
  if record_confirmation_click.outcome is null or record_confirmation_click.outcome not in ('clicked','failed','refused') then
    raise exception 'Invalid outcome' using errcode = '23514';
  end if;
  select * into m from public.inbox_messages where id = j.subject_key::uuid for update;
  if m.capture_id is null or m.signal is distinct from 'opt_in' then raise exception 'Nothing to confirm' using errcode = 'PT409'; end if;
  clean := lower(left(coalesce(nullif(btrim(record_confirmation_click.host), ''), 'unknown'), 253));
  reached := lower(left(nullif(btrim(record_confirmation_click.final_host), ''), 253));
  insert into public.inbox_confirmation_clicks(inbox_message_id, capture_id, host, final_host, outcome, http_status)
    values (m.id, m.capture_id, clean, reached, record_confirmation_click.outcome, record_confirmation_click.http_status)
    on conflict (inbox_message_id) do update
      set outcome = excluded.outcome, final_host = excluded.final_host, http_status = excluded.http_status, updated_at = now()
      where public.inbox_confirmation_clicks.outcome = 'attempted'
    returning id into logged;
  if logged is null then return jsonb_build_object('already', true); end if;
  if record_confirmation_click.outcome <> 'clicked' then
    perform private.open_ops_task('inbox_opt_in', 'inbox_opt_in:' || m.id, m.id,
      jsonb_build_object('brand', m.capture_id, 'host', clean, 'reason', record_confirmation_click.outcome,
        'status', record_confirmation_click.http_status));
  end if;
  return jsonb_build_object('already', false);
end $$;

-- Brands that have waited a week for their first newsletter (since they
-- were added, resubscribed or confirmed): a person checks the sign-up.
-- Once per wait: a task that was resolved or dismissed does not come back.
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
        where t.dedupe_key = 'inbox_pending_subscription:' || cc.id and t.created_at >= coalesce(cc.pending_since, cc.created_at))
  loop
    perform private.open_ops_task('inbox_pending_subscription', 'inbox_pending_subscription:' || c.id, c.id,
      jsonb_build_object('brand', c.id, 'domain', c.domain, 'aliasSlug', c.alias_slug, 'since', c.since));
    n := n + 1;
  end loop;
  return n;
end $$;

-- A platform admin resolves or dismisses a task, with an optional note.
-- Marking "unsubscribed us" done means we signed up again: the brand then
-- waits for its first newsletter.
create or replace function public.resolve_ops_task(task uuid, outcome text, note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.ops_tasks;
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if outcome is null or outcome not in ('resolved','dismissed') then raise exception 'Invalid outcome' using errcode = '23514'; end if;
  if length(coalesce(note, '')) > 500 then raise exception 'Keep the note under 500 characters' using errcode = '23514'; end if;
  select * into t from public.ops_tasks where id = task for update;
  if t.id is null then raise exception 'This task no longer exists' using errcode = 'PT409'; end if;
  if t.state <> 'open' then raise exception 'This task is already closed' using errcode = 'PT409'; end if;
  if t.kind = 'inbox_unsubscribed' and outcome = 'resolved' and t.detail->>'brand' is not null then
    update public.competitor_captures set subscription_status = 'pending', pending_since = now()
      where id = (t.detail->>'brand')::uuid and subscription_status = 'unsubscribed';
  end if;
  update public.ops_tasks
    set state = outcome, resolved_by = auth.uid(), resolved_at = now(), updated_at = now(),
        detail = case when nullif(btrim(coalesce(note, '')), '') is null then detail
                      else detail || jsonb_build_object('note', btrim(note)) end
    where id = task;
end $$;

-- Assigns one unassigned email to a brand (sample mail to a sample brand,
-- real mail to a real one). An ordinary email becomes a competitor email
-- (with its text, screenshot and facts) and shows the brand is subscribed;
-- a confirmation or notice is only assigned. Callers check the admin and
-- lock the email, then the brand.
create or replace function private.assign_inbox_message(m public.inbox_messages, c public.competitor_captures)
returns uuid language plpgsql security definer set search_path = '' as $$
declare email uuid; body text; sections text;
begin
  if m.state <> 'unassigned' then raise exception 'Only an email waiting for a brand can be assigned' using errcode = 'PT409'; end if;
  if c.synthetic is distinct from m.synthetic then
    raise exception 'Sample emails go to sample brands, real emails to real brands' using errcode = '23514';
  end if;
  update public.inbox_messages set state = 'assigned', method = 'admin', capture_id = c.id where id = m.id;
  if m.signal is not null then return null; end if;
  select nullif(btrim(string_agg(s.text, E'\n\n' order by s.ordinal)), '') into sections
    from public.email_sections s where s.inbox_message_id = m.id;
  body := left(coalesce(nullif(btrim(coalesce(m.text_part, '')), ''), sections, '(no text)'), 10000);
  insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic,
      inbox_message_id, raw_path, html_path, preview_text)
    values (c.id, 'msg:' || m.message_key, m.received_at, coalesce(nullif(m.subject, ''), '(no subject)'), body,
      '<!doctype html><html><body style="font-family:Arial;padding:24px"><h1>' || private.escape_html(coalesce(nullif(m.subject, ''), '(no subject)'))
        || '</h1><pre style="white-space:pre-wrap">' || private.escape_html(body) || '</pre></body></html>',
      '{}'::jsonb, m.synthetic, m.id, m.raw_path, m.html_path, left(m.preheader, 300))
    on conflict (capture_id, external_id) do nothing
    returning id into email;
  update public.competitor_captures
    set last_received_at = greatest(coalesce(last_received_at, '-infinity'::timestamptz), m.received_at), status = 'live',
        subscription_status = case when subscription_status in ('not_subscribed','pending') then 'subscribed' else subscription_status end
    where id = c.id;
  return email;
end $$;
revoke all on function private.assign_inbox_message(public.inbox_messages, public.competitor_captures) from public, anon, authenticated;

-- The open sender tasks an email belongs to (unknown sender, or a sender
-- not registered for its +alias), by the sender domain they name.
create or replace function private.sender_tasks(sender text)
returns setof public.ops_tasks language sql stable security definer set search_path = '' as $$
  select * from public.ops_tasks t
    where t.state = 'open' and t.kind = 'inbox_unknown_sender'
      and (t.detail->>'fromDomain' = sender or t.detail->>'fromDomain' like '%.' || sender)
$$;
revoke all on function private.sender_tasks(text) from public, anon, authenticated;

-- A platform admin assigns one unassigned email to a brand. Its sender's
-- task closes once no other email from that sender waits; otherwise it
-- points at the next one.
create or replace function public.admin_assign_inbox_message(message uuid, brand uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.inbox_messages; c public.competitor_captures; email uuid; t public.ops_tasks; next_one uuid;
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  select * into m from public.inbox_messages where id = message for update;
  select * into c from public.competitor_captures where id = brand for update;
  if m.id is null or c.id is null then raise exception 'Email or brand not found' using errcode = 'PT409'; end if;
  email := private.assign_inbox_message(m, c);
  for t in select * from private.sender_tasks(coalesce(m.from_domain, 'none')) where detail->>'fromDomain' = coalesce(m.from_domain, 'none') loop
    select o.id into next_one from public.inbox_messages o
      where o.state = 'unassigned' and o.id <> m.id and o.from_domain is not distinct from m.from_domain
        and (t.dedupe_key like 'inbox_unknown_sender:%' or o.alias_slug is not distinct from t.detail->>'aliasSlug')
      order by o.received_at limit 1;
    if next_one is null then
      update public.ops_tasks set state = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_at = now(),
          detail = detail || jsonb_build_object('assignedTo', c.id)
        where id = t.id;
    else
      update public.ops_tasks set subject_id = next_one, updated_at = now() where id = t.id;
    end if;
  end loop;
  return email;
end $$;

-- A platform admin says a sender domain belongs to a brand: it is
-- remembered for future emails, every waiting email from it (or a
-- subdomain) is assigned now, and its tasks close. Sample senders
-- (.example) go to sample brands, real senders to real brands.
create or replace function public.admin_assign_sender(sender text, brand uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.competitor_captures; m public.inbox_messages; owner uuid; got text; n integer := 0;
  clean text := lower(btrim(coalesce(sender, '')));
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if length(clean) > 253 or clean !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'Sender domains look like mail.northwind.com' using errcode = '23514';
  end if;
  -- The sender's open tasks first: a poll adding an email from this sender
  -- right now waits, or has already committed and is seen below.
  perform 1 from private.sender_tasks(clean) t join public.ops_tasks o on o.id = t.id for update of o;
  -- Then every waiting email from it (all at once), then the brand.
  perform 1 from public.inbox_messages
    where (from_domain = clean or from_domain like '%.' || clean) and state = 'unassigned' for update;
  select * into c from public.competitor_captures where id = brand for update;
  if c.id is null then raise exception 'Brand not found' using errcode = 'PT409'; end if;
  if (clean ~ '\.example$') is distinct from c.synthetic then
    raise exception 'Sample senders (.example) go to sample brands, real senders to real brands' using errcode = '23514';
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
    where id in (select id from private.sender_tasks(clean));
  return n;
end $$;

-- A person labels one section by hand (Lane A's Step 1 gate compares it
-- with the machine label); null clears it.
create or replace function public.admin_label_section(section uuid, block_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if admin_label_section.block_type is not null and admin_label_section.block_type not in ('announcement_bar','header_logo',
    'hero_product','hero_image','offer_banner','text','steps','product_feature','product_grid_2col','product_grid_3col',
    'category_tiles','image_text','founder_note','review_strip','ugc_grid','before_after','faq','cta','signoff','footer','unsure') then
    raise exception 'Use one of the 20 block types, or unsure' using errcode = '23514';
  end if;
  update public.email_sections
    set owner_block_type = admin_label_section.block_type,
        owner_labelled_by = case when admin_label_section.block_type is null then null else auth.uid() end,
        owner_labelled_at = case when admin_label_section.block_type is null then null else now() end
    where id = section;
  if not found then raise exception 'Section not found' using errcode = 'PT409'; end if;
end $$;

-- The label worker's record (INB-003), now with the model that labelled
-- each section; the machine columns only, so a person's label stays apart.
create or replace function public.record_inbox_labels(job uuid, lease uuid, labels jsonb, facts jsonb, version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; m public.inbox_messages; l jsonb; changed integer := 0; n integer;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.label' then raise exception 'Not a label job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  if version is null or version < 1 or jsonb_typeof(labels) is distinct from 'array' or jsonb_typeof(facts) is distinct from 'object'
    or jsonb_array_length(labels) > 40 then
    raise exception 'Invalid labels' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(labels) e
      where jsonb_typeof(e->'ordinal') is distinct from 'number' or coalesce(e->>'source', '') not in ('sample', 'gemini')
        or (e ? 'model' and jsonb_typeof(e->'model') not in ('string', 'null'))
        or case when jsonb_typeof(e->'confidence') = 'number' then (e->>'confidence')::numeric not between 0 and 1 else true end) then
    raise exception 'Invalid labels' using errcode = '23514';
  end if;
  select * into m from public.inbox_messages where id = message for update;
  if m.labelled_at is not null and m.extraction_version >= version then
    return jsonb_build_object('already', true);
  end if;
  for l in select * from jsonb_array_elements(labels) loop
    update public.email_sections
      set block_type = l->>'type', label_source = l->>'source', confidence = round((l->>'confidence')::numeric, 2),
          label_model = left(nullif(btrim(coalesce(l->>'model', '')), ''), 100), labelled_at = now()
      where inbox_message_id = message and ordinal = (l->>'ordinal')::integer;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  update public.inbox_messages set facts = record_inbox_labels.facts, labelled_at = now(), extraction_version = version
    where id = message;
  update public.competitor_emails set facts = record_inbox_labels.facts, labelled_at = now(), extraction_version = version
    where inbox_message_id = message;
  return jsonb_build_object('already', false, 'sections', changed);
end $$;

-- The directory's counts per brand: emails kept and sender domains.
create or replace function public.admin_inbox_brand_counts()
returns table (capture_id uuid, emails integer, senders text[])
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  return query
    select cc.id,
      (select count(*)::integer from public.inbox_messages m where m.capture_id = cc.id and m.state = 'assigned' and m.signal is null),
      coalesce((select array_agg(d.domain order by d.domain) from public.competitor_sender_domains d where d.capture_id = cc.id), '{}')
    from public.competitor_captures cc where cc.alias_slug is not null;
end $$;

revoke all on function public.flag_inbox_message(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_confirmation_click(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_confirmation_click(uuid, uuid, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.check_pending_subscriptions() from public, anon, authenticated;
grant execute on function public.flag_inbox_message(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.begin_confirmation_click(uuid, uuid, text) to service_role;
grant execute on function public.record_confirmation_click(uuid, uuid, text, text, integer, text) to service_role;
grant execute on function public.check_pending_subscriptions() to service_role;
revoke all on function public.resolve_ops_task(uuid, text, text) from public, anon;
revoke all on function public.admin_assign_inbox_message(uuid, uuid) from public, anon;
revoke all on function public.admin_assign_sender(text, uuid) from public, anon;
revoke all on function public.admin_label_section(uuid, text) from public, anon;
revoke all on function public.admin_inbox_brand_counts() from public, anon;
grant execute on function public.resolve_ops_task(uuid, text, text) to authenticated;
grant execute on function public.admin_assign_inbox_message(uuid, uuid) to authenticated;
grant execute on function public.admin_assign_sender(text, uuid) to authenticated;
grant execute on function public.admin_label_section(uuid, text) to authenticated;
grant execute on function public.admin_inbox_brand_counts() to authenticated;
