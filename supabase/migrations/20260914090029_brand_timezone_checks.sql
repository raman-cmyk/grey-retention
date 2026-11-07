-- UIR-023 review fixes for 20260914090028_brand_timezone.sql.
--
-- 1. The brand timezone changes only through the commands below, which log
--    it and check for stale pages. Owners and managers could still write
--    `tenants.timezone` directly (a column grant from the first IAM
--    migration), skipping both.
-- 2. While GROS is making a calendar plan, the timezone cannot change: the
--    plan reads it when it starts, so a change half-way would mix two
--    timezones. Connecting Klaviyo then keeps the current one.
-- 3. A Klaviyo timezone Postgres does not know is "not reported": it is
--    stored as nothing and the connection still works.
-- 4. Saving the timezone the brand already has changes nothing.
-- 5. "Use Klaviyo's timezone" names the Klaviyo timezone the page showed.

revoke update (timezone) on public.tenants from authenticated;

-- Every real timezone name fits (EST5EDT, GB-Eire, Etc/GMT+5, NZ-CHAT …);
-- nothing shaped like a Klaviyo or Shopify key does.
alter table public.workspace_connections
  drop constraint workspace_connections_account_timezone_check,
  add constraint workspace_connections_account_timezone_check
    check (account_timezone is null or (char_length(account_timezone) between 1 and 64
      and account_timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$'
      and account_timezone !~* '^(pk|sk|shp(at|ca|ss|pa))_'));

-- Sets the brand timezone and where it came from. Only a new timezone is
-- logged (the caller has locked the workspace).
create or replace function private.set_tenant_timezone(t uuid, zone text, source text)
returns void language plpgsql security definer set search_path = '' as $$
declare before text; before_source text;
begin
  select timezone, timezone_source into before, before_source from public.tenants where id = t;
  if before is not distinct from zone and before_source = source then
    return;
  end if;
  update public.tenants set timezone = zone, timezone_source = source where id = t;
  if before is distinct from zone then
    insert into public.workspace_events (tenant_id, actor_id, kind, detail)
    values (t, auth.uid(), 'brand_timezone_set',
      jsonb_build_object('from', before, 'to', zone, 'source', source));
  end if;
end $$;

-- A calendar plan for this workspace is queued or being made.
create or replace function private.plan_in_flight(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.job_runs j
    where j.tenant_id = t and j.kind = 'calendar.plan'
      and j.status in ('queued', 'leased', 'running', 'retry_wait')
  )
$$;

-- Connecting Klaviyo: an unknown timezone is not reported (stored as
-- nothing), and it only becomes the brand timezone when the owner has not
-- chosen one and no plan is being made.
create or replace function public.connect_sample_provider(
  t uuid,
  provider text,
  account_label text,
  credential_hint text,
  shop_domain text default null,
  template_count integer default null,
  account_timezone text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r integer;
  zone text;
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
    or (provider = 'shopify' and account_timezone is not null) then
    raise exception 'Connection details required' using errcode = '23514';
  end if;
  if private.known_timezone(account_timezone) then
    zone := account_timezone;
  end if;
  insert into public.workspace_connections as c (
    tenant_id, provider, status, fixture_account, account_label, credential_hint,
    shop_domain, template_count, account_timezone, connected_at, last_error
  ) values (
    t, provider, 'connected', 'fixture:' || t || ':' || provider, account_label,
    credential_hint, shop_domain, template_count, zone, now(), null
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
  if provider = 'klaviyo' and zone is not null
    and (select timezone_source from public.tenants where id = t) <> 'owner'
    and not private.plan_in_flight(t) then
    perform private.set_tenant_timezone(t, zone, 'klaviyo');
  end if;
  return r;
end $$;

-- Settings: the owner picks the brand timezone. `expected` is the timezone
-- the page showed, so two windows cannot overwrite each other unseen.
create or replace function public.set_brand_timezone(t uuid, timezone text, expected text)
returns void language plpgsql security definer set search_path = '' as $$
declare saved_zone text;
begin
  perform private.require_member(t, true);
  if not private.known_timezone(set_brand_timezone.timezone) then
    raise exception 'Choose a timezone from the list' using errcode = '23514';
  end if;
  select tenants.timezone into saved_zone from public.tenants where id = t;
  if saved_zone is distinct from expected then
    raise exception 'The timezone changed in another window' using errcode = 'PT409';
  end if;
  if saved_zone = set_brand_timezone.timezone then
    return;
  end if;
  if private.plan_in_flight(t) then
    raise exception 'GROS is making a plan' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, set_brand_timezone.timezone, 'owner');
end $$;

-- Settings: "Use Klaviyo's timezone". `expected_zone` is the Klaviyo
-- timezone the page showed; if Klaviyo has reported another one since, the
-- owner sees it first.
drop function public.use_klaviyo_timezone(uuid);
create function public.use_klaviyo_timezone(t uuid, expected_zone text)
returns void language plpgsql security definer set search_path = '' as $$
declare zone text;
begin
  perform private.require_member(t, true);
  select c.account_timezone into zone from public.workspace_connections c
  where c.tenant_id = t and c.provider = 'klaviyo' and c.status = 'connected';
  if zone is null or not private.known_timezone(zone) then
    raise exception 'Klaviyo has not reported a timezone' using errcode = 'PT409';
  end if;
  if zone is distinct from expected_zone then
    raise exception 'Klaviyo reported another timezone' using errcode = 'PT409';
  end if;
  if private.plan_in_flight(t) then
    raise exception 'GROS is making a plan' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, zone, 'klaviyo');
end $$;

revoke all on function private.plan_in_flight(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.use_klaviyo_timezone(uuid, text)
  from public, anon, service_role;
grant execute on function public.use_klaviyo_timezone(uuid, text) to authenticated;
