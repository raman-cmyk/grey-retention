-- GROS-OBS-001. Additive real-brand follow; no new table or data deletion.
-- Provisional number: rename to next available number at merge, per D24.
create or replace function public.subscribe_competitor(t uuid, domain text, label text default null, private_rules text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare capture uuid; existing public.competitor_subscriptions; result uuid;
begin
  perform private.require_member(t, true);
  domain := lower(trim(domain));
  if domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or length(domain) > 200
    or (label is not null and length(label) not between 2 and 120)
    or (label is null and length(domain) > 120)
    or length(private_rules) > 5000 then
    raise exception 'Use a valid capture domain and private rules' using errcode = '23514';
  end if;
  select c.id into capture from public.competitor_captures c where c.domain = subscribe_competitor.domain;
  -- Real brands must already have an original admitted by Observer's
  -- server-only selected source. The server action also rechecks the live
  -- human rating; no capture/scrape job is started for a real domain.
  if domain !~ '\.example$' and not exists (
    select 1 from public.inbox_messages m
    where m.capture_id = capture and not m.synthetic
      and m.state = 'assigned' and m.transport_id like 'observer:%'
  ) then
    raise exception 'This real brand has no curated Observer original' using errcode = '23514';
  end if;
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
  insert into public.competitor_captures(domain, synthetic) values (domain, domain ~ '\.example$')
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

