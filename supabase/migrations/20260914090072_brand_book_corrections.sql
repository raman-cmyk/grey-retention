-- ONB-058 (owner pick #58, D27): the owner corrects any line of the Brand
-- book (ONB-106). A correction names its line by its section and the line's
-- own words (never its place, which moves when the book is written again):
-- `remove` takes a line out, `replace` puts the owner's words instead, and
-- `add` adds a line of the owner's own. A fact (free shipping, returns,
-- guarantee, delivery) can be replaced or removed, never added; the
-- owner's fact is the confirmed one. A line is the same line whatever its
-- case and spacing. One live correction per line; a newer one withdraws the
-- older (`replaced`, not an undo). Removing or changing a line the owner
-- added takes his added line back. At most 20 added lines per section.
-- Owners and admins correct through the commands only; members read; the
-- worker reads them to write the book. The number is chosen at merge time
-- (D24).

create table public.brand_book_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  section text not null check (section in ('offering', 'customers.who', 'customers.love',
    'customers.worries', 'voice', 'marketing', 'facts.freeShipping', 'facts.returnDays',
    'facts.guaranteeDays', 'facts.deliveryDays')),
  -- The line's own words; null for a fact or an added line.
  original text check (original is null or char_length(original) between 1 and 300),
  action text not null check (action in ('remove', 'replace', 'add')),
  value text check (value is null or (char_length(value) between 1 and 300 and value ~ '^\S([\s\S]*\S)?$')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- Withdrawn by a newer correction of the same line, not taken back.
  replaced boolean not null default false,
  check (not replaced or withdrawn_at is not null),
  check ((action = 'remove') = (value is null)),
  check (action <> 'add' or original is null),
  check (section not like 'facts.%' or (original is null and action <> 'add')),
  check (section like 'facts.%' or action = 'add' or original is not null)
);

-- A line's key: its words whatever their case and spacing.
create or replace function private.brand_book_line(words text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(words, '')), '\s+', ' ', 'g'))
$$;
revoke all on function private.brand_book_line(text) from public, anon, authenticated, service_role;

-- One live correction per line, and each added line once.
create unique index brand_book_corrections_line on public.brand_book_corrections (tenant_id, section, private.brand_book_line(original))
  where withdrawn_at is null and action <> 'add';
create unique index brand_book_corrections_added on public.brand_book_corrections (tenant_id, section, private.brand_book_line(value))
  where withdrawn_at is null and action = 'add';
create index brand_book_corrections_tenant on public.brand_book_corrections (tenant_id, created_at);

alter table public.brand_book_corrections enable row level security;
create policy brand_book_corrections_member_read on public.brand_book_corrections for select to authenticated
  using (private.is_active_member(tenant_id) or private.is_operator());

revoke all on public.brand_book_corrections from public, anon, authenticated;
grant select on public.brand_book_corrections to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.brand_book_corrections from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_book_corrections from public, anon, authenticated, service_role';
  end if;
end $$;

-- What a fact's value may be: free shipping `always`, `never` or `over 75`
-- (the store's currency, to the cent); days `0` to `3650`; delivery
-- `min-max` calendar days for the slowest customer, min not after max,
-- 1 to 90.
create or replace function private.brand_fact_ok(book_section text, book_value text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when book_value is null then true
    when book_section = 'facts.freeShipping' then
      book_value ~ '^(always|never|over (0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?)$'
    when book_section in ('facts.returnDays', 'facts.guaranteeDays') then
      book_value ~ '^(0|[1-9][0-9]{0,3})$' and book_value::integer <= 3650
    when book_section = 'facts.deliveryDays' then
      book_value ~ '^(0|[1-9][0-9]?)-([1-9][0-9]?)$'
      and split_part(book_value, '-', 1)::integer <= split_part(book_value, '-', 2)::integer
      and split_part(book_value, '-', 2)::integer <= 90
    else true
  end
$$;
revoke all on function private.brand_fact_ok(text, text) from public, anon, authenticated, service_role;

-- Corrects one line. Owner or admin only, workspace locked first
-- (private.require_offer_editor). Returns the correction's id (for the
-- removal of a line the owner added: the id of the line taken back).
create or replace function public.correct_brand_book(t uuid, book_section text, book_original text,
  book_action text, book_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(regexp_replace(coalesce(book_value, ''), '^\s+|\s+$', '', 'g'), '');
  o text := nullif(regexp_replace(coalesce(book_original, ''), '^\s+|\s+$', '', 'g'), '');
  added uuid;
  id uuid;
begin
  perform private.require_offer_editor(t);
  if book_action is null or book_action not in ('remove', 'replace', 'add')
    or book_section is null
    or (book_action = 'remove') <> (v is null)
    or (book_action = 'add' and o is not null)
    or (book_section like 'facts.%' and (o is not null or book_action = 'add'))
    or (book_section not like 'facts.%' and book_action <> 'add' and o is null)
    or char_length(coalesce(v, '')) > 300 or char_length(coalesce(o, '')) > 300
    or not private.brand_fact_ok(book_section, v) then
    raise exception 'Invalid Brand book correction' using errcode = '23514';
  end if;
  if book_action = 'add' then
    if exists (select 1 from public.brand_book_corrections c where c.tenant_id = t
      and c.section = book_section and c.action = 'add' and c.withdrawn_at is null
      and private.brand_book_line(c.value) = private.brand_book_line(v)) then
      raise exception 'Line already added' using errcode = 'PT409';
    end if;
    if (select count(*) from public.brand_book_corrections c where c.tenant_id = t
      and c.section = book_section and c.action = 'add' and c.withdrawn_at is null) >= 20 then
      raise exception 'Too many added lines' using errcode = 'PT409';
    end if;
  else
    -- A line the owner added: removing it takes it back, changing it
    -- adds his new words instead.
    select c.id into added from public.brand_book_corrections c where c.tenant_id = t
      and c.section = book_section and c.action = 'add' and c.withdrawn_at is null
      and private.brand_book_line(c.value) = private.brand_book_line(o);
    if added is not null then
      update public.brand_book_corrections set withdrawn_at = now(), replaced = (book_action = 'replace')
        where brand_book_corrections.id = added;
      if book_action = 'remove' then
        return added;
      end if;
      if exists (select 1 from public.brand_book_corrections c where c.tenant_id = t
        and c.section = book_section and c.action = 'add' and c.withdrawn_at is null
        and private.brand_book_line(c.value) = private.brand_book_line(v)) then
        raise exception 'Line already added' using errcode = 'PT409';
      end if;
      insert into public.brand_book_corrections (tenant_id, section, original, action, value, created_by)
        values (t, book_section, null, 'add', v, auth.uid())
        returning brand_book_corrections.id into id;
      return id;
    end if;
    update public.brand_book_corrections c set withdrawn_at = now(), replaced = true
      where c.tenant_id = t and c.section = book_section
        and private.brand_book_line(c.original) = private.brand_book_line(o)
        and c.action <> 'add' and c.withdrawn_at is null;
  end if;
  insert into public.brand_book_corrections (tenant_id, section, original, action, value, created_by)
    values (t, book_section, o, book_action, v, auth.uid())
    returning brand_book_corrections.id into id;
  return id;
end $$;

-- Takes a correction back: the line is as the readers found it again.
create or replace function public.withdraw_brand_book_correction(t uuid, correction uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_offer_editor(t);
  update public.brand_book_corrections set withdrawn_at = now()
    where tenant_id = t and id = correction and withdrawn_at is null;
  if not found then
    raise exception 'Correction not found' using errcode = 'PT409';
  end if;
end $$;

revoke all on function public.correct_brand_book(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.correct_brand_book(uuid, text, text, text, text) to authenticated;
revoke all on function public.withdraw_brand_book_correction(uuid, uuid) from public, anon, service_role;
grant execute on function public.withdraw_brand_book_correction(uuid, uuid) to authenticated;

-- Each correction and each one taken back goes in the change history (BAS-006).
-- A fact's value is a short checked token (never the owner's own words),
-- so the history can say it; a line's words are never copied.
create or replace function private.record_brand_book_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (old.withdrawn_at is not null or new.withdrawn_at is null or new.replaced) then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail, created_at)
  values (new.tenant_id, auth.uid(),
    case when tg_op = 'INSERT' then 'brand_book_corrected' else 'brand_book_correction_withdrawn' end,
    new.id,
    jsonb_build_object('section', new.section, 'action', new.action)
      || case when new.section like 'facts.%' and new.value is not null
           then jsonb_build_object('value', new.value) else '{}'::jsonb end,
    clock_timestamp());
  return null;
end $$;

revoke all on function private.record_brand_book_correction() from public, anon, authenticated, service_role;

create trigger brand_book_corrections_recorded after insert or update of withdrawn_at on public.brand_book_corrections
  for each row execute function private.record_brand_book_correction();
