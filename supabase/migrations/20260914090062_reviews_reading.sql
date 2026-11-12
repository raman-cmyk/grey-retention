-- ONB-105 Reviews + social reader (AGENT_MAP §2, BUILD_BRIEF D19).
--
-- Customers' own words show what they love and worry about. A reviews read
-- (brand.read_reviews) reads the reviews the brand's own product pages
-- publish (schema.org review data) and the comments on its public social
-- posts; code chooses the reviews an email may quote (a real review read
-- on the brand's own page, its author as shown and its exact words) and
-- the review apps shown; the reader says what customers love, worry about
-- and say, citing the reviews or comments with their words.
--
-- * Findings go to brand_findings under `reviews` (from reviews) and
--   `social` (from comments), with new topics: `review_theme`,
--   `objection`, `customer_words` (words only) and `quotable_review`
--   ({author, url, rating?, date?}, its exact words the evidence's quote).
-- * Each source of a read is ready, none (nothing there: its earlier
--   findings are replaced) or skipped (not read: nothing replaced, D16).
--
-- A real brand's reviews are read from its own pages only with the
-- owner's SITE_READER_MODE=live; its social comments are not read yet
-- (the route is the owner's choice). Like the other source reads, reviews
-- reads run only in the onboarding readers' run. Locks: the tenant first,
-- then the job.

alter table public.brand_findings drop constraint brand_findings_topic_check,
  add constraint brand_findings_topic_check check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping',
    'locale','price_band','offering','audience','tone','claim','contact','review_platform','performance','promotion','angle',
    'creative','landing_page','review_theme','objection','customer_words','quotable_review')),
  add constraint brand_findings_reviews_topics
    check (source <> 'reviews' or topic in ('review_platform','claim','audience','review_theme','objection','customer_words',
      'quotable_review')),
  add constraint brand_findings_social_topics
    check (source <> 'social' or topic in ('audience','tone','claim','offering','review_theme','objection','customer_words'));

-- The value each topic holds, as before (20260914090061), with the
-- reviews topics.
create or replace function private.finding_value_ok(topic text, v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  whole_days constant text := '^[0-9]{1,4}$';
  money constant text := '^[0-9]{1,7}(\.[0-9]{1,2})?$';
begin
  if jsonb_typeof(v) is distinct from 'object' or length(v::text) > 1000 then return false; end if;
  case topic
    when 'free_shipping' then
      if v->>'kind' in ('always','never') then return coalesce(v - 'kind' = '{}'::jsonb, false); end if;
      return coalesce(v->>'kind' = 'over' and jsonb_typeof(v->'amount') = 'number' and v->>'amount' ~ money
        and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$' and v - 'kind' - 'amount' - 'currency' = '{}'::jsonb, false);
    when 'returns', 'guarantee' then
      return coalesce(jsonb_typeof(v->'days') = 'number' and v->>'days' ~ whole_days and (v->>'days')::integer <= 3650
        and v - 'days' = '{}'::jsonb, false);
    when 'delivery_days' then
      if jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number'
        or v->>'min' !~ '^[0-9]{1,2}$' or v->>'max' !~ '^[0-9]{1,2}$' then return false; end if;
      return coalesce((v->>'min')::integer <= (v->>'max')::integer and (v->>'max')::integer <= 90
        and (not v ? 'region' or (jsonb_typeof(v->'region') = 'string' and length(v->>'region') between 2 and 60))
        and v - 'min' - 'max' - 'region' = '{}'::jsonb, false);
    when 'locale' then
      return coalesce(v->>'language', '') ~ '^[a-z]{2}$' and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$'
        and v - 'language' - 'currency' = '{}'::jsonb;
    when 'price_band' then
      if jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number'
        or v->>'min' !~ money or v->>'max' !~ money then return false; end if;
      return coalesce((v->>'min')::numeric <= (v->>'max')::numeric and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$'
        and v - 'min' - 'max' - 'currency' = '{}'::jsonb, false);
    when 'claim' then
      return coalesce(v->>'subject' in ('brand','product')
        and (not v ? 'productId' or (jsonb_typeof(v->'productId') = 'string' and length(v->>'productId') between 1 and 100))
        and v - 'subject' - 'productId' = '{}'::jsonb, false);
    when 'review_platform' then
      return coalesce(jsonb_typeof(v->'name') = 'string' and length(v->>'name') between 2 and 60
        and jsonb_typeof(v->'verified') = 'boolean'
        and (not v ? 'rating' or (jsonb_typeof(v->'rating') = 'number' and (v->>'rating')::numeric between 0 and 5))
        and (not v ? 'count' or (jsonb_typeof(v->'count') = 'number' and v->>'count' ~ '^[0-9]{1,9}$'))
        and v - 'name' - 'verified' - 'rating' - 'count' = '{}'::jsonb, false);
    when 'promotion' then
      if v->>'kind' in ('gift','bundle') then return coalesce(v - 'kind' = '{}'::jsonb, false); end if;
      if v->>'kind' = 'percent_off' then
        return coalesce(jsonb_typeof(v->'percent') = 'number' and v->>'percent' ~ '^[0-9]{1,2}$'
          and (v->>'percent')::integer between 1 and 90 and v - 'kind' - 'percent' = '{}'::jsonb, false);
      end if;
      return coalesce(v->>'kind' = 'amount_off' and jsonb_typeof(v->'amount') = 'number' and v->>'amount' ~ money
        and (v->>'amount')::numeric > 0
        and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$' and v - 'kind' - 'amount' - 'currency' = '{}'::jsonb, false);
    when 'landing_page' then
      return coalesce(jsonb_typeof(v->'url') = 'string' and length(v->>'url') <= 500
        and private.https_host(v->>'url') is not null and v - 'url' = '{}'::jsonb, false);
    when 'quotable_review' then
      return coalesce(jsonb_typeof(v->'author') = 'string' and length(btrim(v->>'author')) between 1 and 80
        and jsonb_typeof(v->'url') = 'string' and length(v->>'url') <= 500 and private.https_host(v->>'url') is not null
        and (not v ? 'rating' or (jsonb_typeof(v->'rating') = 'number' and v->>'rating' ~ '^[1-5]$'))
        and (not v ? 'date' or (jsonb_typeof(v->'date') = 'string' and v->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
        and v - 'author' - 'url' - 'rating' - 'date' = '{}'::jsonb, false);
    when 'shipping', 'offering', 'audience', 'tone', 'contact', 'performance', 'angle', 'creative', 'review_theme', 'objection',
      'customer_words' then
      return coalesce(v = '{}'::jsonb, false);
    else
      return false;
  end case;
end $$;

alter table public.job_runs drop constraint job_runs_kind_check,
  add constraint job_runs_kind_check check (kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule',
    'assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan',
    'reviews.remind','design.render','ops.health','results.pull','reports.digest','learning.synthesize','optimizer.winback',
    'optimizer.suppress','email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history',
    'brand.read_ads','brand.read_reviews'));

-- The owner starts a reviews read: the brand's website is needed (its
-- product pages hold the reviews); at most once a day; a failed read is
-- started again. A synthetic brand reads the samples, a real brand its
-- own pages.
create or replace function public.start_reviews_reading(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d text; synthetic boolean; mode text; j uuid;
begin
  perform private.require_member(t, true);
  select private.site_domain(b.domain), b.synthetic into d, synthetic from public.brand_profiles b where b.tenant_id = t;
  if d is null then raise exception 'Add the brand''s website first' using errcode = '23514'; end if;
  mode := case when synthetic then 'sample' else 'live' end;
  insert into public.job_runs(tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'brand.read_reviews', 'brand.read_reviews:' || mode || ':' || d || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('domain', d, 'mode', mode), auth.uid())
    on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into j;
  update public.job_runs set status = 'queued', attempt = 0, available_at = now(), failure_class = null, error_code = null,
      lease_token = null, lease_until = null, checkpoint = '{}'::jsonb, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- A public post a comment was read on.
create or replace function private.social_post_ok(url text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(url) <= 500 and private.https_host(url) in ('instagram.com','www.instagram.com','facebook.com',
    'www.facebook.com','m.facebook.com','tiktok.com','www.tiktok.com'), false);
$$;
revoke all on function private.social_post_ok(text) from public, anon, authenticated;

-- A source's part of a reviews read's summary: ready, none or skipped.
create or replace function private.reviews_part_ok(part jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(part) = 'object' and part->>'state' in ('ready','none','skipped')
    and part - 'state' - 'reason' = '{}'::jsonb
    and (not part ? 'reason' or (jsonb_typeof(part->'reason') = 'string' and part->>'reason' ~ '^[a-z_]{1,40}$')), false);
$$;
revoke all on function private.reviews_part_ok(jsonb) from public, anon, authenticated;

-- A reviews read's result, all at once; then the job is finished. Each
-- finding cites a page of the brand's own site read here (reviews) or a
-- public post read here (comments), with the words it says; a quotable
-- review names the page it is on. A source read (ready or none) replaces
-- that source's earlier findings; a skipped one replaces nothing; an older
-- read finishing after a newer one replaces nothing, its findings kept
-- already replaced; a real brand's read never leaves sample findings
-- standing. Locks: the tenant first, then the job.
create or replace function public.record_review_findings(job uuid, lease uuid, findings jsonb, pages jsonb, posts jsonb,
    summary jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; d text; n_findings integer := 0; read_pages text[]; read_posts text[];
  newer_reviews boolean; newer_social boolean;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_reviews' then raise exception 'Not a reviews reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null or live is null or live is distinct from (coalesce(j.input->>'mode', '') = 'live') then
    raise exception 'Invalid reviews reading' using errcode = '23514';
  end if;
  -- The samples only for a synthetic brand, also when they are stored.
  if not live and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = j.tenant_id), false) then
    raise exception 'Invalid reviews reading' using errcode = '23514';
  end if;
  if jsonb_typeof(summary) is distinct from 'object' or summary - 'reviews' - 'social' - 'analysis' <> '{}'::jsonb
    or not private.reviews_part_ok(summary->'reviews') or not private.reviews_part_ok(summary->'social')
    or coalesce(summary->>'analysis', '') not in ('done','skipped')
    or (summary->>'analysis' = 'done' and summary->'reviews'->>'state' = 'skipped' and summary->'social'->>'state' = 'skipped') then
    raise exception 'Invalid reviews summary' using errcode = '23514';
  end if;
  -- The pages read (the brand's own) and the posts read (public profiles).
  if jsonb_typeof(pages) is distinct from 'array' or jsonb_array_length(pages) > 12
    or exists (select 1 from jsonb_array_elements(pages) p where jsonb_typeof(p) <> 'string' or not private.ad_link_ok(p #>> '{}', d))
    or (select count(distinct p #>> '{}') from jsonb_array_elements(pages) p) <> jsonb_array_length(pages)
    or (summary->'reviews'->>'state' = 'skipped' and jsonb_array_length(pages) > 0)
    or jsonb_typeof(posts) is distinct from 'array' or jsonb_array_length(posts) > 30
    or exists (select 1 from jsonb_array_elements(posts) p where jsonb_typeof(p) <> 'string' or not private.social_post_ok(p #>> '{}'))
    or (select count(distinct p #>> '{}') from jsonb_array_elements(posts) p) <> jsonb_array_length(posts)
    or (summary->'social'->>'state' = 'skipped' and jsonb_array_length(posts) > 0) then
    raise exception 'Invalid reviews pages' using errcode = '23514';
  end if;
  select coalesce(array_agg(p #>> '{}'), '{}') into read_pages from jsonb_array_elements(pages) p;
  select coalesce(array_agg(p #>> '{}'), '{}') into read_posts from jsonb_array_elements(posts) p;
  if jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 40
    or exists (select 1 from jsonb_array_elements(findings) f
      where jsonb_typeof(f) <> 'object'
        or f - 'source' - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
        or coalesce(f->>'source', '') not in ('reviews','social')
        or summary->(f->>'source')->>'state' is distinct from 'ready'
        or (f->>'source' = 'reviews' and coalesce(f->>'topic', '') not in ('review_platform','audience','review_theme','objection',
          'customer_words','quotable_review'))
        or (f->>'source' = 'social' and coalesce(f->>'topic', '') not in ('audience','review_theme','objection','customer_words'))
        or jsonb_typeof(f->'statement') is distinct from 'string'
        or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
        or coalesce(f->>'pass', '') not in ('sample','model','code')
        or (f->>'pass' = 'sample') = live
        or (f->>'pass' = 'code' and (f->>'topic' not in ('quotable_review','review_platform') or coalesce(f->>'model', '') <> ''))
        or (f->>'pass' = 'model' and (coalesce(btrim(f->>'model'), '') = '' or summary->>'analysis' <> 'done'
          or f->>'topic' in ('quotable_review','review_platform')))
        or (f ? 'model' and coalesce(jsonb_typeof(f->'model'), 'missing') not in ('string','null'))
        or jsonb_typeof(f->'evidence') is distinct from 'object'
        -- A review app's rating cites a page's review data.
        or (f->>'topic' = 'review_platform' and ((f->'evidence') - 'ref' <> '{}'::jsonb
          or not coalesce(f->'evidence'->>'ref' = any(array(select left('review-data:' || p, 200) from unnest(read_pages) p)), false)))
        -- Anything else cites a page or a post read here with its words.
        or (f->>'topic' <> 'review_platform' and ((f->'evidence') - 'url' - 'quote' <> '{}'::jsonb
          or jsonb_typeof(f->'evidence'->'url') is distinct from 'string'
          or not coalesce(f->'evidence'->>'url' = any(case when f->>'source' = 'reviews' then read_pages else read_posts end), false)
          or jsonb_typeof(f->'evidence'->'quote') is distinct from 'string'
          or length(f->'evidence'->>'quote') not between 1 and 300))
        -- A quotable review names the page it is on.
        or (f->>'topic' = 'quotable_review' and f->'value'->>'url' is distinct from f->'evidence'->>'url')) then
    raise exception 'Invalid finding' using errcode = '23514';
  end if;
  newer_reviews := exists (select 1 from public.job_runs r
    where r.tenant_id = j.tenant_id and r.kind = 'brand.read_reviews' and r.id <> j.id and r.status = 'succeeded'
      and r.created_at > j.created_at and r.checkpoint->'reviews'->>'state' in ('ready','none'));
  newer_social := exists (select 1 from public.job_runs r
    where r.tenant_id = j.tenant_id and r.kind = 'brand.read_reviews' and r.id <> j.id and r.status = 'succeeded'
      and r.created_at > j.created_at and r.checkpoint->'social'->>'state' in ('ready','none'));
  if not newer_reviews and summary->'reviews'->>'state' in ('ready','none') then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'reviews' and superseded_at is null;
  end if;
  if not newer_social and summary->'social'->>'state' in ('ready','none') then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'social' and superseded_at is null;
  end if;
  -- A real brand's read, even a skipped one, never leaves sample findings
  -- standing (a brand that was synthetic before).
  if live then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source in ('reviews','social') and pass = 'sample' and superseded_at is null;
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, e->>'source', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when (e->>'source' = 'reviews' and newer_reviews) or (e->>'source' = 'social' and newer_social) then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n_findings = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('reviews', summary->'reviews', 'social', summary->'social', 'analysis', summary->>'analysis',
          'pages', jsonb_array_length(pages), 'posts', jsonb_array_length(posts), 'findings', n_findings, 'live', live,
          'newerReviews', newer_reviews, 'newerSocial', newer_social)
    where id = j.id;
  return jsonb_build_object('findings', n_findings, 'newerReviews', newer_reviews, 'newerSocial', newer_social);
end $$;

-- Source reads are the worker's: as before (20260914090061), reviews
-- reads too.
create or replace function private.onboarding_lease(job uuid, lease uuid)
returns public.job_runs language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; t uuid;
begin
  select tenant_id into t from public.job_runs where id = job;
  if t is null or not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  select * into j from public.job_runs where id = job for update;
  if j.kind in ('email.rewrite','email.import') then raise exception 'Access denied' using errcode = '42501'; end if;
  if j.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if j.status <> 'running' or j.lease_token is distinct from lease or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return j;
end $$;

-- The workspace jobs never take a source read: as before
-- (20260914090061), reviews reads too.
create or replace function public.claim_job(t uuid) returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare j public.job_runs;
begin
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease'
    where tenant_id = t and status in ('leased','running') and lease_until < now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads',
        'brand.read_reviews');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads',
        'brand.read_reviews')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

drop index public.job_runs_source_reads;
create index job_runs_source_reads on public.job_runs (available_at, created_at)
  where kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews');

-- The source reads waiting, and the next one, across active workspaces:
-- as before (20260914090061), reviews reads too.
create or replace function public.source_readings_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select case when coalesce(auth.role(), '') <> 'service_role' then null else (
    select count(*)::integer from public.job_runs j join public.tenants t on t.id = j.tenant_id and t.status = 'active'
      where j.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews')
        and ((j.status in ('queued','retry_wait') and j.attempt < 4 and j.available_at <= now())
          or (j.status in ('leased','running') and j.lease_until < now()))) end;
$$;

create or replace function public.claim_source_reading() returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare candidate uuid; tenant uuid; j public.job_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  select r.id, r.tenant_id into candidate, tenant from public.job_runs r
    join public.tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews')
      and ((r.status in ('queued','retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased','running') and r.lease_until < now()))
    order by r.available_at, r.created_at limit 1;
  if candidate is null then return; end if;
  perform 1 from public.tenants where id = tenant and status = 'active' for update;
  if not found then return; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now()
    where tenant_id = tenant and kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews')
      and status in ('leased','running') and lease_until < now();
  select * into j from public.job_runs
    where id = candidate and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.start_reviews_reading(uuid) from public, anon, service_role;
grant execute on function public.start_reviews_reading(uuid) to authenticated;
revoke all on function public.record_review_findings(uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_review_findings(uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;
