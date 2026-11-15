-- ONB-060b: the brand's two logos, as the Site reader found them on its own
-- home page (owner pick #60): one for light sections (dark ink) and one
-- for dark sections (light ink). One row per workspace, from the newest
-- live read of its website; the members read it, only the Site reader's
-- job writes it (record_site_logos, under its lease). A sample site keeps
-- no logo: its emails show the brand's name.

create table public.brand_logos (
  tenant_id uuid primary key references public.tenants(id),
  run_id uuid not null,
  -- The site the logos were read from.
  domain text not null check (coalesce(domain = private.site_domain(domain), false)),
  on_light text check (on_light is null or (length(on_light) <= 1000 and private.https_host(on_light) is not null)),
  on_dark text check (on_dark is null or (length(on_dark) <= 1000 and private.https_host(on_dark) is not null)),
  -- Never the same picture for both.
  check (on_light is null or on_dark is null or on_light <> on_dark),
  read_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);

alter table public.brand_logos enable row level security;
create policy member_read on public.brand_logos for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.brand_logos from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_logos from authenticated;
grant select on public.brand_logos to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_logos from authenticated';
  end if;
end $$;

-- Keeps the logos one live site read found on the home page, before the
-- read stores its findings (which ends its lease). Logos may be on another
-- host (a store's pictures often are), but only https. A newer read of
-- the site that already kept its logos wins.
create or replace function public.record_site_logos(job uuid, lease uuid, on_light text default null, on_dark text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; d text;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null
    or (on_light is not null and (length(on_light) > 1000 or private.https_host(on_light) is null))
    or (on_dark is not null and (length(on_dark) > 1000 or private.https_host(on_dark) is null))
    or on_light = on_dark then
    raise exception 'Invalid logos' using errcode = '23514';
  end if;
  if exists (select 1 from public.brand_logos b join public.job_runs r on r.tenant_id = b.tenant_id and r.id = b.run_id
      where b.tenant_id = j.tenant_id and r.created_at > j.created_at) then
    return false;
  end if;
  insert into public.brand_logos(tenant_id, run_id, domain, on_light, on_dark)
    values (j.tenant_id, j.id, d, on_light, on_dark)
    on conflict (tenant_id) do update
      set run_id = excluded.run_id, domain = excluded.domain, on_light = excluded.on_light,
          on_dark = excluded.on_dark, read_at = now();
  return true;
end $$;

revoke all on function public.record_site_logos(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_site_logos(uuid, uuid, text, text) to service_role;
