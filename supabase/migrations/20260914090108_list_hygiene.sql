-- PICK-101 (owner pick #101, "List hygiene"): every email GROS plans leaves
-- out people who bounced or are suppressed, and people with no clicks,
-- opens, site visits or orders in the last N days (180 by default). Two
-- tables:
--
-- 1. `list_hygiene_settings`: the owner's per-store setting (on or off, and
--    N, 30 to 730 days). No row means the default (on, 180). Only the owner
--    changes it, through `set_list_hygiene` (the page's revision is checked:
--    PT409 when another window changed it); members read it. Each change
--    goes in the change history (`list_hygiene_changed`).
-- 2. `klaviyo_hygiene_segments`: the exclusion segment in the store's
--    Klaviyo, one row per rule (`v1-180`) with the Klaviyo account and the
--    fingerprint of the metrics it reads: made once, then reused. Only the
--    live pusher writes it, under the exact push lease of the email build
--    it runs for (`save_hygiene_segment`); while one push is making the
--    segment, another is refused (PT409) and waits. Members read it (the
--    Audiences page shows how many people it leaves out); the owner asks
--    for a deleted or failed one to be made again (`retry_list_hygiene`).
--
-- The number is chosen at merge time (D24).

create table public.list_hygiene_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null,
  days smallint not null check (days between 30 and 730),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.list_hygiene_settings enable row level security;
create policy list_hygiene_settings_member_read on public.list_hygiene_settings for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.list_hygiene_settings from public, anon, authenticated, service_role;
grant select on public.list_hygiene_settings to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.list_hygiene_settings from public, anon, authenticated, service_role';
  end if;
end $$;

-- The owner turns hygiene on or off and sets its days. `expected_revision`
-- is the revision the page read, 0 when the store never saved one. Returns
-- the new revision (the same one when nothing changed).
create or replace function public.set_list_hygiene(t uuid, hygiene_on boolean, hygiene_days integer,
  expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare cur public.list_hygiene_settings;
begin
  -- The owner only; the workspace row is locked first.
  perform private.require_member(t, true);
  if hygiene_on is null or hygiene_days is null or hygiene_days not between 30 and 730 then
    raise exception 'Choose 30 to 730 days' using errcode = '23514';
  end if;
  select * into cur from public.list_hygiene_settings s where s.tenant_id = t for update;
  if not found then
    if coalesce(expected_revision, -1) <> 0 then
      raise exception 'List hygiene changed' using errcode = 'PT409';
    end if;
    if hygiene_on and hygiene_days = 180 then
      return 0;
    end if;
    insert into public.list_hygiene_settings (tenant_id, enabled, days, updated_by)
      values (t, hygiene_on, hygiene_days, auth.uid());
    insert into public.workspace_events (tenant_id, actor_id, kind, detail)
      values (t, auth.uid(), 'list_hygiene_changed', jsonb_build_object(
        'from_enabled', true, 'from_days', 180, 'to_enabled', hygiene_on, 'to_days', hygiene_days));
    return 1;
  end if;
  if cur.revision <> coalesce(expected_revision, -1) then
    raise exception 'List hygiene changed' using errcode = 'PT409';
  end if;
  if cur.enabled = hygiene_on and cur.days = hygiene_days then
    return cur.revision;
  end if;
  update public.list_hygiene_settings s
    set enabled = hygiene_on, days = hygiene_days, revision = s.revision + 1,
      updated_by = auth.uid(), updated_at = now()
    where s.tenant_id = t;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail)
    values (t, auth.uid(), 'list_hygiene_changed', jsonb_build_object(
      'from_enabled', cur.enabled, 'from_days', cur.days, 'to_enabled', hygiene_on, 'to_days', hygiene_days));
  return cur.revision + 1;
end $$;

revoke all on function public.set_list_hygiene(uuid, boolean, integer, integer) from public, anon, service_role;
grant execute on function public.set_list_hygiene(uuid, boolean, integer, integer) to authenticated;

create table public.klaviyo_hygiene_segments (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The rule it is for: its version and days ("v1-180"). One row per rule:
  -- the current state of its segment in the store's Klaviyo.
  rule_key text not null check (rule_key ~ '^v[0-9]{1,2}-[0-9]{2,3}$'),
  state text not null check (state in ('creating', 'ready', 'no_data', 'failed', 'deleted')),
  -- The Klaviyo account the segment is in: a reconnect to another account
  -- never reuses it.
  klaviyo_account_id text check (klaviyo_account_id is null or klaviyo_account_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- A fingerprint of the metrics its definition reads: other metrics make
  -- another segment.
  fingerprint text check (fingerprint is null or fingerprint ~ '^[a-f0-9]{8}$'),
  segment_id text check (segment_id is null or segment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Why there is no segment (no_data, failed, deleted).
  reason text check (reason is null or reason ~ '^[a-z][a-z_]{1,39}$'),
  -- When the database saw a create start (never the caller's clock), and
  -- the email build whose push holds that claim.
  create_started_at timestamptz,
  claim_build uuid,
  -- How many people Klaviyo says the segment holds (null: not counted yet).
  profile_count bigint check (profile_count is null or profile_count between 0 and 1000000000000),
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, rule_key),
  check (state <> 'ready' or (segment_id is not null and klaviyo_account_id is not null and fingerprint is not null)),
  check (state <> 'creating' or (create_started_at is not null and claim_build is not null
    and klaviyo_account_id is not null and fingerprint is not null)),
  check (state not in ('no_data', 'failed', 'deleted') or reason is not null)
);

alter table public.klaviyo_hygiene_segments enable row level security;
create policy klaviyo_hygiene_segments_member_read on public.klaviyo_hygiene_segments for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.klaviyo_hygiene_segments from public, anon, authenticated, service_role;
grant select on public.klaviyo_hygiene_segments to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.klaviyo_hygiene_segments from public, anon, authenticated, service_role';
  end if;
end $$;

-- One step of making or reusing the segment, saved by the worker under the
-- exact push lease of the email build (`private.leased_email_build`). `step`
-- names what it sets ({state, segment_id, reason, klaviyo_account_id,
-- fingerprint, profile_count, counted_at}); each is checked, and the row as
-- it would be must pass the table's checks.
--
-- The claim: entering `creating` stamps `create_started_at = now()` and
-- this build as the claimant, and clears the old reason and segment id. It is refused
-- (PT409) while another build's claim is under two minutes old, or when
-- the row is already ready for the same account and fingerprint. While
-- that claim is live, only its claimant writes the row; after two minutes
-- any push may take it over. A first save inserts the whole row in
-- one statement; two first saves at once give one row and PT409 to the
-- other, never a duplicate-key error. Locks: the tenant first, then the
-- build, then the row.
create or replace function public.save_hygiene_segment(build uuid, lease uuid, rule text, step jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['state', 'segment_id', 'reason', 'klaviyo_account_id', 'fingerprint',
    'profile_count', 'counted_at'];
  t uuid; cur public.klaviyo_hygiene_segments; next_state text; added integer;
  creating boolean := step->>'state' = 'creating';
  claim_live boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if build is null or lease is null or rule is null or rule !~ '^v[0-9]{1,2}-[0-9]{2,3}$'
    or jsonb_typeof(step) is distinct from 'object' or step = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(step) k where k <> all (allowed))
    or (step ? 'state' and coalesce(step->>'state', '') not in ('creating', 'ready', 'no_data', 'failed', 'deleted'))
    or exists (select 1 from unnest(array['segment_id', 'klaviyo_account_id']) k
      where step ? k and step->k <> 'null'::jsonb
        and (jsonb_typeof(step->k) <> 'string' or step->>k !~ '^[A-Za-z0-9_-]{1,64}$'))
    or (step ? 'fingerprint' and step->'fingerprint' <> 'null'::jsonb
      and (jsonb_typeof(step->'fingerprint') <> 'string' or step->>'fingerprint' !~ '^[a-f0-9]{8}$'))
    or (step ? 'reason' and step->'reason' <> 'null'::jsonb
      and (jsonb_typeof(step->'reason') <> 'string' or step->>'reason' !~ '^[a-z][a-z_]{1,39}$'))
    or (step ? 'counted_at' and step->'counted_at' <> 'null'::jsonb
      and (jsonb_typeof(step->'counted_at') <> 'string' or private.safe_time(step->>'counted_at') is null))
    or (step ? 'profile_count' and step->'profile_count' <> 'null'::jsonb
      and (jsonb_typeof(step->'profile_count') <> 'number' or step->>'profile_count' !~ '^\d{1,13}$'
        or (step->>'profile_count')::bigint > 1000000000000)) then
    raise exception 'Invalid hygiene step' using errcode = '23514';
  end if;
  select b.tenant_id into t from public.email_builds b where b.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  -- The caller's own build, in its push step, with its unexpired lease.
  perform private.leased_email_build(build, lease, 'push_queued');

  select * into cur from public.klaviyo_hygiene_segments s where s.tenant_id = t and s.rule_key = rule for update;
  -- A first save: the whole row at once (it must pass the table's checks).
  if not found and step ? 'state' then
    insert into public.klaviyo_hygiene_segments as s (tenant_id, rule_key, state, klaviyo_account_id, fingerprint,
        segment_id, reason, create_started_at, claim_build, profile_count, counted_at)
      values (t, rule, step->>'state', step->>'klaviyo_account_id', step->>'fingerprint',
        case when creating then null else step->>'segment_id' end,
        case when creating then null else step->>'reason' end,
        case when creating then now() end, case when creating then build end,
        (step->>'profile_count')::bigint, (step->>'counted_at')::timestamptz)
      on conflict (tenant_id, rule_key) do nothing;
    get diagnostics added = row_count;
    if added = 1 then return; end if;
    -- Another push saved first: read its row and judge the claim again.
    select * into cur from public.klaviyo_hygiene_segments s where s.tenant_id = t and s.rule_key = rule for update;
  end if;
  if not found then raise exception 'Invalid hygiene step' using errcode = '23514'; end if;
  claim_live := cur.state = 'creating' and cur.claim_build is distinct from build
    and cur.create_started_at > now() - interval '2 minutes';
  if creating and (claim_live or (cur.state = 'ready'
      and cur.klaviyo_account_id is not distinct from coalesce(step->>'klaviyo_account_id', cur.klaviyo_account_id)
      and cur.fingerprint is not distinct from coalesce(step->>'fingerprint', cur.fingerprint))) then
    raise exception 'The hygiene segment is being made' using errcode = 'PT409';
  end if;
  -- Only the claimant finishes a row being made (a stale claim is anyone's).
  if not creating and claim_live then
    raise exception 'The hygiene segment is being made' using errcode = 'PT409';
  end if;
  next_state := coalesce(step->>'state', cur.state);
  update public.klaviyo_hygiene_segments s set
      state = next_state,
      klaviyo_account_id = case when step ? 'klaviyo_account_id' then step->>'klaviyo_account_id'
        else s.klaviyo_account_id end,
      fingerprint = case when step ? 'fingerprint' then step->>'fingerprint' else s.fingerprint end,
      segment_id = case when creating then null when step ? 'segment_id' then step->>'segment_id' else s.segment_id end,
      reason = case when creating then null when step ? 'reason' then step->>'reason' else s.reason end,
      create_started_at = case when creating then now() else s.create_started_at end,
      claim_build = case when creating then build else s.claim_build end,
      profile_count = case when step ? 'profile_count' then (step->>'profile_count')::bigint else s.profile_count end,
      counted_at = case when step ? 'counted_at' then (step->>'counted_at')::timestamptz else s.counted_at end,
      updated_at = now()
    where s.tenant_id = t and s.rule_key = rule;
end $$;

revoke all on function public.save_hygiene_segment(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_hygiene_segment(uuid, uuid, text, jsonb) to service_role;

-- The owner asks for a segment he deleted in Klaviyo to be made again (or
-- for a failed one to be tried now): the next email GROS puts in Klaviyo
-- makes or finds it. Owner only; never a row being made.
create or replace function public.retry_list_hygiene(t uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.require_member(t, true);
  delete from public.klaviyo_hygiene_segments s
    where s.tenant_id = t and s.state in ('deleted', 'failed', 'no_data');
  get diagnostics n = row_count;
  -- In the change history (BAS-006), even when nothing was waiting.
  insert into public.workspace_events (tenant_id, actor_id, kind, detail)
    values (t, auth.uid(), 'list_hygiene_retried', jsonb_build_object('rows', n));
  return n;
end $$;

revoke all on function public.retry_list_hygiene(uuid) from public, anon, service_role;
grant execute on function public.retry_list_hygiene(uuid) to authenticated;
