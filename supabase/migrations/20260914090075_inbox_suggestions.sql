-- ONB-065a: the inbox brands a workspace may be suggested as competitors
-- (owner pick #65, VISION: "from brands already in our inbox"). A member
-- of the workspace sees the brands the Inspiration inbox is subscribed to,
-- of the workspace's own kind (from its brand profile), never one it
-- follows or once followed. This widens what a workspace reads: until now
-- it read only the brands it follows (20260914090038); now also the names,
-- sites and niches of these, with how many emails each sent since `since`
-- and how many of its emails carry each industry label (never an email
-- itself). At most 500 brands, busiest first.
--
-- Only the sample store gets sample brands for now. A real store gets none
-- until Raman decides who may see the inbox's real brands (anyone who signs
-- up and saves a real brand profile would), together with following real
-- brands (subscribe_competitor takes sample domains only).

create or replace function public.suggestable_inbox_brands(t uuid, since timestamptz)
returns table (id uuid, domain text, brand_name text, niche text, synthetic boolean, last_received_at timestamptz,
  recent integer, labels jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare sample boolean;
begin
  if t is null or not private.is_active_member(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  if since is null then raise exception 'Invalid window' using errcode = '23514'; end if;
  select b.synthetic into sample from public.brand_profiles b where b.tenant_id = t;
  -- No brand profile yet: it is not known whether the store is real. A
  -- real store: none yet (see above).
  if sample is null or not sample then return; end if;
  return query
    with busiest as (
      select c.id, c.domain, c.brand_name, c.niche, c.synthetic, c.last_received_at,
        (select count(*)::integer from public.competitor_emails e where e.capture_id = c.id and e.received_at >= since) as recent
      from public.competitor_captures c
      where c.subscription_status = 'subscribed' and c.synthetic = sample
        and not exists (select 1 from public.competitor_subscriptions s where s.tenant_id = t and s.capture_id = c.id)
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

-- Each brand's label counts read from the index alone.
create index competitor_emails_capture_industry on public.competitor_emails (capture_id, industry)
  where industry is not null;

revoke all on function public.suggestable_inbox_brands(uuid, timestamptz) from public, anon;
grant execute on function public.suggestable_inbox_brands(uuid, timestamptz) to authenticated;
