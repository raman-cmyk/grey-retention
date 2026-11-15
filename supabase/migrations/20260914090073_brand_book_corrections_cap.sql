-- ONB-058b: the Brand book is written with the owner's corrections, so
-- their number is capped: at most 200 live corrections a workspace (a
-- book holds far fewer lines; a correction may name a line no book has).
-- `correct_brand_book` is the same command otherwise (ONB-058). Also the
-- indexes for finding books older than a correction across workspaces
-- (`staleBooks`). The number is chosen at merge time (D24).

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
      -- ONB-058b: at most 200 live corrections a workspace (the book is
      -- written from all of them, and a correction may name a line no book
      -- has, so the count is capped here).
      if (select count(*) from public.brand_book_corrections c where c.tenant_id = t
        and c.withdrawn_at is null) >= 200 then
        raise exception 'Too many corrections' using errcode = 'PT409';
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
  -- ONB-058b: at most 200 live corrections a workspace (the book is
  -- written from all of them, and a correction may name a line no book
  -- has, so the count is capped here).
  if (select count(*) from public.brand_book_corrections c where c.tenant_id = t
    and c.withdrawn_at is null) >= 200 then
    raise exception 'Too many corrections' using errcode = 'PT409';
  end if;
  insert into public.brand_book_corrections (tenant_id, section, original, action, value, created_by)
    values (t, book_section, o, book_action, v, auth.uid())
    returning brand_book_corrections.id into id;
  return id;
end $$;

revoke all on function public.correct_brand_book(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.correct_brand_book(uuid, text, text, text, text) to authenticated;

-- The cap counts a workspace's live corrections without reading the
-- withdrawn ones (every change leaves one).
create index brand_book_corrections_live on public.brand_book_corrections (tenant_id)
  where withdrawn_at is null;
create index brand_book_corrections_made on public.brand_book_corrections (created_at);
create index brand_book_corrections_withdrawn on public.brand_book_corrections (withdrawn_at)
  where withdrawn_at is not null;
