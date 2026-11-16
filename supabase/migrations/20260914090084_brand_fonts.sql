-- FONT-SITE part b (owner pick #3, ledger row FONT-b): the brand's web
-- fonts, as the Site reader found them on its own pages and the
-- stylesheets they link (a live read only): at most 8 families, heading
-- fonts first, then body fonts, each with its roles, who serves it and at
-- most 12 files. One row per workspace, from the newest live read of its
-- website: a read replaces the whole list (even with none). The members
-- read it; only the Site reader's job writes it (record_site_fonts, under
-- its lease, before it stores its findings).

-- Whether a list of fonts has the shape the Site reader keeps (`SiteFont`
-- in features/onboarding/site/fonts.ts), within its limits.
create or replace function private.site_fonts_ok(fonts jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare f jsonb; x jsonb; names text[] := '{}'; urls text[];
begin
  if jsonb_typeof(fonts) is distinct from 'array' then return false; end if;
  if jsonb_array_length(fonts) > 8 or octet_length(fonts::text) > 300000 then return false; end if;
  for f in select value from jsonb_array_elements(fonts) loop
    if jsonb_typeof(f) <> 'object' then return false; end if;
    if f - 'family' - 'roles' - 'kind' - 'files' <> '{}'::jsonb
      or jsonb_typeof(f->'family') is distinct from 'string'
      or jsonb_typeof(f->'kind') is distinct from 'string'
      or jsonb_typeof(f->'roles') is distinct from 'array'
      or jsonb_typeof(f->'files') is distinct from 'array' then return false; end if;
    -- The design studio's own rule for a name, each family once.
    if (f->>'family') !~ '^[A-Za-z0-9][A-Za-z0-9 -]{0,59}$' or lower(f->>'family') = any(names)
      or (f->>'kind') not in ('google','adobe','self-hosted','system','unknown')
      or not (f->'roles') <@ '["heading","body"]'::jsonb
      or jsonb_array_length(f->'roles') <> (select count(distinct r) from jsonb_array_elements(f->'roles') r)
      or jsonb_array_length(f->'files') > 12 then return false; end if;
    names := names || lower(f->>'family');
    urls := '{}';
    for x in select value from jsonb_array_elements(f->'files') loop
      if jsonb_typeof(x) <> 'object' then return false; end if;
      if x - 'url' - 'format' - 'weight' - 'maxWeight' - 'italic' - 'unicodeRange' <> '{}'::jsonb
        or jsonb_typeof(x->'url') is distinct from 'string'
        or jsonb_typeof(x->'format') is distinct from 'string'
        or jsonb_typeof(x->'weight') is distinct from 'number'
        or jsonb_typeof(x->'italic') is distinct from 'boolean'
        or coalesce(jsonb_typeof(x->'unicodeRange') not in ('string','null'), true)
        or (x ? 'maxWeight' and jsonb_typeof(x->'maxWeight') is distinct from 'number') then return false; end if;
      -- An https file on the standard port, of a type a browser loads, a
      -- weight from 100 to 900 (a variable font's up to its maxWeight), and
      -- its characters as the reader writes a range.
      if length(x->>'url') > 1000 or private.https_host(x->>'url') is null or (x->>'url') = any(urls)
        or (x->>'format') not in ('woff2','woff','truetype','opentype')
        or (x->>'weight')::numeric not between 100 and 900 or (x->>'weight')::numeric % 1 <> 0
        or (x ? 'maxWeight' and ((x->>'maxWeight')::numeric % 1 <> 0
          or (x->>'maxWeight')::numeric <= (x->>'weight')::numeric or (x->>'maxWeight')::numeric > 900))
        or length(x->>'unicodeRange') not between 1 and 1000
        or (x->>'unicodeRange') !~ '^U\+[0-9A-F]{4,6}(-[0-9A-F]{4,6})?(, U\+[0-9A-F]{4,6}(-[0-9A-F]{4,6})?)*$' then
        return false;
      end if;
      urls := urls || (x->>'url');
    end loop;
  end loop;
  return true;
end $$;
revoke all on function private.site_fonts_ok(jsonb) from public, anon, authenticated;

create table public.brand_fonts (
  tenant_id uuid primary key references public.tenants(id),
  run_id uuid not null,
  -- The site the fonts were read from.
  domain text not null check (coalesce(domain = private.site_domain(domain), false)),
  fonts jsonb not null check (private.site_fonts_ok(fonts)),
  read_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);

alter table public.brand_fonts enable row level security;
create policy member_read on public.brand_fonts for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.brand_fonts from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_fonts from authenticated;
grant select on public.brand_fonts to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_fonts from authenticated';
  end if;
end $$;

-- Keeps the fonts one live site read found, replacing the workspace's
-- earlier list (even with none), unless a newer read of the site already
-- kept its own (then false, nothing changed). The lease locks the
-- workspace first, then the job. A list the table would refuse is refused
-- whole, and the earlier list stays.
create or replace function public.record_site_fonts(job uuid, lease uuid, fonts jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; d text;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null then raise exception 'Invalid site reading' using errcode = '23514'; end if;
  if not coalesce(private.site_fonts_ok(fonts), false) then raise exception 'Invalid fonts' using errcode = '23514'; end if;
  if exists (select 1 from public.brand_fonts b join public.job_runs r on r.tenant_id = b.tenant_id and r.id = b.run_id
      where b.tenant_id = j.tenant_id and r.created_at > j.created_at) then
    return false;
  end if;
  insert into public.brand_fonts(tenant_id, run_id, domain, fonts)
    values (j.tenant_id, j.id, d, fonts)
    on conflict (tenant_id) do update
      set run_id = excluded.run_id, domain = excluded.domain, fonts = excluded.fonts, read_at = now();
  return true;
end $$;

revoke all on function public.record_site_fonts(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_site_fonts(uuid, uuid, jsonb) to service_role;
