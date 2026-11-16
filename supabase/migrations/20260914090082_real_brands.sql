-- REAL-01a, Raman's decision of 16 November: real stores may be
-- suggested the inbox's real brands, under his rules: only brands of the
-- store's own industry, only their public newsletter emails, never a
-- person's name or email address from the inbox, and the owner can hide
-- any brand. A suggestion shows only a brand's name, website, niche and how
-- often it sends: never an email, so no inbox content at all.
--
-- The industry is the store's own, read by the app from what it sells (the
-- owner's corrections included), so the brands are now asked for by the
-- app's server only (service role), never by a browser: no member can list
-- brands of other industries. The caller has read the workspace's profile
-- with the member's own client first. Following a real brand (its emails,
-- cleaned of names and addresses) is part b.

create table public.competitor_hidden (
  tenant_id uuid not null references public.tenants(id),
  capture_id uuid not null references public.competitor_captures(id),
  hidden_by uuid not null references public.profiles(id),
  hidden_at timestamptz not null default now(),
  primary key (tenant_id, capture_id)
);

alter table public.competitor_hidden enable row level security;
create policy member_read on public.competitor_hidden for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.competitor_hidden from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.competitor_hidden from authenticated;
grant select on public.competitor_hidden to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.competitor_hidden from authenticated';
  end if;
end $$;

-- The owner hides a brand: it is never suggested again, and the workspace
-- stops following it. Hiding twice is fine.
create or replace function public.hide_competitor(t uuid, capture uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  if not exists (select 1 from public.competitor_captures c where c.id = capture) then
    raise exception 'Unknown brand' using errcode = '23514';
  end if;
  insert into public.competitor_hidden(tenant_id, capture_id, hidden_by) values (t, capture, auth.uid())
    on conflict (tenant_id, capture_id) do nothing;
  update public.competitor_subscriptions s set active = false, revision = s.revision + 1
    where s.tenant_id = t and s.capture_id = capture and s.active;
end $$;

-- The owner shows a hidden brand again (it may be suggested again; it is
-- not followed again by itself).
create or replace function public.unhide_competitor(t uuid, capture uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  delete from public.competitor_hidden h where h.tenant_id = t and h.capture_id = capture;
end $$;

revoke all on function public.hide_competitor(uuid, uuid) from public, anon;
revoke all on function public.unhide_competitor(uuid, uuid) from public, anon;
grant execute on function public.hide_competitor(uuid, uuid) to authenticated;
grant execute on function public.unhide_competitor(uuid, uuid) to authenticated;

-- The inbox brands a workspace may be suggested (ONB-065a), now for real
-- stores too: brands of the workspace's own kind (real or sample), never
-- one it follows, once followed or hid. The app's server only.
create or replace function public.suggestable_inbox_brands(t uuid, since timestamptz)
returns table (id uuid, domain text, brand_name text, niche text, synthetic boolean, last_received_at timestamptz,
  recent integer, labels jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare sample boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if t is null or since is null then raise exception 'Invalid request' using errcode = '23514'; end if;
  select b.synthetic into sample from public.brand_profiles b where b.tenant_id = t;
  -- No brand profile yet: it is not known whether the store is real.
  if sample is null then return; end if;
  return query
    with busiest as (
      select c.id, c.domain, c.brand_name, c.niche, c.synthetic, c.last_received_at,
        (select count(*)::integer from public.competitor_emails e where e.capture_id = c.id and e.received_at >= since) as recent
      from public.competitor_captures c
      where c.subscription_status = 'subscribed' and c.synthetic = sample
        and not exists (select 1 from public.competitor_subscriptions s where s.tenant_id = t and s.capture_id = c.id)
        and not exists (select 1 from public.competitor_hidden h where h.tenant_id = t and h.capture_id = c.id)
      -- 7: its recent emails (a column number, so no name can be taken for another).
      order by 7 desc, c.last_received_at desc nulls last, c.id
      limit 500
    )
    select b.id, b.domain, b.brand_name, b.niche, b.synthetic, b.last_received_at, b.recent,
      coalesce((select jsonb_object_agg(x.industry, x.n) from (
        select e.industry, count(*)::integer as n from public.competitor_emails e
        where e.capture_id = b.id and e.industry is not null group by e.industry) x), '{}'::jsonb)
    from busiest b
    order by b.recent desc, b.last_received_at desc nulls last, b.id;
end $$;

revoke all on function public.suggestable_inbox_brands(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.suggestable_inbox_brands(uuid, timestamptz) to service_role;
