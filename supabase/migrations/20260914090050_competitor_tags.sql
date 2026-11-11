-- CI-001: multi-label competitor intelligence (AGENT_MAP §1, D18).
--
-- Every competitor email gets one value per email label (industry, email
-- type, offer type, season, angle, brand size) and every section a family,
-- a layout, a purpose and up to three styles, from fixed lists (the same
-- lists as features/intelligence/taxonomy.ts; a unit test compares them).
-- The 20 seed block types are the 20 families: a section's family stays in
-- `block_type`, which lane A's copy mode reads. What the agents could not
-- tag surely, even on the larger model, is `untagged` (no labels, left out
-- of search): no person is asked (D16).

alter table public.email_sections
  add column layout text check (layout in ('single_column','two_column','three_column','grid','image_left','image_right',
    'full_width_image','text_over_image','cards','list','strip','other')),
  add column purpose text check (purpose in ('brand_header','navigation','announcement','hook','product_showcase','offer',
    'social_proof','education','story','urgency','call_to_action','closing','legal')),
  add column styles text[] check (styles <@ array['minimal','bold','playful','luxury','editorial','photo_led','text_led',
    'illustrated','dark','colourful']::text[] and cardinality(styles) <= 3),
  add column tag_state text check (tag_state in ('tagged','untagged')),
  add column tag_pass text check (tag_pass in ('sample','fast','strong')),
  -- The tagging rules' version: a section tagged at the current one is not
  -- asked again (a retry pays only for what is left).
  add column tag_version text check (tag_version ~ '^[a-z0-9.-]{1,40}$'),
  -- A tagged section has every label; an untagged one has none.
  add constraint email_sections_tags_whole check (
    tag_state is null
    or (tag_state = 'tagged' and coalesce(block_type, 'unsure') <> 'unsure' and layout is not null and purpose is not null
        and styles is not null and confidence is not null and tag_pass is not null and tag_version is not null)
    or (tag_state = 'untagged' and coalesce(block_type, '') = 'unsure' and layout is null and purpose is null and styles is null
        and tag_pass is not null and tag_version is not null));

-- The email labels, on the inbox copy (admins) and on the competitor email
-- (workspaces that follow the brand read it, under its existing policies).
do $$
declare t text;
begin
  foreach t in array array['inbox_messages', 'competitor_emails'] loop
    execute format($f$
      alter table public.%1$I
        add column industry text check (industry in ('apparel','accessories','jewelry','skincare','beauty','beauty_tools','haircare',
          'supplements','wellness','fitness','food_drink','kitchen','home','pet','baby','outdoor','electronics','other')),
        add column email_type text check (email_type in ('launch','new_arrivals','bestsellers','restock','sale','holiday','collection',
          'education','story','social_proof','bundle','gift_guide','announcement','newsletter','other')),
        add column offer_type text check (offer_type in ('none','percent_off','amount_off','free_shipping','bogo','gift_with_purchase',
          'bundle_price','tiered','early_access','loyalty','other')),
        add column season text check (season in ('none','new_year','valentines','spring','easter','mothers_day','summer','fathers_day',
          'back_to_school','autumn','halloween','black_friday','cyber_monday','holiday','winter')),
        add column angle text check (angle in ('product_benefit','problem_solution','newness','scarcity','urgency','value','social_proof',
          'founder_story','education','lifestyle','exclusivity','gifting','community','sustainability','other')),
        add column brand_size text check (brand_size in ('small','mid','large','unknown')),
        add column labels_confidence numeric(3,2) check (labels_confidence between 0 and 1),
        add column labels_state text check (labels_state in ('tagged','untagged')),
        add column labels_pass text check (labels_pass in ('sample','fast','strong')),
        add column labels_model text check (length(labels_model) between 1 and 100),
        add constraint %1$s_labels_whole check (
          labels_state is null
          or (labels_state = 'tagged' and industry is not null and email_type is not null and offer_type is not null
              and season is not null and angle is not null and brand_size is not null and labels_confidence is not null
              and labels_pass is not null)
          or (labels_state = 'untagged' and industry is null and email_type is null and offer_type is null and season is null
              and angle is null and brand_size is null and labels_confidence is null and labels_pass is not null))
    $f$, t);
  end loop;
end $$;

-- Library search reads only what was tagged surely.
create index competitor_emails_labels on public.competitor_emails (industry, email_type, season)
  where labels_state = 'tagged';
create index email_sections_tags on public.email_sections (block_type, layout, purpose)
  where tag_state = 'tagged';

-- An email assigned to its brand later brings its screenshot, facts and
-- labels. FOR SHARE waits for a screenshot or tagging job writing the
-- message right now, so the copy is never taken from before its commit.
create or replace function private.competitor_email_screenshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.inbox_message_id is not null then
    select coalesce(new.screenshot_path, m.screenshot_path), coalesce(new.screenshot_width, m.screenshot_width),
           coalesce(new.screenshot_height, m.screenshot_height), coalesce(new.facts, m.facts),
           coalesce(new.labelled_at, m.labelled_at), coalesce(new.extraction_version, m.extraction_version)
      into new.screenshot_path, new.screenshot_width, new.screenshot_height, new.facts, new.labelled_at,
           new.extraction_version
      from public.inbox_messages m where m.id = new.inbox_message_id for share;
    -- The labels come whole from the message, unless the caller gave its own.
    if new.labels_state is null then
      select m.labels_state, m.industry, m.email_type, m.offer_type, m.season, m.angle, m.brand_size, m.labels_confidence,
             m.labels_pass, m.labels_model
        into new.labels_state, new.industry, new.email_type, new.offer_type, new.season, new.angle, new.brand_size,
             new.labels_confidence, new.labels_pass, new.labels_model
        from public.inbox_messages m where m.id = new.inbox_message_id;
    end if;
  end if;
  return new;
end $$;

-- The tagging worker records sections as it tags them, in batches, so a
-- retry or a run cut short pays only for what is left. The lists are the
-- columns' checks (23514 for anything else). An email already tagged at
-- this facts version is not changed.
create or replace function public.record_section_tags(job uuid, lease uuid, sections jsonb, tag_version text)
returns integer language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; m public.inbox_messages; s jsonb; changed integer := 0; n integer; tagged boolean;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.label' then raise exception 'Not a label job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  if tag_version is null or tag_version !~ '^[a-z0-9.-]{1,40}$' or jsonb_typeof(sections) is distinct from 'array'
    or jsonb_array_length(sections) > 40 then
    raise exception 'Invalid tags' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(sections) e
      where jsonb_typeof(e->'ordinal') is distinct from 'number' or (e->>'ordinal') !~ '^[1-9][0-9]?$' or (e->>'ordinal')::integer > 40
        or coalesce(e->>'state', '') not in ('tagged', 'untagged') or coalesce(e->>'pass', '') not in ('sample', 'fast', 'strong')
        or (e ? 'model' and jsonb_typeof(e->'model') not in ('string', 'null'))
        or (e->>'state' = 'tagged' and (jsonb_typeof(e->'styles') is distinct from 'array'
          or case when jsonb_typeof(e->'confidence') = 'number' then (e->>'confidence')::numeric not between 0 and 1 else true end))) then
    raise exception 'Invalid tags' using errcode = '23514';
  end if;
  select * into m from public.inbox_messages where id = message for update;
  for s in select * from jsonb_array_elements(sections) loop
    tagged := s->>'state' = 'tagged';
    update public.email_sections
      set block_type = case when tagged then s->>'family' else 'unsure' end,
          layout = case when tagged then s->>'layout' end,
          purpose = case when tagged then s->>'purpose' end,
          styles = case when tagged then array(select distinct v from jsonb_array_elements_text(s->'styles') v order by v) end,
          confidence = case when tagged then round((s->>'confidence')::numeric, 2) end,
          label_source = case when s->>'pass' = 'sample' then 'sample' else 'gemini' end,
          label_model = left(nullif(btrim(coalesce(s->>'model', '')), ''), 100),
          tag_state = s->>'state', tag_pass = s->>'pass', tag_version = record_section_tags.tag_version, labelled_at = now()
      where inbox_message_id = message and ordinal = (s->>'ordinal')::integer;
    get diagnostics n = row_count;
    changed := changed + n;
  end loop;
  return changed;
end $$;

-- Then the email's labels (or untagged) and its facts, once per version,
-- on the inbox copy and on the competitor email.
create or replace function public.record_inbox_tags(job uuid, lease uuid, email jsonb, facts jsonb, version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; message uuid; m public.inbox_messages; labelled boolean;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.label' then raise exception 'Not a label job' using errcode = '23514'; end if;
  message := j.subject_key::uuid;
  if version is null or version < 1 or jsonb_typeof(email) is distinct from 'object' or jsonb_typeof(facts) is distinct from 'object'
    or length(facts::text) > 8000 or coalesce(email->>'state', '') not in ('tagged', 'untagged')
    or coalesce(email->>'pass', '') not in ('sample', 'fast', 'strong')
    or (email ? 'model' and jsonb_typeof(email->'model') not in ('string', 'null'))
    or (email->>'state' = 'tagged' and case when jsonb_typeof(email->'confidence') = 'number'
          then (email->>'confidence')::numeric not between 0 and 1 else true end) then
    raise exception 'Invalid tags' using errcode = '23514';
  end if;
  select * into m from public.inbox_messages where id = message for update;
  if m.labelled_at is not null and m.extraction_version >= version then
    return jsonb_build_object('already', true);
  end if;
  labelled := email->>'state' = 'tagged';
  update public.inbox_messages
    set facts = record_inbox_tags.facts, labelled_at = now(), extraction_version = version,
        industry = case when labelled then email->>'industry' end, email_type = case when labelled then email->>'email_type' end,
        offer_type = case when labelled then email->>'offer_type' end, season = case when labelled then email->>'season' end,
        angle = case when labelled then email->>'angle' end, brand_size = case when labelled then email->>'brand_size' end,
        labels_confidence = case when labelled then round((email->>'confidence')::numeric, 2) end,
        labels_state = email->>'state', labels_pass = email->>'pass',
        labels_model = left(nullif(btrim(coalesce(email->>'model', '')), ''), 100)
    where id = message;
  update public.competitor_emails c
    set facts = m2.facts, labelled_at = m2.labelled_at, extraction_version = m2.extraction_version,
        industry = m2.industry, email_type = m2.email_type, offer_type = m2.offer_type, season = m2.season, angle = m2.angle,
        brand_size = m2.brand_size, labels_confidence = m2.labels_confidence, labels_state = m2.labels_state,
        labels_pass = m2.labels_pass, labels_model = m2.labels_model
    from public.inbox_messages m2
    where m2.id = message and c.inbox_message_id = message;
  return jsonb_build_object('already', false, 'labels', email->>'state');
end $$;

-- A tag job put back without using up a try: the run's time is up, or the
-- platform's AI budget is spent for the day (D16: nothing waits for a
-- person; the job simply runs later).
create or replace function public.defer_platform_job(job uuid, lease uuid, delay_seconds integer, reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.label' then raise exception 'Only tag jobs are put back' using errcode = '23514'; end if;
  if delay_seconds is null or delay_seconds not between 0 and 86400 or reason is null or reason !~ '^[a-z0-9_.-]{1,80}$' then
    raise exception 'Invalid delay' using errcode = '23514';
  end if;
  update public.platform_jobs
    set status = 'queued', lease_token = null, lease_expires_at = null, attempt = greatest(attempt - 1, 0),
        last_error_code = reason, available_at = now() + make_interval(secs => delay_seconds::double precision), updated_at = now()
    where id = j.id;
end $$;

revoke all on function public.record_section_tags(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.record_inbox_tags(uuid, uuid, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public.defer_platform_job(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.record_section_tags(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.record_inbox_tags(uuid, uuid, jsonb, jsonb, integer) to service_role;
grant execute on function public.defer_platform_job(uuid, uuid, integer, text) to service_role;

-- The one-of-20 labeller's command is retired: a worker still running the
-- old code while the new one deploys fails its job (it is retried by the
-- new worker) instead of marking an email labelled at version 1.
revoke execute on function public.record_inbox_labels(uuid, uuid, jsonb, jsonb, integer) from service_role;

-- Browser roles never write competitor emails (only the commands do), the
-- same as the other inbox tables; their reads stay under RLS.
revoke insert, update, delete, truncate, references, trigger on public.competitor_emails from public, anon, authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.competitor_emails from public, anon, authenticated';
  end if;
end $$;

-- Emails tagged with the one-of-20 labeller (version 1) are tagged again
-- with the new labels, after the new worker is deployed. Safe to run again.
insert into public.platform_jobs(kind, subject_key, idempotency_key, available_at)
  select 'inbox.label', m.id::text, 'inbox.label:' || m.id || ':v2', now() + interval '30 minutes'
    from public.inbox_messages m
    where m.labelled_at is not null and m.extraction_version < 2 and m.state in ('assigned', 'unassigned')
  on conflict do nothing;
