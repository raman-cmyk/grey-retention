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
-- its coded block by the build (DST-006). A job that is never answered is
-- failed by the next claim's lease recovery; the build's own deadline
-- covers its render (DST-006).
--
-- Workspace members see their own builds' renders and pictures; platform
-- admins see everything. Only jobs (service role) write, through these
-- commands. The number is chosen at merge time (D24).

create table public.section_renders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  build_id uuid not null references public.email_builds(id),
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
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (build_id, section_key),
  check ((state = 'drawn') = (path is not null and height is not null and bytes is not null)),
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
-- again is the same render (a retried claim asks nothing twice).
create or replace function public.request_section_render(build uuid, lease uuid, section_key text, section jsonb, origins text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.email_builds;
  r uuid;
begin
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
  if origins is null or cardinality(origins) not between 1 and 8 or exists (
       select 1 from unnest(origins) o
       where o is null or o !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$') then
    raise exception 'A render loads from https origins only' using errcode = '22023';
  end if;
  select id into r from public.section_renders where build_id = b.id and section_renders.section_key = request_section_render.section_key;
  if r is not null then
    return r;
  end if;
  if (select count(*) from public.section_renders where build_id = b.id) >= 12 then
    raise exception 'This build drew too many sections' using errcode = '22023', detail = 'too_many_renders';
  end if;
  insert into public.section_renders (tenant_id, build_id, section_key, section, origins)
    values (b.tenant_id, b.id, request_section_render.section_key, request_section_render.section, request_section_render.origins)
    returning id into r;
  insert into public.platform_jobs (kind, subject_key, idempotency_key)
    values ('studio.render', r::text, 'studio.render:' || r)
    on conflict do nothing;
  return r;
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

-- The browser drew the section and stored its picture.
create or replace function public.record_section_render(job uuid, lease uuid, height integer, bytes integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.section_renders;
begin
  r := private.leased_section_render(job, lease);
  if height is null or height <> 2 * (r.section->>'height')::integer then
    raise exception 'The picture is not the section''s size' using errcode = '23514';
  end if;
  if bytes is null or bytes not between 1 and 3145728 then
    raise exception 'The picture is not a usable size' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o
      where o.bucket_id = 'studio-renders' and o.name = 'render/' || r.id || '.jpg') then
    raise exception 'Stored picture missing' using errcode = 'PT409';
  end if;
  update public.section_renders
    set state = 'drawn', path = 'render/' || r.id || '.jpg', height = record_section_render.height,
        bytes = record_section_render.bytes, finished_at = now()
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

revoke all on function public.request_section_render(uuid, uuid, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.record_section_render(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.fail_section_render(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.leased_section_render(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_section_render(uuid, uuid, text, jsonb, text[]) to service_role;
grant execute on function public.record_section_render(uuid, uuid, integer, integer) to service_role;
grant execute on function public.fail_section_render(uuid, uuid, text) to service_role;
