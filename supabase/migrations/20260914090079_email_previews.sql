-- DST-005b part 2a (D25, AGENT_MAP §4 pick 92): a whole built email drawn
-- in the inbox's views, by the browser outside the app.
--
-- The section browser (scripts/section-render.mjs, `renderEmail`) also
-- draws a whole email: `desktop` (600 px wide), `phone` (375 px wide, as a
-- phone) and `dark` (600 px, dark mode as the email declares it). The
-- build's design step asks for a view of the email it drew
-- (`request_email_render`, under the build's own lease, on its design
-- step, as a section), so the Design critic can judge the whole email
-- (DST-006d) and its height be checked (DST-007) before it is stored. An
-- `studio.preview` job hands the email's page to the browser (a scheduled
-- GitHub Actions job): it loads only the email's own origins, uploads the
-- JPEG through a signed link into the private `studio-renders` bucket
-- (email/<render id>.jpg), and `record_email_render` records it, only
-- when the stored picture is there and is the size reported. An email
-- taller than 6,000 px is drawn cut there, and says so (`cut`).
--
-- Failures are a section's: one the browser refuses, too large or that
-- tries to leave the page fails at once; a timeout or a browser failure is
-- tried again (the platform jobs' 4 attempts), then fails. A job that fails
-- for good, also by a lease that ran out, fails its render. The design
-- studio's claim waits for these as for its sections.
--
-- Nothing asks for a view yet: the design step does once DST-006d is on,
-- and only with the design studio on (DESIGN_STUDIO), so this is inert with
-- every switch off. Workspace members see their own builds' views and
-- pictures; platform admins see everything. Only jobs (service role)
-- write, through these commands. The number is chosen at merge time (D24).

create table public.email_renders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  build_id uuid not null,
  -- The caller's key for this version of the email, e.g. "e-r1-ab12cd34".
  render_key text not null check (render_key ~ '^[a-z0-9-]{1,40}$'),
  view text not null check (view in ('desktop', 'phone', 'dark')),
  -- The whole page the browser draws: the email as the preview shows it
  -- (Klaviyo's tags as placeholders), at most a built email's size.
  document text not null check (octet_length(document) between 1 and 200000),
  -- The https origins it may load from (its pictures' and fonts'); an
  -- email with no outside picture has none.
  origins text[] not null check (cardinality(origins) between 0 and 8),
  state text not null default 'queued' check (state in ('queued', 'drawn', 'failed')),
  failure text check (failure in ('refused', 'too_large', 'navigated', 'timeout', 'failed', 'upload_failed')),
  path text check (path ~ '^email/[0-9a-f-]{36}\.jpg$'),
  -- CSS px at the view's width (one picture pixel each).
  height integer check (height between 1 and 6000),
  -- Taller than 6,000 px: drawn cut at 6,000.
  cut boolean,
  bytes integer check (bytes between 1 and 3145728),
  -- The stored picture's tag when it was recorded (a later upload to the
  -- same path changes it).
  etag text check (length(etag) between 1 and 200),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (build_id, render_key, view),
  -- A view is its build's, in the build's workspace, and goes with it.
  foreign key (tenant_id, build_id) references public.email_builds (tenant_id, id) on delete cascade,
  check ((state = 'drawn') = (path is not null and height is not null and cut is not null
    and bytes is not null and etag is not null)),
  check ((state = 'failed') = (failure is not null)),
  check (path is null or path = 'email/' || id || '.jpg'),
  check (cut is not true or height = 6000)
);
create index email_renders_tenant on public.email_renders (tenant_id);
create index email_renders_path on public.email_renders (path) where path is not null;

alter table public.email_renders enable row level security;
create policy email_renders_member_read on public.email_renders for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.email_renders from public, anon, authenticated;
grant select on public.email_renders to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.email_renders from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_renders from public, anon, authenticated, service_role';
  end if;
end $$;

-- The pictures go in the studio's bucket (private JPEGs of at most 3 MiB).
create or replace function private.email_render_access(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_operator()
    or exists (select 1 from public.email_renders r
      where r.path = object_name and private.is_active_member(r.tenant_id))
$$;
revoke all on function private.email_render_access(text) from public, anon;
grant execute on function private.email_render_access(text) to authenticated;
create policy email_render_read on storage.objects for select to authenticated
  using (bucket_id = 'studio-renders' and private.email_render_access(name));

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview'));

-- The build's design step asks for a view of the email it drew. The same
-- key, view and page again is the same render (a retried claim asks
-- nothing twice); the same key and view with another page is PT409.
create or replace function public.request_email_render(build uuid, lease uuid, render_key text, email_view text,
  document text, origins text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.email_builds;
  t uuid;
  r public.email_renders;
begin
  -- Tenant first, then the build (as every build-leased command).
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  b := private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step draws the email' using errcode = 'PT409';
  end if;
  if render_key is null or render_key !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'A render has no usable key' using errcode = '22023';
  end if;
  if email_view is null or email_view not in ('desktop', 'phone', 'dark') then
    raise exception 'An email is drawn as desktop, phone or dark' using errcode = '22023';
  end if;
  if document is null or octet_length(document) not between 1 and 200000 then
    raise exception 'A render needs the email''s page' using errcode = '22023';
  end if;
  -- A hostname (its last label not a number: no IP address), no port.
  if origins is null or cardinality(origins) > 8 or exists (
       select 1 from unnest(origins) o
       where o is null or length(o) > 261
         or o !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
         or o ~ '\.[0-9]+$') then
    raise exception 'A render loads from https origins only' using errcode = '22023';
  end if;
  select * into r from public.email_renders s
    where s.build_id = b.id and s.render_key = request_email_render.render_key and s.view = email_view;
  if found then
    if r.document is distinct from request_email_render.document
       or r.origins is distinct from request_email_render.origins then
      raise exception 'This key is another email''s' using errcode = 'PT409';
    end if;
    return r.id;
  end if;
  -- Three views of up to three versions of the email.
  if (select count(*) from public.email_renders where build_id = b.id) >= 9 then
    raise exception 'This build drew the email too often' using errcode = '22023', detail = 'too_many_previews';
  end if;
  insert into public.email_renders (tenant_id, build_id, render_key, view, document, origins)
    values (b.tenant_id, b.id, request_email_render.render_key, email_view, request_email_render.document,
            request_email_render.origins)
    returning * into r;
  insert into public.platform_jobs (kind, subject_key, idempotency_key)
    values ('studio.preview', r.id::text, 'studio.preview:' || r.id)
    on conflict do nothing;
  return r.id;
end $$;

-- The leased preview job's render, locked; a render already finished is PT409.
create or replace function private.leased_email_render(job uuid, lease uuid)
returns public.email_renders language plpgsql security definer set search_path = '' as $$
declare
  j public.platform_jobs;
  r public.email_renders;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'studio.preview' then
    raise exception 'This job draws no email' using errcode = '23514';
  end if;
  select * into r from public.email_renders where id = j.subject_key::uuid for update;
  if not found or r.state <> 'queued' then
    raise exception 'This render is finished' using errcode = 'PT409';
  end if;
  return r;
end $$;

-- The browser drew the email and stored its picture. A report that does
-- not match (a height out of range, cut below the limit, no stored
-- picture, another size or type than stored) is 23514: the caller fails
-- the render.
create or replace function public.record_email_render(job uuid, lease uuid, height integer, cut boolean, bytes integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.email_renders;
  m jsonb;
begin
  r := private.leased_email_render(job, lease);
  if height is null or height not between 1 and 6000 or cut is null or (cut and height <> 6000) then
    raise exception 'The picture is not the email''s size' using errcode = '23514';
  end if;
  if bytes is null or bytes not between 1 and 3145728 then
    raise exception 'The picture is not a usable size' using errcode = '23514';
  end if;
  select o.metadata into m from storage.objects o
    where o.bucket_id = 'studio-renders' and o.name = 'email/' || r.id || '.jpg';
  if not found then
    raise exception 'Stored picture missing' using errcode = '23514';
  end if;
  if coalesce(m->>'size', '') <> bytes::text or coalesce(m->>'mimetype', '') <> 'image/jpeg'
     or coalesce(length(m->>'eTag'), 0) not between 1 and 200 then
    raise exception 'The stored picture is not the one reported' using errcode = '23514';
  end if;
  update public.email_renders
    set state = 'drawn', path = 'email/' || r.id || '.jpg', height = record_email_render.height,
        cut = record_email_render.cut, bytes = record_email_render.bytes, etag = m->>'eTag', finished_at = now()
    where id = r.id;
  perform public.finish_platform_job(job, lease, jsonb_build_object('height', height, 'cut', cut));
end $$;

-- The browser could not draw it: as a section's failure.
create or replace function public.fail_email_render(job uuid, lease uuid, failure text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.email_renders;
  j public.platform_jobs;
  final boolean;
begin
  if failure is null or failure not in ('refused', 'too_large', 'navigated', 'timeout', 'failed', 'upload_failed') then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  r := private.leased_email_render(job, lease);
  select * into j from public.platform_jobs where id = job;
  final := failure in ('refused', 'too_large', 'navigated') or j.attempt >= 4;
  if final then
    update public.email_renders set state = 'failed', failure = fail_email_render.failure, finished_at = now()
      where id = r.id;
  end if;
  if failure in ('refused', 'too_large', 'navigated') then
    perform public.finish_platform_job(job, lease, jsonb_build_object('failure', failure));
  else
    perform public.fail_platform_job(job, lease,
      case when failure = 'timeout' then 'timeout' else 'unavailable' end, 'preview_' || failure);
  end if;
end $$;

-- A preview job that fails for good fails its render, so the build never
-- waits on a dead one.
create or replace function private.fail_dead_preview()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.email_renders
    set state = 'failed', failure = 'timeout', finished_at = now()
    where id = new.subject_key::uuid and state = 'queued';
  return new;
end $$;
revoke all on function private.fail_dead_preview() from public, anon, authenticated, service_role;
create trigger studio_preview_failed after update of status on public.platform_jobs
  for each row when (new.kind = 'studio.preview' and new.status = 'failed' and old.status is distinct from 'failed')
  execute function private.fail_dead_preview();

revoke all on function public.request_email_render(uuid, uuid, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.record_email_render(uuid, uuid, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.fail_email_render(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.leased_email_render(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_email_render(uuid, uuid, text, text, text, text[]) to service_role;
grant execute on function public.record_email_render(uuid, uuid, integer, boolean, integer) to service_role;
grant execute on function public.fail_email_render(uuid, uuid, text) to service_role;

-- The design studio's claim (DST-006b) waits for the email's views as for
-- its sections: a design step is taken again once every picture and view
-- it asked for is drawn or failed, or its time is up. Otherwise as before.
create or replace function public.claim_studio_build(target uuid default null)
returns table (id uuid, tenant_id uuid, state text, step text, progress jsonb, run_id uuid, slot integer,
  planned jsonb, email jsonb, push_key uuid, timezone text, start_on date, lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  lease uuid := gen_random_uuid();
  passed boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  loop
    select * into b from public.email_builds e
      where e.state = 'build_queued' and e.step = 'design'
        -- Waiting for its pictures (DST-006b).
        and e.waits > 0 and e.not_before is not null and e.error_code is null
        and (e.lease_until is null or e.lease_until < now())
        -- A failed step waits a minute before its next try.
        and (e.attempts = 0 or e.updated_at < now() - interval '1 minute')
        -- Every picture and view it asked for is drawn or failed, or its time is up.
        and (e.not_before <= now() or (
          not exists (select 1 from public.section_renders r where r.build_id = e.id and r.state = 'queued')
          and not exists (select 1 from public.email_renders v where v.build_id = e.id and v.state = 'queued')))
        and exists (select 1 from public.tenants w where w.id = e.tenant_id and w.status = 'active')
        and (target is null or e.id = target)
      order by e.updated_at, e.id
      limit 1
      for update skip locked;
    if not found then return; end if;
    -- As `claim_email_build`: a planned day that has passed (store time)
    -- needs no draft any more, and a step out of tries is not tried again.
    begin
      select (s.plan->'slots'->b.slot->>'date')::date < (now() at time zone coalesce(w.timezone, 'UTC'))::date
        into passed
        from public.strategy_runs s, public.tenants w
        where s.id = b.run_id and w.id = b.tenant_id;
    exception when others then
      passed := true;
    end;
    passed := coalesce(passed, true);
    exit when b.attempts < 3 and not passed;
    update public.email_builds e
      set state = 'failed', error_code = case when passed then 'day_passed' else 'step_timed_out' end,
          lease_token = null, lease_until = null, updated_at = now()
      where e.id = b.id;
  end loop;
  update public.email_builds e
    set attempts = e.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where e.id = b.id;
  return query
    select b.id, b.tenant_id, b.state, b.step, b.progress, b.run_id, b.slot, s.plan->'slots'->b.slot,
      b.email, b.push_key, coalesce(w.timezone, 'UTC'), s.start_on, lease
    from public.strategy_runs s, public.tenants w
    where s.id = b.run_id and w.id = b.tenant_id;
end $$;

revoke all on function public.claim_studio_build(uuid) from public, anon, authenticated;
grant execute on function public.claim_studio_build(uuid) to service_role;
