-- UIR-009 Inspiration (docs/UI_REBUILD_SPEC.md §9): a workspace tracks at
-- most 10 competitor domains at a time. The same command as before
-- (20260914090004, with 40001 rewritten to PT409 by 20260914090011), plus
-- the limit. `private.require_member` locks the workspace first, so two
-- windows cannot both add the 10th domain.

create or replace function public.subscribe_competitor(t uuid, domain text, label text, private_rules text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare capture uuid; result uuid;
begin
  perform private.require_member(t, true);
  domain := lower(trim(domain));
  if domain !~ '^[a-z0-9][a-z0-9.-]*\.example$' or length(domain) > 200
    or length(label) not between 2 and 120 or length(private_rules) > 5000 then
    raise exception 'Use a fictional .example capture domain and valid private rules' using errcode = '23514';
  end if;
  -- Re-tracking a domain the workspace already has does not count twice.
  if (select count(*) from public.competitor_subscriptions s
      join public.competitor_captures c on c.id = s.capture_id
      where s.tenant_id = t and s.active and c.domain <> subscribe_competitor.domain) >= 10 then
    raise exception 'You can track up to 10 domains' using errcode = 'PT409';
  end if;
  insert into public.competitor_captures(domain) values (domain)
  on conflict on constraint competitor_captures_domain_key do update set domain = excluded.domain
  returning id into capture;
  insert into public.competitor_subscriptions(tenant_id, capture_id, label, private_rules, created_by)
  values (t, capture, label, private_rules, auth.uid())
  on conflict (tenant_id, capture_id) do update set
    active = true,
    label = excluded.label,
    private_rules = excluded.private_rules,
    revision = public.competitor_subscriptions.revision + 1
  returning id into result;
  return result;
end $$;
