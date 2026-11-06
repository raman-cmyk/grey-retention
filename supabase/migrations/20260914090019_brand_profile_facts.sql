-- UIR-005 review fixes, applied together with 20260914090018 (neither has
-- reached production). Brand facts now live in one place:
--   * brand name, website, positioning, voice and prohibitions stay only in
--     brand_profiles (what every AI feature reads). Identity and Tone saves
--     write them there with a brand-revision check, so an edit made elsewhere
--     (for example on Get started) is never silently overwritten.
--   * "Redo with AI" can only change the section's own notes; it never
--     touches brand facts, keeps fields the suggestion leaves out, and keeps
--     locked fields.
--   * Grants are explicit; NULL locks are refused.

-- 1. Section content no longer holds brand facts.
update public.brand_profile_sections
set content = content - 'brand_name' - 'website' - 'positioning',
  locked = array(select l from unnest(locked) l
                 where l not in ('brand_name','website','positioning'))
where section = 'identity';
update public.brand_profile_sections
set content = content - 'do' - 'dont',
  locked = array(select l from unnest(locked) l where l not in ('do','dont'))
where section = 'tone';

create or replace function private.brand_section_fields(section text)
returns table(field text, kind text, max_length integer)
language sql immutable set search_path = '' as $$
  select f.field, f.kind, f.max_length from (values
    ('identity','niche','text',200), ('identity','geographic_market','text',200),
    ('identity','origin_story','text',5000), ('identity','target_audience','text',2000),
    ('products','hero_product_url','text',500), ('products','summary','text',2000),
    ('tone','formality','text',60), ('tone','energy','text',60), ('tone','warmth','text',60),
    ('tone','archetype','text',60),
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

drop function public.save_brand_section(uuid, text, integer, jsonb, text[]);
drop function private.sync_brand_from_section(uuid, text, jsonb);

-- Text as the owner means it: Windows line endings and outer spaces or blank lines ignored.
create function private.brand_text(value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(replace(coalesce(value, ''), E'\r\n', E'\n'), E' \t\n\r')
$$;

-- Writes the brand facts of Identity (brand_name, domain, positioning) or
-- Tone (voice, prohibitions). Returns true when brand_profiles changed; a
-- change bumps the brand revision and clears its approval, and the existing
-- brand_guard trigger resets unsent campaigns (or refuses during delivery).
create function private.save_brand_facts(
  t uuid, section text, facts jsonb, expected_brand_revision integer
) returns boolean language plpgsql set search_path = '' as $$
declare b public.brand_profiles; had boolean; allowed text[];
  name text; site text; pos text; v text; p text;
begin
  if facts is null then return false; end if;
  allowed := case section when 'identity' then array['brand_name','domain','positioning']
                          when 'tone' then array['voice','prohibitions'] end;
  if allowed is null or jsonb_typeof(facts) <> 'object' or exists (
      select 1 from jsonb_each(facts) e
      where e.key <> all (allowed) or jsonb_typeof(e.value) <> 'string') then
    raise exception 'Check the brand details' using errcode = '23514';
  end if;
  select * into b from public.brand_profiles where tenant_id = t for update;
  had := found;
  if coalesce(b.revision, 0) is distinct from expected_brand_revision then
    raise exception 'Brand details changed in another window' using errcode = 'PT409';
  end if;
  if not had and section = 'tone' then
    raise exception 'Save the Brand Identity first' using errcode = '23514';
  end if;
  name := private.brand_text(coalesce(facts->>'brand_name', b.brand_name));
  site := private.brand_text(coalesce(facts->>'domain', b.domain));
  pos := private.brand_text(coalesce(facts->>'positioning', b.positioning));
  v := private.brand_text(coalesce(facts->>'voice', b.voice));
  p := private.brand_text(coalesce(facts->>'prohibitions', b.prohibitions));
  if char_length(name) not between 2 and 120 then
    raise exception 'Brand name needs 2 to 120 characters' using errcode = '23514';
  end if;
  if char_length(site) > 300 or char_length(pos) > 5000 or char_length(v) > 5000
    or char_length(p) > 5000 then
    raise exception 'Check the brand details' using errcode = '23514';
  end if;
  if not had then
    insert into public.brand_profiles(tenant_id, brand_name, domain, positioning, corrections)
    values (t, name, site, pos, jsonb_build_object('positioning', pos, 'voice', '', 'prohibitions', ''));
    return true;
  end if;
  -- Same meaning as before: keep the stored text and the approval.
  if (name, site, pos, v, p) is not distinct from (private.brand_text(b.brand_name),
      private.brand_text(b.domain), private.brand_text(b.positioning),
      private.brand_text(b.voice), private.brand_text(b.prohibitions)) then
    return false;
  end if;
  update public.brand_profiles set brand_name = name, domain = site, positioning = pos,
    voice = v, prohibitions = p,
    corrections = jsonb_build_object('positioning', pos, 'voice', v, 'prohibitions', p),
    revision = revision + 1, approved_revision = null, approved_by = null, approved_at = null,
    updated_at = now()
  where tenant_id = t;
  return true;
end $$;

-- Owner edit of one section: its notes and locks, plus (Identity and Tone)
-- the brand facts shown on the same card. Lock order: workspace, section
-- row, brand row, then campaigns (brand_guard).
create function public.save_brand_section(
  t uuid, section text, expected_revision integer, content jsonb,
  locked text[] default '{}', facts jsonb default null,
  expected_brand_revision integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.brand_profile_sections; r integer; changed boolean; keep text[];
begin
  s := private.brand_section_lock(t, section, expected_revision);
  if not private.brand_section_valid(section, content)
    or exists (select 1 from unnest(coalesce(locked, '{}')) l
      where l is null or l not in (select field from private.brand_section_fields(section))) then
    raise exception 'Check the section fields' using errcode = '23514';
  end if;
  keep := array(select distinct l from unnest(coalesce(locked, '{}')) l order by l);
  changed := private.save_brand_facts(t, section, facts, expected_brand_revision);
  insert into public.brand_profile_sections as x
    (tenant_id, section, content, locked, source, edited_at, edited_by)
  values (t, section, content, keep, 'owner', now(), auth.uid())
  on conflict on constraint brand_profile_sections_pkey do update set
    content = excluded.content, locked = excluded.locked, source = 'owner',
    edited_at = now(), edited_by = auth.uid(), revision = x.revision + 1, updated_at = now()
  returning x.revision into r;
  return jsonb_build_object('revision', r, 'brand_changed', changed);
end $$;

-- "Redo with AI": suggested fields replace unlocked ones; locked fields and
-- fields the suggestion leaves out keep their current value. Brand facts
-- are not section fields, so a suggestion can never change them.
create or replace function public.apply_brand_suggestion(
  t uuid, section text, expected_revision integer, suggestion jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare s public.brand_profile_sections; merged jsonb; r integer;
begin
  s := private.brand_section_lock(t, section, expected_revision);
  if not private.brand_section_valid(section, suggestion) then
    raise exception 'Check the section fields' using errcode = '23514';
  end if;
  merged := coalesce(s.content, '{}')
    || (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(suggestion)
        where key <> all (coalesce(s.locked, '{}')));
  insert into public.brand_profile_sections as x
    (tenant_id, section, content, locked, source, generated_at)
  values (t, section, merged, '{}', 'sample', now())
  on conflict on constraint brand_profile_sections_pkey do update set
    content = merged, source = 'sample', generated_at = now(),
    revision = x.revision + 1, updated_at = now()
  returning x.revision into r;
  return r;
end $$;

-- Explicit grants: members read through RLS; every write goes through the
-- owner-only commands above.
revoke all on public.brand_profile_sections from public, anon, authenticated, service_role;
grant select on public.brand_profile_sections to authenticated;
revoke all on function private.brand_text(text),
  private.save_brand_facts(uuid, text, jsonb, integer),
  private.brand_section_fields(text), private.brand_section_valid(text, jsonb),
  private.brand_section_lock(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.save_brand_section(uuid, text, integer, jsonb, text[], jsonb, integer),
  public.apply_brand_suggestion(uuid, text, integer, jsonb) from public, anon, service_role;
grant execute on function public.save_brand_section(uuid, text, integer, jsonb, text[], jsonb, integer),
  public.apply_brand_suggestion(uuid, text, integer, jsonb) to authenticated;
