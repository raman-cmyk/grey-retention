-- CI-002 Block variants (AGENT_MAP §1, BUILD_BRIEF D18).
--
-- The block library grows from the 20 seed blocks into the thousands: each
-- competitor section that is tagged becomes a reusable variant of its
-- family, **structure only** (rows of columns of slots, with their
-- proportions; never a competitor's words, pictures, links or colours,
-- VISION rule 8). One row per structure: the duplicate check is the
-- structural fingerprint, so a section whose structure is already in the
-- library adds evidence to that row instead of a copy.
--
-- * block_variants: the library, with the 20 seeds (source 'seed').
-- * email_sections gain the variant they became (or why none), and the
--   fingerprint of the structure read from their HTML, so the same
--   structure seen again needs no AI call.
-- * inbox.variant jobs: one per tagged email, queued when its tags are
--   recorded; record_block_variants stores a batch of sections at a time.
-- * search_block_variants: the library searched by every label (the
--   section's and the email's), for any signed-in workspace member and the
--   agents. Where a variant came from (the sections, the brands) stays
--   with platform admins; a member's search by the emails' labels only
--   counts structures seen at 3 brands or more, so it never describes one
--   brand's email.
-- * Only emails assigned to a brand feed the library (an unknown sender's
--   mail joins once an admin assigns it).

create table public.block_variants (
  id uuid primary key default gen_random_uuid(),
  -- The stable name the agents use: `<family>/seed` for a seed block,
  -- `<family>/<first 16 hex of the fingerprint>` for one from a competitor.
  key text not null unique check (key ~ '^[a-z0-9_]{2,40}/(seed|[a-f0-9]{16})$'),
  family text not null check (family in ('announcement_bar','header_logo','hero_product','hero_image','offer_banner','text','steps','product_feature','product_grid_2col','product_grid_3col','category_tiles','image_text','founder_note','review_strip','ugc_grid','before_after','faq','cta','signoff','footer')),
  layout text not null check (layout in ('single_column','two_column','three_column','grid','image_left','image_right','full_width_image','text_over_image','cards','list','strip','other')),
  purpose text not null check (purpose in ('brand_header','navigation','announcement','hook','product_showcase','offer','social_proof','education','story','urgency','call_to_action','closing','legal')),
  styles text[] not null default '{}' check (styles <@ array['minimal','bold','playful','luxury','editorial','photo_led','text_led','illustrated','dark','colourful']::text[]
    and cardinality(styles) <= 3 and array_position(styles, null) is null),
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and jsonb_typeof(spec->'rows') = 'array'
    and jsonb_array_length(spec->'rows') between 1 and 6 and length(spec::text) <= 8000),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('seed','competitor')),
  pass text not null check (pass in ('seed','maker','skeleton')),
  model text check (model is null or length(model) between 1 and 100),
  -- Sections seen with this structure (a seed starts at none).
  evidence integer not null default 0 check (evidence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'seed') = (pass = 'seed')),
  check (split_part(key, '/', 1) = family
    and split_part(key, '/', 2) = case when source = 'seed' then 'seed' else left(fingerprint, 16) end)
);
create index block_variants_labels on public.block_variants (family, layout, purpose);
create index block_variants_styles on public.block_variants using gin (styles);
create index block_variants_evidence on public.block_variants (evidence desc, created_at);
alter table public.block_variants enable row level security;
create policy operator_read on public.block_variants for select to authenticated using (private.is_operator());
revoke all on public.block_variants from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.block_variants from authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.block_variants from authenticated';
  end if;
end $$;

-- What each tagged section became: a new variant ('made'), evidence for
-- one already there ('matched'), or left out (D16, logged): no structure
-- could be read ('no_structure'), or none that can be drawn ('unusable';
-- when a model really answered, its structure is kept, so the same
-- structure seen again is left out without another AI call).
alter table public.email_sections
  add column variant_id uuid references public.block_variants(id),
  add column variant_state text check (variant_state in ('made','matched','no_structure','unusable')),
  add column variant_version text check (variant_version is null or variant_version ~ '^[a-z0-9.-]{1,40}$'),
  add column skeleton_fingerprint text check (skeleton_fingerprint is null or skeleton_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint email_sections_variant_whole check (
    (variant_state is null and variant_id is null and variant_version is null and skeleton_fingerprint is null)
    or (variant_state in ('made','matched') and variant_id is not null and variant_version is not null
        and skeleton_fingerprint is not null)
    or (variant_state = 'unusable' and variant_id is null and variant_version is not null)
    or (variant_state = 'no_structure' and variant_id is null and variant_version is not null and skeleton_fingerprint is null));
create index email_sections_variant on public.email_sections (variant_id) where variant_id is not null;
create index email_sections_skeleton on public.email_sections (skeleton_fingerprint) where skeleton_fingerprint is not null;

-- The 20 seed blocks are the first variant of each family (their
-- fingerprints are checked against the code in features/intelligence).
insert into public.block_variants (key, family, layout, purpose, styles, spec, fingerprint, source, pass)
select family || '/seed', family, layout, purpose, styles, spec::jsonb, fingerprint, 'seed', 'seed' from (values
  ('announcement_bar', 'strip', 'announcement', array['minimal']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"text","lines":1}]}]}],"align":"center","background":"dark","padding":"s"}', 'c15f66c9e82cb2f55173f7134dfc37067167fc17b53ea4b0ba719970b39ae4b4'),
  ('header_logo', 'single_column', 'brand_header', array['minimal']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"image","role":"logo","aspect":"free","bleed":false}]}]}],"align":"center","background":"none","padding":"m"}', 'e43c9c24015f49a5ab0937be157bfa9c6a67786600f86a3386430e489ff28588'),
  ('hero_product', 'single_column', 'hook', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"eyebrow"},{"kind":"heading","size":"xl"},{"kind":"text","lines":2},{"kind":"image","role":"product","aspect":"4:5","bleed":false},{"kind":"button","style":"solid"}]}]}],"align":"center","background":"brand","padding":"l"}', '1df10630ebab173bdffbc61c065fdec99c497edff8d8452b8470501d813c6fe4'),
  ('hero_image', 'full_width_image', 'hook', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"image","role":"lifestyle","aspect":"4:5","bleed":true},{"kind":"heading","size":"xl"},{"kind":"text","lines":2},{"kind":"button","style":"solid"}]}]}],"align":"center","background":"none","padding":"none"}', 'a734a81b5309c8b5c1724b30622cc5003eea3dc7a6403a345cfd82f6cd1cfc84'),
  ('offer_banner', 'single_column', 'offer', array['bold']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"xl"},{"kind":"text","lines":1},{"kind":"code"},{"kind":"text","lines":1},{"kind":"button","style":"solid"}]}]}],"align":"center","background":"accent","padding":"l"}', 'f5bc71c14a2fde59dbecf13dde12c99584b841b6a8976d18f5050f67003b1aaf'),
  ('text', 'single_column', 'story', array['text_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"},{"kind":"text","lines":5}]}]}],"align":"left","background":"none","padding":"m"}', '7b743a36bc1f789bfa16d44dc0edaa5d3eca2c066fcf7afd352980917282e15a'),
  ('steps', 'list', 'education', array['text_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.2,"slots":[{"kind":"heading","size":"s"}]},{"width":0.8,"slots":[{"kind":"text","lines":2}]}]},{"columns":[{"width":0.2,"slots":[{"kind":"heading","size":"s"}]},{"width":0.8,"slots":[{"kind":"text","lines":2}]}]},{"columns":[{"width":0.2,"slots":[{"kind":"heading","size":"s"}]},{"width":0.8,"slots":[{"kind":"text","lines":2}]}]}],"align":"left","background":"none","padding":"m"}', 'b9a06b28716bfa9229a2c9032c80172c84db80e7ce5ac57aaa7235319807847a'),
  ('product_feature', 'image_left', 'product_showcase', array['photo_led']::text[], '{"rows":[{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false}]},{"width":0.5,"slots":[{"kind":"heading","size":"s"},{"kind":"text","lines":1},{"kind":"price"},{"kind":"text","lines":2},{"kind":"button","style":"solid"}]}]}],"align":"left","background":"none","padding":"m"}', 'da78e57f702b47036080d33f4fc94443292fe8beebe7be2c6d9f852d13701da0'),
  ('product_grid_2col', 'two_column', 'product_showcase', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]},{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]}]},{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]},{"width":0.5,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]}]}],"align":"center","background":"none","padding":"m"}', 'eaa7d80e00e6bda56ee816712fb46da775b9bd09d07bd01b123e94dc285a1457'),
  ('product_grid_3col', 'three_column', 'product_showcase', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.33,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]},{"width":0.33,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]},{"width":0.33,"slots":[{"kind":"image","role":"product","aspect":"1:1","bleed":false},{"kind":"text","lines":1},{"kind":"price"},{"kind":"button","style":"link"}]}]}],"align":"center","background":"none","padding":"m"}', 'f86c1c75a02ccdb09755c827e7caffa6019130de786276a7703af0afb05f8f48'),
  ('category_tiles', 'grid', 'navigation', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false},{"kind":"text","lines":1}]},{"width":0.5,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false},{"kind":"text","lines":1}]}]},{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false},{"kind":"text","lines":1}]},{"width":0.5,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false},{"kind":"text","lines":1}]}]}],"align":"center","background":"none","padding":"m"}', '154c7022d3f6cb6c5472de35842e55d20e6e812608867499c3ca841478dd0cdc'),
  ('image_text', 'image_left', 'story', array['editorial']::text[], '{"rows":[{"columns":[{"width":0.5,"slots":[{"kind":"image","role":"lifestyle","aspect":"4:5","bleed":false}]},{"width":0.5,"slots":[{"kind":"heading","size":"m"},{"kind":"text","lines":5},{"kind":"button","style":"link"}]}]}],"align":"left","background":"none","padding":"m"}', '9a73cece4417f4d66b771cfe74b39f417d8b213d6ed389db082001cfcf76dba5'),
  ('founder_note', 'single_column', 'story', array['editorial']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false},{"kind":"text","lines":11}]}]}],"align":"center","background":"none","padding":"l"}', '132fa388485b99c383d178b424981da0d50a37e0e348ab37cb450ff82c7fb809'),
  ('review_strip', 'three_column', 'social_proof', array['text_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.33,"slots":[{"kind":"rating"},{"kind":"quote"},{"kind":"text","lines":1}]},{"width":0.33,"slots":[{"kind":"rating"},{"kind":"quote"},{"kind":"text","lines":1}]},{"width":0.33,"slots":[{"kind":"rating"},{"kind":"quote"},{"kind":"text","lines":1}]}]}],"align":"center","background":"none","padding":"m"}', '4a29240fc38a3849e06d5e26ff015b945f903acb5f6d1fd21192a025418dc8e9'),
  ('ugc_grid', 'grid', 'social_proof', array['photo_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"}]}]},{"columns":[{"width":0.33,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false}]},{"width":0.33,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false}]},{"width":0.33,"slots":[{"kind":"image","role":"lifestyle","aspect":"1:1","bleed":false}]}]},{"columns":[{"width":1,"slots":[{"kind":"text","lines":1},{"kind":"button","style":"solid"}]}]}],"align":"center","background":"none","padding":"m"}', '67952ab1e205cfddf18d269b149525e4c9b925713ceaac7cec465b2e220643ce'),
  ('before_after', 'two_column', 'social_proof', array['photo_led']::text[], '{"rows":[{"columns":[{"width":0.5,"slots":[{"kind":"eyebrow"},{"kind":"image","role":"lifestyle","aspect":"4:5","bleed":false}]},{"width":0.5,"slots":[{"kind":"eyebrow"},{"kind":"image","role":"lifestyle","aspect":"4:5","bleed":false}]}]},{"columns":[{"width":1,"slots":[{"kind":"text","lines":1}]}]}],"align":"center","background":"none","padding":"m"}', '8f4e61c0a991de42b5e18b0592bcdf5b3b7e05780c25c43dfad3e792f6b9862e'),
  ('faq', 'list', 'education', array['text_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"heading","size":"m"},{"kind":"heading","size":"s"},{"kind":"text","lines":2},{"kind":"heading","size":"s"},{"kind":"text","lines":2}]}]}],"align":"left","background":"none","padding":"m"}', '5a75c6e2792c695cc14c08549369c879d705783b51a2ec3e9505dd919056ef17'),
  ('cta', 'single_column', 'call_to_action', array['minimal']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"button","style":"solid"}]}]}],"align":"center","background":"none","padding":"m"}', '098e3d855260ab8cb8e11e0217780bda9df04406e687a46f402bec906836c847'),
  ('signoff', 'single_column', 'closing', array['text_led']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"text","lines":2}]}]}],"align":"center","background":"none","padding":"m"}', '8474eeb324343e89073262f91a6c9477eea4d08efc5f15996b16e1814aadbc28'),
  ('footer', 'single_column', 'legal', array['minimal']::text[], '{"rows":[{"columns":[{"width":1,"slots":[{"kind":"social"},{"kind":"text","lines":3}]}]}],"align":"center","background":"none","padding":"m"}', 'efcae99cd69628d39972c76e391661e7ddec5b940d92e56f0900436c2242205b')
) as seed(family, layout, purpose, styles, spec, fingerprint)
on conflict (fingerprint) do nothing;

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant'));

-- An email of a brand whose tags are recorded (CI-001) is queued for its
-- variants, once per variant version, when it has a tagged section; an
-- unknown sender's email when an admin assigns it. A later re-tag does not
-- place a section again: a new tag version needs a `variants-v2` key.
create or replace function private.queue_inbox_variants()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.labelled_at is not null and coalesce(new.extraction_version, 0) >= 2
    and new.state = 'assigned' and new.capture_id is not null
    and exists (select 1 from public.email_sections s where s.inbox_message_id = new.id and s.tag_state = 'tagged') then
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('inbox.variant', new.id::text, 'inbox.variant:' || new.id || ':variants-v1')
      on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function private.queue_inbox_variants() from public, anon, authenticated;
create trigger queue_inbox_variants after update of labelled_at, extraction_version, state on public.inbox_messages
  for each row when (new.labelled_at is distinct from old.labelled_at or new.extraction_version is distinct from old.extraction_version
    or new.state is distinct from old.state)
  execute function private.queue_inbox_variants();

-- A batch of an email's sections, each once: a new variant (or, when its
-- structure is already there, evidence for that one), a variant found by
-- the structure read from the HTML, or left out. Rows are locked in
-- fingerprint order, so two jobs never wait on each other in a circle.
create or replace function public.record_block_variants(job uuid, lease uuid, sections jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.platform_jobs; message uuid; s jsonb; v jsonb; sec public.email_sections; variant uuid; state text; fam text;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  made integer := 0; matched integer := 0; dropped integer := 0;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.variant' then raise exception 'Not a variant job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  -- The email's row first, as the other commands on its sections take it.
  perform 1 from public.inbox_messages m where m.id = message and m.state = 'assigned' for update;
  if not found then raise exception 'Not a brand email' using errcode = '23514'; end if;
  if jsonb_typeof(sections) is distinct from 'array' or jsonb_array_length(sections) > 40
    or exists (select 1 from jsonb_array_elements(sections) e
      where jsonb_typeof(e) <> 'object' or coalesce(e->>'section_id', '') !~ uuid_re
        or coalesce(e->>'state', '') not in ('made','matched','no_structure','unusable')
        or (e->>'state' in ('made','matched') and coalesce(e->>'skeleton_fingerprint', '') !~ '^[a-f0-9]{64}$')
        or (e->>'state' = 'unusable' and e->>'skeleton_fingerprint' !~ '^[a-f0-9]{64}$')
        or (e->>'state' = 'matched' and coalesce(e->>'variant_id', '') !~ uuid_re)
        or (e->>'state' = 'made' and (jsonb_typeof(e->'variant') is distinct from 'object'
          or coalesce(e->'variant'->>'fingerprint', '') !~ '^[a-f0-9]{64}$'
          or coalesce(e->'variant'->>'pass', '') not in ('maker','skeleton')
          or jsonb_typeof(e->'variant'->'spec') is distinct from 'object'
          or (e->'variant' ? 'model' and jsonb_typeof(e->'variant'->'model') not in ('string','null'))))) then
    raise exception 'Invalid variants' using errcode = '23514';
  end if;
  for s in
    select e from jsonb_array_elements(sections) e
      left join public.block_variants b on b.id = case when e->>'state' = 'matched' then (e->>'variant_id')::uuid end
      order by coalesce(case when e->>'state' = 'made' then e->'variant'->>'fingerprint' else b.fingerprint end, ''), e->>'section_id'
  loop
    state := null;
    variant := null;
    select * into sec from public.email_sections
      where id = (s->>'section_id')::uuid and inbox_message_id = message for update;
    if sec.id is null then raise exception 'Unknown section' using errcode = '23514'; end if;
    -- Each section once: a retry adds no evidence.
    continue when sec.variant_state is not null;
    if sec.tag_state is distinct from 'tagged' then raise exception 'Section not tagged' using errcode = '23514'; end if;
    -- A person's own label (INB-004) wins, as in the email's block sequence.
    fam := coalesce(sec.owner_block_type, sec.block_type);
    if s->>'state' in ('no_structure','unusable') then
      update public.email_sections
        set variant_state = s->>'state', variant_version = 'variants-v1',
            skeleton_fingerprint = case when s->>'state' = 'unusable' then s->>'skeleton_fingerprint' end
        where id = sec.id;
      dropped := dropped + 1;
      continue;
    end if;
    if s->>'state' = 'made' then
      v := s->'variant';
      insert into public.block_variants (key, family, layout, purpose, styles, spec, fingerprint, source, pass, model, evidence)
        values (fam || '/' || left(v->>'fingerprint', 16), fam, sec.layout, sec.purpose, coalesce(sec.styles, '{}'), v->'spec', v->>'fingerprint', 'competitor',
          v->>'pass', left(nullif(btrim(coalesce(v->>'model', '')), ''), 100), 1)
        on conflict (fingerprint) do nothing
        returning id into variant;
      if variant is not null then
        state := 'made';
        made := made + 1;
      else
        select b2.id into variant from public.block_variants b2 where b2.fingerprint = v->>'fingerprint' and b2.family = fam;
      end if;
    else
      select b2.id into variant from public.block_variants b2 where b2.id = (s->>'variant_id')::uuid and b2.family = fam;
    end if;
    if state is distinct from 'made' or variant is null then
      if variant is null then raise exception 'Unknown variant' using errcode = '23514'; end if;
      update public.block_variants set evidence = evidence + 1, updated_at = now() where id = variant;
      state := 'matched';
      matched := matched + 1;
    end if;
    update public.email_sections
      set variant_id = variant, variant_state = state, variant_version = 'variants-v1',
          skeleton_fingerprint = s->>'skeleton_fingerprint'
      where id = sec.id;
  end loop;
  return jsonb_build_object('made', made, 'matched', matched, 'dropped', dropped);
end $$;

-- What the library already knows of these structures (read from the
-- sections' HTML): the variant with that fingerprint, or the one a section
-- with the same structure became, or that it could not be drawn.
create or replace function public.find_block_variants(keys text[])
returns table (fingerprint text, variant_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if keys is null or cardinality(keys) > 40 then raise exception 'Invalid keys' using errcode = '23514'; end if;
  return query
    select k.key, coalesce(b.id, seen.variant_id)
    from unnest(keys) as k(key)
    left join public.block_variants b on b.fingerprint = k.key
    left join lateral (
      select s.variant_id, s.variant_state from public.email_sections s
        where s.skeleton_fingerprint = k.key and s.variant_state in ('made','matched','unusable')
        order by s.variant_id is null, s.id limit 1
    ) seen on b.id is null
    where b.id is not null or seen.variant_state is not null;
end $$;

-- Variant jobs are put back the same way as tag jobs (time up, budget spent).
create or replace function public.defer_platform_job(job uuid, lease uuid, delay_seconds integer, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  j := private.platform_lease(job, lease);
  if j.kind not in ('inbox.label','inbox.variant') then
    raise exception 'Only tag and variant jobs are put back' using errcode = '23514';
  end if;
  if delay_seconds is null or delay_seconds not between 0 and 86400 or reason is null or reason !~ '^[a-z0-9_.-]{1,80}$' then
    raise exception 'Invalid delay' using errcode = '23514';
  end if;
  update public.platform_jobs
    set status = 'queued', lease_token = null, lease_expires_at = null, attempt = greatest(attempt - 1, 0),
        last_error_code = reason, available_at = now() + make_interval(secs => delay_seconds::double precision), updated_at = now()
    where id = j.id;
end $$;

-- A filter's values: one string, or a list of 1 to 20 strings.
create or replace function private.variant_filter(filters jsonb, key text)
returns text[] language sql immutable set search_path = '' as $$
  select case jsonb_typeof(filters->key)
    when 'string' then array[filters->>key]
    when 'array' then array(select jsonb_array_elements_text(filters->key))
  end;
$$;
revoke all on function private.variant_filter(jsonb, text) from public, anon, authenticated;

-- The library searched by every label: the variant's own (family, layout,
-- purpose, style, source) and the emails its sections came from (industry,
-- email type, offer type, season, angle, brand size). With an email label,
-- `matches` counts the sections from such emails and only variants seen in
-- them are returned; for a workspace member, only variants seen at 3 brands
-- or more, so a search never describes one brand's email. Structure only:
-- never a section, an email or a brand. The agents (service role) and
-- platform admins have no minimum.
create or replace function public.search_block_variants(filters jsonb default '{}', max_results integer default 50)
returns table (id uuid, key text, family text, layout text, purpose text, styles text[], spec jsonb, source text,
  evidence integer, matches integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(filters, '{}'::jsonb); k text; by_email boolean; min_brands integer := 1;
  section_keys constant text[] := array['family','layout','purpose','style','source'];
  email_keys constant text[] := array['industry','email_type','offer_type','season','angle','brand_size'];
  families text[]; layouts text[]; purposes text[]; styles_any text[]; sources text[];
  industries text[]; email_types text[]; offer_types text[]; seasons text[]; angles text[]; sizes text[];
begin
  if not (coalesce(auth.role(), '') = 'service_role' or private.is_operator()) then
    if not exists (
      select 1 from public.tenant_memberships m
        join public.profiles p on p.id = m.profile_id and p.status = 'active'
        join public.tenants t on t.id = m.tenant_id and t.status = 'active'
        where m.profile_id = (select auth.uid()) and m.status = 'active') then
      raise exception 'Access denied' using errcode = '42501';
    end if;
    min_brands := 3;
  end if;
  if jsonb_typeof(f) is distinct from 'object' or max_results is null or max_results not between 1 and 100 then
    raise exception 'Invalid search' using errcode = '23514';
  end if;
  for k in select jsonb_object_keys(f) loop
    if not (k = any(section_keys || email_keys))
      or jsonb_typeof(f->k) not in ('string','array')
      or (jsonb_typeof(f->k) = 'string' and length(f->>k) not between 1 and 40)
      or (jsonb_typeof(f->k) = 'array' and (jsonb_array_length(f->k) not between 1 and 20
        or exists (select 1 from jsonb_array_elements(f->k) e
          where jsonb_typeof(e) <> 'string' or length(e#>>'{}') not between 1 and 40))) then
      raise exception 'Invalid search' using errcode = '23514';
    end if;
  end loop;
  families := private.variant_filter(f, 'family'); layouts := private.variant_filter(f, 'layout');
  purposes := private.variant_filter(f, 'purpose'); styles_any := private.variant_filter(f, 'style');
  sources := private.variant_filter(f, 'source'); industries := private.variant_filter(f, 'industry');
  email_types := private.variant_filter(f, 'email_type'); offer_types := private.variant_filter(f, 'offer_type');
  seasons := private.variant_filter(f, 'season'); angles := private.variant_filter(f, 'angle');
  sizes := private.variant_filter(f, 'brand_size');
  by_email := f ?| email_keys;
  return query
    select b.id, b.key, b.family, b.layout, b.purpose, b.styles, b.spec, b.source, b.evidence, coalesce(seen.n, 0)::integer
    from public.block_variants b
    left join lateral (
      select count(*) as n, count(distinct m.capture_id) as brands from public.email_sections s
        join public.inbox_messages m on m.id = s.inbox_message_id
        where by_email and s.variant_id = b.id and m.state = 'assigned' and m.capture_id is not null
          and (industries is null or m.industry = any(industries))
          and (email_types is null or m.email_type = any(email_types))
          and (offer_types is null or m.offer_type = any(offer_types))
          and (seasons is null or m.season = any(seasons))
          and (angles is null or m.angle = any(angles))
          and (sizes is null or m.brand_size = any(sizes))
    ) seen on true
    where (families is null or b.family = any(families))
      and (layouts is null or b.layout = any(layouts))
      and (purposes is null or b.purpose = any(purposes))
      and (styles_any is null or b.styles && styles_any)
      and (sources is null or b.source = any(sources))
      and (not by_email or (seen.n > 0 and seen.brands >= min_brands))
    order by coalesce(seen.n, 0) desc, b.evidence desc, b.created_at, b.id
    limit max_results;
end $$;

revoke all on function public.record_block_variants(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.find_block_variants(text[]) from public, anon, authenticated;
grant execute on function public.record_block_variants(uuid, uuid, jsonb) to service_role;
grant execute on function public.find_block_variants(text[]) to service_role;
revoke all on function public.search_block_variants(jsonb, integer) from public, anon;
grant execute on function public.search_block_variants(jsonb, integer) to authenticated, service_role;

-- Emails tagged before this migration are queued now.
insert into public.platform_jobs(kind, subject_key, idempotency_key)
  select 'inbox.variant', m.id::text, 'inbox.variant:' || m.id || ':variants-v1'
    from public.inbox_messages m
    where m.labelled_at is not null and coalesce(m.extraction_version, 0) >= 2
      and m.state = 'assigned' and m.capture_id is not null
      and exists (select 1 from public.email_sections s where s.inbox_message_id = m.id and s.tag_state = 'tagged')
  on conflict do nothing;
