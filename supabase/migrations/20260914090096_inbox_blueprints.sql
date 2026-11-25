-- DES-ENGINE-002 (step 2 of the email design plan, owner approval of 25 Nov):
-- every Inspiration email gets its blueprint, measured once and kept, so
-- "Use this design" (Copy) can copy its structure 1:1 for a brand.
--
-- * inbox_blueprints: one row per inbox email (inbox_messages.id) and
--   blueprint version (1, features/design-engine/blueprint.ts), written only
--   through record_inbox_blueprint (the blueprint browser job, service role;
--   no role may insert, update or delete rows directly). `state` is `ready`
--   (the blueprint) or `failed` (it can never be measured; `failure` is a
--   short code the app turns into plain words).
-- * A stored blueprint never keeps the inbox's pictures or links (rule 8: a
--   copy never reuses a competitor picture): the job and the app drop them,
--   and the table refuses one (`private.blueprint_is_bare`): no src, href,
--   srcset, url or poster value of any type, a background only as a hex
--   colour, no `url(` at the start of a word ("Curl (8 oz)" is fine), and no
--   `//` with or without http(s): in front of it anywhere in the blueprint's
--   text (the app blanks web addresses written in words with the same rule).
--   Sizes, places, fills, fonts, parts and words stay, as email_sections
--   already keeps the words.
-- * Visibility matches email_sections: platform admins read it; a
--   workspace never reads it directly. The build worker reads it (service
--   role) only for an email the workspace follows (create_email_build
--   already refuses any other reference; the caller checks it again).
-- * Which emails are measured, one rule everywhere: an email a workspace
--   can use (it has a competitor_emails row), with its marked copy and its
--   screenshot (its pictures are stored by then). Queued when the
--   screenshot is recorded, when an email is assigned to a brand later, for
--   emails already photographed (the last 120 days), and on first use
--   (`request_inbox_blueprint`, for a Copy build whose email has none yet).
-- * Merging starts the backfill: with the scheduled jobs on
--   (SCHEDULED_JOBS_ENABLED), the inbox browser job measures and stores
--   these blueprints in production, a few dozen per run.
-- * The number is chosen at merge time (D24).

-- True when a blueprint keeps no picture address and no link.
create or replace function private.blueprint_is_bare(b jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select not jsonb_path_exists(b, 'lax $.**.src ? (@ != null)')
     and not jsonb_path_exists(b, 'lax $.**.href ? (@ != null)')
     and not jsonb_path_exists(b, 'lax $.**.srcset ? (@ != null)')
     and not jsonb_path_exists(b, 'lax $.**.url ? (@ != null)')
     and not jsonb_path_exists(b, 'lax $.**.poster ? (@ != null)')
     and not jsonb_path_exists(b, 'lax $.**.background ? (@ != null && !(@.type() == "string" && @ like_regex "^#[0-9a-f]{6}$"))')
     and b::text !~* '\murl\s*\('
     and b::text !~* '(https?:)?//'
$$;
revoke all on function private.blueprint_is_bare(jsonb) from public, anon, authenticated;

create table public.inbox_blueprints (
  inbox_message_id uuid not null references public.inbox_messages(id),
  version integer not null check (version = 1),
  state text not null check (state in ('ready', 'failed')),
  blueprint jsonb check (blueprint is null or (jsonb_typeof(blueprint) = 'object'
    and length(blueprint::text) <= 600000 and private.blueprint_is_bare(blueprint))),
  failure text check (failure ~ '^[a-z0-9_]{1,60}$'),
  sections integer check (sections between 1 and 40),
  -- Sections that cannot be copied (a countdown timer, a video, a form).
  unsupported integer check (unsupported between 0 and 40),
  measured_at timestamptz not null default now(),
  primary key (inbox_message_id, version),
  check ((state = 'ready') = (blueprint is not null and sections is not null and unsupported is not null and failure is null)),
  check ((state = 'failed') = (failure is not null and blueprint is null))
);

alter table public.inbox_blueprints enable row level security;
create policy operator_read on public.inbox_blueprints for select to authenticated using (private.is_operator());
revoke all on public.inbox_blueprints from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.inbox_blueprints from authenticated, service_role;
grant select on public.inbox_blueprints to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.inbox_blueprints from public, anon, authenticated, service_role';
  end if;
end $$;

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview','inbox.blueprint'));

-- Whether an email is one the rule above measures.
create or replace function private.blueprint_wanted(message uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inbox_messages m
                 where m.id = message and m.marked_html_path is not null and m.screenshot_at is not null)
     and exists (select 1 from public.competitor_emails e where e.inbox_message_id = message)
$$;
revoke all on function private.blueprint_wanted(uuid) from public, anon, authenticated;

-- Queues an email's blueprint once per version (a measured or failed one
-- is never measured again). True when it is queued or being measured now.
create or replace function private.queue_inbox_blueprint(message uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.inbox_blueprints b where b.inbox_message_id = message and b.version = 1)
     or not private.blueprint_wanted(message) then
    return false;
  end if;
  insert into public.platform_jobs(kind, subject_key, idempotency_key)
    values ('inbox.blueprint', message::text, 'inbox.blueprint:' || message || ':v1')
    on conflict do nothing;
  return exists (select 1 from public.platform_jobs p where p.kind = 'inbox.blueprint' and p.subject_key = message::text
    and p.status in ('queued', 'leased', 'retry_wait'));
end $$;
revoke all on function private.queue_inbox_blueprint(uuid) from public, anon, authenticated;

-- An email photographed, or assigned to a brand after it was, is queued.
create or replace function private.queue_inbox_blueprint_on_screenshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_inbox_blueprint(new.id);
  return null;
end $$;
revoke all on function private.queue_inbox_blueprint_on_screenshot() from public, anon, authenticated;
create trigger queue_inbox_blueprint after update of screenshot_at on public.inbox_messages
  for each row when (new.screenshot_at is not null and new.marked_html_path is not null)
  execute function private.queue_inbox_blueprint_on_screenshot();

create or replace function private.queue_inbox_blueprint_on_assign()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_inbox_blueprint(new.inbox_message_id);
  return null;
end $$;
revoke all on function private.queue_inbox_blueprint_on_assign() from public, anon, authenticated;
create trigger queue_inbox_blueprint after insert on public.competitor_emails
  for each row when (new.inbox_message_id is not null)
  execute function private.queue_inbox_blueprint_on_assign();

-- First use: a Copy build whose inspiration email has no blueprint yet
-- asks for it (the worker, service role). Returns the blueprint's state as
-- the build reads it: ready, failed (a row with its reason, or a job that
-- failed four times in the last day), unphotographed (no screenshot, and
-- no screenshot job will take one: it can never be measured as it is),
-- waiting (queued, or its screenshot job is still to run), or none (no
-- marked copy: nothing to measure).
create or replace function public.request_inbox_blueprint(email uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare message uuid; b public.inbox_blueprints; m public.inbox_messages;
begin
  select e.inbox_message_id into message from public.competitor_emails e where e.id = email;
  if message is null then return 'none'; end if;
  select * into b from public.inbox_blueprints where inbox_message_id = message and version = 1;
  if found then return b.state; end if;
  select * into m from public.inbox_messages where id = message;
  if m.marked_html_path is null then return 'none'; end if;
  -- A job that failed four times is final for a day; asked again after
  -- that, it starts over once more (a measuring problem is never tried
  -- every minute).
  if exists (select 1 from public.platform_jobs p where p.kind = 'inbox.blueprint' and p.subject_key = message::text
             and p.status = 'failed' and p.finished_at > now() - interval '1 day') then
    return 'failed';
  end if;
  update public.platform_jobs set idempotency_key = idempotency_key || ':' || id, updated_at = now()
    where kind = 'inbox.blueprint' and subject_key = message::text and status = 'failed'
      and idempotency_key = 'inbox.blueprint:' || message || ':v1';
  if private.queue_inbox_blueprint(message) then return 'waiting'; end if;
  if m.screenshot_at is not null then return 'none'; end if;
  -- Not photographed yet: the screenshot queues it, if a screenshot job is
  -- still to run; one that failed for good never will.
  if exists (select 1 from public.platform_jobs p where p.kind = 'inbox.screenshot'
             and p.subject_key = message::text and p.status in ('queued', 'leased', 'retry_wait')) then
    return 'waiting';
  end if;
  return 'unphotographed';
end $$;
revoke all on function public.request_inbox_blueprint(uuid) from public, anon, authenticated;
grant execute on function public.request_inbox_blueprint(uuid) to service_role;

-- The browser job's result: the measured blueprint (already checked by
-- the app against the blueprint schema, pictures and links dropped) or a
-- reason it can never be measured. Once per email and version: a retry
-- records nothing twice. Finishes the job.
create or replace function public.record_inbox_blueprint(job uuid, lease uuid, blueprint jsonb default null,
  failure text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; n integer; odd integer;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.blueprint' then raise exception 'Not a blueprint job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  if (blueprint is null) = (failure is null) then
    raise exception 'Give a blueprint or a failure' using errcode = '23514';
  end if;
  if failure is not null and failure !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  if blueprint is not null then
    if jsonb_typeof(blueprint) <> 'object' or length(blueprint::text) > 600000
       or (blueprint->>'version') is distinct from '1'
       or jsonb_typeof(blueprint->'sections') is distinct from 'array'
       or jsonb_array_length(blueprint->'sections') not between 1 and 40 then
      raise exception 'Invalid blueprint' using errcode = '23514';
    end if;
    -- Never a picture address or a link from the inbox (rule 8).
    if not private.blueprint_is_bare(blueprint) then
      raise exception 'A stored blueprint keeps no picture or link' using errcode = '23514';
    end if;
    n := jsonb_array_length(blueprint->'sections');
    select count(*) into odd from jsonb_array_elements(blueprint->'sections') s
      where jsonb_typeof(s->'unsupported') = 'string';
  end if;
  perform 1 from public.inbox_messages where id = message for update;
  insert into public.inbox_blueprints(inbox_message_id, version, state, blueprint, failure, sections, unsupported)
    values (message, 1, case when blueprint is null then 'failed' else 'ready' end, blueprint,
      record_inbox_blueprint.failure, n, odd)
    on conflict (inbox_message_id, version) do nothing;
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', case when blueprint is null then 'failed' else 'ready' end,
          'sections', coalesce(n, 0)),
        finished_at = now(), updated_at = now()
    where id = j.id;
  return (select b.state from public.inbox_blueprints b where b.inbox_message_id = message and b.version = 1);
end $$;
revoke all on function public.record_inbox_blueprint(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_inbox_blueprint(uuid, uuid, jsonb, text) to service_role;

-- A job handed back without counting a try: the browser measured it with
-- another engine version than the app runs (both catch up within minutes
-- of a merge). It waits 10 minutes; nothing is recorded.
create or replace function public.release_inbox_blueprint(job uuid, lease uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.blueprint' then raise exception 'Not a blueprint job' using errcode = '23514'; end if;
  update public.platform_jobs
    set status = 'retry_wait', lease_token = null, lease_expires_at = null,
        attempt = greatest(0, j.attempt - 1), last_error_code = 'version_skew',
        available_at = now() + interval '10 minutes', updated_at = now()
    where id = j.id;
end $$;
revoke all on function public.release_inbox_blueprint(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_inbox_blueprint(uuid, uuid) to service_role;

-- Emails already photographed: their blueprints are measured over the next
-- runs (20 every half hour), newest first.
insert into public.platform_jobs(kind, subject_key, idempotency_key, available_at)
  select 'inbox.blueprint', m.id::text, 'inbox.blueprint:' || m.id || ':v1',
    now() + ((row_number() over (order by m.received_at desc, m.id) - 1) / 20) * interval '30 minutes'
  from public.inbox_messages m
  where m.received_at > now() - interval '120 days'
    and private.blueprint_wanted(m.id)
  on conflict do nothing;
