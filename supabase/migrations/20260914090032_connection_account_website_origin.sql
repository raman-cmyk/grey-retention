-- UIR-021 review fix for 20260914090031_connection_account_facts.sql.
--
-- The Klaviyo website is kept as its origin only (`https://host`). The
-- guard only needs the host, and with nothing allowed after it, no key or
-- token can be stored in the column (a path like `/?key=pk_…` could).
-- A website in another shape counts as "not reported", like the other
-- facts.

update public.workspace_connections
set account_website = null
where account_website is not null
  and account_website !~ '^https://[a-z0-9.-]+\.[a-z]{2,}$';

alter table public.workspace_connections
  drop constraint workspace_connections_account_website_check,
  add constraint workspace_connections_account_website_check
    check (account_website is null or (char_length(account_website) <= 300
      and account_website ~ '^https://[a-z0-9.-]+\.[a-z]{2,}$'));

-- The same command; only the website filter changes (a trailing slash is
-- dropped, anything else after the host means "not reported").
create or replace function public.connect_sample_provider(
  t uuid,
  provider text,
  account_label text,
  credential_hint text,
  shop_domain text default null,
  template_count integer default null,
  account_timezone text default null,
  account_website text default null,
  account_currency text default null,
  account_country text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r integer;
  zone text;
  website text;
  currency text;
  country text;
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
    or (provider = 'shopify' and account_timezone is not null)
    or (provider = 'shopify' and account_website is not null) then
    raise exception 'Connection details required' using errcode = '23514';
  end if;
  if private.known_timezone(account_timezone) then
    zone := account_timezone;
  end if;
  if char_length(account_website) <= 301
    and account_website ~ '^https://[a-z0-9.-]+\.[a-z]{2,}/?$' then
    website := rtrim(account_website, '/');
  end if;
  if account_currency ~ '^[A-Z]{3}$' then
    currency := account_currency;
  end if;
  if account_country ~ '^[A-Z]{2}$' then
    country := account_country;
  end if;
  insert into public.workspace_connections as c (
    tenant_id, provider, status, fixture_account, account_label, credential_hint,
    shop_domain, template_count, account_timezone, account_website,
    account_currency, account_country, connected_at, last_error
  ) values (
    t, provider, 'connected', 'fixture:' || t || ':' || provider, account_label,
    credential_hint, shop_domain, template_count, zone, website,
    currency, country, now(), null
  )
  on conflict on constraint workspace_connections_pkey do update set
    status = 'connected',
    account_label = excluded.account_label,
    credential_hint = excluded.credential_hint,
    shop_domain = excluded.shop_domain,
    template_count = excluded.template_count,
    account_timezone = excluded.account_timezone,
    account_website = excluded.account_website,
    account_currency = excluded.account_currency,
    account_country = excluded.account_country,
    connected_at = now(),
    last_error = null,
    revision = c.revision + 1,
    updated_at = now()
  returning c.revision into r;
  if provider = 'klaviyo' and zone is not null
    and (select timezone_source from public.tenants where id = t) <> 'owner'
    and not private.plan_in_flight(t) then
    perform private.set_tenant_timezone(t, zone, 'klaviyo');
  end if;
  return r;
end $$;
