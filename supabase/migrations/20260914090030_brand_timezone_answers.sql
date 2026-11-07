-- UIR-023 second review (after 20260914090029_brand_timezone_checks.sql).
--
-- 1. `set_brand_timezone` says whether it changed anything, so Settings
--    can say "Nothing changed" only after the stale-page check has passed.
-- 2. "Use Klaviyo's timezone" also names the brand timezone the page
--    showed, so a zone chosen in another window is never overwritten
--    unseen. Switching only where the timezone came from (the brand
--    already has Klaviyo's zone) is allowed while GROS makes a plan; a new
--    zone is not.
-- 3. Every change is logged, also a change of only where the timezone came
--    from: it decides whether a later Klaviyo reconnect may move it.

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
    jsonb_build_object('from', before, 'to', zone, 'source', source, 'from_source', before_source));
end $$;

-- Returns true when the brand timezone changed, false when it already was
-- this one (after the stale-page check).
drop function public.set_brand_timezone(uuid, text, text);
create function public.set_brand_timezone(t uuid, timezone text, expected text)
returns boolean language plpgsql security definer set search_path = '' as $$
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
    return false;
  end if;
  if private.plan_in_flight(t) then
    raise exception 'GROS is making a plan' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, set_brand_timezone.timezone, 'owner');
  return true;
end $$;

-- `expected_zone` is the Klaviyo timezone the page showed, `expected` the
-- brand timezone it showed.
drop function public.use_klaviyo_timezone(uuid, text);
create function public.use_klaviyo_timezone(t uuid, expected_zone text, expected text)
returns void language plpgsql security definer set search_path = '' as $$
declare zone text; saved_zone text;
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
  select tenants.timezone into saved_zone from public.tenants where id = t;
  if saved_zone is distinct from expected then
    raise exception 'The timezone changed in another window' using errcode = 'PT409';
  end if;
  if saved_zone is distinct from zone and private.plan_in_flight(t) then
    raise exception 'GROS is making a plan' using errcode = 'PT409';
  end if;
  perform private.set_tenant_timezone(t, zone, 'klaviyo');
end $$;

revoke all on function public.set_brand_timezone(uuid, text, text),
  public.use_klaviyo_timezone(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.set_brand_timezone(uuid, text, text),
  public.use_klaviyo_timezone(uuid, text, text)
  to authenticated;
