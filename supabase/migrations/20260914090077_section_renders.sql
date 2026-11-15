-- DST-001b (D25, AGENT_MAP §4 layer 3 step 4): a designed section drawn to
-- a picture by a browser outside the app.
--
-- A server function cannot run a browser, so the email build's design step
-- asks for each designed section to be drawn (`request_section_render`,
-- under the build's own lease, on its design step) and goes on when the
-- pictures are there (DST-006). A `studio.render` job hands the section to
-- a browser that runs outside the app (a scheduled GitHub Actions job, as
-- the inbox screenshots, INB-002): it draws the section at 1,200 px wide,
-- loading only the section's own origins, and uploads the JPEG through a
-- signed link into the private `studio-renders` bucket
-- (render/<render id>.jpg). `record_section_render` then records it, only
-- when the stored picture is there and is the section's size.
--
-- A section the browser refuses, or that is too large or tries to leave
-- the page, fails at once; a timeout or a browser failure is tried again
-- (the platform jobs' 4 attempts), then fails. A failed render is drawn as
-- its coded block by the build (DST-006). A job that fails for good,
-- also by the next claim's lease recovery, fails its render.
--
-- Workspace members see their own builds' renders and pictures; platform
-- admins see everything. Only jobs (service role) write, through these
-- commands. The number is chosen at merge time (D24).

create table public.section_renders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  build_id uuid not null,
  -- The caller's key for this section and design, e.g. "s2-r1-ab12cd34".
  section_key text not null check (section_key ~ '^[a-z0-9-]{1,40}$'),
  -- The section as code checked it (DST-001a's format).
  section jsonb not null check (jsonb_typeof(section) = 'object' and octet_length(section::text) <= 100000),
  -- The https origins it may load from (its photo's and fonts').
  origins text[] not null check (cardinality(origins) between 1 and 8),
  state text not null default 'queued' check (state in ('queued', 'drawn', 'failed')),
  failure text check (failure in ('refused', 'too_large', 'navigated', 'timeout', 'failed', 'upload_failed')),
  path text check (path ~ '^render/[0-9a-f-]{36}\.jpg$'),
  height integer check (height between 80 and 3200),
  bytes integer check (bytes between 1 and 3145728),
  -- The stored picture's tag when it was recorded: a later upload to the
  -- same path changes it, so a picture swapped after drawing is caught.
  etag text check (length(etag) between 1 and 200),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (build_id, section_key),
  -- A render is its build's, in the build's workspace, and goes with it.
  foreign key (tenant_id, build_id) references public.email_builds (tenant_id, id) on delete cascade,
  check ((state = 'drawn') = (path is not null and height is not null and bytes is not null and etag is not null)),
  check ((state = 'failed') = (failure is not null)),
  check (path is null or path = 'render/' || id || '.jpg')
);
create index section_renders_tenant on public.section_renders (tenant_id);
create index section_renders_path on public.section_renders (path) where path is not null;

alter table public.section_renders enable row level security;
create policy section_renders_member_read on public.section_renders for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.section_renders from public, anon, authenticated;
grant select on public.section_renders to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.section_renders from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.section_renders from public, anon, authenticated, service_role';
  end if;
end $$;

-- A designed section's picture is at most 3 MiB (the renderer's limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('studio-renders', 'studio-renders', false, 3145728, array['image/jpeg'])
  on conflict (id) do nothing;

create or replace function private.section_render_access(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_operator()
    or exists (select 1 from public.section_renders r
      where r.path = object_name and private.is_active_member(r.tenant_id))
$$;
revoke all on function private.section_render_access(text) from public, anon;
grant execute on function private.section_render_access(text) to authenticated;
create policy section_render_read on storage.objects for select to authenticated
  using (bucket_id = 'studio-renders' and private.section_render_access(name));

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant','studio.render'));

-- The build's design step asks for a section to be drawn. The same key
-- and the same section again is the same render (a retried claim asks
-- nothing twice); the same key with another section is PT409.
create or replace function public.request_section_render(build uuid, lease uuid, section_key text, section jsonb, origins text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.email_builds;
  t uuid;
  r public.section_renders;
begin
  -- Tenant first, then the build (as every build-leased command).
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  b := private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step draws sections' using errcode = 'PT409';
  end if;
  if section_key is null or section_key !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'A render has no usable key' using errcode = '22023';
  end if;
  if section is null or jsonb_typeof(section) <> 'object' or octet_length(section::text) > 100000
     or coalesce(jsonb_typeof(section->'height'), '') <> 'number'
     or (section->>'height')::numeric not between 40 and 1600
     or (section->>'height')::numeric <> floor((section->>'height')::numeric) then
    raise exception 'A render needs a section of a usable size' using errcode = '22023';
  end if;
  -- A hostname (its last label not a number: no IP address), no port.
  if origins is null or cardinality(origins) not between 1 and 8 or exists (
       select 1 from unnest(origins) o
       where o is null or length(o) > 261
         or o !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
         or o ~ '\.[0-9]+$') then
    raise exception 'A render loads from https origins only' using errcode = '22023';
  end if;
  select * into r from public.section_renders s
    where s.build_id = b.id and s.section_key = request_section_render.section_key;
  if found then
    if r.section is distinct from request_section_render.section or r.origins is distinct from request_section_render.origins then
      raise exception 'This key is another section''s' using errcode = 'PT409';
    end if;
    return r.id;
  end if;
  if (select count(*) from public.section_renders where build_id = b.id) >= 12 then
    raise exception 'This build drew too many sections' using errcode = '22023', detail = 'too_many_renders';
  end if;
  insert into public.section_renders (tenant_id, build_id, section_key, section, origins)
    values (b.tenant_id, b.id, request_section_render.section_key, request_section_render.section, request_section_render.origins)
    returning * into r;
  insert into public.platform_jobs (kind, subject_key, idempotency_key)
    values ('studio.render', r.id::text, 'studio.render:' || r.id)
    on conflict do nothing;
  return r.id;
end $$;

-- The leased render job's render, locked; a render already finished is PT409.
create or replace function private.leased_section_render(job uuid, lease uuid)
returns public.section_renders language plpgsql security definer set search_path = '' as $$
declare
  j public.platform_jobs;
  r public.section_renders;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'studio.render' then
    raise exception 'This job draws no section' using errcode = '23514';
  end if;
  select * into r from public.section_renders where id = j.subject_key::uuid for update;
  if not found or r.state <> 'queued' then
    raise exception 'This render is finished' using errcode = 'PT409';
  end if;
  return r;
end $$;

-- The browser drew the section and stored its picture. A report that
-- does not match (another height, no stored picture, another size or
-- type than stored) is 23514: the caller fails the render.
create or replace function public.record_section_render(job uuid, lease uuid, height integer, bytes integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.section_renders;
  m jsonb;
begin
  r := private.leased_section_render(job, lease);
  if height is null or height <> 2 * (r.section->>'height')::integer then
    raise exception 'The picture is not the section''s size' using errcode = '23514';
  end if;
  if bytes is null or bytes not between 1 and 3145728 then
    raise exception 'The picture is not a usable size' using errcode = '23514';
  end if;
  select o.metadata into m from storage.objects o
    where o.bucket_id = 'studio-renders' and o.name = 'render/' || r.id || '.jpg';
  if not found then
    raise exception 'Stored picture missing' using errcode = '23514';
  end if;
  if coalesce(m->>'size', '') <> bytes::text or coalesce(m->>'mimetype', '') <> 'image/jpeg'
     or coalesce(length(m->>'eTag'), 0) not between 1 and 200 then
    raise exception 'The stored picture is not the one reported' using errcode = '23514';
  end if;
  update public.section_renders
    set state = 'drawn', path = 'render/' || r.id || '.jpg', height = record_section_render.height,
        bytes = record_section_render.bytes, etag = m->>'eTag', finished_at = now()
    where id = r.id;
  perform public.finish_platform_job(job, lease, jsonb_build_object('height', height));
end $$;

-- The browser could not draw it. A section it refuses, too large or that
-- tries to leave the page fails at once; a timeout or a browser or upload
-- failure is tried again, then fails with the job's last attempt.
create or replace function public.fail_section_render(job uuid, lease uuid, failure text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.section_renders;
  j public.platform_jobs;
  final boolean;
begin
  if failure is null or failure not in ('refused', 'too_large', 'navigated', 'timeout', 'failed', 'upload_failed') then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  r := private.leased_section_render(job, lease);
  select * into j from public.platform_jobs where id = job;
  final := failure in ('refused', 'too_large', 'navigated') or j.attempt >= 4;
  if final then
    update public.section_renders set state = 'failed', failure = fail_section_render.failure, finished_at = now()
      where id = r.id;
  end if;
  if failure in ('refused', 'too_large', 'navigated') then
    perform public.finish_platform_job(job, lease, jsonb_build_object('failure', failure));
  else
    perform public.fail_platform_job(job, lease,
      case when failure = 'timeout' then 'timeout' else 'unavailable' end, 'render_' || failure);
  end if;
end $$;

-- A render job that fails for good (its last attempt, or a lease that ran
-- out on it) fails its render, so the build never waits on a dead one.
create or replace function private.fail_dead_render()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.section_renders
    set state = 'failed', failure = 'timeout', finished_at = now()
    where id = new.subject_key::uuid and state = 'queued';
  return new;
end $$;
revoke all on function private.fail_dead_render() from public, anon, authenticated, service_role;
create trigger studio_render_failed after update of status on public.platform_jobs
  for each row when (new.kind = 'studio.render' and new.status = 'failed' and old.status is distinct from 'failed')
  execute function private.fail_dead_render();

revoke all on function public.request_section_render(uuid, uuid, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.record_section_render(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.fail_section_render(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.leased_section_render(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_section_render(uuid, uuid, text, jsonb, text[]) to service_role;
grant execute on function public.record_section_render(uuid, uuid, integer, integer) to service_role;
grant execute on function public.fail_section_render(uuid, uuid, text) to service_role;
