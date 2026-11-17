-- DST-004b part 2b (AGENT_MAP §4 layer 3 step 5): the match score's
-- pictures. In Copy mode a designed section must look like the inbox
-- section it rebuilds (DST-004b1's `matchScore`, in code). The browser that
-- draws the section (DST-001c) also reads both pictures as small grey-level
-- grids, area-averaged: its own drawing, and the reference section's crop
-- from the Inspiration inbox (`inbox-assets`, `sect/<message>/<n>.jpg`,
-- the `email_sections.image_path` shape), through a short signed link the
-- app hands it with the job.
--
-- So a render now keeps the reference crop's path it was asked with (part
-- of the request: the same key with another reference is PT409), and the
-- two grids the browser reported with the picture. Both grids are optional:
-- a picture without them is drawn as before and its match is not measured
-- (the critic decides). Only jobs (service role) write, through these
-- commands; members read their own builds' renders as before. The number
-- is chosen at merge time (D24).

-- A grid as the match score reads it: width and height 1 to 256, one grey
-- level (0 to 255) per cell, row by row.
create or replace function private.usable_grid(g jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select g is null or (
    jsonb_typeof(g) = 'object'
    and octet_length(g::text) <= 600000
    and jsonb_typeof(g->'width') = 'number' and jsonb_typeof(g->'height') = 'number'
    and (g->>'width')::numeric between 1 and 256 and (g->>'height')::numeric between 1 and 256
    and (g->>'width')::numeric = floor((g->>'width')::numeric)
    and (g->>'height')::numeric = floor((g->>'height')::numeric)
    and jsonb_typeof(g->'values') = 'array'
    and jsonb_array_length(g->'values') = (g->>'width')::integer * (g->>'height')::integer
    and not exists (
      select 1 from jsonb_array_elements(g->'values') v
      where jsonb_typeof(v) <> 'number' or v::text::numeric not between 0 and 255)
    and (select count(*) from jsonb_object_keys(g)) = 3
  )
$$;
revoke all on function private.usable_grid(jsonb) from public, anon, authenticated, service_role;

alter table public.section_renders
  add column reference_path text check (reference_path ~ '^sect/[0-9a-f-]{36}/[0-9]{1,2}\.jpg$'),
  add column grid jsonb check (private.usable_grid(grid)),
  add column reference_grid jsonb check (private.usable_grid(reference_grid)),
  -- Grids only with the drawn picture; the reference's only with a reference.
  add constraint section_renders_grids check (
    (grid is null or state = 'drawn')
    and (reference_grid is null or (state = 'drawn' and reference_path is not null)));

-- The build's design step asks for a section to be drawn, now with the
-- reference crop it rebuilds (Copy mode), if any. The same key, section
-- and reference again is the same render; the same key with another
-- section or another reference is PT409.
drop function public.request_section_render(uuid, uuid, text, jsonb, text[]);
create function public.request_section_render(build uuid, lease uuid, section_key text, section jsonb, origins text[],
  reference text default null)
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
  -- Only an inbox section's own crop: never a whole email or a kept image.
  if reference is not null and reference !~ '^sect/[0-9a-f-]{36}/[0-9]{1,2}\.jpg$' then
    raise exception 'A render''s reference is an inbox section''s picture' using errcode = '22023';
  end if;
  select * into r from public.section_renders s
    where s.build_id = b.id and s.section_key = request_section_render.section_key;
  if found then
    if r.section is distinct from request_section_render.section or r.origins is distinct from request_section_render.origins
       or r.reference_path is distinct from request_section_render.reference then
      raise exception 'This key is another section''s' using errcode = 'PT409';
    end if;
    return r.id;
  end if;
  if (select count(*) from public.section_renders where build_id = b.id) >= 12 then
    raise exception 'This build drew too many sections' using errcode = '22023', detail = 'too_many_renders';
  end if;
  insert into public.section_renders (tenant_id, build_id, section_key, section, origins, reference_path)
    values (b.tenant_id, b.id, request_section_render.section_key, request_section_render.section,
      request_section_render.origins, request_section_render.reference)
    returning * into r;
  insert into public.platform_jobs (kind, subject_key, idempotency_key)
    values ('studio.render', r.id::text, 'studio.render:' || r.id)
    on conflict do nothing;
  return r.id;
end $$;

-- The browser drew the section and stored its picture, now with the two
-- grids when it could read them. A report that does not match (another
-- height, no stored picture, another size or type than stored, a grid
-- that is not one, a reference grid for a render with no reference) is
-- 23514: the caller fails the render's attempt.
drop function public.record_section_render(uuid, uuid, integer, integer);
create function public.record_section_render(job uuid, lease uuid, height integer, bytes integer,
  grid jsonb default null, reference_grid jsonb default null)
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
  if not private.usable_grid(grid) or not private.usable_grid(reference_grid)
     or (reference_grid is not null and r.reference_path is null) then
    raise exception 'The grids are not the picture''s' using errcode = '23514';
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
        bytes = record_section_render.bytes, etag = m->>'eTag', finished_at = now(),
        grid = record_section_render.grid, reference_grid = record_section_render.reference_grid
    where id = r.id;
  perform public.finish_platform_job(job, lease, jsonb_build_object('height', height));
end $$;

revoke all on function public.request_section_render(uuid, uuid, text, jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.record_section_render(uuid, uuid, integer, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.request_section_render(uuid, uuid, text, jsonb, text[], text) to service_role;
grant execute on function public.record_section_render(uuid, uuid, integer, integer, jsonb, jsonb) to service_role;
