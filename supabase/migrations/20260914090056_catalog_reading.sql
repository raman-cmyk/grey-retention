-- ONB-102 Catalog analyst (AGENT_MAP §2, BUILD_BRIEF D19; continues KLV-001).
--
-- Emails may show only the brand's real products, prices and photos, and
-- they come from Klaviyo. A catalog read (brand.read_catalog) reads the
-- Klaviyo catalog, or, when Klaviyo's API cannot show it (a Shopify-synced
-- catalog), builds it from the Viewed Product and Placed Order events. Code
-- cleans it (variants grouped into one product, the currency checked, a
-- photo required, a permanent compare-at price hidden) and counts the
-- bestsellers and new arrivals; the Catalog analyst finds duplicates and
-- says what the brand sells.
--
-- * products: the cleaned catalog is stored with the other products
--   (source 'klaviyo'), one row per Klaviyo product, kept up to date by
--   each read; a product a complete read no longer finds is retired, never
--   deleted (a campaign may point at it).
-- * catalog_status: what the latest read found, per workspace: ready,
--   empty ("no products", D16) or paused (the key needs the owner).
-- * Catalog findings (price band, locale, what the brand sells) go to
--   brand_findings for the Brand strategist, like the Site reader's.
-- * A rate limit puts the read back for later without using a try; a
--   rejected key or a missing scope stops it, marks the live connection as
--   needing attention and tells the owners.
--
-- Catalog reads, like site reads, run only in the onboarding readers' run
-- (live AI, the workspace's Klaviyo key): never in the sweep or an owner's
-- "Run jobs". Locks: the tenant first, then the job, then products.
--
-- Also the guard deferred from KLV-001: the old sample command
-- (set_fixture_connection) never changes a live Klaviyo connection, except
-- to disconnect it.

alter table public.products drop constraint products_source_check,
  add constraint products_source_check check (source in ('manual','fixture','klaviyo'));
alter table public.products
  -- Klaviyo's id of the product (a catalog item, or the store's product id
  -- in its events).
  add column external_id text check (external_id is null or external_id ~ '^[A-Za-z0-9$:._-]{1,160}$'),
  -- The real product photo (never made up).
  add column image_url text check (image_url is null or (image_url ~ '^https://[^\s/?#@]+(/[^\s]*)?$' and length(image_url) <= 2000)),
  add column compare_at_minor integer check (compare_at_minor is null or compare_at_minor > 0),
  -- True only when the compare-at price was seen to be a temporary sale; a
  -- permanent one is never shown (it would fake a discount).
  add column compare_at_is_sale boolean not null default false,
  -- Whether emails may feature it; hidden_reason says why not.
  add column featurable boolean not null default true,
  add column hidden_reason text check (hidden_reason is null
    or hidden_reason in ('no_image','currency','duplicate','unpublished','not_picked','retired')),
  add column units_30d integer check (units_30d is null or units_30d >= 0),
  add column units_90d integer check (units_90d is null or units_90d >= 0),
  add column bestseller_rank integer check (bestseller_rank is null or bestseller_rank between 1 and 500),
  -- When it was added to the store, if known.
  add column launched_at timestamptz,
  add column new_arrival boolean not null default false,
  -- False when the store does not say how many are in stock (stock is 0 then).
  add column stock_known boolean not null default true,
  add column variant_count integer not null default 1 check (variant_count between 1 and 500),
  -- The catalog read that last saw it.
  add column catalog_run_id uuid,
  add column retired_at timestamptz,
  add constraint products_catalog_run_fk foreign key (tenant_id, catalog_run_id) references public.job_runs(tenant_id, id),
  add constraint products_klaviyo_shape check (source <> 'klaviyo' or (external_id is not null and catalog_run_id is not null)),
  add constraint products_hidden_shape check (not (featurable and hidden_reason is not null)
    and (retired_at is null or (not featurable and hidden_reason = 'retired'))),
  add constraint products_sale_shape check (not compare_at_is_sale or coalesce(compare_at_minor > price_minor, false));
create unique index products_external on public.products (tenant_id, source, external_id) where external_id is not null;

alter table public.brand_findings add constraint brand_findings_catalog_topics
  check (source <> 'catalog' or topic in ('locale','price_band','offering','claim'));
-- How a finding was made: the sample rules on sample data, a model on real
-- data, or code counting real data (a catalog's price band).
alter table public.brand_findings drop constraint brand_findings_pass_check,
  add constraint brand_findings_pass_check check (pass in ('sample','model','code'));

create table public.catalog_status (
  tenant_id uuid primary key references public.tenants(id),
  -- The catalog read this describes.
  run_id uuid not null,
  state text not null check (state in ('ready','empty','paused')),
  -- Where the products came from: Klaviyo's catalog, or its events.
  source text check (source in ('api','events')),
  products integer not null default 0 check (products between 0 and 500),
  featurable integer not null default 0 check (featurable between 0 and products),
  currency text check (currency ~ '^[A-Z]{3}$'),
  -- Whether the store's orders are in the account's currency.
  currency_check text not null default 'unverified' check (currency_check in ('matched','mismatch','unverified')),
  -- False when the read ran out of time (nothing was retired then).
  complete boolean not null default true,
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  live boolean not null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id),
  check (state <> 'empty' or products = 0)
);
alter table public.catalog_status enable row level security;
create policy member_read on public.catalog_status for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.catalog_status from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.catalog_status from authenticated;
grant select on public.catalog_status to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.catalog_status from authenticated';
  end if;
end $$;

alter table public.job_runs drop constraint job_runs_kind_check,
  add constraint job_runs_kind_check check (kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule',
    'assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan',
    'reviews.remind','design.render','ops.health','results.pull','reports.digest','learning.synthesize','optimizer.winback',
    'optimizer.suppress','email.rewrite','email.import','brand.read_site','brand.read_catalog'));

-- KLV-001's deferred guard: a live Klaviyo connection is changed only by
-- its key check (connect_klaviyo_live), or disconnected. The rest is as
-- before (20260914090003).
create or replace function public.set_fixture_connection(t uuid,provider text,status text,folder text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 if provider not in ('klaviyo','shopify','drive') or status not in ('connected','disconnected','expired','error') or (provider='drive' and status='connected' and (folder is null or folder !~ '^fixture:[a-zA-Z0-9_-]{1,60}$')) then raise exception 'Invalid fixture connection' using errcode='23514';end if;
 if provider='klaviyo' and status<>'disconnected' and exists(select 1 from public.workspace_connections w where w.tenant_id=t and w.provider='klaviyo' and w.mode='live') then
  raise exception 'Live Klaviyo changes only through its key check' using errcode='PT409';
 end if;
 insert into public.workspace_connections(tenant_id,provider,status,fixture_account,folder_id,last_error) values(t,provider,status,'fixture:'||t||':'||provider,case when provider='drive' then folder else null end,case when status in ('expired','error') then 'fixture_connection_unavailable' else null end)
 on conflict on constraint workspace_connections_pkey do update set status=excluded.status,folder_id=excluded.folder_id,revision=public.workspace_connections.revision+1,last_error=excluded.last_error,updated_at=now();
 if status in ('expired','error') then perform private.notify_owners(t,'connection_health',t,'A fixture connection needs attention. Inspect connection diagnostics; no live account is connected.');end if;
end $$;

-- The owner starts a read of the Klaviyo catalog (at most once a day per
-- kind of connection; asking again the same day returns the same job, and
-- restarts it when it failed). The job keeps the kind of connection it
-- reads: the worker reads only that one.
create or replace function public.start_catalog_reading(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.workspace_connections; j uuid;
begin
  perform private.require_member(t, true);
  select * into c from public.workspace_connections w where w.tenant_id = t and w.provider = 'klaviyo';
  if not found or c.status <> 'connected' then raise exception 'Connect Klaviyo first' using errcode = '23514'; end if;
  -- A sample connection has only the sample catalog, which is never a real
  -- brand's: a real brand needs its live Klaviyo.
  if c.mode <> 'live' and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = t), false) then
    raise exception 'Connect live Klaviyo first' using errcode = '23514';
  end if;
  insert into public.job_runs(tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'brand.read_catalog', 'brand.read_catalog:' || c.mode || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('mode', c.mode), auth.uid())
    on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into j;
  update public.job_runs set status = 'queued', attempt = 0, available_at = now(), failure_class = null, error_code = null,
      lease_token = null, lease_until = null, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- A catalog read's result, all at once; then the job is finished. Products
-- are kept by their Klaviyo id: a product seen again is updated, a new one
-- added; after a complete read, the Klaviyo products it did not see are
-- retired (not featurable). An older read finishing after a newer one
-- changes no product and no status, and its findings are kept already
-- replaced. Locks: the tenant first, then the job, then the products.
create or replace function public.record_catalog_reading(job uuid, lease uuid, products jsonb, findings jsonb, summary jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; newer boolean; n_products integer := 0; n_findings integer := 0; n_featurable integer := 0;
  st text; cur text; keys constant text[] := array['externalId','title','url','priceMinor','currency','imageUrl','compareAtMinor',
    'compareAtIsSale','featurable','hiddenReason','units30d','units90d','bestsellerRank','launchedAt','newArrival','stock',
    'variantCount'];
  whole constant text := '^[0-9]{1,9}$';
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_catalog' then raise exception 'Not a catalog reading job' using errcode = '23514'; end if;
  if live is null or live <> (j.input->>'mode' = 'live') then raise exception 'Invalid catalog reading' using errcode = '23514'; end if;
  -- The summary.
  st := summary->>'state'; cur := summary->>'currency';
  if jsonb_typeof(summary) is distinct from 'object' or st is null or st not in ('ready','empty')
    or summary - 'state' - 'source' - 'currency' - 'currencyCheck' - 'complete' - 'reason' <> '{}'::jsonb
    or (summary ? 'source' and coalesce(summary->>'source', '') not in ('api','events'))
    or (st = 'ready' and not summary ? 'source')
    or (cur is not null and cur !~ '^[A-Z]{3}$') or (st = 'ready' and cur is null)
    or coalesce(summary->>'currencyCheck', '') not in ('matched','mismatch','unverified')
    or jsonb_typeof(summary->'complete') is distinct from 'boolean'
    or (summary ? 'reason' and coalesce(summary->>'reason', '') !~ '^[a-z_]{1,40}$') then
    raise exception 'Invalid catalog summary' using errcode = '23514';
  end if;
  -- The products.
  if jsonb_typeof(products) is distinct from 'array' or jsonb_array_length(products) > 500
    or (st = 'empty' and jsonb_array_length(products) > 0) or (st = 'ready' and jsonb_array_length(products) = 0)
    or exists (select 1 from jsonb_array_elements(products) p
      where jsonb_typeof(p) <> 'object' or p - keys <> '{}'::jsonb
        or jsonb_typeof(p->'externalId') is distinct from 'string' or p->>'externalId' !~ '^[A-Za-z0-9$:._-]{1,160}$'
        or jsonb_typeof(p->'title') is distinct from 'string' or length(btrim(p->>'title')) not between 2 and 200
        or jsonb_typeof(p->'url') is distinct from 'string' or private.https_host(p->>'url') is null or length(p->>'url') > 2000
        or jsonb_typeof(p->'priceMinor') is distinct from 'number' or p->>'priceMinor' !~ whole
        or p->>'currency' is distinct from cur
        or jsonb_typeof(p->'imageUrl') not in ('string','null')
        or (jsonb_typeof(p->'imageUrl') = 'string' and private.https_host(p->>'imageUrl') is null)
        or jsonb_typeof(p->'compareAtMinor') not in ('number','null')
        or (jsonb_typeof(p->'compareAtMinor') = 'number' and p->>'compareAtMinor' !~ whole)
        or jsonb_typeof(p->'compareAtIsSale') is distinct from 'boolean'
        or jsonb_typeof(p->'featurable') is distinct from 'boolean'
        or jsonb_typeof(p->'hiddenReason') not in ('string','null')
        or (jsonb_typeof(p->'hiddenReason') = 'string' and p->>'hiddenReason' not in ('no_image','currency','duplicate','unpublished','not_picked'))
        or ((p->>'featurable')::boolean = (jsonb_typeof(p->'hiddenReason') = 'string'))
        or ((p->>'featurable')::boolean and jsonb_typeof(p->'imageUrl') <> 'string')
        or ((p->>'featurable')::boolean and summary->>'currencyCheck' = 'mismatch')
        or jsonb_typeof(p->'units30d') is distinct from 'number' or p->>'units30d' !~ whole
        or jsonb_typeof(p->'units90d') is distinct from 'number' or p->>'units90d' !~ whole
        or (p->>'units30d')::bigint > (p->>'units90d')::bigint
        or jsonb_typeof(p->'bestsellerRank') not in ('number','null')
        or (jsonb_typeof(p->'bestsellerRank') = 'number' and p->>'bestsellerRank' !~ '^[1-9][0-9]{0,2}$')
        or jsonb_typeof(p->'launchedAt') not in ('string','null')
        or (jsonb_typeof(p->'launchedAt') = 'string' and p->>'launchedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$')
        or jsonb_typeof(p->'newArrival') is distinct from 'boolean'
        or jsonb_typeof(p->'stock') not in ('number','null') or (jsonb_typeof(p->'stock') = 'number' and p->>'stock' !~ whole)
        or jsonb_typeof(p->'variantCount') is distinct from 'number' or p->>'variantCount' !~ '^[1-9][0-9]{0,2}$')
    or (select count(distinct p->>'externalId') from jsonb_array_elements(products) p) <> jsonb_array_length(products) then
    raise exception 'Invalid catalog product' using errcode = '23514';
  end if;
  -- The findings: the topics a catalog can state, each citing Klaviyo.
  if jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 20
    or exists (select 1 from jsonb_array_elements(findings) f
      where jsonb_typeof(f) <> 'object' or f - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
        or coalesce(f->>'topic', '') not in ('locale','price_band','offering','claim')
        or jsonb_typeof(f->'statement') is distinct from 'string'
        or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
        or coalesce(f->>'pass', '') not in ('sample','model','code')
        or (f->>'pass' = 'sample') = live
        or (f ? 'model' and jsonb_typeof(f->'model') not in ('string','null'))
        or jsonb_typeof(f->'evidence') is distinct from 'object' or (f->'evidence') - 'ref' <> '{}'::jsonb
        or coalesce(f->'evidence'->>'ref', '') !~ '^klaviyo:(account|catalog|events)(:[A-Za-z0-9 $._:-]{1,120})?$') then
    raise exception 'Invalid finding' using errcode = '23514';
  end if;
  -- A newer catalog read already recorded: this one changes nothing.
  newer := exists (select 1 from public.catalog_status s join public.job_runs r on r.tenant_id = s.tenant_id and r.id = s.run_id
    where s.tenant_id = j.tenant_id and s.state in ('ready','empty') and r.created_at > j.created_at);
  if not newer then
    insert into public.products as p (tenant_id, title, url, price_minor, currency, stock, stock_observed_at, source, synthetic,
        external_id, image_url, compare_at_minor, compare_at_is_sale, featurable, hidden_reason, units_30d, units_90d,
        bestseller_rank, launched_at, new_arrival, stock_known, variant_count, catalog_run_id, retired_at)
      select j.tenant_id, btrim(x->>'title'), x->>'url', (x->>'priceMinor')::integer, cur,
        coalesce((x->>'stock')::integer, 0), now(), 'klaviyo', not live,
        x->>'externalId', x->>'imageUrl', (x->>'compareAtMinor')::integer, (x->>'compareAtIsSale')::boolean,
        (x->>'featurable')::boolean, x->>'hiddenReason', (x->>'units30d')::integer, (x->>'units90d')::integer,
        (x->>'bestsellerRank')::integer, (x->>'launchedAt')::timestamptz, (x->>'newArrival')::boolean,
        jsonb_typeof(x->'stock') = 'number', (x->>'variantCount')::integer, j.id, null
      from jsonb_array_elements(products) x
      order by x->>'externalId'
      on conflict (tenant_id, source, external_id) where external_id is not null do update set
        title = excluded.title, url = excluded.url, price_minor = excluded.price_minor, currency = excluded.currency,
        stock = excluded.stock, stock_observed_at = excluded.stock_observed_at, synthetic = excluded.synthetic,
        image_url = excluded.image_url, compare_at_minor = excluded.compare_at_minor,
        compare_at_is_sale = excluded.compare_at_is_sale, featurable = excluded.featurable,
        hidden_reason = excluded.hidden_reason, units_30d = excluded.units_30d, units_90d = excluded.units_90d,
        bestseller_rank = excluded.bestseller_rank, launched_at = excluded.launched_at,
        new_arrival = excluded.new_arrival, stock_known = excluded.stock_known, variant_count = excluded.variant_count,
        catalog_run_id = excluded.catalog_run_id, retired_at = null, updated_at = now();
    get diagnostics n_products = row_count;
    if (summary->>'complete')::boolean then
      update public.products set featurable = false, hidden_reason = 'retired', retired_at = now(), updated_at = now()
        where tenant_id = j.tenant_id and source = 'klaviyo' and catalog_run_id is distinct from j.id and retired_at is null;
    end if;
    select count(*) filter (where (x->>'featurable')::boolean) into n_featurable from jsonb_array_elements(products) x;
    insert into public.catalog_status as s (tenant_id, run_id, state, source, products, featurable, currency, currency_check,
        complete, reason, live, updated_at)
      values (j.tenant_id, j.id, st, summary->>'source', jsonb_array_length(products), n_featurable, cur,
        summary->>'currencyCheck', (summary->>'complete')::boolean, summary->>'reason', live, now())
      on conflict (tenant_id) do update set run_id = excluded.run_id, state = excluded.state, source = excluded.source,
        products = excluded.products, featurable = excluded.featurable, currency = excluded.currency,
        currency_check = excluded.currency_check, complete = excluded.complete, reason = excluded.reason,
        live = excluded.live, updated_at = now();
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'catalog' and superseded_at is null;
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'catalog', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when newer then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n_findings = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('state', st, 'source', summary->'source', 'products', jsonb_array_length(products),
          'featurable', n_featurable, 'findings', n_findings, 'complete', summary->'complete', 'live', live, 'newer', newer)
    where id = j.id;
  return jsonb_build_object('products', jsonb_array_length(products), 'featurable', n_featurable, 'findings', n_findings,
    'newer', newer);
end $$;

-- A catalog read Klaviyo stopped. A rate limit puts it back for later
-- (between a minute and a day), without using one of its tries. A rejected
-- key or a missing scope ends it: a live connection then needs the owner
-- (the key is no longer read; connecting again with a key fixes it), and
-- the owners are told. Locks: the tenant first, then the job.
create or replace function public.pause_source_reading(job uuid, lease uuid, reason text, seconds integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; is_live boolean;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_catalog' or reason is null
    or reason not in ('rate_limited','klaviyo_key_rejected','klaviyo_scope_missing') then
    raise exception 'Invalid pause' using errcode = '23514';
  end if;
  if reason = 'rate_limited' then
    update public.job_runs set status = 'retry_wait', attempt = greatest(attempt - 1, 0),
        available_at = now() + make_interval(secs => least(greatest(coalesce(seconds, 60), 60), 86400)),
        error_code = 'rate_limited', lease_token = null, lease_until = null, updated_at = now()
      where id = j.id;
    return;
  end if;
  update public.job_runs set status = 'failed', failure_class = 'auth', error_code = reason, lease_token = null,
      lease_until = null, updated_at = now()
    where id = j.id;
  select w.mode = 'live' into is_live from public.workspace_connections w
    where w.tenant_id = j.tenant_id and w.provider = 'klaviyo' for update;
  if coalesce(is_live, false) then
    update public.workspace_connections set status = 'expired', last_error = reason, revision = revision + 1, updated_at = now()
      where tenant_id = j.tenant_id and provider = 'klaviyo';
    if reason = 'klaviyo_key_rejected' then
      update public.klaviyo_credentials set status = 'revoked', updated_at = now() where tenant_id = j.tenant_id;
    end if;
  end if;
  insert into public.catalog_status as s (tenant_id, run_id, state, reason, live, updated_at)
    values (j.tenant_id, j.id, 'paused', reason, j.input->>'mode' = 'live', now())
    on conflict (tenant_id) do update set run_id = excluded.run_id, state = 'paused', reason = excluded.reason,
      live = excluded.live, updated_at = now();
  perform private.notify_owners(j.tenant_id, 'connection_health', j.tenant_id,
    case when reason = 'klaviyo_key_rejected'
      then 'Klaviyo no longer accepts the API key. Connect Klaviyo again with a new private key to read the catalog.'
      else 'The Klaviyo API key cannot read the catalog. Connect Klaviyo again with a key that has Catalogs, Events and Metrics read access.' end);
end $$;

-- Site and catalog reads use live AI (and the open internet or the
-- workspace's Klaviyo key), so the workspace jobs never take them: only the
-- onboarding readers' run does. The same claim as before otherwise
-- (20260914090055).
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
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

-- The source reads (site and catalog) waiting, across active workspaces.
create or replace function public.source_readings_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select case when coalesce(auth.role(), '') <> 'service_role' then null else (
    select count(*)::integer from public.job_runs j join public.tenants t on t.id = j.tenant_id and t.status = 'active'
      where j.kind in ('brand.read_site','brand.read_catalog')
        and ((j.status in ('queued','retry_wait') and j.attempt < 4 and j.available_at <= now())
          or (j.status in ('leased','running') and j.lease_until < now()))) end;
$$;

-- The next source read due, across active workspaces, leased to the worker
-- for 90 seconds; as claim_site_reading (20260914090055), for both kinds.
create or replace function public.claim_source_reading() returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare candidate uuid; tenant uuid; j public.job_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  select r.id, r.tenant_id into candidate, tenant from public.job_runs r
    join public.tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.kind in ('brand.read_site','brand.read_catalog')
      and ((r.status in ('queued','retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased','running') and r.lease_until < now()))
    order by r.available_at, r.created_at limit 1;
  if candidate is null then return; end if;
  perform 1 from public.tenants where id = tenant and status = 'active' for update;
  if not found then return; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now()
    where tenant_id = tenant and kind in ('brand.read_site','brand.read_catalog') and status in ('leased','running')
      and lease_until < now();
  select * into j from public.job_runs
    where id = candidate and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.start_catalog_reading(uuid) from public, anon;
grant execute on function public.start_catalog_reading(uuid) to authenticated;
revoke all on function public.record_catalog_reading(uuid, uuid, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_catalog_reading(uuid, uuid, jsonb, jsonb, jsonb, boolean) to service_role;
revoke all on function public.pause_source_reading(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.pause_source_reading(uuid, uuid, text, integer) to service_role;
revoke all on function public.source_readings_waiting() from public, anon, authenticated;
grant execute on function public.source_readings_waiting() to service_role;
revoke all on function public.claim_source_reading() from public, anon, authenticated;
grant execute on function public.claim_source_reading() to service_role;
