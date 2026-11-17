-- REL-ONB2 part e: the photos customers posted with their reviews.
--
-- "Create email" may show a grid of customers' photos only with real
-- photos the store's own customers posted with their reviews on the
-- store's own pages (the owner's rule of 16 November: from the store's own
-- sources only, nothing invented). The Reviews reader keeps them from the
-- pages' review data, by code, of a live read only.
--
-- * A new reviews topic, `customer_photo` ({url, page, product?}): the
--   photo's address (https, a JPEG or PNG, at most 500 characters), the
--   page it was read on and, when the page names it, the product (at most
--   120 characters). Never the reviewer's name or words. Its evidence cites
--   the page's review data (`ref`), as a review app's does.
-- * `record_review_findings` keeps at most 12 a read, each once, chosen by
--   code (`pass` `code`), on a page read here, on the store's own domain
--   (or a subdomain), a store's folder on Shopify's CDN
--   (`/s/files/1/…/`) or the one review app image host confirmed
--   (Judge.me's `judgeme.imgix.net`), each once (by its host and path),
--   and all its Shopify CDN photos in one folder. A photo's address has a
--   plain host (letters, digits, hyphens and dots: never a `\`, a `%` or a
--   name and password) and only URL-safe characters (`photo_url_ok`). The
--   reader also checks that the folder is the one the product's own
--   pictures use and that the page loads the app.
--
-- Everything else as before (20260914090062, 20260914090089). Locks: the
-- tenant first, then the job (`private.onboarding_lease`). RLS unchanged.

alter table public.brand_findings drop constraint brand_findings_topic_check,
  add constraint brand_findings_topic_check check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping',
    'locale','price_band','offering','audience','tone','claim','contact','review_platform','performance','promotion','angle',
    'creative','landing_page','review_theme','objection','customer_words','quotable_review','founder','customer_photo')),
  drop constraint brand_findings_reviews_topics,
  add constraint brand_findings_reviews_topics
    check (source <> 'reviews' or topic in ('review_platform','claim','audience','review_theme','objection','customer_words',
      'quotable_review','customer_photo'));

-- A customer's photo's address as it is kept: https, a plain host of
-- lower-case labels (nothing a browser reads another way: no `\`, `%`, `@`
-- or port), a path, query and fragment of URL-safe characters only (no
-- space, quote, `<`, `>` or `\`), a JPEG or PNG, at most 500 characters.
create or replace function private.photo_url_ok(url text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(url) <= 500
    and url ~ ('^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+'
      || '/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*\.([jJ][pP][eE]?[gG]|[pP][nN][gG])'
      || '(\?[A-Za-z0-9._~!$&''()*+,;=:@%/?-]*)?(#[A-Za-z0-9._~!$&''()*+,;=:@%/?-]*)?$'), false);
$$;
revoke all on function private.photo_url_ok(text) from public, anon, authenticated;

-- The value each topic holds, as before (20260914090089), with customers'
-- photos.
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
      -- A day, when given, is a real one.
      if v ? 'date' then
        if jsonb_typeof(v->'date') is distinct from 'string' or v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
        begin
          if to_char(to_date(v->>'date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v->>'date' then return false; end if;
        exception when others then
          return false;
        end;
      end if;
      return coalesce(jsonb_typeof(v->'author') = 'string' and v->>'author' ~ '[^[:space:]]' and length(v->>'author') <= 80
        and jsonb_typeof(v->'url') = 'string' and length(v->>'url') <= 500 and private.https_host(v->>'url') is not null
        and (not v ? 'rating' or (jsonb_typeof(v->'rating') = 'number' and v->>'rating' ~ '^[1-5]$'))
        and v - 'author' - 'url' - 'rating' - 'date' = '{}'::jsonb, false);
    when 'founder' then
      -- The founder's name and role as the page writes them; the note is the evidence's quote.
      return coalesce(jsonb_typeof(v->'name') = 'string' and v->>'name' ~ '[^[:space:]]' and length(v->>'name') <= 60
        and (not v ? 'role' or (jsonb_typeof(v->'role') = 'string' and v->>'role' ~ '[^[:space:]]' and length(v->>'role') <= 60))
        and v - 'name' - 'role' = '{}'::jsonb, false);
    when 'customer_photo' then
      -- A JPEG or PNG over https, the page it was read on, the product when named; never anyone's name or words.
      return coalesce(jsonb_typeof(v->'url') = 'string' and private.photo_url_ok(v->>'url')
        and jsonb_typeof(v->'page') = 'string' and length(v->>'page') <= 500 and private.https_host(v->>'page') is not null
        and (not v ? 'product' or (jsonb_typeof(v->'product') = 'string' and v->>'product' ~ '[^[:space:]]'
          and length(v->>'product') <= 120))
        and v - 'url' - 'page' - 'product' = '{}'::jsonb, false);
    when 'shipping', 'offering', 'audience', 'tone', 'contact', 'performance', 'angle', 'creative', 'review_theme', 'objection',
      'customer_words' then
      return coalesce(v = '{}'::jsonb, false);
    else
      return false;
  end case;
end $$;
revoke all on function private.finding_value_ok(text, jsonb) from public, anon, authenticated;

-- A customer's photo on a host that may be the store's, its address kept
-- as `photo_url_ok` says: its own domain (or a subdomain, plain labels:
-- `ad_link_ok`), a store's folder on Shopify's CDN, or a review app's
-- confirmed image host.
create or replace function private.review_photo_host_ok(url text, domain text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(private.photo_url_ok(url) and (private.ad_link_ok(url, domain)
    or url ~ '^https://cdn\.shopify\.com/s/files/1/[0-9]{4}/[0-9]{4}/([0-9]{4}/)?[A-Za-z]'
    or private.https_host(url) in ('judgeme.imgix.net')), false);
$$;
revoke all on function private.review_photo_host_ok(text, text) from public, anon, authenticated;

-- A reviews read's result, all at once, as before (20260914090062), with
-- customers' photos: chosen by code on a live read, at most 12, each once,
-- citing the review data of a page read here, on a host that may be the
-- store's. Locks: the tenant first, then the job.
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
          'customer_words','quotable_review','customer_photo'))
        or (f->>'source' = 'social' and coalesce(f->>'topic', '') not in ('audience','review_theme','objection','customer_words'))
        or jsonb_typeof(f->'statement') is distinct from 'string'
        or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
        or coalesce(f->>'pass', '') not in ('sample','model','code')
        or (f->>'pass' = 'sample') = live
        or (f->>'pass' = 'code' and (f->>'topic' not in ('quotable_review','review_platform','customer_photo')
          or coalesce(f->>'model', '') <> ''))
        or (f->>'pass' = 'model' and (coalesce(btrim(f->>'model'), '') = '' or summary->>'analysis' <> 'done'
          or f->>'topic' in ('quotable_review','review_platform','customer_photo')))
        or (f ? 'model' and coalesce(jsonb_typeof(f->'model'), 'missing') not in ('string','null'))
        or jsonb_typeof(f->'evidence') is distinct from 'object'
        -- A review app's rating cites a page's review data.
        or (f->>'topic' = 'review_platform' and ((f->'evidence') - 'ref' <> '{}'::jsonb
          or not coalesce(f->'evidence'->>'ref' = any(array(select left('review-data:' || p, 200) from unnest(read_pages) p)), false)))
        -- A customer's photo, code's on a live read only, cites the review
        -- data of the page read here that it names, on a host that may be
        -- the store's.
        or (f->>'topic' = 'customer_photo' and (f->>'pass' <> 'code' or (f->'evidence') - 'ref' <> '{}'::jsonb
          or jsonb_typeof(f->'value') is distinct from 'object'
          or not coalesce(f->'value'->>'page' = any(read_pages), false)
          or f->'evidence'->>'ref' is distinct from left('review-data:' || (f->'value'->>'page'), 200)
          or not private.review_photo_host_ok(f->'value'->>'url', d)))
        -- Anything else cites a page or a post read here with its words.
        or (f->>'topic' not in ('review_platform','customer_photo') and ((f->'evidence') - 'url' - 'quote' <> '{}'::jsonb
          or jsonb_typeof(f->'evidence'->'url') is distinct from 'string'
          or not coalesce(f->'evidence'->>'url' = any(case when f->>'source' = 'reviews' then read_pages else read_posts end), false)
          or jsonb_typeof(f->'evidence'->'quote') is distinct from 'string'
          or length(f->'evidence'->>'quote') not between 1 and 300))
        -- A quotable review names the page it is on.
        or (f->>'topic' = 'quotable_review' and f->'value'->>'url' is distinct from f->'evidence'->>'url'))
    -- At most 12 customers' photos a read, each once (its host in lower
    -- case and its path), and those on Shopify's CDN in one store's folder.
    or (select count(*) from jsonb_array_elements(findings) f where f->>'topic' = 'customer_photo') > 12
    or (select count(*) - count(distinct lower(private.https_host(f->'value'->>'url'))
        || coalesce(substring(f->'value'->>'url' from '^https://[^/?#]*(/[^?#]*)'), ''))
      from jsonb_array_elements(findings) f where f->>'topic' = 'customer_photo') > 0
    or (select count(distinct substring(f->'value'->>'url' from '^https://cdn\.shopify\.com/s/files/1/[0-9]{4}/[0-9]{4}/(?:[0-9]{4}/)?'))
      from jsonb_array_elements(findings) f where f->>'topic' = 'customer_photo') > 1 then
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

revoke all on function public.record_review_findings(uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_review_findings(uuid, uuid, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;
