-- UIR-005: editable Brand profile (OWNER_JOURNEYS §18 decision 5). Six
-- sections the owner can edit and lock; "Redo with AI" (a sample provider for
-- now) may only change fields the owner has not locked. Identity and Tone
-- edits also update brand_profiles, which every AI feature reads, and clear
-- the brand approval exactly like save_brand does.

create table public.brand_profile_sections (
  tenant_id uuid not null references public.tenants(id),
  section text not null
    check (section in ('identity','products','tone','vocabulary','sample_copy','audience')),
  content jsonb not null default '{}'
    check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 65536),
  locked text[] not null default '{}' check (cardinality(locked) <= 20),
  source text not null check (source in ('sample','owner')),
  revision integer not null default 1 check (revision > 0),
  generated_at timestamptz,
  edited_at timestamptz,
  edited_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, section)
);
alter table public.brand_profile_sections enable row level security;
create policy tenant_read on public.brand_profile_sections
  for select to authenticated using (private.is_active_member(tenant_id));
grant select on public.brand_profile_sections to authenticated;

-- Field kinds per section. text:N = string up to N characters; list = up to
-- 15 strings of up to 300 characters; terms = up to 30 {term, definition}.
create function private.brand_section_fields(section text)
returns table(field text, kind text, max_length integer)
language sql immutable set search_path = '' as $$
  select f.field, f.kind, f.max_length from (values
    ('identity','brand_name','text',120), ('identity','niche','text',200),
    ('identity','positioning','text',2000), ('identity','geographic_market','text',200),
    ('identity','origin_story','text',5000), ('identity','target_audience','text',2000),
    ('identity','website','text',300),
    ('products','hero_product_url','text',500), ('products','summary','text',2000),
    ('tone','formality','text',60), ('tone','energy','text',60), ('tone','warmth','text',60),
    ('tone','archetype','text',60), ('tone','do','list',300), ('tone','dont','list',300),
    ('vocabulary','preferred','list',300), ('vocabulary','avoid','list',300),
    ('vocabulary','terms','terms',300), ('vocabulary','signature_phrases','list',300),
    ('sample_copy','subject_lines','list',300), ('sample_copy','opening_lines','list',300),
    ('sample_copy','ctas','list',300), ('sample_copy','sign_offs','list',300),
    ('audience','primary_persona','text',2000), ('audience','age_range','text',60),
    ('audience','pain_points','list',300), ('audience','motivations','list',300),
    ('audience','emotional_notes','list',300)
  ) as f(section, field, kind, max_length)
  where f.section = brand_section_fields.section
$$;

create function private.brand_section_valid(section text, content jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; v jsonb; spec record; item jsonb;
begin
  -- Nested checks on purpose: SQL does not promise left-to-right OR, and
  -- jsonb_array_length / jsonb_object_keys throw on the wrong type.
  if content is null or jsonb_typeof(content) <> 'object' then return false; end if;
  for k, v in select * from jsonb_each(content) loop
    select * into spec from private.brand_section_fields(section) f where f.field = k;
    if not found then return false; end if;
    if spec.kind = 'text' then
      if jsonb_typeof(v) <> 'string' then return false; end if;
      if char_length(v #>> '{}') > spec.max_length then return false; end if;
    else
      if jsonb_typeof(v) <> 'array' then return false; end if;
      -- Parentheses keep CASE's own THEN from ending the IF condition.
      if jsonb_array_length(v) > (case when spec.kind = 'list' then 15 else 30 end) then return false; end if;
      for item in select * from jsonb_array_elements(v) loop
        if spec.kind = 'list' then
          if jsonb_typeof(item) <> 'string' then return false; end if;
          if char_length(item #>> '{}') not between 1 and spec.max_length then return false; end if;
        else
          if jsonb_typeof(item) <> 'object' then return false; end if;
          if (select count(*) from jsonb_object_keys(item)) <> 2 then return false; end if;
          if coalesce(jsonb_typeof(item->'term'), '') <> 'string'
            or coalesce(jsonb_typeof(item->'definition'), '') <> 'string' then return false; end if;
          if char_length(item->>'term') not between 1 and 80
            or char_length(item->>'definition') > 300 then return false; end if;
        end if;
      end loop;
    end if;
  end loop;
  return true;
end $$;

-- Keeps brand_profiles (what the AI reads) in step with Identity and Tone.
-- A real change bumps the brand revision and clears its approval.
create function private.sync_brand_from_section(t uuid, section text, content jsonb)
returns void language plpgsql set search_path = '' as $$
declare b public.brand_profiles; had boolean; name text; site text; pos text; v text; p text;
begin
  if section not in ('identity','tone') then return; end if;
  select * into b from public.brand_profiles where tenant_id = t for update;
  had := found;
  if section = 'identity' then
    name := coalesce(nullif(btrim(content->>'brand_name'), ''), b.brand_name);
    if name is null or char_length(name) < 2 then
      raise exception 'Brand name required' using errcode = '23514';
    end if;
    site := coalesce(content->>'website', b.domain, '');
    pos := coalesce(content->>'positioning', b.positioning, '');
    if not had then
      insert into public.brand_profiles(tenant_id, brand_name, domain, positioning, corrections)
      values (t, name, site, pos, jsonb_build_object('positioning', pos, 'voice', '', 'prohibitions', ''));
      return;
    end if;
    v := b.voice; p := b.prohibitions;
  else
    if not had then return; end if;
    name := b.brand_name; site := b.domain; pos := b.positioning;
    -- A list that is present (even empty) replaces the text; an absent one keeps it.
    v := case when content ? 'do' then coalesce((select string_agg(x, E'\n')
           from jsonb_array_elements_text(content->'do') x), '') else b.voice end;
    p := case when content ? 'dont' then coalesce((select string_agg(x, E'\n')
           from jsonb_array_elements_text(content->'dont') x), '') else b.prohibitions end;
  end if;
  if (name, site, pos, v, p) is distinct from (b.brand_name, b.domain, b.positioning, b.voice, b.prohibitions) then
    update public.brand_profiles set brand_name = name, domain = site, positioning = pos, voice = v,
      prohibitions = p,
      corrections = jsonb_build_object('positioning', pos, 'voice', v, 'prohibitions', p),
      revision = revision + 1, approved_revision = null, approved_by = null, approved_at = null,
      updated_at = now()
    where tenant_id = t;
  end if;
end $$;

-- Shared guard: owner, workspace lock first, known section, fresh revision.
create function private.brand_section_lock(t uuid, section text, expected_revision integer)
returns public.brand_profile_sections language plpgsql set search_path = '' as $$
declare s public.brand_profile_sections;
begin
  perform private.require_member(t, true);
  if section is null or not exists (select 1 from private.brand_section_fields(section)) then
    raise exception 'Unknown brand section' using errcode = '23514';
  end if;
  select * into s from public.brand_profile_sections x
    where x.tenant_id = t and x.section = brand_section_lock.section for update;
  if coalesce(s.revision, 0) is distinct from expected_revision then
    raise exception 'This section changed in another window' using errcode = 'PT409';
  end if;
  return s;
end $$;

-- Owner edit: replaces the section's content and the set of locked fields.
create function public.save_brand_section(
  t uuid, section text, expected_revision integer, content jsonb, locked text[] default '{}'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare s public.brand_profile_sections; r integer;
begin
  s := private.brand_section_lock(t, section, expected_revision);
  if not private.brand_section_valid(section, content)
    or exists (select 1 from unnest(coalesce(locked, '{}')) l
      where l not in (select field from private.brand_section_fields(section))) then
    raise exception 'Check the section fields' using errcode = '23514';
  end if;
  insert into public.brand_profile_sections as x
    (tenant_id, section, content, locked, source, edited_at, edited_by)
  values (t, section, content, coalesce(locked, '{}'), 'owner', now(), auth.uid())
  on conflict on constraint brand_profile_sections_pkey do update set
    content = excluded.content, locked = excluded.locked, source = 'owner',
    edited_at = now(), edited_by = auth.uid(), revision = x.revision + 1, updated_at = now()
  returning x.revision into r;
  perform private.sync_brand_from_section(t, section, content);
  return r;
end $$;

-- "Redo with AI": takes a suggestion for every field the owner has not
-- locked; locked fields keep their current value.
create function public.apply_brand_suggestion(
  t uuid, section text, expected_revision integer, suggestion jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare s public.brand_profile_sections; merged jsonb; r integer;
begin
  s := private.brand_section_lock(t, section, expected_revision);
  if not private.brand_section_valid(section, suggestion) then
    raise exception 'Check the section fields' using errcode = '23514';
  end if;
  merged := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(suggestion)
             where key <> all (coalesce(s.locked, '{}')))
         || (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(coalesce(s.content, '{}'))
             where key = any (coalesce(s.locked, '{}')));
  insert into public.brand_profile_sections as x
    (tenant_id, section, content, locked, source, generated_at)
  values (t, section, merged, '{}', 'sample', now())
  on conflict on constraint brand_profile_sections_pkey do update set
    content = merged, source = 'sample', generated_at = now(),
    revision = x.revision + 1, updated_at = now()
  returning x.revision into r;
  perform private.sync_brand_from_section(t, section, merged);
  return r;
end $$;

revoke all on function private.brand_section_fields(text), private.brand_section_valid(text, jsonb),
  private.sync_brand_from_section(uuid, text, jsonb), private.brand_section_lock(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.save_brand_section(uuid, text, integer, jsonb, text[]),
  public.apply_brand_suggestion(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.save_brand_section(uuid, text, integer, jsonb, text[]),
  public.apply_brand_suggestion(uuid, text, integer, jsonb) to authenticated;
