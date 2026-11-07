-- UIR-011: Settings "Campaign defaults" (docs/UI_REBUILD_SPEC.md §11,
-- OWNER_JOURNEYS §11). One row per workspace. The values pre-fill NEW
-- campaigns only; existing drafts never change. Audience ids are the
-- Klaviyo list/segment ids the picker showed (sample ids until Klaviyo is
-- connected for real). Apply after 20260914090019.

create table public.campaign_defaults (
  tenant_id uuid primary key references public.tenants(id),
  featured_product_id uuid,
  sender_name text not null default '' check (char_length(sender_name) <= 100),
  primary_link text not null default ''
    check (primary_link = '' or (primary_link ~ '^https://[^\s]+$' and char_length(primary_link) <= 2000)),
  send_to text[] not null default '{}' check (cardinality(send_to) <= 20),
  dont_send_to text[] not null default '{}' check (cardinality(dont_send_to) <= 20),
  include_footer boolean not null default true,
  footer_source text not null default 'auto' check (footer_source = 'auto'),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  -- A removed product clears the default instead of blocking the removal.
  foreign key (tenant_id, featured_product_id) references public.products(tenant_id, id)
    on delete set null (featured_product_id)
);
alter table public.campaign_defaults enable row level security;
create policy tenant_read on public.campaign_defaults
  for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.campaign_defaults from public, anon, authenticated, service_role;
grant select on public.campaign_defaults to authenticated;

-- Audience ids: 1–100 characters, no blanks or duplicates, never both
-- "send to" and "don't send to".
create function private.audience_ids_valid(ids text[])
returns boolean language sql immutable set search_path = '' as $$
  select ids is not null
    and not exists (select 1 from unnest(ids) i where i is null or char_length(btrim(i)) not between 1 and 100)
    and cardinality(ids) = (select count(distinct i) from unnest(ids) i)
$$;

-- Owner-only, workspace lock first, PT409 on a stale page.
create function public.save_campaign_defaults(
  t uuid, expected_revision integer, featured_product_id uuid, sender_name text,
  primary_link text, send_to text[], dont_send_to text[], include_footer boolean,
  footer_source text default 'auto'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.campaign_defaults; r integer;
  name text := btrim(coalesce(sender_name, ''));
  link text := btrim(coalesce(primary_link, ''));
begin
  perform private.require_member(t, true);
  select * into d from public.campaign_defaults where tenant_id = t for update;
  if coalesce(d.revision, 0) is distinct from expected_revision then
    raise exception 'Campaign defaults changed in another window' using errcode = 'PT409';
  end if;
  if featured_product_id is not null and not exists (
      select 1 from public.products p where p.tenant_id = t and p.id = featured_product_id) then
    raise exception 'Choose a product from your catalogue' using errcode = '23514';
  end if;
  if char_length(name) > 100 then
    raise exception 'Sender name is too long' using errcode = '23514';
  end if;
  if link <> '' and (link !~ '^https://[^\s]+$' or char_length(link) > 2000) then
    raise exception 'Primary link must start with https://' using errcode = '23514';
  end if;
  if not private.audience_ids_valid(send_to) or not private.audience_ids_valid(dont_send_to)
    or cardinality(send_to) > 20 or cardinality(dont_send_to) > 20 then
    raise exception 'Check the audiences' using errcode = '23514';
  end if;
  if send_to && dont_send_to then
    raise exception 'An audience cannot be in both Send to and Don''t send to' using errcode = '23514';
  end if;
  if include_footer is null or coalesce(footer_source, '') <> 'auto' then
    raise exception 'Check the email settings' using errcode = '23514';
  end if;
  insert into public.campaign_defaults as x (tenant_id, featured_product_id, sender_name,
    primary_link, send_to, dont_send_to, include_footer, footer_source, updated_by)
  values (t, featured_product_id, name, link, send_to, dont_send_to, include_footer, 'auto', auth.uid())
  on conflict (tenant_id) do update set featured_product_id = excluded.featured_product_id,
    sender_name = excluded.sender_name, primary_link = excluded.primary_link,
    send_to = excluded.send_to, dont_send_to = excluded.dont_send_to,
    include_footer = excluded.include_footer, footer_source = excluded.footer_source,
    updated_by = auth.uid(), updated_at = now(), revision = x.revision + 1
  returning x.revision into r;
  return r;
end $$;

revoke all on function private.audience_ids_valid(text[]) from public, anon, authenticated, service_role;
revoke all on function public.save_campaign_defaults(uuid, integer, uuid, text, text, text[], text[], boolean, text)
  from public, anon, service_role;
grant execute on function public.save_campaign_defaults(uuid, integer, uuid, text, text, text[], text[], boolean, text)
  to authenticated;
