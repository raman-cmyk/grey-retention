-- ONB-103 Klaviyo historian (AGENT_MAP §2, BUILD_BRIEF D19).
--
-- What the brand already sent, and what made money, shapes the plan. A
-- history read (brand.read_history) reads, read-only, the emails sent in
-- the last year with their results, the emails already scheduled (those
-- days count as taken), the flows and their results (when the key can read
-- flows), the lists and segments. Code counts the history (results,
-- emails a week, the usual send time, the best emails); the Klaviyo
-- historian says in words what made money, what the emails promote, how
-- they speak and who they go to.
--
-- * klaviyo_history: one checked history per workspace, replaced by each
--   read, for "Plan next 15 days" and the Brand strategist; ready, empty
--   (nothing sent or scheduled) or paused (the key needs the owner).
-- * Its findings go to brand_findings (source klaviyo_history), with the
--   new words-only topic `performance` (what made money).
--
-- Like site and catalog reads, history reads run only in the onboarding
-- readers' run, never in the sweep or an owner's "Run jobs", and pause on
-- Klaviyo's pace or a refused key (pause_source_reading). Locks: the
-- tenant first, then the job, then the history.

alter table public.brand_findings drop constraint brand_findings_topic_check,
  add constraint brand_findings_topic_check check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping',
    'locale','price_band','offering','audience','tone','claim','contact','review_platform','performance')),
  add constraint brand_findings_history_topics
    check (source <> 'klaviyo_history' or topic in ('offering','audience','tone','claim','performance'));

-- The value each topic holds, as before (20260914090055), with
-- `performance` in words only.

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
    when 'shipping', 'offering', 'audience', 'tone', 'contact', 'performance' then
      return coalesce(v = '{}'::jsonb, false);
    else
      return false;
  end case;
end $$;

create table public.klaviyo_history (
  tenant_id uuid primary key references public.tenants(id),
  -- The history read this describes.
  run_id uuid not null,
  state text not null check (state in ('ready','empty','paused')),
  -- The counted history (features/onboarding/history/facts.ts checks the
  -- same shape when it is read back); kept while a later read is paused.
  snapshot jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and length(snapshot::text) <= 900000)),
  sent integer not null default 0 check (sent between 0 and 400),
  scheduled integer not null default 0 check (scheduled between 0 and 300),
  flows integer not null default 0 check (flows between 0 and 100),
  audiences integer not null default 0 check (audiences between 0 and 120),
  -- False when the key cannot read flows (they are left out).
  flows_read boolean not null default true,
  -- False when the read stopped before the end.
  complete boolean not null default true,
  reason text check (reason is null or reason ~ '^[a-z_]{1,40}$'),
  live boolean not null,
  read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id),
  check (state = 'paused' or snapshot is not null),
  check (state <> 'empty' or (sent = 0 and scheduled = 0))
);
alter table public.klaviyo_history enable row level security;
create policy member_read on public.klaviyo_history for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.klaviyo_history from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.klaviyo_history from authenticated;
grant select on public.klaviyo_history to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.klaviyo_history from authenticated';
  end if;
end $$;

alter table public.job_runs drop constraint job_runs_kind_check,
  add constraint job_runs_kind_check check (kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule',
    'assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan',
    'reviews.remind','design.render','ops.health','results.pull','reports.digest','learning.synthesize','optimizer.winback',
    'optimizer.suppress','email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history'));

-- The owner starts a history read, on the same terms as a catalog read
-- (20260914090057): Klaviyo connected, a sample connection only for a
-- synthetic brand, at most once a day, a failed read started again.
create or replace function public.start_history_reading(t uuid)
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
    values (t, 'brand.read_history', 'brand.read_history:' || c.mode || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
      jsonb_build_object('mode', c.mode), auth.uid())
    on conflict (tenant_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into j;
  update public.job_runs set status = 'queued', attempt = 0, available_at = now(), failure_class = null, error_code = null,
      lease_token = null, lease_until = null, checkpoint = '{}'::jsonb, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- The catalog's start, as before (20260914090057), with the same restart
-- fix: a read started again counts its pauses from nothing.
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
      lease_token = null, lease_until = null, checkpoint = '{}'::jsonb, updated_at = now()
    where id = j and status in ('failed', 'cancelled');
  return j;
end $$;

-- A history read's result, all at once; then the job is finished. The
-- history replaces the workspace's earlier one; its findings replace the
-- history findings of the same topics (all of them when nothing was sent
-- or scheduled). An older read finishing after a newer one changes
-- nothing, and its findings are kept already replaced. Locks: the tenant
-- first, then the job, then the history.
create or replace function public.record_klaviyo_history(job uuid, lease uuid, snapshot jsonb, findings jsonb, summary jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; newer boolean; st text; n_findings integer := 0; topics text[];
  n_sent integer; n_scheduled integer; n_flows integer; n_audiences integer;
  keys constant text[] := array['currency','timezone','sendsPerWeek','usualSendTime','sent','scheduled','flows','audiences','flowsRead',
    'window','parts'];
  parts constant text[] := array['sent','scheduled','audiences','campaignReport','flows','flowReport','lists','segments'];
  sent_keys constant text[] := array['id','campaignId','name','subject','preview','sentAt','offer','collecting','abTest','strategy',
    'recipients','opens','clicks','orders','revenue','revenuePerRecipient','openRate','clickRate','unsubscribeRate'];
  scheduled_keys constant text[] := array['id','campaignId','subject','sendAt','date','audienceIds','offer'];
  flow_keys constant text[] := array['id','name','status','trigger','sends90d','orders90d','revenue90d'];
  audience_keys constant text[] := array['id','kind','name','active','starred','excludedOnly'];
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_history' then raise exception 'Not a history reading job' using errcode = '23514'; end if;
  if live is null or live is distinct from (coalesce(j.input->>'mode', '') = 'live') then
    raise exception 'Invalid history reading' using errcode = '23514';
  end if;
  -- The sample account only for a synthetic brand, also when it is stored.
  if not live and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = j.tenant_id), false) then
    raise exception 'Invalid history reading' using errcode = '23514';
  end if;
  st := summary->>'state';
  if jsonb_typeof(summary) is distinct from 'object' or st is null or st not in ('ready','empty')
    or summary - 'state' - 'complete' - 'flowsRead' - 'reason' <> '{}'::jsonb
    or jsonb_typeof(summary->'complete') is distinct from 'boolean'
    or jsonb_typeof(summary->'flowsRead') is distinct from 'boolean'
    or (summary ? 'reason' and coalesce(summary->>'reason', '') !~ '^[a-z_]{1,40}$') then
    raise exception 'Invalid history summary' using errcode = '23514';
  end if;
  if jsonb_typeof(snapshot) is distinct from 'object' or not (snapshot ?& keys) or snapshot - keys <> '{}'::jsonb
    or length(snapshot::text) > 900000
    or coalesce(snapshot->>'currency', '') !~ '^[A-Z]{3}$'
    or jsonb_typeof(snapshot->'timezone') is distinct from 'string' or length(snapshot->>'timezone') not between 1 and 60
    or jsonb_typeof(snapshot->'sendsPerWeek') is distinct from 'number' or (snapshot->>'sendsPerWeek')::numeric not between 0 and 50
    or coalesce(jsonb_typeof(snapshot->'usualSendTime'), 'missing') not in ('string','null')
    or (jsonb_typeof(snapshot->'usualSendTime') = 'string' and snapshot->>'usualSendTime' !~ '^([01][0-9]|2[0-3]):00$')
    or jsonb_typeof(snapshot->'sent') is distinct from 'array' or jsonb_array_length(snapshot->'sent') > 300
    or jsonb_typeof(snapshot->'scheduled') is distinct from 'array' or jsonb_array_length(snapshot->'scheduled') > 300
    or jsonb_typeof(snapshot->'flows') is distinct from 'array' or jsonb_array_length(snapshot->'flows') > 100
    or jsonb_typeof(snapshot->'audiences') is distinct from 'array' or jsonb_array_length(snapshot->'audiences') > 120
    or jsonb_typeof(snapshot->'flowsRead') is distinct from 'boolean'
    or (snapshot->>'flowsRead')::boolean is distinct from (summary->>'flowsRead')::boolean
    or (not (snapshot->>'flowsRead')::boolean and jsonb_array_length(snapshot->'flows') > 0)
    or snapshot->'window' is distinct from '{"sentDays": 365, "sentCap": 300, "flowDays": 90}'::jsonb
    or jsonb_typeof(snapshot->'parts') is distinct from 'object' or not ((snapshot->'parts') ?& parts)
    or (snapshot->'parts') - parts <> '{}'::jsonb
    or exists (select 1 from jsonb_each(snapshot->'parts') x where jsonb_typeof(x.value) <> 'boolean')
    -- Each sent email: its own keys, an id, a time, words of bounded length,
    -- flags, and results that are whole, money or rates (or unknown).
    or exists (select 1 from jsonb_array_elements(snapshot->'sent') e
      where jsonb_typeof(e) <> 'object' or not (e ?& sent_keys) or e - sent_keys <> '{}'::jsonb
        or jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ '^[A-Za-z0-9]{1,64}$'
        or coalesce(jsonb_typeof(e->'campaignId'), 'missing') not in ('string','null')
        or (jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' !~ '^[A-Za-z0-9]{1,64}$')
        or exists (select 1 from unnest(array['name','subject','preview']) k
          where coalesce(jsonb_typeof(e->k), 'missing') not in ('string','null') or length(e->>k) > 300)
        or jsonb_typeof(e->'sentAt') is distinct from 'string' or private.safe_time(e->>'sentAt') is null
        or exists (select 1 from unnest(array['offer','collecting','abTest']) k where jsonb_typeof(e->k) is distinct from 'boolean')
        or coalesce(e->>'strategy', '') not in ('static','local','optimized')
        or exists (select 1 from unnest(array['recipients','opens','clicks','orders']) k
          where coalesce(jsonb_typeof(e->k), 'missing') not in ('number','null')
            or (jsonb_typeof(e->k) = 'number' and e->>k !~ '^[0-9]{1,9}$'))
        or exists (select 1 from unnest(array['revenue','revenuePerRecipient']) k
          where coalesce(jsonb_typeof(e->k), 'missing') not in ('number','null')
            or (jsonb_typeof(e->k) = 'number' and (e->>k)::numeric not between 0 and 100000000))
        or exists (select 1 from unnest(array['openRate','clickRate','unsubscribeRate']) k
          where coalesce(jsonb_typeof(e->k), 'missing') not in ('number','null')
            or (jsonb_typeof(e->k) = 'number' and (e->>k)::numeric not between 0 and 1)))
    or (select count(distinct e->>'id') from jsonb_array_elements(snapshot->'sent') e) <> jsonb_array_length(snapshot->'sent')
    -- Each scheduled email: a real day, its audiences, whether it is an offer.
    or exists (select 1 from jsonb_array_elements(snapshot->'scheduled') e
      where jsonb_typeof(e) <> 'object' or not (e ?& scheduled_keys) or e - scheduled_keys <> '{}'::jsonb
        or jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ '^[A-Za-z0-9]{1,64}$'
        or coalesce(jsonb_typeof(e->'campaignId'), 'missing') not in ('string','null')
        or (jsonb_typeof(e->'campaignId') = 'string' and e->>'campaignId' !~ '^[A-Za-z0-9]{1,64}$')
        or coalesce(jsonb_typeof(e->'subject'), 'missing') not in ('string','null') or length(e->>'subject') > 300
        or jsonb_typeof(e->'sendAt') is distinct from 'string' or private.safe_time(e->>'sendAt') is null
        or jsonb_typeof(e->'date') is distinct from 'string'
        or private.safe_time((e->>'date') || 'T00:00:00Z') is null or (e->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
        or to_char(((e->>'date') || 'T00:00:00Z')::timestamptz at time zone 'UTC', 'YYYY-MM-DD') <> e->>'date'
        or jsonb_typeof(e->'audienceIds') is distinct from 'array' or jsonb_array_length(e->'audienceIds') > 50
        or exists (select 1 from jsonb_array_elements(e->'audienceIds') a
          where jsonb_typeof(a) <> 'string' or a #>> '{}' !~ '^[A-Za-z0-9]{1,64}$')
        or jsonb_typeof(e->'offer') is distinct from 'boolean')
    or (select count(distinct e->>'id') from jsonb_array_elements(snapshot->'scheduled') e) <> jsonb_array_length(snapshot->'scheduled')
    -- Each flow: its results whole and money, or unknown.
    or exists (select 1 from jsonb_array_elements(snapshot->'flows') e
      where jsonb_typeof(e) <> 'object' or not (e ?& flow_keys) or e - flow_keys <> '{}'::jsonb
        or jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ '^[A-Za-z0-9]{1,64}$'
        or jsonb_typeof(e->'name') is distinct from 'string' or length(e->>'name') not between 1 and 200
        or jsonb_typeof(e->'status') is distinct from 'string' or length(e->>'status') > 20
        or coalesce(jsonb_typeof(e->'trigger'), 'missing') not in ('string','null') or length(e->>'trigger') > 40
        or exists (select 1 from unnest(array['sends90d','orders90d']) k
          where coalesce(jsonb_typeof(e->k), 'missing') not in ('number','null')
            or (jsonb_typeof(e->k) = 'number' and e->>k !~ '^[0-9]{1,9}$'))
        or coalesce(jsonb_typeof(e->'revenue90d'), 'missing') not in ('number','null')
        or (jsonb_typeof(e->'revenue90d') = 'number' and (e->>'revenue90d')::numeric not between 0 and 100000000))
    or (select count(distinct e->>'id') from jsonb_array_elements(snapshot->'flows') e) <> jsonb_array_length(snapshot->'flows')
    -- Each list or segment.
    or exists (select 1 from jsonb_array_elements(snapshot->'audiences') e
      where jsonb_typeof(e) <> 'object' or not (e ?& audience_keys) or e - audience_keys <> '{}'::jsonb
        or jsonb_typeof(e->'id') is distinct from 'string' or e->>'id' !~ '^[A-Za-z0-9]{1,64}$'
        or coalesce(e->>'kind', '') not in ('list','segment')
        or jsonb_typeof(e->'name') is distinct from 'string' or length(e->>'name') not between 1 and 200
        or exists (select 1 from unnest(array['active','starred','excludedOnly']) k where jsonb_typeof(e->k) is distinct from 'boolean'))
    or (select count(distinct e->>'id') from jsonb_array_elements(snapshot->'audiences') e) <> jsonb_array_length(snapshot->'audiences')
    or (st = 'empty') <> (jsonb_array_length(snapshot->'sent') = 0 and jsonb_array_length(snapshot->'scheduled') = 0) then
    raise exception 'Invalid history' using errcode = '23514';
  end if;
  -- The findings: the topics a history can state, each citing Klaviyo;
  -- code counts (performance), a model or the sample rules put it in words.
  if jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 12
    or (st = 'empty' and jsonb_array_length(findings) > 0)
    or exists (select 1 from jsonb_array_elements(findings) f
      where jsonb_typeof(f) <> 'object' or f - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
        or coalesce(f->>'topic', '') not in ('performance','offering','tone','audience')
        or jsonb_typeof(f->'statement') is distinct from 'string'
        or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
        or coalesce(f->>'pass', '') not in ('sample','model','code')
        or (f->>'pass' = 'sample') = live
        or (f->>'pass' = 'code' and (f->>'topic' <> 'performance' or coalesce(f->>'model', '') <> ''))
        or (f->>'pass' = 'model' and coalesce(btrim(f->>'model'), '') = '')
        or (f ? 'model' and coalesce(jsonb_typeof(f->'model'), 'missing') not in ('string','null'))
        or jsonb_typeof(f->'evidence') is distinct from 'object' or (f->'evidence') - 'ref' <> '{}'::jsonb
        or coalesce(f->'evidence'->>'ref', '') !~ '^klaviyo:(campaigns|audiences|flows|campaign:[A-Za-z0-9]{1,64})$') then
    raise exception 'Invalid finding' using errcode = '23514';
  end if;
  n_sent := jsonb_array_length(snapshot->'sent');
  n_scheduled := jsonb_array_length(snapshot->'scheduled');
  n_flows := jsonb_array_length(snapshot->'flows');
  n_audiences := jsonb_array_length(snapshot->'audiences');
  newer := exists (select 1 from public.klaviyo_history h join public.job_runs r on r.tenant_id = h.tenant_id and r.id = h.run_id
    where h.tenant_id = j.tenant_id and h.state in ('ready','empty') and r.created_at > j.created_at);
  if not newer then
    insert into public.klaviyo_history as h (tenant_id, run_id, state, snapshot, sent, scheduled, flows, audiences, flows_read,
        complete, reason, live, read_at, updated_at)
      values (j.tenant_id, j.id, st, snapshot, n_sent, n_scheduled, n_flows, n_audiences, (summary->>'flowsRead')::boolean,
        (summary->>'complete')::boolean, summary->>'reason', live, now(), now())
      on conflict (tenant_id) do update set run_id = excluded.run_id, state = excluded.state, snapshot = excluded.snapshot,
        sent = excluded.sent, scheduled = excluded.scheduled, flows = excluded.flows, audiences = excluded.audiences,
        flows_read = excluded.flows_read, complete = excluded.complete, reason = excluded.reason, live = excluded.live,
        read_at = excluded.read_at, updated_at = now();
    select coalesce(array_agg(distinct e->>'topic'), '{}') into topics from jsonb_array_elements(findings) e;
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'klaviyo_history' and superseded_at is null
        and (st = 'empty' or topic = any(topics));
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'klaviyo_history', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when newer then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n_findings = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('state', st, 'sent', n_sent, 'scheduled', n_scheduled, 'flows', n_flows,
          'audiences', n_audiences, 'findings', n_findings, 'complete', summary->'complete',
          'flowsRead', summary->'flowsRead', 'live', live, 'newer', newer)
    where id = j.id;
  return jsonb_build_object('sent', n_sent, 'scheduled', n_scheduled, 'findings', n_findings, 'newer', newer);
end $$;

-- Klaviyo pausing a source read: as before (20260914090057), for history
-- reads too (their pause is written on the history, not the catalog).
create or replace function public.pause_source_reading(job uuid, lease uuid, reason text, seconds integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; pauses integer; rechecked boolean;
begin
  j := private.onboarding_lease(job, lease);
  if j.kind not in ('brand.read_catalog','brand.read_history') or reason is null
    or reason not in ('rate_limited','klaviyo_key_rejected','klaviyo_scope_missing') then
    raise exception 'Invalid pause' using errcode = '23514';
  end if;
  if reason = 'rate_limited' then
    pauses := coalesce((j.checkpoint->>'pauses')::integer, 0) + 1;
    if pauses > 6 or j.created_at < now() - interval '1 day' then
      update public.job_runs set status = 'failed', failure_class = 'rate_limit', error_code = 'rate_limited',
          checkpoint = coalesce(j.checkpoint, '{}'::jsonb) || jsonb_build_object('pauses', pauses),
          lease_token = null, lease_until = null, updated_at = now()
        where id = j.id;
      perform private.notify_owners(j.tenant_id, 'connection_health', j.tenant_id,
        case when j.kind = 'brand.read_catalog'
          then 'Klaviyo kept asking us to slow down, so the catalog was not read. Start the catalog read again later.'
          else 'Klaviyo kept asking us to slow down, so what you sent was not read. Start the history read again later.' end);
      return;
    end if;
    update public.job_runs set status = 'retry_wait', attempt = greatest(attempt - 1, 0),
        available_at = now() + make_interval(secs => least(greatest(coalesce(seconds, 60), 60), 86400)),
        checkpoint = coalesce(j.checkpoint, '{}'::jsonb) || jsonb_build_object('pauses', pauses),
        error_code = 'rate_limited', lease_token = null, lease_until = null, updated_at = now()
      where id = j.id;
    return;
  end if;
  if coalesce(j.input->>'mode', '') = 'live' then
    perform 1 from public.workspace_connections w
      where w.tenant_id = j.tenant_id and w.provider = 'klaviyo' for update;
    rechecked := exists (select 1 from public.klaviyo_credentials c
      where c.tenant_id = j.tenant_id and c.checked_at > j.updated_at);
    if rechecked then
      update public.job_runs set status = 'retry_wait', attempt = greatest(attempt - 1, 0), available_at = now(),
          error_code = reason, lease_token = null, lease_until = null, updated_at = now()
        where id = j.id;
      return;
    end if;
  end if;
  update public.job_runs set status = 'failed', failure_class = 'auth', error_code = reason, lease_token = null,
      lease_until = null, updated_at = now()
    where id = j.id;
  if coalesce(j.input->>'mode', '') <> 'live' then return; end if;
  update public.workspace_connections set status = 'expired', last_error = reason, revision = revision + 1, updated_at = now()
    where tenant_id = j.tenant_id and provider = 'klaviyo' and mode = 'live';
  if reason = 'klaviyo_key_rejected' then
    update public.klaviyo_credentials set status = 'revoked', updated_at = now() where tenant_id = j.tenant_id;
  end if;
  if j.kind = 'brand.read_catalog' then
    insert into public.catalog_status as s (tenant_id, run_id, state, reason, live, updated_at)
      values (j.tenant_id, j.id, 'paused', reason, true, now())
      on conflict (tenant_id) do update set run_id = excluded.run_id, state = 'paused', reason = excluded.reason,
        live = excluded.live, updated_at = now();
  else
    -- The history read before stays as it is (its own run, live or
    -- sample); only its state says a later read stopped.
    insert into public.klaviyo_history as h (tenant_id, run_id, state, reason, live, complete, flows_read, read_at, updated_at)
      values (j.tenant_id, j.id, 'paused', reason, true, false, false, now(), now())
      on conflict (tenant_id) do update set state = 'paused', reason = excluded.reason, updated_at = now();
  end if;
  perform private.notify_owners(j.tenant_id, 'connection_health', j.tenant_id,
    case
      when reason = 'klaviyo_key_rejected' and j.kind = 'brand.read_catalog'
        then 'Klaviyo no longer accepts the API key. Connect Klaviyo again with a new private key to read the catalog.'
      when reason = 'klaviyo_key_rejected'
        then 'Klaviyo no longer accepts the API key. Connect Klaviyo again with a new private key to read what you sent.'
      when j.kind = 'brand.read_catalog'
        then 'The Klaviyo API key cannot read the catalog. Connect Klaviyo again with a key that has Accounts, Catalogs, Events and Metrics read access.'
      else 'The Klaviyo API key cannot read what you sent. Connect Klaviyo again with a key that has Accounts, Campaigns, Lists, Metrics and Segments read access.' end);
end $$;

-- Source reads are the worker's: as before (20260914090057), for history
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
  if j.kind in ('brand.read_site','brand.read_catalog','brand.read_history') and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if j.status <> 'running' or j.lease_token is distinct from lease or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return j;
end $$;

-- The workspace jobs never take a source read: as before (20260914090057),
-- history reads too.
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
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

drop index public.job_runs_source_reads;
create index job_runs_source_reads on public.job_runs (available_at, created_at)
  where kind in ('brand.read_site','brand.read_catalog','brand.read_history');

-- The source reads waiting, and the next one, across active workspaces:
-- as before (20260914090057), history reads too.
create or replace function public.source_readings_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select case when coalesce(auth.role(), '') <> 'service_role' then null else (
    select count(*)::integer from public.job_runs j join public.tenants t on t.id = j.tenant_id and t.status = 'active'
      where j.kind in ('brand.read_site','brand.read_catalog','brand.read_history')
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
    where r.kind in ('brand.read_site','brand.read_catalog','brand.read_history')
      and ((r.status in ('queued','retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased','running') and r.lease_until < now()))
    order by r.available_at, r.created_at limit 1;
  if candidate is null then return; end if;
  perform 1 from public.tenants where id = tenant and status = 'active' for update;
  if not found then return; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now()
    where tenant_id = tenant and kind in ('brand.read_site','brand.read_catalog','brand.read_history') and status in ('leased','running')
      and lease_until < now();
  select * into j from public.job_runs
    where id = candidate and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.start_history_reading(uuid) from public, anon, service_role;
grant execute on function public.start_history_reading(uuid) to authenticated;
revoke all on function public.record_klaviyo_history(uuid, uuid, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_klaviyo_history(uuid, uuid, jsonb, jsonb, jsonb, boolean) to service_role;
