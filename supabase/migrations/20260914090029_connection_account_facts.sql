-- UIR-021 brand-mismatch guard (docs/OWNER_JOURNEYS.md §0.1, §18.6).
--
-- A connected Klaviyo or Shopify account reports what business it belongs
-- to when it is connected: its website (Klaviyo), currency and country.
-- The Brand page and every AI step compare these with the Brand profile and
-- warn when they look like another brand. Display facts only: the checks
-- below make sure no key or token can be stored in them.

alter table public.workspace_connections
  add column account_website text
    check (account_website is null or (char_length(account_website) <= 300
      and account_website ~ '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^[:space:]]*)?$')),
  add column account_currency text
    check (account_currency is null or account_currency ~ '^[A-Z]{3}$'),
  add column account_country text
    check (account_country is null or account_country ~ '^[A-Z]{2}$');

-- The same command, plus the account facts (all optional). The seven-
-- argument form is replaced; named calls without the new arguments work.
drop function public.connect_sample_provider(uuid, text, text, text, text, integer, text);
create function public.connect_sample_provider(
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
      and (provider <> 'klaviyo' or not private.known_timezone(account_timezone)))
    or (account_website is not null and provider <> 'klaviyo') then
    raise exception 'Connection details required' using errcode = '23514';
  end if;
  insert into public.workspace_connections as c (
    tenant_id, provider, status, fixture_account, account_label, credential_hint,
    shop_domain, template_count, account_timezone, account_website,
    account_currency, account_country, connected_at, last_error
  ) values (
    t, provider, 'connected', 'fixture:' || t || ':' || provider, account_label,
    credential_hint, shop_domain, template_count, account_timezone, account_website,
    account_currency, account_country, now(), null
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
  if provider = 'klaviyo' and account_timezone is not null
    and (select timezone_source from public.tenants where id = t) <> 'owner' then
    perform private.set_tenant_timezone(t, account_timezone, 'klaviyo');
  end if;
  return r;
end $$;

revoke all on function public.connect_sample_provider(uuid, text, text, text, text, integer, text, text, text, text)
  from public, anon, service_role;
grant execute on function public.connect_sample_provider(uuid, text, text, text, text, integer, text, text, text, text)
  to authenticated;
