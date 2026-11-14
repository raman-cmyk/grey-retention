-- PLN-039 (owner pick #39, D27): a margin floor on discounts. Products carry
-- no cost in Klaviyo, so the owner gives their usual gross margin and the
-- lowest margin they accept after a discount; the offers every agent reads
-- then cap the discount where the floor would break (features/offers).
-- Owners and admins change them through set_margin_floor only. The number
-- is chosen at merge time (D24).

alter table public.brand_offers
  add column gross_margin_percent integer check (gross_margin_percent between 1 and 99),
  add column margin_floor_percent integer check (margin_floor_percent between 0 and 98),
  -- Both or neither, and the floor below the margin.
  add constraint brand_offers_margin_floor_check check (
    (gross_margin_percent is null) = (margin_floor_percent is null)
    and (margin_floor_percent is null or margin_floor_percent < gross_margin_percent)
  );

-- Sets (or, with both null, clears) the margin floor. Like the max discount:
-- `expected_revision` is the revision the page read; a change from another
-- window is PT409. The max discount must be saved first (the offer limits'
-- row holds both).
create or replace function public.set_margin_floor(t uuid, gross_margin integer, margin_floor integer,
  expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.brand_offers;
begin
  perform private.require_offer_editor(t);
  if (gross_margin is null) <> (margin_floor is null)
    or gross_margin < 1 or gross_margin > 99 or margin_floor < 0 or margin_floor >= gross_margin then
    raise exception 'Margin floor must be below the gross margin' using errcode = '23514';
  end if;
  select * into o from public.brand_offers where tenant_id = t for update;
  if o.tenant_id is null then
    raise exception 'Set the max discount first' using errcode = 'PT409', detail = 'no_offer_limits';
  end if;
  if o.revision <> coalesce(expected_revision, -1) then
    raise exception 'Offer limits changed' using errcode = 'PT409';
  end if;
  update public.brand_offers
    set gross_margin_percent = gross_margin, margin_floor_percent = margin_floor,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    where tenant_id = t;
  return o.revision + 1;
end $$;

revoke all on function public.set_margin_floor(uuid, integer, integer, integer) from public, anon, service_role;
grant execute on function public.set_margin_floor(uuid, integer, integer, integer) to authenticated;
