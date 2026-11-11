-- INB-003 Inspiration extraction: sections, labels and facts (VISION Step 2).
--
-- The image job (INB-002) now also cuts each email into sections from its
-- HTML structure and keeps a marked copy of the HTML; the screenshot browser
-- photographs each section too. Then an `inbox.label` job labels every
-- section with one of the 20 block types (text or design), works out the
-- email's facts (offer, angle, call to action, block sequence, ...) and
-- stores them once: an email is never labelled twice for the same version.
-- A brand's summary is computed from its emails' facts when it is read.
--
-- Every email gets facts: the label job is queued when its sections are
-- recorded (an hour later, so the screenshot crops are usually there; the
-- screenshot brings it forward), and straight away for an email without
-- HTML. Emails INB-002 handled before this migration are cut again.

create table public.email_sections (
  id uuid primary key default gen_random_uuid(),
  inbox_message_id uuid not null references public.inbox_messages(id),
  ordinal integer not null check (ordinal between 1 and 40),
  html text not null check (length(html) <= 200000),
  text text not null default '' check (length(text) <= 4000),
  kind text not null check (kind in ('text','design')),
  words integer not null check (words >= 0),
  images integer not null check (images >= 0),
  wide_images integer not null default 0 check (wide_images >= 0),
  links jsonb not null default '[]' check (jsonb_typeof(links) = 'array' and length(links::text) <= 20000),
  -- Where the section sits in the 600px screenshot, and its own crop.
  image_path text check (image_path ~ '^sect/[0-9a-f-]{36}/[0-9]{1,2}\.jpg$'),
  top integer check (top between 0 and 16000),
  height integer check (height between 1 and 16000),
  block_type text check (block_type in ('announcement_bar','header_logo','hero_product','hero_image','offer_banner','text','steps',
    'product_feature','product_grid_2col','product_grid_3col','category_tiles','image_text','founder_note','review_strip',
    'ugc_grid','before_after','faq','cta','signoff','footer','unsure')),
  label_source text check (label_source in ('sample','gemini','owner')),
  confidence numeric(3,2) check (confidence between 0 and 1),
  labelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (inbox_message_id, ordinal),
  check ((block_type is null) = (label_source is null and labelled_at is null))
);

alter table public.inbox_messages
  add column marked_html_path text check (marked_html_path ~ '^(fake|gmail)/[a-f0-9]{64}\.marked\.html$'),
  add column preheader text check (length(preheader) <= 200),
  add column text_ratio numeric(4,3) check (text_ratio between 0 and 1),
  add column facts jsonb check (jsonb_typeof(facts) = 'object' and length(facts::text) <= 8000),
  add column labelled_at timestamptz,
  add column extraction_version integer check (extraction_version > 0);

-- The facts a workspace that follows the brand may read.
alter table public.competitor_emails
  add column facts jsonb check (jsonb_typeof(facts) = 'object' and length(facts::text) <= 8000);

alter table public.email_sections enable row level security;
create policy operator_read on public.email_sections for select to authenticated using (private.is_operator());
revoke insert, update, delete, truncate, references, trigger on public.email_sections from public, anon, authenticated;
revoke all on public.email_sections from anon;
grant select on public.email_sections to authenticated;
-- Postgres 17 also grants MAINTAIN (vacuum, analyze, refresh); browser roles
-- get it on no inbox table. Older servers do not have the privilege.
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_sections, public.inbox_messages, public.inbox_mailboxes, '
      || 'public.inbox_message_images, public.competitor_sender_domains, public.platform_jobs, public.ops_tasks '
      || 'from public, anon, authenticated';
  end if;
end $$;

-- An email assigned to its brand later brings its screenshot and facts.
-- FOR SHARE waits for a screenshot or label job writing the message right
-- now, so the copy is never taken from before that job's commit.
create or replace function private.competitor_email_screenshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.inbox_message_id is not null then
    select coalesce(new.screenshot_path, m.screenshot_path), coalesce(new.screenshot_width, m.screenshot_width),
           coalesce(new.screenshot_height, m.screenshot_height), coalesce(new.facts, m.facts),
           coalesce(new.labelled_at, m.labelled_at), coalesce(new.extraction_version, m.extraction_version)
      into new.screenshot_path, new.screenshot_width, new.screenshot_height, new.facts, new.labelled_at, new.extraction_version
      from public.inbox_messages m where m.id = new.inbox_message_id for share;
  end if;
  return new;
end $$;

-- An email without HTML has no sections: its facts come from its subject,
-- so it is queued for labelling straight away.
create or replace function private.queue_inbox_label_plain()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.html_path is null and new.state in ('assigned','unassigned') then
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('inbox.label', new.id::text, 'inbox.label:' || new.id || ':v1')
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function private.queue_inbox_label_plain() from public, anon, authenticated;
create trigger queue_inbox_label_plain after insert on public.inbox_messages
  for each row execute function private.queue_inbox_label_plain();

-- Cuts recorded by the image job: the sections and the marked HTML copy
-- the screenshot browser renders. Once per email: a retry with another cut
-- adds nothing. Then the email is queued for labelling, and an email that
-- was photographed before it had sections is photographed again for its
-- section crops.
create or replace function public.record_inbox_sections(job uuid, lease uuid, marked_path text, sections jsonb,
  preheader text default null, text_ratio numeric default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; s jsonb; m public.inbox_messages; fresh boolean;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.assets' then raise exception 'Not an image job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  select * into m from public.inbox_messages where id = message for update;
  if jsonb_typeof(sections) is distinct from 'array' or jsonb_array_length(sections) > 40 then
    raise exception 'Invalid sections' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(sections) e
      where jsonb_typeof(e->'ordinal') is distinct from 'number' or jsonb_typeof(e->'words') is distinct from 'number'
        or jsonb_typeof(e->'images') is distinct from 'number') then
    raise exception 'Invalid sections' using errcode = '23514';
  end if;
  if marked_path is not null then
    if marked_path !~ ('^' || (select key from public.inbox_mailboxes where id = m.mailbox_id) || '/[a-f0-9]{64}\.marked\.html$') then
      raise exception 'Invalid stored copy' using errcode = '23514';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-raw' and o.name = marked_path) then
      raise exception 'Stored copy missing' using errcode = 'PT409';
    end if;
  end if;
  fresh := not exists (select 1 from public.email_sections where inbox_message_id = message);
  if fresh then
    for s in select * from jsonb_array_elements(sections) loop
      insert into public.email_sections(inbox_message_id, ordinal, html, text, kind, words, images, wide_images, links)
        values (message, (s->>'ordinal')::integer, left(s->>'html', 200000), left(coalesce(s->>'text', ''), 4000), s->>'kind',
          (s->>'words')::integer, (s->>'images')::integer, coalesce((s->>'wideImages')::integer, 0), coalesce(s->'links', '[]'))
        on conflict (inbox_message_id, ordinal) do nothing;
    end loop;
    update public.inbox_messages
      set marked_html_path = coalesce(marked_html_path, record_inbox_sections.marked_path),
          preheader = coalesce(public.inbox_messages.preheader, left(record_inbox_sections.preheader, 200)),
          text_ratio = coalesce(public.inbox_messages.text_ratio, record_inbox_sections.text_ratio)
      where id = message;
  end if;
  insert into public.platform_jobs(kind, subject_key, idempotency_key, available_at)
    values ('inbox.label', j.subject_key, 'inbox.label:' || j.subject_key || ':v1', now() + interval '1 hour')
    on conflict do nothing;
  if fresh and m.screenshot_path is not null and jsonb_array_length(sections) > 0 then
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('inbox.screenshot', j.subject_key, 'inbox.screenshot:' || j.subject_key || ':sections')
      on conflict do nothing;
  end if;
  return (select count(*)::integer from public.email_sections where inbox_message_id = message);
end $$;

-- The screenshot, now with where each section sits and its own crop; then
-- the email's label job runs at the next sweep (it was queued an hour out
-- when its sections were recorded).
drop function public.record_inbox_screenshot(uuid, uuid, integer, integer);
create or replace function public.record_inbox_screenshot(job uuid, lease uuid, width integer, height integer, boxes jsonb default '[]')
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; shot text; message uuid; b jsonb; crop text;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.screenshot' then raise exception 'Not a screenshot job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  shot := 'shot/' || j.subject_key || '.jpg';
  if width is null or width not between 1 and 2000 or height is null or height not between 1 and 16000 then
    raise exception 'Invalid screenshot size' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(boxes, '[]')) <> 'array' or jsonb_array_length(coalesce(boxes, '[]')) > 40 then
    raise exception 'Invalid section boxes' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(boxes, '[]')) e
      where jsonb_typeof(e->'ordinal') is distinct from 'number' or jsonb_typeof(e->'top') is distinct from 'number'
        or jsonb_typeof(e->'height') is distinct from 'number') then
    raise exception 'Invalid section boxes' using errcode = '23514';
  end if;
  -- The message row first, as the label job does (no deadlock between them).
  perform 1 from public.inbox_messages where id = message for update;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-assets' and o.name = shot) then
    raise exception 'Stored copy missing' using errcode = 'PT409';
  end if;
  for b in select * from jsonb_array_elements(coalesce(boxes, '[]')) loop
    crop := 'sect/' || j.subject_key || '/' || (b->>'ordinal')::integer || '.jpg';
    if not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-assets' and o.name = crop) then
      raise exception 'Stored copy missing' using errcode = 'PT409';
    end if;
    update public.email_sections set image_path = crop, top = (b->>'top')::integer, height = (b->>'height')::integer
      where inbox_message_id = message and ordinal = (b->>'ordinal')::integer;
  end loop;
  update public.inbox_messages
    set screenshot_path = shot, screenshot_width = width, screenshot_height = height, screenshot_at = now()
    where id = message;
  update public.competitor_emails set screenshot_path = shot, screenshot_width = width, screenshot_height = height
    where inbox_message_id = message;
  insert into public.platform_jobs(kind, subject_key, idempotency_key)
    values ('inbox.label', j.subject_key, 'inbox.label:' || j.subject_key || ':v1')
    on conflict do nothing;
  update public.platform_jobs set available_at = now(), updated_at = now()
    where kind = 'inbox.label' and subject_key = j.subject_key and status = 'queued' and available_at > now();
end $$;

-- Labels and facts of one email, once per extraction version. A repeat
-- (or a lower version) changes nothing and says so. The worker labels as
-- 'sample' or 'gemini' only; an owner's own label is never overwritten.
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
        or case when jsonb_typeof(e->'confidence') = 'number' then (e->>'confidence')::numeric not between 0 and 1 else true end) then
    raise exception 'Invalid labels' using errcode = '23514';
  end if;
  select * into m from public.inbox_messages where id = message for update;
  if m.labelled_at is not null and m.extraction_version >= version then
    return jsonb_build_object('already', true);
  end if;
  for l in select * from jsonb_array_elements(labels) loop
    update public.email_sections
      set block_type = l->>'type', label_source = l->>'source', confidence = round((l->>'confidence')::numeric, 2), labelled_at = now()
      where inbox_message_id = message and ordinal = (l->>'ordinal')::integer
        and (label_source is distinct from 'owner');
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  update public.inbox_messages set facts = record_inbox_labels.facts, labelled_at = now(), extraction_version = version
    where id = message;
  update public.competitor_emails set facts = record_inbox_labels.facts, labelled_at = now(), extraction_version = version
    where inbox_message_id = message;
  return jsonb_build_object('already', false, 'sections', changed);
end $$;

revoke all on function public.record_inbox_sections(uuid, uuid, text, jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.record_inbox_screenshot(uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.record_inbox_labels(uuid, uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.record_inbox_sections(uuid, uuid, text, jsonb, text, numeric) to service_role;
grant execute on function public.record_inbox_screenshot(uuid, uuid, integer, integer, jsonb) to service_role;
grant execute on function public.record_inbox_labels(uuid, uuid, jsonb, jsonb, integer) to service_role;

-- Emails INB-002 handled before this migration: cut into sections now (the
-- image job sees their images are already kept and only cuts), and the
-- ones without HTML get their facts from the subject. Safe to run again.
insert into public.platform_jobs(kind, subject_key, idempotency_key)
  select 'inbox.assets', m.id::text, 'inbox.assets:' || m.id || ':sections'
    from public.inbox_messages m
    where m.html_path is not null and m.assets_state = 'done' and m.state in ('assigned','unassigned')
      and not exists (select 1 from public.email_sections s where s.inbox_message_id = m.id)
  on conflict do nothing;
insert into public.platform_jobs(kind, subject_key, idempotency_key)
  select 'inbox.label', m.id::text, 'inbox.label:' || m.id || ':v1'
    from public.inbox_messages m
    where m.html_path is null and m.state in ('assigned','unassigned') and m.labelled_at is null
  on conflict do nothing;
