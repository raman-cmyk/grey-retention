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
-- At most 10 new requests per workspace in 24 hours (on top of the
-- ten-brands-at-a-time rule), so stopping and following cannot flood
-- Observer with sign-ups. PT429 is "too many requests".
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
  if not coalesce(existing.active, false) and private.competitor_slots_full(t, capture) then
    raise exception 'You can track up to 10 domains' using errcode = 'PT409';
  end if;
  -- A new request: a real brand without an approved original that this
  -- workspace has never followed.
  if is_real and not is_curated and existing.id is null and (
    select count(*) from public.competitor_subscriptions s
    join public.competitor_captures c on c.id = s.capture_id
    where s.tenant_id = t and not c.synthetic and s.created_at > now() - interval '1 day'
      and not exists (
        select 1 from public.inbox_messages m
        where m.capture_id = c.id and not m.synthetic
          and m.state = 'assigned' and m.transport_id like 'observer:%'
      )
  ) >= 10 then
    raise exception 'You asked for 10 new brands today' using errcode = 'PT429';
  end if;
  insert into public.competitor_captures(domain, synthetic, alias_slug, subscription_status, pending_since)
  values (
    domain,
    not is_real,
    case when is_real then 'observer-' || left(encode(sha256(convert_to(domain, 'UTF8')), 'hex'), 24) end,
    case when is_real then 'pending' else 'not_subscribed' end,
    case when is_real then now() end
  )
  on conflict on constraint competitor_captures_domain_key do update set
    domain = excluded.domain,
    alias_slug = coalesce(public.competitor_captures.alias_slug, excluded.alias_slug),
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
