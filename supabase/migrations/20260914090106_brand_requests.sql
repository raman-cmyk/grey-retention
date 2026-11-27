-- GROS-INS-002. A workspace owner may follow a real brand that Grey Observer
-- has not collected yet. Instead of being refused, the brand is recorded as
-- a request: its capture is real, `subscription_status` is 'pending' and
-- `pending_since` says when it was first asked for. The scheduled sweep hands
-- pending requests to Grey Observer through the Observer Sheet's "GROS
-- requests" tab; Observer stays the only system that subscribes. Its emails
-- still reach GROS only after a person rates them Exemplary.
--
-- The capture gets the same +alias the inbox worker would give it
-- ('observer-' + the first 24 hex characters of the SHA-256 of its domain),
-- so the first approved original lands on this capture.
--
-- Guards:
-- * Following a brand lets the workspace read every stored email of it
--   (`private.capture_access`). A real brand holding any stored email that
--   did not come through Observer's human rating (the earlier inbox) is
--   therefore never followed (23514), curated or not.
-- * Only a real store asks for a real brand (PT403); sample stores follow
--   sample brands.
-- * At most 10 new requests per workspace in 24 hours (PT429), on top of
--   the ten-brands-at-a-time rule, so stopping and following cannot flood
--   Observer with sign-ups.
create or replace function public.subscribe_competitor(t uuid, domain text, label text default null, private_rules text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  capture uuid; existing public.competitor_subscriptions; result uuid;
  is_real boolean; is_curated boolean := false;
begin
  perform private.require_member(t, true);
  domain := lower(trim(domain));
  if domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(domain) > 200
    or (label is not null and length(label) not between 2 and 120)
    or (label is null and length(domain) > 120)
    or length(private_rules) > 5000 then
    raise exception 'Use a valid capture domain and private rules' using errcode = '23514';
  end if;
  is_real := domain !~ '\.example$';
  select c.id into capture from public.competitor_captures c where c.domain = subscribe_competitor.domain;
  if capture is not null then
    if is_real and exists (
      select 1 from public.competitor_emails e
      left join public.inbox_messages m on m.id = e.inbox_message_id
      where e.capture_id = capture and not e.synthetic
        and (m.transport_id is null or m.transport_id not like 'observer:%')
    ) then
      raise exception 'This brand cannot be followed yet' using errcode = '23514';
    end if;
    is_curated := exists (
      select 1 from public.inbox_messages m
      where m.capture_id = capture and not m.synthetic
        and m.state = 'assigned' and m.transport_id like 'observer:%'
    );
    select * into existing from public.competitor_subscriptions s
    where s.tenant_id = t and s.capture_id = capture for update;
  end if;
  -- Already tracked, nothing new asked: leave it exactly as it is.
  if existing.active and label is null and private_rules is null then
    return existing.id;
  end if;
  if is_real and not is_curated and not exists (
    select 1 from public.brand_profiles b where b.tenant_id = t and not b.synthetic
  ) then
    raise exception 'Only a real store can ask for a new brand' using errcode = 'PT403';
  end if;
  if not coalesce(existing.active, false) and private.competitor_slots_full(t, capture) then
    raise exception 'You can track up to 10 domains' using errcode = 'PT409';
  end if;
  -- A new request: a real brand without an approved original that this
  -- workspace has never followed.
  if is_real and not is_curated and existing.id is null and (
    select count(*) from public.competitor_subscriptions s
    join public.competitor_captures c on c.id = s.capture_id
    where s.tenant_id = t and not c.synthetic and s.created_at > now() - interval '24 hours'
      and not exists (
        select 1 from public.inbox_messages m
        where m.capture_id = c.id and not m.synthetic
          and m.state = 'assigned' and m.transport_id like 'observer:%'
      )
  ) >= 10 then
    raise exception 'You asked for 10 new brands today' using errcode = 'PT429';
  end if;
  insert into public.competitor_captures(domain, synthetic, alias_slug, brand_name, subscription_status, pending_since)
  values (
    domain,
    not is_real,
    case when is_real then 'observer-' || left(encode(sha256(convert_to(domain, 'UTF8')), 'hex'), 24) end,
    case when is_real then domain end,
    case when is_real then 'pending' else 'not_subscribed' end,
    case when is_real then now() end
  )
  on conflict on constraint competitor_captures_domain_key do update set
    domain = excluded.domain,
    alias_slug = coalesce(public.competitor_captures.alias_slug, excluded.alias_slug),
    brand_name = coalesce(public.competitor_captures.brand_name, excluded.brand_name),
    -- A real brand nobody collects yet becomes a request again; one Observer
    -- already sends or is signing up to keeps its status.
    subscription_status = case
      when is_real and not is_curated
        and public.competitor_captures.subscription_status in ('not_subscribed', 'unsubscribed')
      then 'pending' else public.competitor_captures.subscription_status end,
    pending_since = case
      when is_real and not is_curated
        and public.competitor_captures.subscription_status in ('not_subscribed', 'unsubscribed')
      then now() else public.competitor_captures.pending_since end
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

-- A brand with an approved Observer original is one Observer is subscribed
-- to. The inbox worker now marks it so on arrival; brands admitted before
-- that are marked here (idempotent).
update public.competitor_captures c set subscription_status = 'subscribed'
where not c.synthetic and c.subscription_status <> 'subscribed'
  and exists (
    select 1 from public.inbox_messages m
    where m.capture_id = c.id and not m.synthetic
      and m.state = 'assigned' and m.transport_id like 'observer:%'
  );

-- The "still not subscribed after 7 days" admin task is for brands a person
-- signs up to with GROS's own +alias. Observer requests (its 'observer-'
-- aliases) are handled by Observer through its Sheet, so they never raise it.
create or replace function public.check_pending_subscriptions()
returns integer language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  for c in select cc.id, cc.domain, cc.alias_slug, coalesce(cc.pending_since, cc.created_at) as since
    from public.competitor_captures cc
    where cc.subscription_status = 'pending' and cc.alias_slug is not null
      and cc.alias_slug not like 'observer-%'
      and coalesce(cc.pending_since, cc.created_at) < now() - interval '7 days'
      and not exists (select 1 from public.inbox_messages o
        where o.capture_id = cc.id and o.state = 'assigned' and o.signal is null
          and o.received_at >= coalesce(cc.pending_since, cc.created_at))
      and not exists (select 1 from public.ops_tasks t
        where t.dedupe_key = 'inbox_pending_subscription:' || cc.id
          and (t.state = 'open' or t.created_at >= coalesce(cc.pending_since, cc.created_at)))
  loop
    perform private.open_ops_task('inbox_pending_subscription', 'inbox_pending_subscription:' || c.id, c.id,
      jsonb_build_object('brand', c.id, 'domain', c.domain, 'aliasSlug', c.alias_slug, 'since', c.since));
    n := n + 1;
  end loop;
  return n;
end $$;
