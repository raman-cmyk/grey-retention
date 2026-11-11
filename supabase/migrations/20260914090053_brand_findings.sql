-- ONB-101 Site reader (AGENT_MAP §2, BUILD_BRIEF D19).
--
-- Onboarding is done by a team of agents. The source readers (ONB-101..105,
-- lane B) write down what each source says about the brand, one fact per
-- row with its evidence; the Brand strategist (ONB-106, lane A) reads them
-- and writes the Brand book, taking the stricter fact when sources
-- disagree and never stating a claim it cannot back.
--
-- * brand_findings: one fact per row (source, topic, a plain sentence, a
--   value of the topic's own shape, the evidence, a confidence). A newer
--   run of a source replaces that source's current findings.
-- * brand.read_site jobs: the Site reader reads the brand's own website;
--   the owner starts it (once a day at most); record_site_findings stores
--   a run's findings at once and finishes the job. A run replaces the site
--   findings from the kinds of page it read; a page it could not read, or
--   whose answer was unusable, replaces nothing.
--
-- Every active member of the workspace reads its findings; only the
-- worker writes them.

-- The value each topic holds: one fixed shape per topic (features/
-- onboarding/findings.ts holds the same shapes). Never null: a check that
-- is null would let any value through.
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
    when 'shipping', 'offering', 'audience', 'tone', 'contact' then
      return coalesce(v = '{}'::jsonb, false);
    else
      return false;
  end case;
end $$;
revoke all on function private.finding_value_ok(text, jsonb) from public, anon, authenticated;

create table public.brand_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  -- The reader's job (one run of one source).
  run_id uuid not null,
  source text not null check (source in ('site','catalog','klaviyo_history','ads','reviews','social')),
  topic text not null check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping','locale','price_band',
    'offering','audience','tone','claim','contact','review_platform')),
  statement text not null check (length(statement) between 2 and 300),
  value jsonb not null default '{}' check (private.finding_value_ok(topic, value)),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and length(evidence::text) <= 1200),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  pass text not null check (pass in ('sample','model')),
  model text check (model is null or length(model) between 1 and 100),
  created_at timestamptz not null default now(),
  -- Set when a newer run of the same source replaces it.
  superseded_at timestamptz,
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id),
  check (source <> 'site' or topic in ('free_shipping','returns','guarantee','delivery_days','shipping','locale','price_band',
    'offering','audience','tone','claim','contact'))
);
create index brand_findings_current on public.brand_findings (tenant_id, source, topic) where superseded_at is null;
create index brand_findings_run on public.brand_findings (tenant_id, run_id);
alter table public.brand_findings enable row level security;
create policy member_read on public.brand_findings for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.brand_findings from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_findings from authenticated;
grant select on public.brand_findings to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_findings from authenticated';
  end if;
end $$;

alter table public.job_runs drop constraint job_runs_kind_check,
  add constraint job_runs_kind_check check (kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule',
    'assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan',
    'reviews.remind','design.render','ops.health','results.pull','reports.digest','learning.synthesize','optimizer.winback',
    'optimizer.suppress','email.rewrite','email.import','brand.read_site'));

-- A brand's website as the readers use it: lower case, without `www.`
-- (the reader reads the domain and its `www.` both); null unless it is a
-- plain host name (never an address).
create or replace function private.site_domain(domain text)
returns text language sql immutable set search_path = '' as $$
  select case when d ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and d !~ '^[0-9.]+$' then d end
  from (select regexp_replace(lower(btrim(coalesce(domain, ''))), '^www\.', '') as d) x;
$$;
revoke all on function private.site_domain(text) from public, anon, authenticated;

-- The host of an https link on the standard port, lower case; null for
-- anything else (another scheme, a port, a name and password).
create or replace function private.https_host(url text)
returns text language sql immutable set search_path = '' as $$
  select lower(substring(url from '^https://([^/:?#@]+)(?:[/?#]|$)'));
$$;
revoke all on function private.https_host(text) from public, anon, authenticated;

-- The owner starts a read of the brand's own website (at most once a day;
-- asking again the same day returns the same job). The job keeps the
-- domain it reads, so a website changed mid-run does not break it.
create or replace function public.start_site_reading(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d text; j uuid;
begin
  perform private.require_member(t, true);
  select private.site_domain(domain) into d from public.brand_profiles where tenant_id = t;
  if d is null then raise exception 'Add the brand''s website first' using errcode = '23514'; end if;
  insert into public.job_runs(tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'brand.read_site', 'brand.read_site:' || d || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('domain', d), auth.uid())
    on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into j;
  -- Today's read failed: asking again starts it again, with all its tries.
  update public.job_runs set status = 'queued', attempt = 0, available_at = now(), failure_class = null, error_code = null,
      lease_token = null, lease_until = null, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- A run's findings, all at once, with the pages read and skipped; then the
-- job is finished. Every page and every piece of evidence is on the
-- domain the job reads (or its `www.`), and evidence cites a page this run
-- read. The run replaces the current site findings from the kinds of page
-- it read, unless a newer run has already replaced them (then its own are
-- kept, already replaced). Locks: the tenant first, then the job.
create or replace function public.record_site_findings(job uuid, lease uuid, findings jsonb, pages jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; d text; f jsonb; n integer := 0; read_kinds text[]; newer boolean;
  kinds constant text[] := array['home','product','about','shipping','returns','faq'];
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null then raise exception 'Invalid site reading' using errcode = '23514'; end if;
  if live is null or jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 200
    or jsonb_typeof(pages) is distinct from 'array' or jsonb_array_length(pages) > 8
    or exists (select 1 from jsonb_array_elements(pages) p
      where jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'url') is distinct from 'string' or length(p->>'url') > 500
        or coalesce(private.https_host(p->>'url'), '') not in (d, 'www.' || d)
        or not (coalesce(p->>'kind', '') = any(kinds)) or coalesce(p->>'state', '') not in ('read','skipped')
        or (p ? 'reason' and (jsonb_typeof(p->'reason') <> 'string' or p->>'reason' !~ '^[a-z_]{1,40}$'))
        or (p ? 'findings' and (jsonb_typeof(p->'findings') <> 'number' or p->>'findings' !~ '^[0-9]{1,3}$'))
        or p - 'url' - 'kind' - 'state' - 'reason' - 'findings' <> '{}'::jsonb) then
    raise exception 'Invalid site reading' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct p->>'kind'), '{}') into read_kinds
    from jsonb_array_elements(pages) p where p->>'state' = 'read';
  for f in select * from jsonb_array_elements(findings) loop
    if jsonb_typeof(f) <> 'object' or jsonb_typeof(f->'topic') is distinct from 'string'
      or jsonb_typeof(f->'statement') is distinct from 'string'
      or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
      or coalesce(f->>'pass', '') not in ('sample','model')
      or (f ? 'model' and jsonb_typeof(f->'model') not in ('string','null'))
      or f - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
      or jsonb_typeof(f->'evidence') is distinct from 'object'
      or coalesce(private.https_host(f->'evidence'->>'url'), '') not in (d, 'www.' || d)
      or jsonb_typeof(f->'evidence'->'quote') is distinct from 'string' or length(f->'evidence'->>'quote') not between 1 and 300
      or not (coalesce(f->'evidence'->>'page', '') = any(read_kinds))
      or (f->'evidence') - 'url' - 'quote' - 'page' <> '{}'::jsonb then
      raise exception 'Invalid finding' using errcode = '23514';
    end if;
  end loop;
  -- A newer run of this site already replaced the findings: this one's are
  -- kept for the record, already replaced.
  newer := exists (select 1 from public.brand_findings b join public.job_runs r on r.tenant_id = b.tenant_id and r.id = b.run_id
    where b.tenant_id = j.tenant_id and b.source = 'site' and b.superseded_at is null and r.created_at > j.created_at);
  if cardinality(read_kinds) > 0 and not newer then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'site' and superseded_at is null
        and evidence->>'page' = any(read_kinds);
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'site', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when newer then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('pages', pages, 'findings', n, 'live', live)
    where id = j.id;
  return jsonb_build_object('findings', n, 'pages', jsonb_array_length(pages));
end $$;

-- Site reads use live AI and the open internet, so the workspace jobs never
-- take them (an owner's "Run jobs" or the sweep): only the onboarding
-- readers' own run does, as the worker, with its calls capped to fit its
-- route. The same claim as before otherwise (20260914090015).
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
      and kind not in ('email.rewrite','email.import','brand.read_site');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

-- The site reads waiting, across active workspaces (the readers' run asks
-- first, so an idle run is one small request).
create or replace function public.site_readings_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select case when coalesce(auth.role(), '') <> 'service_role' then null else (
    select count(*)::integer from public.job_runs j join public.tenants t on t.id = j.tenant_id and t.status = 'active'
      where j.kind = 'brand.read_site'
        and ((j.status in ('queued','retry_wait') and j.attempt < 4 and j.available_at <= now())
          or (j.status in ('leased','running') and j.lease_until < now()))) end;
$$;

-- The next site read due, across active workspaces, leased to the worker
-- for 90 seconds. A read whose lease ran out is tried again (or failed
-- after its fourth try) first. Locks: the tenant first, then the job.
create or replace function public.claim_site_reading() returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare candidate public.job_runs; j public.job_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now()
    where kind = 'brand.read_site' and status in ('leased','running') and lease_until < now();
  select r.* into candidate from public.job_runs r join public.tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.kind = 'brand.read_site' and r.status in ('queued','retry_wait') and r.attempt < 4 and r.available_at <= now()
    order by r.available_at, r.created_at limit 1;
  if candidate.id is null then return; end if;
  perform 1 from public.tenants where id = candidate.tenant_id and status = 'active' for update;
  if not found then return; end if;
  select * into j from public.job_runs
    where id = candidate.id and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.site_readings_waiting() from public, anon, authenticated;
revoke all on function public.claim_site_reading() from public, anon, authenticated;
grant execute on function public.site_readings_waiting() to service_role;
grant execute on function public.claim_site_reading() to service_role;
revoke all on function public.start_site_reading(uuid) from public, anon;
grant execute on function public.start_site_reading(uuid) to authenticated;
revoke all on function public.record_site_findings(uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_site_findings(uuid, uuid, jsonb, jsonb, boolean) to service_role;
