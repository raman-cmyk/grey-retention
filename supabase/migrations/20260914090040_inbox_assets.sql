-- INB-002 Inspiration inbox: every image kept at once, and a 600px
-- screenshot of the whole email (VISION Step 2).
--
-- Tracking and image links in newsletters expire, so as soon as an email
-- with HTML is recorded an `inbox.assets` job downloads every image it
-- uses into the private `inbox-assets` bucket (stored once by content:
-- img/<sha256>.<ext>). When that is done an `inbox.screenshot` job asks for
-- a picture of the whole email at 600px (shot/<message id>.jpg); a browser
-- outside the app takes it, with the stored images only.
--
-- Workspaces see an email's screenshot only when they follow its brand
-- (the same rule as the email itself); platform admins see everything.

create table public.inbox_message_images (
  id uuid primary key default gen_random_uuid(),
  inbox_message_id uuid not null references public.inbox_messages(id),
  ordinal integer not null check (ordinal between 1 and 60),
  -- remote: an https link; cid: a part of the email; inline: a data: URI.
  source text not null check (source in ('remote','cid','inline')),
  -- The reference as written in the HTML (used to show the stored copy).
  source_ref text not null check (length(source_ref) between 1 and 2000),
  state text not null check (state in ('stored','failed')),
  failure text check (failure in ('broken','too_large','not_image','blocked','timeout','limit')),
  path text check (path ~ '^img/[a-f0-9]{64}\.(png|jpg|gif|webp)$'),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer check (bytes between 1 and 5242880),
  content_type text check (content_type in ('image/png','image/jpeg','image/gif','image/webp')),
  created_at timestamptz not null default now(),
  unique (inbox_message_id, ordinal),
  check ((state = 'stored') = (path is not null and sha256 is not null and bytes is not null and content_type is not null)),
  -- The stored copy is named by its content and its type.
  check (path is null or path = 'img/' || sha256 || '.' || case content_type
    when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/gif' then 'gif' else 'webp' end),
  check ((state = 'failed') = (failure is not null))
);
create index inbox_message_images_path on public.inbox_message_images (path) where path is not null;

alter table public.inbox_messages
  add column assets_state text not null default 'none' check (assets_state in ('none','pending','done')),
  add column images_stored integer not null default 0 check (images_stored between 0 and 60),
  add column images_failed integer not null default 0 check (images_failed between 0 and 60),
  add column screenshot_path text check (screenshot_path ~ '^shot/[0-9a-f-]{36}\.jpg$'),
  add column screenshot_width integer check (screenshot_width between 1 and 2000),
  add column screenshot_height integer check (screenshot_height between 1 and 16000),
  add column screenshot_at timestamptz;

-- What a workspace that follows the brand may see of the screenshot.
alter table public.competitor_emails
  add column screenshot_path text check (screenshot_path ~ '^shot/[0-9a-f-]{36}\.jpg$'),
  add column screenshot_width integer check (screenshot_width between 1 and 2000),
  add column screenshot_height integer check (screenshot_height between 1 and 16000);
-- The storage rule looks screenshots up by path on every signed link.
create index competitor_emails_screenshot_path on public.competitor_emails (screenshot_path)
  where screenshot_path is not null;

alter table public.inbox_message_images enable row level security;
create policy operator_read on public.inbox_message_images for select to authenticated using (private.is_operator());
revoke insert, update, delete, truncate, references, trigger on public.inbox_message_images from public, anon, authenticated;
revoke all on public.inbox_message_images from anon;
grant select on public.inbox_message_images to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('inbox-assets', 'inbox-assets', false, 10485760, array['image/png','image/jpeg','image/gif','image/webp'])
  on conflict (id) do nothing;

-- Platform admins read every kept image and screenshot. A workspace member
-- reads only the screenshot of an email from a brand the workspace follows
-- (the kept images themselves are for the platform).
create or replace function private.inbox_asset_access(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_operator()
    or exists (select 1 from public.competitor_emails e
      where e.screenshot_path = object_name and private.capture_access(e.capture_id))
$$;
revoke all on function private.inbox_asset_access(text) from public, anon;
grant execute on function private.inbox_asset_access(text) to authenticated;
create policy inbox_asset_read on storage.objects for select to authenticated
  using (bucket_id = 'inbox-assets' and private.inbox_asset_access(name));

-- An email with HTML gets its images kept as soon as it is recorded.
-- (A message that could not be read keeps its copy for a person only.)
create or replace function private.inbox_assets_pending()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.html_path is not null and new.state in ('assigned','unassigned') then new.assets_state := 'pending'; end if;
  return new;
end $$;
create or replace function private.queue_inbox_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.html_path is not null and new.state in ('assigned','unassigned') then
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('inbox.assets', new.id::text, 'inbox.assets:' || new.id)
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function private.inbox_assets_pending() from public, anon, authenticated;
revoke all on function private.queue_inbox_assets() from public, anon, authenticated;
create trigger inbox_assets_pending before insert on public.inbox_messages
  for each row execute function private.inbox_assets_pending();
create trigger queue_inbox_assets after insert on public.inbox_messages
  for each row execute function private.queue_inbox_assets();

-- An email assigned to its brand later (by an admin, INB-004) brings its
-- screenshot along.
create or replace function private.competitor_email_screenshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.inbox_message_id is not null and new.screenshot_path is null then
    select m.screenshot_path, m.screenshot_width, m.screenshot_height
      into new.screenshot_path, new.screenshot_width, new.screenshot_height
      from public.inbox_messages m where m.id = new.inbox_message_id;
  end if;
  return new;
end $$;
revoke all on function private.competitor_email_screenshot() from public, anon, authenticated;
create trigger competitor_email_screenshot before insert on public.competitor_emails
  for each row execute function private.competitor_email_screenshot();

-- Emails recorded before this migration (INB-001 was already reading the
-- inbox) get their images kept too. Safe to run again.
update public.inbox_messages set assets_state = 'pending'
  where html_path is not null and assets_state = 'none' and state in ('assigned','unassigned');
insert into public.platform_jobs(kind, subject_key, idempotency_key)
  select 'inbox.assets', id::text, 'inbox.assets:' || id from public.inbox_messages
    where html_path is not null and state in ('assigned','unassigned')
  on conflict do nothing;

-- Records what happened to every image of one email, once, and asks for
-- its screenshot. A retry records nothing twice.
create or replace function public.record_inbox_images(job uuid, lease uuid, images jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; img jsonb; stored integer; failed integer;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.assets' then raise exception 'Not an image job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  if jsonb_typeof(images) is distinct from 'array' or jsonb_array_length(images) > 60 then
    raise exception 'Invalid image list' using errcode = '23514';
  end if;
  for img in select * from jsonb_array_elements(images) loop
    if img->>'state' = 'stored' and not exists (
      select 1 from storage.objects o where o.bucket_id = 'inbox-assets' and o.name = img->>'path') then
      raise exception 'Stored copy missing' using errcode = 'PT409';
    end if;
    insert into public.inbox_message_images(inbox_message_id, ordinal, source, source_ref, state, failure, path, sha256, bytes, content_type)
      values (message, (img->>'ordinal')::integer, img->>'source', left(img->>'sourceRef', 2000), img->>'state',
        img->>'failure', img->>'path', img->>'sha256', (img->>'bytes')::integer, img->>'contentType')
      on conflict (inbox_message_id, ordinal) do nothing;
  end loop;
  select count(*) filter (where state = 'stored'), count(*) filter (where state = 'failed')
    into stored, failed from public.inbox_message_images where inbox_message_id = message;
  update public.inbox_messages set assets_state = 'done', images_stored = stored, images_failed = failed
    where id = message;
  insert into public.platform_jobs(kind, subject_key, idempotency_key)
    values ('inbox.screenshot', message::text, 'inbox.screenshot:' || message)
    on conflict do nothing;
  return jsonb_build_object('stored', stored, 'failed', failed);
end $$;

-- Records the screenshot of one email (already uploaded) on the message
-- and on its competitor email.
create or replace function public.record_inbox_screenshot(job uuid, lease uuid, width integer, height integer)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; shot text;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.screenshot' then raise exception 'Not a screenshot job' using errcode = '23514'; end if;
  shot := 'shot/' || j.subject_key || '.jpg';
  if width is null or width not between 1 and 2000 or height is null or height not between 1 and 16000 then
    raise exception 'Invalid screenshot size' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-assets' and o.name = shot) then
    raise exception 'Stored copy missing' using errcode = 'PT409';
  end if;
  update public.inbox_messages
    set screenshot_path = shot, screenshot_width = width, screenshot_height = height, screenshot_at = now()
    where id = j.subject_key::uuid;
  update public.competitor_emails set screenshot_path = shot, screenshot_width = width, screenshot_height = height
    where inbox_message_id = j.subject_key::uuid;
end $$;

revoke all on function public.record_inbox_images(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_inbox_screenshot(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.record_inbox_images(uuid, uuid, jsonb) to service_role;
grant execute on function public.record_inbox_screenshot(uuid, uuid, integer, integer) to service_role;
