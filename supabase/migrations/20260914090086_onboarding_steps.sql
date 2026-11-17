-- UI-ONBa: the onboarding steps' saved marks (docs/design/BRAND.md
-- StepCard: progress is saved after every step, and coming back opens the
-- step that is Now). The five steps are Store, Brand, Klaviyo, Discount and
-- Rivals. Three of them are read from records that already exist: Store is
-- a saved website (`brand_profiles.domain`), Klaviyo a connected Klaviyo
-- (`workspace_connections`), Discount a saved max discount
-- (`brand_offers`). The rest need a mark of their own, kept here, one row a
-- workspace:
--
-- * Brand: the owner confirmed what GROS found on this website. The mark
--   keeps the website it was confirmed for, so a website changed later
--   needs a new look (the app compares it with the saved one).
-- * Rivals: done by following one brand (`competitor_subscriptions`), or
--   by this explicit skip.
-- * Finish: the owner finished onboarding, only once every step is done.
--
-- Every active member of the workspace reads the marks; only the owner
-- sets them, through `save_onboarding_step`. Nothing else writes them,
-- not even the worker. The number is chosen at merge time (D24).

create table public.onboarding_steps (
  tenant_id uuid primary key references public.tenants(id),
  -- The website (as `private.site_domain` writes it) the owner confirmed.
  brand_site text check (char_length(brand_site) between 3 and 253),
  brand_confirmed_at timestamptz,
  rivals_skipped_at timestamptz,
  finished_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((brand_site is null) = (brand_confirmed_at is null))
);

alter table public.onboarding_steps enable row level security;
create policy member_read on public.onboarding_steps for select to authenticated
  using (private.is_active_member(tenant_id));
revoke all on public.onboarding_steps from public, anon, authenticated;
grant select on public.onboarding_steps to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.onboarding_steps from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.onboarding_steps from public, anon, authenticated, service_role';
  end if;
end $$;

-- The owner saves a step: `brand` (confirms what was found on the saved
-- website), `rivals` (skips following a brand) or `finish`. Saving again is
-- fine and keeps the first time, except a Brand confirmed for another
-- website, which takes the new one. A step whose record is missing is a
-- business conflict (PT409, its detail names the first step still to do).
-- Locks: the tenant first (`require_member`), then the workspace's marks.
create or replace function public.save_onboarding_step(t uuid, step text)
returns void language plpgsql security definer set search_path = '' as $$
declare site text; s public.onboarding_steps; todo text;
begin
  perform private.require_member(t, true);
  if step is null or step not in ('brand', 'rivals', 'finish') then
    raise exception 'Unknown step' using errcode = '23514';
  end if;
  select private.site_domain(b.domain) into site from public.brand_profiles b where b.tenant_id = t;
  insert into public.onboarding_steps (tenant_id, updated_by) values (t, auth.uid())
    on conflict (tenant_id) do nothing;
  select * into s from public.onboarding_steps where tenant_id = t for update;
  if step = 'brand' then
    if site is null then
      raise exception 'Save your store first' using errcode = 'PT409', detail = 'store';
    end if;
    if s.brand_site is distinct from site then
      update public.onboarding_steps set brand_site = site, brand_confirmed_at = now(),
        updated_by = auth.uid(), updated_at = now() where tenant_id = t;
    end if;
  elsif step = 'rivals' then
    if s.rivals_skipped_at is null then
      update public.onboarding_steps set rivals_skipped_at = now(), updated_by = auth.uid(), updated_at = now()
        where tenant_id = t;
    end if;
  else
    todo := case
      when site is null then 'store'
      when s.brand_site is distinct from site then 'brand'
      when not exists (select 1 from public.workspace_connections c
        where c.tenant_id = t and c.provider = 'klaviyo' and c.status = 'connected') then 'klaviyo'
      when not exists (select 1 from public.brand_offers o where o.tenant_id = t) then 'discount'
      when s.rivals_skipped_at is null and not exists (select 1 from public.competitor_subscriptions c
        where c.tenant_id = t and c.active) then 'rivals'
    end;
    if todo is not null then
      raise exception 'Finish the steps first' using errcode = 'PT409', detail = todo;
    end if;
    if s.finished_at is null then
      update public.onboarding_steps set finished_at = now(), updated_by = auth.uid(), updated_at = now()
        where tenant_id = t;
    end if;
  end if;
end $$;

revoke all on function public.save_onboarding_step(uuid, text) from public, anon, service_role;
grant execute on function public.save_onboarding_step(uuid, text) to authenticated;
