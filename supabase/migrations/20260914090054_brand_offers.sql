-- DSC-001: the owner's offer limits (VISION rule 6, CLAUDE.md "What this
-- product is"): the max discount any email may offer, and the real discount
-- codes the agents may use. Every agent reads these through an OfferSource;
-- the AI never makes up a code or a percent. Owners and admins change them,
-- through the commands below only; every active member reads them.
-- The number is chosen at merge time (D24).

create table public.brand_offers (
  tenant_id uuid primary key references public.tenants(id),
  max_discount_percent integer not null check (max_discount_percent between 0 and 100),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null check (code ~ '^[A-Za-z0-9_-]{3,40}$'),
  percent integer not null check (percent between 1 and 100),
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((status = 'retired') = (retired_at is not null))
);
-- One active code per spelling in a workspace (codes are case-insensitive in Klaviyo and Shopify).
create unique index discount_codes_active_code on public.discount_codes (tenant_id, upper(code)) where status = 'active';
create index discount_codes_tenant_idx on public.discount_codes (tenant_id, status);

alter table public.brand_offers enable row level security;
alter table public.discount_codes enable row level security;
create policy brand_offers_member_read on public.brand_offers for select to authenticated
  using (private.is_active_member(tenant_id) or private.is_operator());
create policy discount_codes_member_read on public.discount_codes for select to authenticated
  using (private.is_active_member(tenant_id) or private.is_operator());

revoke all on public.brand_offers, public.discount_codes from public, anon, authenticated;
grant select on public.brand_offers, public.discount_codes to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.brand_offers, public.discount_codes from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_offers, public.discount_codes from public, anon, authenticated, service_role';
  end if;
end $$;

-- Owner or admin of an active workspace; locks the workspace (tenant first).
create or replace function private.require_offer_editor(t uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if t is null or not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 perform 1 from public.tenants where id = t and status = 'active' for update;
 if not found or not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
  raise exception 'Access denied' using errcode='42501';
 end if;
end $$;
revoke all on function private.require_offer_editor(uuid) from public, anon, authenticated;

-- Sets the max discount. `expected_revision` is the revision the page read
-- (0 when none was saved yet); a change from another window is PT409.
create or replace function public.set_max_discount(t uuid, percent integer, expected_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare o public.brand_offers;
begin
 perform private.require_offer_editor(t);
 if percent is null or percent < 0 or percent > 100 then raise exception 'Max discount must be 0 to 100' using errcode='23514'; end if;
 select * into o from public.brand_offers where tenant_id = t for update;
 if o.tenant_id is null then
  if coalesce(expected_revision, -1) <> 0 then raise exception 'Offer limits changed' using errcode='PT409'; end if;
  insert into public.brand_offers (tenant_id, max_discount_percent, updated_by) values (t, percent, auth.uid());
  return 1;
 end if;
 if o.revision <> coalesce(expected_revision, -1) then raise exception 'Offer limits changed' using errcode='PT409'; end if;
 update public.brand_offers set max_discount_percent = percent, revision = revision + 1, updated_by = auth.uid(), updated_at = now() where tenant_id = t;
 return o.revision + 1;
end $$;

-- Adds a real code. A code that already works, a past expiry or more than
-- 200 active codes is refused.
create or replace function public.add_discount_code(t uuid, code text, percent integer, expires_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; c text := btrim(code);
begin
 perform private.require_offer_editor(t);
 if c is null or c !~ '^[A-Za-z0-9_-]{3,40}$' then raise exception 'Invalid code' using errcode='23514'; end if;
 if percent is null or percent < 1 or percent > 100 then raise exception 'Percent must be 1 to 100' using errcode='23514'; end if;
 if expires_at is not null and expires_at <= now() then raise exception 'Code already expired' using errcode='23514'; end if;
 if exists (select 1 from public.discount_codes d where d.tenant_id = t and d.status = 'active' and upper(d.code) = upper(c)) then
  raise exception 'Code already added' using errcode='PT409';
 end if;
 if (select count(*) from public.discount_codes d where d.tenant_id = t and d.status = 'active') >= 200 then
  raise exception 'Too many codes' using errcode='PT409';
 end if;
 insert into public.discount_codes (tenant_id, code, percent, expires_at, created_by) values (t, c, percent, expires_at, auth.uid()) returning id into rid;
 return rid;
end $$;

-- Retires a code; agents stop using it at once. Retiring twice is fine.
create or replace function public.retire_discount_code(code_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 select d.tenant_id into t from public.discount_codes d where d.id = code_id;
 if t is null then raise exception 'Access denied' using errcode='42501'; end if;
 perform private.require_offer_editor(t);
 update public.discount_codes set status = 'retired', retired_at = now() where id = code_id and status = 'active';
end $$;

revoke all on function public.set_max_discount(uuid, integer, integer), public.add_discount_code(uuid, text, integer, timestamptz),
  public.retire_discount_code(uuid) from public, anon;
grant execute on function public.set_max_discount(uuid, integer, integer), public.add_discount_code(uuid, text, integer, timestamptz),
  public.retire_discount_code(uuid) to authenticated;
