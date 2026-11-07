-- UIR-023 one brand timezone everywhere (docs/OWNER_JOURNEYS.md §18.14).
--
-- `tenants.timezone` stays the ONE brand timezone every screen uses. It now
-- records where it came from: 'setup' (chosen when the workspace was
-- created), 'klaviyo' (taken from the connected Klaviyo account) or 'owner'
-- (chosen in Settings). Connecting Klaviyo sets it from the account unless
-- the owner has chosen one; the owner can change it in Settings at any time
-- and can switch back to Klaviyo's.

alter table public.tenants
  add column timezone_source text not null default 'setup'
    check (timezone_source in ('setup', 'klaviyo', 'owner'));

-- The Klaviyo account's timezone as reported when connecting (sample mode:
-- the sample account reports the workspace's timezone).
alter table public.workspace_connections
  add column account_timezone text
    -- Timezone-shaped only (Region/City), so no key or token fits here.
    check (account_timezone is null or (char_length(account_timezone) between 1 and 64
      and account_timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$'));

-- A real region timezone Postgres knows (not the posix/right copies).
create or replace function private.known_timezone(zone text)
returns boolean language sql stable set search_path = '' as $$
  select zone is not null and zone !~ '^(posix|right)/'
    and zone not in ('posixrules', 'localtime', 'Factory')
    and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = zone)
$$;

-- Sets the brand timezone and logs it (the caller has locked the workspace).
create or replace function private.set_tenant_timezone(t uuid, zone text, source text)
returns void language plpgsql security definer set search_path = '' as $$
declare before text; before_source text;
begin
  select timezone, timezone_source into before, before_source from public.tenants where id = t;
  if before is not distinct from zone and before_source = source then
    return;
  end if;
  update public.tenants set timezone = zone, timezone_source = source where id = t;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail)
  values (t, auth.uid(), 'brand_timezone_set',
    jsonb_build_object('from', before, 'to', zone, 'source', source));
end $$;

-- The same command as before, plus the Klaviyo account's timezone. The old
-- six-argument form is replaced (named calls without the new argument still
-- work through its default).
drop function public.connect_sample_provider(uuid, text, text, text, text, integer);
create function public.connect_sample_provider(
  t uuid,
  provider text,
  account_label text,
  credential_hint text,
  shop_domain text default null,
  template_count integer default null,
  account_timezone text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare r integer;
begin
  perform private.require_member(t, true);
  if provider is null or provider not in ('klaviyo', 'shopify') then
    raise exception 'Unsupported connection' using errcode = '23514';
  end if;
  if account_label is null or credential_hint is null
    or (provider = 'shopify') <> (shop_domain is not null)
    or (provider = 'klaviyo' and credential_hint !~ '^pk_')
    or (provider = 'shopify' and credential_hint !~ '^shp(at|ca)_')
    or (provider = 'shopify' and template_count is not null)
    or (account_timezone is not null
      and (provider <> 'klaviyo' or not private.known_timezone(account_timezone))) then
    raise exception 'Connection details required' using errcode = '23514';
  end if;
  insert into public.workspace_connections as c (
    tenant_id, provider, status, fixture_account, account_label, credential_hint,
    shop_domain, template_count, account_timezone, connected_at, last_error
  ) values (
    t, provider, 'connected', 'fixture:' || t || ':' || provider, account_label,
    credential_hint, shop_domain, template_count, account_timezone, now(), null
  )
  on conflict on constraint workspace_connections_pkey do update set
    status = 'connected',
    account_label = excluded.account_label,
    credential_hint = excluded.credential_hint,
    shop_domain = excluded.shop_domain,
    template_count = excluded.template_count,
    account_timezone = excluded.account_timezone,
    connected_at = now(),
    last_error = null,
    revision = c.revision + 1,
    updated_at = now()
  returning c.revision into r;
  -- Klaviyo decides the brand timezone unless the owner chose one.
  if provider = 'klaviyo' and account_timezone is not null
    and (select timezone_source from public.tenants where id = t) <> 'owner' then
    perform private.set_tenant_timezone(t, account_timezone, 'klaviyo');
  end if;
  return r;
end $$;

-- Settings: the owner picks the brand timezone. `expected` is the timezone
-- the page showed, so two windows cannot overwrite each other unseen.
create or replace function public.set_brand_timezone(t uuid, timezone text, expected text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  if not private.known_timezone(set_brand_timezone.timezone) then
    raise exception 'Choose a timezone from the list' using errcode = '23514';
  end if;
  if (select tenants.timezone from public.tenants where id = t) is distinct from expected then
    raise exception 'The timezone changed in another window' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, set_brand_timezone.timezone, 'owner');
end $$;

-- Settings: "Use Klaviyo's timezone" (only while Klaviyo is connected and
-- reported one).
create or replace function public.use_klaviyo_timezone(t uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare zone text;
begin
  perform private.require_member(t, true);
  select c.account_timezone into zone from public.workspace_connections c
  where c.tenant_id = t and c.provider = 'klaviyo' and c.status = 'connected';
  if zone is null or not private.known_timezone(zone) then
    raise exception 'Klaviyo has not reported a timezone' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, zone, 'klaviyo');
end $$;

revoke all on function private.known_timezone(text), private.set_tenant_timezone(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.connect_sample_provider(uuid, text, text, text, text, integer, text),
  public.set_brand_timezone(uuid, text, text), public.use_klaviyo_timezone(uuid)
  from public, anon, service_role;
grant execute on function public.connect_sample_provider(uuid, text, text, text, text, integer, text),
  public.set_brand_timezone(uuid, text, text), public.use_klaviyo_timezone(uuid)
  to authenticated;
