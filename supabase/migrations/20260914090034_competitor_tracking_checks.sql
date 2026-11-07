-- UIR-009 review fixes for 20260914090033_competitor_domain_limit.sql.
--
-- 1. Turning a stopped domain back on (the advanced page's "Active") also
--    counts against the 10-domain limit.
-- 2. Tracking a domain again from Inspiration keeps its label and private
--    rules: both arguments may now be null, which means "keep what is
--    there" (a new domain gets the domain as its label and no rules). A
--    domain that is already tracked is left exactly as it is, so its
--    revision, and a playbook built on it, stay valid.
-- (090033's header said its body had 40001 rewritten; subscribe_competitor
-- never raised 40001. Its body is 090004's plus the limit.)

create or replace function private.competitor_slots_full(t uuid, keep_capture uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select count(*) >= 10 from public.competitor_subscriptions s
  where s.tenant_id = t and s.active and s.capture_id is distinct from keep_capture
$$;
revoke all on function private.competitor_slots_full(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.subscribe_competitor(t uuid, domain text, label text default null, private_rules text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare capture uuid; existing public.competitor_subscriptions; result uuid;
begin
  perform private.require_member(t, true);
  domain := lower(trim(domain));
  if domain !~ '^[a-z0-9][a-z0-9.-]*\.example$' or length(domain) > 200
    or (label is not null and length(label) not between 2 and 120)
    or (label is null and length(domain) > 120)
    or length(private_rules) > 5000 then
    raise exception 'Use a fictional .example capture domain and valid private rules' using errcode = '23514';
  end if;
  select c.id into capture from public.competitor_captures c where c.domain = subscribe_competitor.domain;
  if capture is not null then
    select * into existing from public.competitor_subscriptions s
    where s.tenant_id = t and s.capture_id = capture for update;
  end if;
  -- Already tracked, nothing new asked: leave it exactly as it is.
  if existing.active and label is null and private_rules is null then
    return existing.id;
  end if;
  if not coalesce(existing.active, false) and private.competitor_slots_full(t, capture) then
    raise exception 'You can track up to 10 domains' using errcode = 'PT409';
  end if;
  insert into public.competitor_captures(domain) values (domain)
  on conflict on constraint competitor_captures_domain_key do update set domain = excluded.domain
  returning id into capture;
  insert into public.competitor_subscriptions(tenant_id, capture_id, label, private_rules, created_by)
  values (t, capture, coalesce(label, domain), coalesce(private_rules, ''), auth.uid())
  on conflict (tenant_id, capture_id) do update set
    active = true,
    label = coalesce(subscribe_competitor.label, public.competitor_subscriptions.label),
    private_rules = coalesce(subscribe_competitor.private_rules, public.competitor_subscriptions.private_rules),
    revision = public.competitor_subscriptions.revision + 1
  returning id into result;
  return result;
end $$;

create or replace function public.update_competitor_subscription(t uuid, subscription uuid, expected_revision integer, active boolean, private_rules text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing public.competitor_subscriptions;
begin
  perform private.require_member(t, true);
  if length(private_rules) > 5000 then
    raise exception 'Rules too long' using errcode = '23514';
  end if;
  select * into existing from public.competitor_subscriptions s
  where s.id = subscription and s.tenant_id = t for update;
  if not found or existing.revision is distinct from expected_revision then
    raise exception 'Stale subscription' using errcode = 'PT409';
  end if;
  -- Turning a stopped domain back on takes one of the 10 places.
  if update_competitor_subscription.active and not existing.active
    and private.competitor_slots_full(t, existing.capture_id) then
    raise exception 'You can track up to 10 domains' using errcode = 'PT409';
  end if;
  update public.competitor_subscriptions s set
    active = update_competitor_subscription.active,
    private_rules = update_competitor_subscription.private_rules,
    revision = s.revision + 1
  where s.id = subscription and s.tenant_id = t;
end $$;
