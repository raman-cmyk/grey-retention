-- LRN-001 (D22): what happened to every email we put into Klaviyo, and
-- how it did.
--
-- One row per drafted email build (EML-004 part 2; a live draft from
-- PSH-001, or a synthetic brand's sample draft). The results sync, a
-- service-role run every hour, checks each email's status in Klaviyo
-- (draft, scheduled, sending, sent, cancelled, deleted) and whether it was
-- changed outside the app (its subject or preview; never overwritten: the
-- pusher refuses such a draft). Once an email is sent, its results are
-- read once a day for three days (per A/B variation, and its link clicks
-- per section), then never again. Each row keeps what was planned (email
-- type, angle, offer, send time, audience, products) and how each read was
-- made, for LRN-002's Performance analyst.
--
-- Only the results run writes it, through `save_klaviyo_result` under its
-- lease; members of the workspace (and platform operators) read it. Nothing
-- here schedules, sends or changes anything in Klaviyo.
--
-- The number is chosen at merge time (D24).

create table public.klaviyo_email_results (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  build_id uuid not null unique,
  run_id uuid not null,
  slot integer not null check (slot between 0 and 19),
  -- A synthetic brand's sample draft: its status and results are samples.
  sample boolean not null,
  campaign_id text not null check (length(campaign_id) between 1 and 200),
  message_id text check (message_id is null or message_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- What was planned and built: { date, time, emailType, angle, products,
  -- offer, audience, plannedSendAt, subject, code, approach, designs }.
  planned jsonb not null check (jsonb_typeof(planned) = 'object' and octet_length(planned::text) <= 20000),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'deleted', 'stale')),
  -- Changed in Klaviyo outside the app (its subject or preview); once seen
  -- it stays so.
  changed boolean not null default false,
  sent_at timestamptz,
  checked_at timestamptz,
  next_check_at timestamptz not null default now(),
  -- Results reads done (one a day for three days after the send).
  pulls integer not null default 0 check (pulls between 0 and 3),
  -- Per variation: [{ "variation": "...", "name": "Design A", "design": "A",
  -- "statistics": { "recipients": 1200, "open_rate": 0.41, ... } }].
  results jsonb not null default '[]'::jsonb
    check (jsonb_typeof(results) = 'array' and jsonb_array_length(results) <= 8 and octet_length(results::text) <= 20000),
  -- Per variation and address: [{ "variation": "...", "design": "A",
  -- "url": "...", "section": 2, "block": "hero_product", "clicks": 31,
  -- "unique": 27 }] (section and block null for an address in no section
  -- or in several; `unique` is each day's unique clickers added up).
  clicks jsonb not null default '[]'::jsonb
    check (jsonb_typeof(clicks) = 'array' and jsonb_array_length(clicks) <= 200 and octet_length(clicks::text) <= 200000),
  results_at timestamptz,
  -- False when the last read was not whole (Klaviyo had more, gave no
  -- orders, did not split the designs, or a part could not be read).
  complete boolean not null default true,
  -- How the last read was made: its windows, the account's currency, the
  -- conversion metric, the send strategy, where the send time came from,
  -- whether the designs were split and how clicks were found.
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 4000),
  -- Nothing more to check: sent and read three times, cancelled, deleted,
  -- a draft long past its day, or a sent email whose results could not be
  -- read for ten days (`paused` says why).
  final boolean not null default false,
  -- Why the last check could not read Klaviyo (its pace, a refused key, a
  -- missing scope, Klaviyo off): logged, and checked again later (D16).
  paused text check (paused is null or paused ~ '^[a-z][a-z_]{1,39}$'),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, build_id),
  foreign key (tenant_id, build_id) references public.email_builds (tenant_id, id) on delete cascade,
  check ((lease_token is null) = (lease_until is null)),
  check (status <> 'sent' or sent_at is not null),
  check (pulls = 0 or status in ('sent', 'deleted')),
  check (not final or status in ('sent', 'cancelled', 'deleted', 'stale')),
  check (not final or status <> 'sent' or pulls = 3 or paused is not null),
  check (status <> 'stale' or final),
  check (sample or message_id is not null)
);
create index klaviyo_email_results_due on public.klaviyo_email_results (next_check_at) where not final;
-- Drafted builds by when they were drafted, for meeting the drafts made since.
create index email_builds_drafted on public.email_builds (updated_at, id) where state = 'drafted';

alter table public.klaviyo_email_results enable row level security;
create policy klaviyo_email_results_member_read on public.klaviyo_email_results for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
-- Written only through the functions below.
revoke all on public.klaviyo_email_results from public, anon, authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.klaviyo_email_results from public, anon, authenticated, service_role';
  end if;
end $$;
grant select on public.klaviyo_email_results to authenticated;
grant select on public.klaviyo_email_results to service_role;

-- A result of one variation: its id and name as Klaviyo gives them, the
-- design it is (ours: A or B), and numbers of the counts read only.
create or replace function private.klaviyo_result_ok(r jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(r) = 'object'
    and r - 'variation' - 'name' - 'design' - 'statistics' = '{}'::jsonb
    and coalesce(jsonb_typeof(r->'variation'), 'null') in ('string', 'null')
    and (jsonb_typeof(r->'variation') is distinct from 'string' or r->>'variation' ~ '^[A-Za-z0-9_-]{1,64}$')
    and coalesce(jsonb_typeof(r->'name'), 'null') in ('string', 'null')
    and (jsonb_typeof(r->'name') is distinct from 'string' or length(r->>'name') between 1 and 120)
    and coalesce(jsonb_typeof(r->'design'), 'null') in ('string', 'null')
    and (jsonb_typeof(r->'design') is distinct from 'string' or r->>'design' in ('A', 'B'))
    and jsonb_typeof(r->'statistics') = 'object'
    and not exists (select 1 from jsonb_each(r->'statistics') s
      where s.key not in ('recipients', 'delivered', 'opens_unique', 'open_rate', 'clicks_unique', 'click_rate',
          'conversions', 'conversion_uniques', 'conversion_value', 'revenue_per_recipient', 'unsubscribe_uniques',
          'unsubscribe_rate', 'spam_complaints', 'bounced')
        or jsonb_typeof(s.value) <> 'number' or (s.value #>> '{}')::numeric < 0
        or (s.key like '%\_rate' and (s.value #>> '{}')::numeric > 1)), false);
$$;
revoke all on function private.klaviyo_result_ok(jsonb) from public, anon, authenticated;

-- One address's clicks: the variation and our design, the address (http
-- or https), the section it is in (or none), and two whole counts.
create or replace function private.klaviyo_click_ok(c jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(c) = 'object'
    and c - 'variation' - 'design' - 'url' - 'section' - 'block' - 'clicks' - 'unique' = '{}'::jsonb
    and coalesce(jsonb_typeof(c->'variation'), 'null') in ('string', 'null')
    and (jsonb_typeof(c->'variation') is distinct from 'string' or c->>'variation' ~ '^[A-Za-z0-9_-]{1,64}$')
    and coalesce(jsonb_typeof(c->'design'), 'null') in ('string', 'null')
    and (jsonb_typeof(c->'design') is distinct from 'string' or c->>'design' in ('A', 'B'))
    and jsonb_typeof(c->'url') = 'string' and length(c->>'url') between 1 and 2000 and c->>'url' ~* '^https?://'
    and coalesce(jsonb_typeof(c->'section'), 'null') in ('number', 'null')
    and (jsonb_typeof(c->'section') is distinct from 'number'
      or ((c->>'section') ~ '^\d{1,2}$' and (c->>'section')::integer < 60))
    and coalesce(jsonb_typeof(c->'block'), 'null') in ('string', 'null')
    and (jsonb_typeof(c->'block') is distinct from 'string' or c->>'block' ~ '^[a-z][a-z_]{1,39}$')
    and ((c->'section') is null or jsonb_typeof(c->'section') = 'null') = ((c->'block') is null or jsonb_typeof(c->'block') = 'null')
    and jsonb_typeof(c->'clicks') = 'number' and (c->>'clicks') ~ '^\d{1,9}$'
    and jsonb_typeof(c->'unique') = 'number' and (c->>'unique') ~ '^\d{1,9}$'
    -- Unique clickers are never more than the clicks.
    and (c->>'unique')::bigint <= (c->>'clicks')::bigint, false);
$$;
revoke all on function private.klaviyo_click_ok(jsonb) from public, anon, authenticated;

-- How a read was made: known keys only, each of its kind.
create or replace function private.klaviyo_context_ok(c jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(c) = 'object' and octet_length(c::text) <= 4000
    and c - 'reportFrom' - 'reportTo' - 'clicksFrom' - 'clicksTo' - 'currency' - 'conversion' - 'attributionOpen'
      - 'sendStrategy' - 'sentAtFrom' - 'abSplit' - 'clicksBy' - 'botsLeftOut' - 'reported' - 'resultsKept'
      - 'clicksKept' = '{}'::jsonb
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
      or (e.key = 'botsLeftOut' and (jsonb_typeof(e.value) <> 'number' or e.value #>> '{}' !~ '^\d{1,9}$'))), false);
$$;
revoke all on function private.klaviyo_context_ok(jsonb) from public, anon, authenticated;

-- Drafted emails the results run has not met yet (drafted in the last 30
-- days): a live draft with its message, or a synthetic brand's sample
-- draft (a real brand's sample draft is in no Klaviyo account: nothing to
-- check). One too large to keep is never met (and never counted waiting).
create or replace function private.adoptable_klaviyo_drafts()
returns table (tenant_id uuid, build_id uuid)
language sql stable security definer set search_path = '' as $$
  select b.tenant_id, b.id from public.email_builds b
    join public.tenants w on w.id = b.tenant_id and w.status = 'active'
    join public.strategy_runs s on s.tenant_id = b.tenant_id and s.id = b.run_id
    left join public.brand_profiles bp on bp.tenant_id = b.tenant_id
    left join public.klaviyo_draft_pushes p on p.tenant_id = b.tenant_id and p.push_key = b.push_key
    where b.state = 'drafted' and b.updated_at > now() - interval '30 days'
      and not exists (select 1 from public.klaviyo_email_results e where e.build_id = b.id)
      and ((b.sample_draft and coalesce(bp.synthetic, false))
        or (not b.sample_draft and p.state = 'drafted' and p.message_id ~ '^[A-Za-z0-9_-]{1,64}$'))
      and octet_length(coalesce(s.plan->'slots'->b.slot, '{}'::jsonb)::text) <= 15000
      and length(coalesce(b.email->>'subject', '')) <= 200 and length(coalesce(b.email->>'code', '')) <= 100
      and length(coalesce(b.email->>'approach', '')) <= 10 and length(coalesce(b.email->>'plannedSendAt', '')) <= 40
    order by b.tenant_id, b.id
    limit 200;
$$;
revoke all on function private.adoptable_klaviyo_drafts() from public, anon, authenticated, service_role;

-- How many checks are due (the hourly run asks first, so an idle run is
-- one small request).
create or replace function public.klaviyo_results_waiting()
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  return (select count(*) from private.adoptable_klaviyo_drafts())
    + (select count(*) from public.klaviyo_email_results e
        join public.tenants w on w.id = e.tenant_id and w.status = 'active'
        where not e.final and e.next_check_at <= now() and (e.lease_until is null or e.lease_until < now()));
end $$;

-- The results run's claim: first it meets the emails drafted since (each
-- with what was planned and built), then takes up to `lim` due checks of
-- active workspaces, each leased for three minutes (a run that stops is
-- picked up again once the lease runs out).
create or replace function public.claim_klaviyo_results(lim integer default 20)
returns setof public.klaviyo_email_results
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if lim is null or lim < 1 or lim > 100 then raise exception 'Invalid claim' using errcode = '23514'; end if;
  insert into public.klaviyo_email_results (tenant_id, build_id, run_id, slot, sample, campaign_id, message_id, planned)
    select b.tenant_id, b.id, b.run_id, b.slot, b.sample_draft, b.klaviyo_campaign_id,
      case when b.sample_draft then null else p.message_id end,
      jsonb_strip_nulls(jsonb_build_object(
        'date', s.plan->'slots'->b.slot->'date',
        'time', s.plan->'slots'->b.slot->'time',
        'emailType', s.plan->'slots'->b.slot->'emailType',
        'angle', left(s.plan->'slots'->b.slot->>'angle', 600),
        'products', s.plan->'slots'->b.slot->'products',
        'offer', s.plan->'slots'->b.slot->'offer',
        'audience', s.plan->'slots'->b.slot->'audience',
        'plannedSendAt', b.email->'plannedSendAt',
        'subject', b.email->'subject',
        'code', b.email->'code',
        'approach', b.email->'approach',
        'designs', case when b.sample_draft then '"A"'::jsonb else to_jsonb(p.designs) end))
    from private.adoptable_klaviyo_drafts() a
    join public.email_builds b on b.tenant_id = a.tenant_id and b.id = a.build_id
    join public.strategy_runs s on s.tenant_id = b.tenant_id and s.id = b.run_id
    left join public.klaviyo_draft_pushes p on p.tenant_id = b.tenant_id and p.push_key = b.push_key
    order by b.tenant_id, b.id
    on conflict do nothing;
  return query
    with due as (
      select e.tenant_id, e.build_id from public.klaviyo_email_results e
        join public.tenants w on w.id = e.tenant_id and w.status = 'active'
        where not e.final and e.next_check_at <= now() and (e.lease_until is null or e.lease_until < now())
        order by e.next_check_at, e.build_id
        limit lim
        for update of e skip locked)
    update public.klaviyo_email_results e
      set lease_token = gen_random_uuid(), lease_until = now() + interval '3 minutes', updated_at = now()
      from due where e.tenant_id = due.tenant_id and e.build_id = due.build_id
      returning e.*;
end $$;

-- One check's outcome, saved under its lease (and the lease let go).
-- `patch` names what changed; each is checked: Klaviyo's statuses only,
-- nothing back from sent, cancelled or deleted; a change seen stays seen;
-- the send time, set only with the sent status and once known kept; one
-- results read a day after the send and a day after the last read (three
-- in all), with what was read and how; final only when nothing is left to
-- check. Locks: the workspace first (shared), then the row.
create or replace function public.save_klaviyo_result(build uuid, lease uuid, patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.klaviyo_email_results;
  t uuid;
  made timestamptz;
  allowed constant text[] := array['status', 'changed', 'sent_at', 'pulls', 'results', 'clicks', 'complete',
    'context', 'final', 'paused', 'next_check_at'];
  new_status text; new_sent timestamptz; new_pulls integer; new_final boolean; next_at timestamptz;
  planned_day date;
  today date := (now() at time zone 'UTC')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if jsonb_typeof(patch) is distinct from 'object' or exists (select 1 from jsonb_object_keys(patch) k where k <> all(allowed))
    or not patch ? 'next_check_at' then
    raise exception 'Invalid result' using errcode = '23514';
  end if;
  if build is null or lease is null then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  select r.tenant_id into t from public.klaviyo_email_results r where r.build_id = build;
  if t is null then raise exception 'Result unavailable' using errcode = 'PT409'; end if;
  -- A workspace paused since the claim saves nothing.
  perform 1 from public.tenants where id = t and status = 'active' for share;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  select * into e from public.klaviyo_email_results r where r.tenant_id = t and r.build_id = build for update;
  if e.final or e.lease_token is distinct from lease or e.lease_until is null or e.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  select b.created_at into made from public.email_builds b where b.id = build;
  begin
    new_status := coalesce(patch->>'status', e.status);
    new_sent := case when patch ? 'sent_at' and jsonb_typeof(patch->'sent_at') = 'string' then (patch->>'sent_at')::timestamptz
      when patch ? 'sent_at' then 'infinity'::timestamptz
      else e.sent_at end;
    new_pulls := coalesce((patch->>'pulls')::integer, e.pulls);
    next_at := (patch->>'next_check_at')::timestamptz;
    new_final := case when jsonb_typeof(patch->'final') = 'boolean' then (patch->>'final')::boolean else false end;
  exception when others then
    raise exception 'Invalid result' using errcode = '23514';
  end;
  -- The planned day matters only to a stale outcome (read only for one).
  if new_status = 'stale' then
    begin
      planned_day := coalesce((e.planned->>'date')::date, today);
    exception when others then
      raise exception 'Invalid result' using errcode = '23514';
    end;
  end if;
  if new_status not in ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'deleted', 'stale')
    or (patch ? 'status' and jsonb_typeof(patch->'status') <> 'string')
    -- Nothing comes back from sent, cancelled or deleted (any can be deleted).
    or (e.status in ('sent', 'cancelled', 'deleted') and new_status <> e.status and new_status <> 'deleted')
    -- Stale ends it: only a draft or a scheduled email long past its day.
    or (new_status = 'stale' and (e.status not in ('draft', 'scheduled') or planned_day >= today - 14 or not new_final))
    -- The send time: set only with the sent status, a real time after the
    -- email was built and not ahead of now, and once known it stays.
    or (patch ? 'sent_at' and (new_status <> 'sent' or e.sent_at is not null))
    or (e.sent_at is not null and new_sent is distinct from e.sent_at)
    or (new_sent is not null and (not isfinite(new_sent) or new_sent > now() + interval '1 hour'
      or new_sent < coalesce(made, e.created_at) - interval '1 hour'))
    or (new_status = 'sent' and new_sent is null)
    or (patch ? 'changed' and jsonb_typeof(patch->'changed') <> 'boolean')
    or (patch ? 'complete' and jsonb_typeof(patch->'complete') <> 'boolean')
    or (patch ? 'final' and jsonb_typeof(patch->'final') <> 'boolean')
    or (patch ? 'paused' and jsonb_typeof(patch->'paused') <> 'null'
      and (jsonb_typeof(patch->'paused') <> 'string' or patch->>'paused' !~ '^[a-z][a-z_]{1,39}$'))
    or (patch ? 'context' and not private.klaviyo_context_ok(patch->'context'))
    -- One results read a day after the send and a day after the last,
    -- with what was read, three in all.
    or (patch ? 'pulls' and jsonb_typeof(patch->'pulls') <> 'number')
    or new_pulls not in (e.pulls, e.pulls + 1) or new_pulls > 3
    or (new_pulls = e.pulls + 1 and (new_status <> 'sent' or not patch ? 'results' or not patch ? 'clicks'
      or not patch ? 'complete' or not patch ? 'context'
      or now() < new_sent + make_interval(hours => 24 * new_pulls) - interval '10 minutes'
      or (e.results_at is not null and now() < e.results_at + interval '23 hours 50 minutes')))
    -- What was read, and how, only with a read.
    or ((patch ? 'results' or patch ? 'clicks' or patch ? 'complete' or patch ? 'context') and new_pulls = e.pulls)
    or (patch ? 'results' and (jsonb_typeof(patch->'results') <> 'array' or jsonb_array_length(patch->'results') > 8
      or octet_length((patch->'results')::text) > 20000
      or exists (select 1 from jsonb_array_elements(patch->'results') r where not private.klaviyo_result_ok(r))))
    or (patch ? 'clicks' and (jsonb_typeof(patch->'clicks') <> 'array' or jsonb_array_length(patch->'clicks') > 200
      or octet_length((patch->'clicks')::text) > 200000
      or exists (select 1 from jsonb_array_elements(patch->'clicks') c where not private.klaviyo_click_ok(c))))
    -- Final only when nothing is left to check: three reads, or a sent
    -- email unread for ten days (saying why).
    or (new_final and not (new_status in ('cancelled', 'deleted', 'stale') or (new_status = 'sent' and new_pulls = 3)
      or (new_status = 'sent' and patch->>'paused' is not null and now() > new_sent + interval '10 days')))
    or (not new_final and new_status = 'sent' and new_pulls = 3)
    or next_at is null or next_at < now() - interval '1 minute' or next_at > now() + interval '8 days' then
    raise exception 'Invalid result' using errcode = '23514';
  end if;
  update public.klaviyo_email_results r
    set status = new_status,
        changed = r.changed or coalesce((patch->>'changed')::boolean, false),
        sent_at = new_sent,
        pulls = new_pulls,
        results = case when patch ? 'results' then patch->'results' else r.results end,
        clicks = case when patch ? 'clicks' then patch->'clicks' else r.clicks end,
        results_at = case when patch ? 'results' then now() else r.results_at end,
        complete = case when patch ? 'complete' then (patch->>'complete')::boolean else r.complete end,
        context = case when patch ? 'context' then patch->'context' else r.context end,
        final = new_final,
        paused = case when patch ? 'paused' then patch->>'paused' else null end,
        checked_at = now(),
        next_check_at = next_at,
        lease_token = null, lease_until = null, updated_at = now()
    where r.tenant_id = t and r.build_id = build;
end $$;

revoke all on function public.klaviyo_results_waiting() from public, anon, authenticated;
grant execute on function public.klaviyo_results_waiting() to service_role;
revoke all on function public.claim_klaviyo_results(integer) from public, anon, authenticated;
grant execute on function public.claim_klaviyo_results(integer) to service_role;
revoke all on function public.save_klaviyo_result(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_klaviyo_result(uuid, uuid, jsonb) to service_role;
