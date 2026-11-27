-- PICK-101 (owner pick #101, "List hygiene"): every email GROS plans leaves
-- out people who bounced or are suppressed, and people with no clicks, real
-- opens, site visits or orders in the last N days (180 by default). Two
-- tables:
--
-- 1. `list_hygiene_settings`: the owner's per-store setting (on or off, and
--    N, 30 to 730 days). No row means the default (on, 180). Only the owner
--    changes it, through `set_list_hygiene` (the page's revision is checked:
--    PT409 when another window changed it); members read it. Each change
--    goes in the change history (`list_hygiene_changed`).
-- 2. `klaviyo_hygiene_segments`: GROS's own exclusion segment in the
--    store's Klaviyo, one per rule (`v1-180`): made once, then reused. Only
--    the live pusher writes it, under the exact push lease of the email
--    build it runs for (`save_hygiene_segment`); while one push is making
--    the segment, another is refused (PT409) and waits. Members read it (the
--    Audiences page shows how many people it leaves out).
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
  -- The rule it is made for: its version and days ("v1-180").
  rule_key text not null check (rule_key ~ '^v[0-9]{1,2}-[0-9]{2,3}$'),
  state text not null check (state in ('creating', 'ready', 'no_data', 'failed')),
  segment_id text check (segment_id is null or segment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Why there is no segment (no_data, failed).
  reason text check (reason is null or reason ~ '^[a-z][a-z_]{1,39}$'),
  -- When a create was sent: its answer may be lost, so it is looked up by
  -- name before another is ever made.
  create_started_at timestamptz,
  -- The email build whose push is making it.
  claim_build uuid,
  -- How many people Klaviyo says the segment holds (null: not counted yet).
  profile_count bigint check (profile_count is null or profile_count between 0 and 1000000000000),
  counted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, rule_key),
  check (state <> 'ready' or segment_id is not null),
  check (state not in ('no_data', 'failed') or reason is not null)
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
-- names the columns it sets ({state, segment_id, reason, create_started_at,
-- profile_count, counted_at}); each is checked. A push that wants to start
-- making it while another build's create is under two minutes old, or once
-- it is ready, is refused (PT409): it waits and reads it again. Locks: the
-- tenant first, then the build, then the row.
create or replace function public.save_hygiene_segment(build uuid, lease uuid, rule text, step jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  allowed constant text[] := array['state', 'segment_id', 'reason', 'create_started_at', 'profile_count', 'counted_at'];
  t uuid; cur public.klaviyo_hygiene_segments; next_state text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if build is null or lease is null or rule is null or rule !~ '^v[0-9]{1,2}-[0-9]{2,3}$'
    or jsonb_typeof(step) is distinct from 'object' or step = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(step) k where k <> all (allowed))
    or (step ? 'state' and coalesce(step->>'state', '') not in ('creating', 'ready', 'no_data', 'failed'))
    or (step ? 'segment_id' and step->'segment_id' <> 'null'::jsonb
      and (jsonb_typeof(step->'segment_id') <> 'string' or step->>'segment_id' !~ '^[A-Za-z0-9_-]{1,64}$'))
    or (step ? 'reason' and step->'reason' <> 'null'::jsonb
      and (jsonb_typeof(step->'reason') <> 'string' or step->>'reason' !~ '^[a-z][a-z_]{1,39}$'))
    or (step ? 'create_started_at' and step->'create_started_at' <> 'null'::jsonb
      and (jsonb_typeof(step->'create_started_at') <> 'string' or private.safe_time(step->>'create_started_at') is null))
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
  if step->>'state' = 'creating' and found and (cur.state = 'ready'
      or (cur.state = 'creating' and cur.claim_build is distinct from build
        and cur.create_started_at > now() - interval '2 minutes')) then
    raise exception 'The hygiene segment is being made' using errcode = 'PT409';
  end if;
  if not found then
    if not step ? 'state' then raise exception 'Invalid hygiene step' using errcode = '23514'; end if;
    insert into public.klaviyo_hygiene_segments (tenant_id, rule_key, state)
      values (t, rule, step->>'state');
  end if;
  next_state := coalesce(step->>'state', cur.state);
  update public.klaviyo_hygiene_segments s set
      state = next_state,
      segment_id = case when step ? 'segment_id' then step->>'segment_id' else s.segment_id end,
      reason = case when step ? 'reason' then step->>'reason' else s.reason end,
      create_started_at = case when step ? 'create_started_at' then (step->>'create_started_at')::timestamptz
        else s.create_started_at end,
      claim_build = case when next_state = 'creating' then build else s.claim_build end,
      profile_count = case when step ? 'profile_count' then (step->>'profile_count')::bigint else s.profile_count end,
      counted_at = case when step ? 'counted_at' then (step->>'counted_at')::timestamptz else s.counted_at end,
      updated_at = now()
    where s.tenant_id = t and s.rule_key = rule;
end $$;

revoke all on function public.save_hygiene_segment(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_hygiene_segment(uuid, uuid, text, jsonb) to service_role;
