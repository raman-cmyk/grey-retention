-- ONB-059b: the photo library's site photos (owner pick #59). The product
-- and lifestyle photos the Site reader found on the brand's own pages (a
-- live read only), each with its description, the page it was on and
-- where on the page. One set per workspace, from the newest live read of
-- its website: a read replaces the whole set. The members read them; only
-- the Site reader's job writes them (record_site_photos, under its lease,
-- before it stores its findings). The catalog's own pictures are read
-- from the products table, not copied here.

create table public.brand_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  run_id uuid not null,
  url text not null check (length(url) <= 1000 and private.https_host(url) is not null),
  kind text not null check (kind in ('product','lifestyle')),
  page text not null check (page in ('home','product','about','shipping','returns','faq')),
  alt text check (alt is null or length(alt) between 1 and 200),
  source text not null check (source in ('schema','share','page')),
  position integer not null check (position between 0 and 199),
  created_at timestamptz not null default now(),
  unique (tenant_id, url),
  unique (tenant_id, position),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);

-- Which read kept the workspace's set, and from which website: an empty
-- set is still a set (a later, older read cannot replace it), and photos
-- of a website the owner since changed are not his.
create table public.brand_photo_sets (
  tenant_id uuid primary key references public.tenants(id),
  run_id uuid not null,
  domain text not null check (coalesce(domain = private.site_domain(domain), false)),
  kept_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);

do $$ declare t text; begin
  foreach t in array array['brand_photos', 'brand_photo_sets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy member_read on public.%I for select to authenticated using (private.is_active_member(tenant_id))', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if current_setting('server_version_num')::integer >= 170000 then
      execute format('revoke maintain on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- Keeps the photos one live site read found, replacing the workspace's
-- earlier set (even with none), unless a newer read of the site already
-- kept its own (then false, nothing changed). At most 200, each checked as the table
-- checks it; a set with one bad photo is refused whole.
create or replace function public.record_site_photos(job uuid, lease uuid, photos jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; d text;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null then raise exception 'Invalid site reading' using errcode = '23514'; end if;
  if jsonb_typeof(photos) is distinct from 'array' or jsonb_array_length(photos) > 200
    or exists (select 1 from jsonb_array_elements(photos) p
      where jsonb_typeof(p) <> 'object'
        or p - 'url' - 'kind' - 'page' - 'alt' - 'source' <> '{}'::jsonb
        or jsonb_typeof(p->'url') is distinct from 'string'
        or (p ? 'alt' and jsonb_typeof(p->'alt') not in ('string','null'))) then
    raise exception 'Invalid photos' using errcode = '23514';
  end if;
  if exists (select 1 from public.brand_photo_sets s join public.job_runs r on r.tenant_id = s.tenant_id and r.id = s.run_id
      where s.tenant_id = j.tenant_id and r.created_at > j.created_at) then
    return false;
  end if;
  begin
    delete from public.brand_photos where tenant_id = j.tenant_id;
    insert into public.brand_photos(tenant_id, run_id, url, kind, page, alt, source, position)
      select j.tenant_id, j.id, p->>'url', p->>'kind', p->>'page', nullif(p->>'alt', ''), p->>'source', (n - 1)::integer
      from jsonb_array_elements(photos) with ordinality x(p, n);
    insert into public.brand_photo_sets(tenant_id, run_id, domain) values (j.tenant_id, j.id, d)
      on conflict (tenant_id) do update set run_id = excluded.run_id, domain = excluded.domain, kept_at = now();
  exception
    -- A photo the table refuses (a bad address, kind or page, a repeat):
    -- the set is refused whole, and the earlier set stays.
    when check_violation or unique_violation or not_null_violation or program_limit_exceeded then
      raise exception 'Invalid photos' using errcode = '23514';
  end;
  return true;
end $$;

revoke all on function public.record_site_photos(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_site_photos(uuid, uuid, jsonb) to service_role;
