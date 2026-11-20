-- LRN-001b: how each variation's clicks were put in sections.
--
-- A results read maps each variation's link clicks with that variation's
-- own HTML, never another design's: ours while its template shows what
-- the push put there, its template as it is now once it was changed in
-- Klaviyo (or when we kept none of ours for it), else none (its clicks are
-- kept, in no section). The read says which, per variation, in its
-- `context.sections`: at most 8 entries of
--   {"variation": "VarB01", "design": "B" | "A" | null,
--    "from": "build" | "klaviyo" | null, "changed": true | false}
-- `changed`: its template was changed in Klaviyo since the push (the row's
-- `changed` flag is set with it, as for a subject or preview changed).
--
-- Only `private.klaviyo_context_ok` changes (every earlier key as before);
-- no table, grant or policy changes, so RLS and the save's locks (the
-- workspace first, shared, then the row) are as in 090063.

create or replace function private.klaviyo_sections_from_ok(s jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(s) = 'array' and jsonb_array_length(s) <= 8
    -- Each entry has exactly its four keys, each of its kind (an unknown
    -- answer counts as wrong, so a missing key is refused twice over).
    and not exists (select 1 from jsonb_array_elements(s) e where not coalesce(
      jsonb_typeof(e) = 'object'
      and e - 'variation' - 'design' - 'from' - 'changed' = '{}'::jsonb
      and e ? 'variation' and e ? 'design' and e ? 'from' and e ? 'changed'
      and jsonb_typeof(e->'variation') = 'string' and e->>'variation' ~ '^[A-Za-z0-9_-]{1,64}$'
      and (jsonb_typeof(e->'design') = 'null' or e->>'design' in ('A', 'B'))
      and (jsonb_typeof(e->'from') = 'null' or e->>'from' in ('build', 'klaviyo'))
      and jsonb_typeof(e->'changed') = 'boolean', false)), false);
$$;
revoke all on function private.klaviyo_sections_from_ok(jsonb) from public, anon, authenticated;

-- How a read was made: known keys only, each of its kind (090063's, and
-- `sections`).
create or replace function private.klaviyo_context_ok(c jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(c) = 'object' and octet_length(c::text) <= 4000
    and c - 'reportFrom' - 'reportTo' - 'clicksFrom' - 'clicksTo' - 'currency' - 'conversion' - 'attributionOpen'
      - 'sendStrategy' - 'sentAtFrom' - 'abSplit' - 'clicksBy' - 'botsLeftOut' - 'reported' - 'resultsKept'
      - 'clicksKept' - 'sections' = '{}'::jsonb
    and not exists (select 1 from jsonb_each(c) e where
      (e.key in ('reportFrom', 'reportTo', 'clicksFrom', 'clicksTo')
        and (jsonb_typeof(e.value) <> 'string' or e.value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}T[0-9:.]{8,15}Z$'))
      or (e.key = 'currency' and jsonb_typeof(e.value) <> 'null' and coalesce(e.value #>> '{}', '') !~ '^[A-Z]{3}$')
      or (e.key = 'conversion' and jsonb_typeof(e.value) <> 'null'
        and coalesce(e.value #>> '{}', '') not in ('placed_order', 'clicked_email'))
      or (e.key in ('attributionOpen', 'reported', 'resultsKept', 'clicksKept') and jsonb_typeof(e.value) <> 'boolean')
      or (e.key = 'abSplit' and jsonb_typeof(e.value) not in ('boolean', 'null'))
      or (e.key = 'sendStrategy' and jsonb_typeof(e.value) <> 'null' and coalesce(e.value #>> '{}', '') !~ '^[a-z_]{1,40}$')
      or (e.key = 'sentAtFrom' and coalesce(e.value #>> '{}', '') not in ('send_time', 'send_times', 'first_seen'))
      or (e.key = 'clicksBy' and jsonb_typeof(e.value) <> 'null'
        and coalesce(e.value #>> '{}', '') not in ('message', 'campaign'))
      or (e.key = 'botsLeftOut' and (jsonb_typeof(e.value) <> 'number' or e.value #>> '{}' !~ '^\d{1,9}$'))
      or (e.key = 'sections' and not private.klaviyo_sections_from_ok(e.value))), false);
$$;
revoke all on function private.klaviyo_context_ok(jsonb) from public, anon, authenticated;
