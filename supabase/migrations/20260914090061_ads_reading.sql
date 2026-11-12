-- ONB-104 Ads analyst (AGENT_MAP §2, BUILD_BRIEF D19, D23).
--
-- The brand's live ads show its current offers and angles. An ads read
-- (brand.read_ads) asks the Ad Library for the brand's active ads, keeps
-- those of the brand's own page (the page sending people to its own
-- domain), at most 30, and the Ads analyst says what they offer, why they
-- say to buy and what they show; code counts their landing pages and
-- formats. Each finding cites the ad it came from (its Ad Library page)
-- with the ad's own words.
--
-- * Its findings go to brand_findings (source ads), with new topics:
--   `promotion` (percent_off with a percent, amount_off with an amount and
--   currency, gift, bundle), `angle` and `creative` (words only), and
--   `landing_page` (a page on the brand's own site).
-- * No live ads (state none) replaces the earlier ads findings; a library
--   that cannot read the brand (state skipped) replaces nothing (D16).
--
-- The sample ads are only for a synthetic brand; a real brand's live Ad
-- Library is not read yet (which route is the owner's choice), so its
-- read is skipped. Like the other source reads, ads reads run only in the
-- onboarding readers' run. Locks: the tenant first, then the job.

alter table public.brand_findings drop constraint brand_findings_topic_check,
  add constraint brand_findings_topic_check check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping',
    'locale','price_band','offering','audience','tone','claim','contact','review_platform','performance','promotion','angle',
    'creative','landing_page')),
  add constraint brand_findings_ads_topics
    check (source <> 'ads' or topic in ('offering','audience','tone','claim','free_shipping','promotion','angle','creative',
      'landing_page'));

-- An ad's link on the brand's own site: https on the standard port, a host
-- of plain labels (no escapes, no empty label), the brand's domain or one
-- of its subdomains. Never null.
create or replace function private.ad_link_ok(link text, domain text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(link) <= 500
    and private.https_host(link) ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and private.on_site(private.https_host(link), domain), false);
$$;
revoke all on function private.ad_link_ok(text, text) from public, anon, authenticated;

-- The value each topic holds, as before (20260914090059), with the ads
-- topics.
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
    when 'shipping', 'offering', 'audience', 'tone', 'contact', 'performance', 'angle', 'creative' then
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
    'brand.read_ads'));

-- The owner starts an ads read: the brand's website is needed (the ads
-- kept are those sending people to it); at most once a day; a failed
-- read is started again. A synthetic brand reads the sample ads; a real
-- brand its live ads.
create or replace function public.start_ads_reading(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d text; synthetic boolean; mode text; j uuid;
begin
  perform private.require_member(t, true);
  select private.site_domain(b.domain), b.synthetic into d, synthetic from public.brand_profiles b where b.tenant_id = t;
  if d is null then raise exception 'Add the brand''s website first' using errcode = '23514'; end if;
  mode := case when synthetic then 'sample' else 'live' end;
  insert into public.job_runs(tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'brand.read_ads', 'brand.read_ads:' || mode || ':' || d || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('domain', d, 'mode', mode), auth.uid())
    on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into j;
  update public.job_runs set status = 'queued', attempt = 0, available_at = now(), failure_class = null, error_code = null,
      lease_token = null, lease_until = null, checkpoint = '{}'::jsonb, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- An ads read's result, all at once; then the job is finished. Each
-- finding cites an ad this read kept (its Ad Library page) with its own
-- words; a landing page is on the brand's own domain. A read that found
-- the brand's ads, or that it runs none, replaces the earlier ads
-- findings; a skipped read replaces nothing. An older read finishing
-- after a newer one replaces nothing, and its findings are kept already
-- replaced. Locks: the tenant first, then the job.
create or replace function public.record_ad_findings(job uuid, lease uuid, findings jsonb, ads jsonb, summary jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; d text; st text; newer boolean; n_findings integer := 0; ids text[];
  library constant text := 'https://www.facebook.com/ads/library/?id=';
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_ads' then raise exception 'Not an ads reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null or live is null or live is distinct from (coalesce(j.input->>'mode', '') = 'live') then
    raise exception 'Invalid ads reading' using errcode = '23514';
  end if;
  -- The sample ads only for a synthetic brand, also when they are stored.
  if not live and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = j.tenant_id), false) then
    raise exception 'Invalid ads reading' using errcode = '23514';
  end if;
  st := summary->>'state';
  if jsonb_typeof(summary) is distinct from 'object' or st is null or st not in ('ready','none','skipped')
    or summary - 'state' - 'analysis' - 'reason' <> '{}'::jsonb
    or coalesce(summary->>'analysis', '') not in ('done','skipped')
    or (summary ? 'reason' and (jsonb_typeof(summary->'reason') is distinct from 'string'
      or summary->>'reason' !~ '^[a-z_]{1,40}$'))
    or (st <> 'ready' and summary->>'analysis' = 'done') then
    raise exception 'Invalid ads summary' using errcode = '23514';
  end if;
  -- The ads kept: at most 30, each once, a link only on the brand's own
  -- domain; ads only when the read found some.
  if jsonb_typeof(ads) is distinct from 'array' or jsonb_array_length(ads) > 30
    or (st = 'ready') <> (jsonb_array_length(ads) > 0)
    or exists (select 1 from jsonb_array_elements(ads) a
      where jsonb_typeof(a) <> 'object' or a - 'id' - 'link' <> '{}'::jsonb
        or jsonb_typeof(a->'id') is distinct from 'string' or a->>'id' !~ '^[0-9]{1,25}$'
        or coalesce(jsonb_typeof(a->'link'), 'missing') not in ('string','null')
        or (jsonb_typeof(a->'link') = 'string' and not private.ad_link_ok(a->>'link', d)))
    or (select count(distinct a->>'id') from jsonb_array_elements(ads) a) <> jsonb_array_length(ads) then
    raise exception 'Invalid ads' using errcode = '23514';
  end if;
  select coalesce(array_agg(a->>'id'), '{}') into ids from jsonb_array_elements(ads) a;
  -- The findings: the topics ads can state, each citing an ad kept here
  -- with its own words; a model or the sample rules say it, code counts
  -- landing pages and formats.
  if jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 40
    or (st <> 'ready' and jsonb_array_length(findings) > 0)
    or exists (select 1 from jsonb_array_elements(findings) f
      where jsonb_typeof(f) <> 'object' or f - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
        or coalesce(f->>'topic', '') not in ('offering','audience','tone','claim','free_shipping','promotion','angle','creative',
          'landing_page')
        or jsonb_typeof(f->'statement') is distinct from 'string'
        or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
        or coalesce(f->>'pass', '') not in ('sample','model','code')
        or (f->>'pass' = 'sample') = live
        or (f->>'pass' = 'code' and (f->>'topic' not in ('landing_page','creative') or coalesce(f->>'model', '') <> ''))
        or (f->>'pass' = 'model' and (coalesce(btrim(f->>'model'), '') = '' or summary->>'analysis' <> 'done'))
        or (f ? 'model' and coalesce(jsonb_typeof(f->'model'), 'missing') not in ('string','null'))
        or jsonb_typeof(f->'evidence') is distinct from 'object' or (f->'evidence') - 'url' - 'quote' <> '{}'::jsonb
        or jsonb_typeof(f->'evidence'->'url') is distinct from 'string'
        or left(f->'evidence'->>'url', length(library)) <> library
        or not (substr(f->'evidence'->>'url', length(library) + 1) = any(ids))
        or jsonb_typeof(f->'evidence'->'quote') is distinct from 'string'
        or length(f->'evidence'->>'quote') not between 1 and 300
        or (f->>'topic' = 'landing_page' and not private.ad_link_ok(f->'value'->>'url', d))) then
    raise exception 'Invalid finding' using errcode = '23514';
  end if;
  newer := exists (select 1 from public.job_runs r
    where r.tenant_id = j.tenant_id and r.kind = 'brand.read_ads' and r.id <> j.id and r.status = 'succeeded'
      and r.created_at > j.created_at and r.checkpoint->>'state' in ('ready','none'));
  if not newer and st in ('ready','none') then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'ads' and superseded_at is null;
  end if;
  -- A real brand's read, even a skipped one, never leaves sample findings
  -- standing (a brand that was synthetic before).
  if live then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'ads' and pass = 'sample' and superseded_at is null;
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'ads', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when newer then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n_findings = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('state', st, 'ads', jsonb_array_length(ads), 'findings', n_findings,
          'analysis', summary->>'analysis', 'reason', summary->>'reason', 'live', live, 'newer', newer)
    where id = j.id;
  return jsonb_build_object('ads', jsonb_array_length(ads), 'findings', n_findings, 'newer', newer);
end $$;

-- Source reads are the worker's: as before (20260914090059), ads reads
-- too.
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
  if j.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if j.status <> 'running' or j.lease_token is distinct from lease or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return j;
end $$;

-- The workspace jobs never take a source read: as before
-- (20260914090059), ads reads too.
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
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

drop index public.job_runs_source_reads;
create index job_runs_source_reads on public.job_runs (available_at, created_at)
  where kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads');

-- The source reads waiting, and the next one, across active workspaces:
-- as before (20260914090059), ads reads too.
create or replace function public.source_readings_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select case when coalesce(auth.role(), '') <> 'service_role' then null else (
    select count(*)::integer from public.job_runs j join public.tenants t on t.id = j.tenant_id and t.status = 'active'
      where j.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads')
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
    where r.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads')
      and ((r.status in ('queued','retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased','running') and r.lease_until < now()))
    order by r.available_at, r.created_at limit 1;
  if candidate is null then return; end if;
  perform 1 from public.tenants where id = tenant and status = 'active' for update;
  if not found then return; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now()
    where tenant_id = tenant and kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads')
      and status in ('leased','running') and lease_until < now();
  select * into j from public.job_runs
    where id = candidate and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.start_ads_reading(uuid) from public, anon, service_role;
grant execute on function public.start_ads_reading(uuid) to authenticated;
revoke all on function public.record_ad_findings(uuid, uuid, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_ad_findings(uuid, uuid, jsonb, jsonb, jsonb, boolean) to service_role;
