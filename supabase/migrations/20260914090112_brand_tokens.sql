-- PICK-006 (owner pick #6, "Design tokens per brand"): the brand's spacing
-- scale, type scale, corner radius and button style, as the Site reader
-- found them on its own pages and the stylesheets they link (the sample
-- site's own styles on a sample read), each clamped to an email-safe range
-- (`features/design-engine/tokens.ts`). One row per workspace, from the
-- newest read of its website: a read replaces the whole set (even with
-- none). The members read it; only the Site reader's job writes it
-- (record_site_tokens, under its lease, before it stores its findings).
--
-- The owner corrects a token in the Brand book like a fact (ONB-058,
-- UI-BRAND-2): a section `tokens.<name>` (replace or remove, never a line
-- or an added line), its value a short checked text
-- (`private.brand_token_ok`), so his value wins over the site's and a
-- removal gives the site's (or GROS's default) back. The checked command
-- `private.correct_brand_book_checked` is the same otherwise (090073,
-- moved by 090095); a token's value goes in the change history as a
-- fact's does.
--
-- The number is chosen at merge time (D24).

-- Whether one token's value is in its email-safe range (the app clamps
-- before it sends; anything else is refused whole).
create or replace function private.token_number_ok(token text, n numeric)
returns boolean language sql immutable set search_path = '' as $$
  select n is not null and case token
    when 'spacing.base' then n between 2 and 12 and n % 1 = 0
    when 'type.body' then n between 14 and 20 and n % 1 = 0
    when 'type.h1' then n between 24 and 48 and n % 1 = 0
    when 'type.h2' then n between 18 and 36 and n % 1 = 0
    when 'type.h3' then n between 16 and 28 and n % 1 = 0
    when 'type.lineHeight' then n between 1.2 and 1.8 and (n * 100) % 1 = 0
    when 'radius.button' then n between 0 and 24 and n % 1 = 0
    when 'radius.card' then n between 0 and 24 and n % 1 = 0
    when 'radius.image' then n between 0 and 24 and n % 1 = 0
    when 'button.paddingX' then n between 12 and 48 and n % 1 = 0
    when 'button.paddingY' then n between 8 and 20 and n % 1 = 0
    when 'button.weight' then n in (400, 500, 600, 700, 800)
    else false
  end
$$;
revoke all on function private.token_number_ok(text, numeric) from public, anon, authenticated;

-- Whether a scale of spaces is whole px from 2 to 64, 2 to 10 of them,
-- each once, smallest first.
create or replace function private.token_steps_ok(steps numeric[])
returns boolean language sql immutable set search_path = '' as $$
  select steps is not null and cardinality(steps) between 2 and 10
    and not exists (select 1 from unnest(steps) s where s is null or s % 1 <> 0 or s not between 2 and 64)
    and steps = (select array_agg(distinct s order by s) from unnest(steps) s)
$$;
revoke all on function private.token_steps_ok(numeric[]) from public, anon, authenticated;

-- Whether a set of tokens has the shape the Site reader keeps (`SiteTokens`):
-- an object of known tokens only, each in its range.
create or replace function private.site_tokens_ok(tokens jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb;
begin
  if jsonb_typeof(tokens) is distinct from 'object' or octet_length(tokens::text) > 4000 then return false; end if;
  for k, v in select key, value from jsonb_each(tokens) loop
    if k in ('type.headingCase', 'button.case') then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('none', 'uppercase') then return false; end if;
    elsif k = 'button.style' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('filled', 'outline') then return false; end if;
    elsif k = 'spacing.steps' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number')
        or not private.token_steps_ok(array(select (e #>> '{}')::numeric from jsonb_array_elements(v) e)) then
        return false;
      end if;
    elsif jsonb_typeof(v) <> 'number' or not private.token_number_ok(k, (v #>> '{}')::numeric) then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.site_tokens_ok(jsonb) from public, anon, authenticated;

create table public.brand_tokens (
  tenant_id uuid primary key references public.tenants(id),
  run_id uuid not null,
  -- The site the tokens were read from.
  domain text not null check (coalesce(domain = private.site_domain(domain), false)),
  tokens jsonb not null check (private.site_tokens_ok(tokens)),
  read_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);

alter table public.brand_tokens enable row level security;
create policy member_read on public.brand_tokens for select to authenticated
  using ((select private.is_active_member(tenant_id)));
revoke all on public.brand_tokens from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_tokens from authenticated;
grant select on public.brand_tokens to authenticated;
-- The worker writes only through record_site_tokens, never directly.
revoke insert, update, delete, truncate, references, trigger on public.brand_tokens from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_tokens from public, anon, authenticated, service_role';
  end if;
end $$;

-- Keeps the tokens one site read found, replacing the workspace's earlier
-- set (even with none), unless a newer read of the site already kept its
-- own (then false, nothing changed). The lease locks the workspace first,
-- then the job. A set the table would refuse is refused whole, and the
-- earlier set stays.
create or replace function public.record_site_tokens(job uuid, lease uuid, tokens jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; d text;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null then raise exception 'Invalid site reading' using errcode = '23514'; end if;
  if not coalesce(private.site_tokens_ok(tokens), false) then raise exception 'Invalid tokens' using errcode = '23514'; end if;
  if exists (select 1 from public.brand_tokens b join public.job_runs r on r.tenant_id = b.tenant_id and r.id = b.run_id
      where b.tenant_id = j.tenant_id and r.created_at > j.created_at) then
    return false;
  end if;
  insert into public.brand_tokens(tenant_id, run_id, domain, tokens)
    values (j.tenant_id, j.id, d, tokens)
    on conflict (tenant_id) do update
      set run_id = excluded.run_id, domain = excluded.domain, tokens = excluded.tokens, read_at = now();
  return true;
end $$;

revoke all on function public.record_site_tokens(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_site_tokens(uuid, uuid, jsonb) to service_role;

-- The owner's corrections: the sections a token is corrected in.
create or replace function private.brand_token_sections() returns text[]
language sql immutable set search_path = '' as $$
  select array['tokens.spacing.base', 'tokens.spacing.steps', 'tokens.type.body', 'tokens.type.h1',
    'tokens.type.h2', 'tokens.type.h3', 'tokens.type.lineHeight', 'tokens.type.headingCase',
    'tokens.radius.button', 'tokens.radius.card', 'tokens.radius.image', 'tokens.button.style',
    'tokens.button.paddingX', 'tokens.button.paddingY', 'tokens.button.case', 'tokens.button.weight']
$$;
revoke all on function private.brand_token_sections() from public, anon, authenticated, service_role;

-- What the owner's value of a token may be, as the app writes it
-- (`tokenText`): a whole number ("8"), a line height ("1.5"), the spaces
-- as a list ("4, 8, 16, 24"), or one of its words. Null (a removal) is
-- always fine.
create or replace function private.brand_token_ok(book_section text, book_value text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when book_value is null then true
    when not (book_section = any(private.brand_token_sections())) then false
    when book_section in ('tokens.type.headingCase', 'tokens.button.case') then book_value in ('none', 'uppercase')
    when book_section = 'tokens.button.style' then book_value in ('filled', 'outline')
    when book_section = 'tokens.spacing.steps' then
      book_value ~ '^[0-9]{1,2}(, [0-9]{1,2}){1,9}$'
      and private.token_steps_ok(string_to_array(book_value, ', ')::numeric[])
    when book_section = 'tokens.type.lineHeight' then
      book_value ~ '^[0-9](\.[0-9]{1,2})?$' and private.token_number_ok('type.lineHeight', book_value::numeric)
    else book_value ~ '^[0-9]{1,3}$'
      and private.token_number_ok(substr(book_section, length('tokens.') + 1), book_value::numeric)
  end
$$;
revoke all on function private.brand_token_ok(text, text) from public, anon, authenticated, service_role;

-- A fact's value as before (ONB-058); a token's by `brand_token_ok`.
create or replace function private.brand_fact_ok(book_section text, book_value text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when book_value is null then true
    when book_section like 'tokens.%' then private.brand_token_ok(book_section, book_value)
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

-- The table takes the token sections, which, like facts, have no line of
-- their own: replaced or removed, never added. Its checks on the section
-- (ONB-058's, named by Postgres) are replaced by named ones.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
      where conrelid = 'public.brand_book_corrections'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%section%' loop
    execute format('alter table public.brand_book_corrections drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.brand_book_corrections
  add constraint brand_book_corrections_section_known check (section in ('offering', 'customers.who', 'customers.love',
    'customers.worries', 'voice', 'marketing', 'facts.freeShipping', 'facts.returnDays',
    'facts.guaranteeDays', 'facts.deliveryDays')
    or section = any(private.brand_token_sections())),
  add constraint brand_book_corrections_fact_shape check (
    (section not like 'facts.%' and section not like 'tokens.%') or (original is null and action <> 'add')),
  add constraint brand_book_corrections_line_shape check (
    section like 'facts.%' or section like 'tokens.%' or action = 'add' or original is not null);

-- ONB-058's checked command (090073, owner only since 090095), with a
-- token's section read like a fact's. Otherwise unchanged.
create or replace function private.correct_brand_book_checked(t uuid, book_section text, book_original text,
  book_action text, book_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(regexp_replace(coalesce(book_value, ''), '^\s+|\s+$', '', 'g'), '');
  o text := nullif(regexp_replace(coalesce(book_original, ''), '^\s+|\s+$', '', 'g'), '');
  fact boolean := book_section like 'facts.%' or book_section like 'tokens.%';
  added uuid;
  id uuid;
begin
  perform private.require_offer_editor(t);
  if book_action is null or book_action not in ('remove', 'replace', 'add')
    or book_section is null
    or (book_action = 'remove') <> (v is null)
    or (book_action = 'add' and o is not null)
    or (fact and (o is not null or book_action = 'add'))
    or (not fact and book_action <> 'add' and o is null)
    or char_length(coalesce(v, '')) > 300 or char_length(coalesce(o, '')) > 300
    or (book_section like 'tokens.%' and not (book_section = any(private.brand_token_sections())))
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
  if (select count(*) from public.brand_book_corrections c where c.tenant_id = t
    and c.withdrawn_at is null) >= 200 then
    raise exception 'Too many corrections' using errcode = 'PT409';
  end if;
  insert into public.brand_book_corrections (tenant_id, section, original, action, value, created_by)
    values (t, book_section, o, book_action, v, auth.uid())
    returning brand_book_corrections.id into id;
  return id;
end $$;
revoke all on function private.correct_brand_book_checked(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- The change history says a token's checked value, as a fact's (never a
-- line's own words).
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
      || case when (new.section like 'facts.%' or new.section like 'tokens.%') and new.value is not null
           then jsonb_build_object('value', new.value) else '{}'::jsonb end,
    clock_timestamp());
  return null;
end $$;
revoke all on function private.record_brand_book_correction() from public, anon, authenticated, service_role;
