-- EML-004 part 2 (decisions D16, D17, D21): "Create email" on a planned
-- email. The owner clicks it; a job builds the email (sections, locked
-- content, copy, design) and then puts it into Klaviyo as a draft through
-- the DraftPusher port (PSH-001 builds the live one; a fake until then).
-- Nothing waits for a person, and nothing is scheduled or sent here.
--
-- * One build per planned email at a time; clicking again returns it.
-- * The owner writes only through create_email_build; jobs (service role)
--   claim a step with a lease and finish or fail it. After 3 failed
--   attempts a step fails for good; a busy Klaviyo can ask for a later try.
-- * The number is chosen at merge time (D24).

create table public.email_builds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  -- The planned email's place in the run's plan (plan->'slots'->slot).
  slot integer not null check (slot between 0 and 19),
  state text not null default 'build_queued'
    check (state in ('build_queued', 'push_queued', 'drafted', 'failed')),
  email jsonb check (email is null or (jsonb_typeof(email) = 'object' and octet_length(email::text) <= 300000)),
  klaviyo_campaign_id text check (klaviyo_campaign_id is null or length(klaviyo_campaign_id) between 1 and 200),
  -- True when the draft came from the fake pusher (no Klaviyo call).
  sample_draft boolean not null default false,
  attempts integer not null default 0 check (attempts between 0 and 10),
  lease_token uuid,
  lease_until timestamptz,
  -- A step Klaviyo asked to retry later waits until then.
  not_before timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.strategy_runs (tenant_id, id) on delete cascade,
  check (state not in ('push_queued', 'drafted') or email is not null),
  check ((klaviyo_campaign_id is not null) = (state = 'drafted')),
  check ((lease_token is null) = (lease_until is null)),
  unique (tenant_id, id)
);
-- One build per planned email at a time.
create unique index email_builds_one_open on public.email_builds (run_id, slot)
  where state in ('build_queued', 'push_queued', 'drafted');
create index email_builds_due on public.email_builds (updated_at)
  where state in ('build_queued', 'push_queued');
create index email_builds_run on public.email_builds (tenant_id, run_id, created_at desc);

alter table public.email_builds enable row level security;
create policy email_builds_member_read on public.email_builds for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.email_builds from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.email_builds from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_builds from public, anon, authenticated, service_role';
  end if;
end $$;
grant select on public.email_builds to authenticated;

-- The owner's "Create email" on a planned email (D17). Returns the build:
-- the open or drafted one for that email, or a new one.
create or replace function public.create_email_build(t uuid, run uuid, slot integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
  zone text;
  day date;
  build uuid;
begin
  -- require_member locks the workspace row (tenant first), then the run.
  perform private.require_member(t, true);
  select * into r from public.strategy_runs s where s.id = run and s.tenant_id = t for update;
  if not found then raise exception 'Plan unavailable' using errcode = '42501'; end if;
  if r.state <> 'planned' then
    raise exception 'This plan is not ready yet' using errcode = 'PT409';
  end if;
  if slot is null or slot < 0 or slot >= jsonb_array_length(coalesce(r.plan->'slots', '[]'::jsonb)) then
    raise exception 'This plan has no such email' using errcode = '22023';
  end if;
  select timezone into zone from public.tenants where id = t;
  begin
    day := (r.plan->'slots'->slot->>'date')::date;
  exception when others then
    raise exception 'This planned email has no day' using errcode = '22023';
  end;
  if day is null then
    raise exception 'This planned email has no day' using errcode = '22023';
  end if;
  if day < (now() at time zone coalesce(zone, 'UTC'))::date then
    raise exception 'This email''s day has passed' using errcode = 'PT409';
  end if;
  select b.id into build from public.email_builds b
    where b.run_id = run and b.slot = create_email_build.slot
      and b.state in ('build_queued', 'push_queued', 'drafted');
  if found then return build; end if;
  insert into public.email_builds (tenant_id, run_id, slot, created_by)
    values (t, run, create_email_build.slot, auth.uid())
    returning id into build;
  return build;
end $$;

-- A job takes the oldest waiting step with a short lease, and the planned
-- email it builds. `target` claims that one build (the owner's click).
create or replace function public.claim_email_build(target uuid default null)
returns table (id uuid, tenant_id uuid, state text, run_id uuid, slot integer, planned jsonb, email jsonb, lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  lease uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  loop
    select * into b from public.email_builds e
      where e.state in ('build_queued', 'push_queued')
        and (e.lease_until is null or e.lease_until < now())
        and (e.not_before is null or e.not_before <= now())
        -- A failed step waits a minute before its next try.
        and (e.attempts = 0 or e.updated_at < now() - interval '1 minute')
        and exists (select 1 from public.tenants w where w.id = e.tenant_id and w.status = 'active')
        and (target is null or e.id = target)
      order by e.updated_at, e.id
      limit 1
      for update skip locked;
    if not found then return; end if;
    -- A step whose lease ran out three times is not tried again; look on.
    exit when b.attempts < 3;
    update public.email_builds e
      set state = 'failed', error_code = 'step_timed_out', lease_token = null, lease_until = null, updated_at = now()
      where e.id = b.id;
  end loop;
  update public.email_builds e
    set attempts = e.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where e.id = b.id;
  return query
    select b.id, b.tenant_id, b.state, b.run_id, b.slot,
      (select s.plan->'slots'->b.slot from public.strategy_runs s where s.id = b.run_id),
      b.email, lease;
end $$;

create or replace function private.leased_email_build(build uuid, lease uuid, expected text)
returns public.email_builds language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  select * into b from public.email_builds where id = build for update;
  if not found or lease is null or b.state <> expected or b.lease_token is distinct from lease or b.lease_until < now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return b;
end $$;

-- The built email: what the pusher puts into Klaviyo.
create or replace function public.finish_email_build(build uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.leased_email_build(build, lease, 'build_queued');
  if result is null or jsonb_typeof(result) <> 'object'
     or coalesce(jsonb_typeof(result->'html'), '') <> 'string'
     or coalesce(jsonb_typeof(result->'subject'), '') <> 'string'
     or coalesce(jsonb_typeof(result->'preheader'), '') <> 'string'
     or length(result->>'html') not between 1 and 200000 then
    raise exception 'A built email needs its subject, preview and HTML' using errcode = '22023';
  end if;
  update public.email_builds
    set email = result, state = 'push_queued', attempts = 0, error_code = null, not_before = null,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
end $$;

-- The draft is in Klaviyo (or the fake pusher's sample draft).
create or replace function public.finish_email_push(build uuid, lease uuid, campaign text, sample boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.leased_email_build(build, lease, 'push_queued');
  if campaign is null or length(campaign) not between 1 and 200 or sample is null then
    raise exception 'A draft needs its campaign id' using errcode = '22023';
  end if;
  update public.email_builds
    set klaviyo_campaign_id = campaign, sample_draft = sample, state = 'drafted', attempts = 0,
        error_code = null, not_before = null, lease_token = null, lease_until = null, updated_at = now()
    where id = build;
end $$;

-- A step that failed: tried again later, or failed for good after its
-- third attempt. `final`: a retry cannot help (bad data, Klaviyo refused).
-- `retry_after_seconds`: Klaviyo asked to wait (at most a day).
create or replace function public.fail_email_step(build uuid, lease uuid, code text,
  final boolean default false, retry_after_seconds integer default null)
returns text language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  give_up boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  if code is null or code !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A short error code is required' using errcode = '22023';
  end if;
  if retry_after_seconds is not null and retry_after_seconds not between 1 and 86400 then
    raise exception 'Retry after 1 second to 1 day' using errcode = '22023';
  end if;
  select * into b from public.email_builds where id = build for update;
  if not found or lease is null or b.lease_token is distinct from lease or b.lease_until < now()
     or b.state not in ('build_queued', 'push_queued') then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  give_up := coalesce(final, false) or b.attempts >= 3;
  update public.email_builds
    set state = case when give_up then 'failed' else b.state end,
        error_code = code,
        not_before = case when give_up or retry_after_seconds is null then null
                          else now() + make_interval(secs => retry_after_seconds) end,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return case when give_up then 'failed' else 'retry' end;
end $$;

revoke all on function public.create_email_build(uuid, uuid, integer) from public, anon;
grant execute on function public.create_email_build(uuid, uuid, integer) to authenticated;
revoke all on function public.claim_email_build(uuid), public.finish_email_build(uuid, uuid, jsonb),
  public.finish_email_push(uuid, uuid, text, boolean), public.fail_email_step(uuid, uuid, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.claim_email_build(uuid), public.finish_email_build(uuid, uuid, jsonb),
  public.finish_email_push(uuid, uuid, text, boolean), public.fail_email_step(uuid, uuid, text, boolean, integer)
  to service_role;
revoke all on function private.leased_email_build(uuid, uuid, text) from public, anon, authenticated;
