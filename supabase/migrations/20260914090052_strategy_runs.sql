-- STR-003 part 2 (decisions D17, D20): "Plan next 15 days". The owner
-- starts a run; a job reads the store (the Brand pulse, STR-001) and stops
-- for the owner's optional offer pick; then a job plans the 15 days
-- (STR-002, STR-003 part 1). There is no approval: the plan is shown, and
-- "Create email" on a slot starts the email build (EML-001).
--
-- * One open run per workspace; starting again returns it.
-- * The owner writes only through start_strategy_run and
--   pick_strategy_offers; jobs (service role) claim a step with a lease and
--   finish or fail it. After 3 failed attempts a step is failed for good.
-- * The number is chosen at merge time (D24).

create table public.strategy_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- The first of the 15 days, in the store's timezone.
  start_on date not null,
  state text not null default 'pulse_queued'
    check (state in ('pulse_queued', 'offers_ready', 'plan_queued', 'planned', 'failed')),
  pulse jsonb check (pulse is null or (jsonb_typeof(pulse) = 'object' and octet_length(pulse::text) <= 200000)),
  offer_pick jsonb check (offer_pick is null or (jsonb_typeof(offer_pick) = 'object' and octet_length(offer_pick::text) <= 4000)),
  plan jsonb check (plan is null or (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 400000)),
  attempts integer not null default 0 check (attempts between 0 and 10),
  lease_token uuid,
  lease_until timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each step leaves its result: the pulse, then the pick, then the plan.
  check (state in ('pulse_queued', 'failed') or pulse is not null),
  check (state not in ('plan_queued', 'planned') or offer_pick is not null),
  check ((plan is not null) = (state = 'planned')),
  check ((lease_token is null) = (lease_until is null)),
  unique (tenant_id, id)
);
-- One open run per workspace.
create unique index strategy_runs_one_open on public.strategy_runs (tenant_id)
  where state in ('pulse_queued', 'offers_ready', 'plan_queued');
create index strategy_runs_due on public.strategy_runs (updated_at)
  where state in ('pulse_queued', 'plan_queued');
create index strategy_runs_recent on public.strategy_runs (tenant_id, created_at desc);

alter table public.strategy_runs enable row level security;
create policy strategy_runs_member_read on public.strategy_runs for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.strategy_runs from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.strategy_runs from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.strategy_runs from public, anon, authenticated, service_role';
  end if;
end $$;
grant select on public.strategy_runs to authenticated;

-- The owner starts a run (or gets the open one back).
create or replace function public.start_strategy_run(t uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  zone text;
  today date;
  run uuid;
begin
  -- require_member locks the workspace row (tenant first).
  perform private.require_member(t, true);
  select timezone into zone from public.tenants where id = t;
  today := (now() at time zone coalesce(zone, 'UTC'))::date;
  -- An open run whose 15 days have begun is out of date: close it.
  update public.strategy_runs
    set state = 'failed', error_code = 'out_of_date', lease_token = null, lease_until = null, updated_at = now()
    where tenant_id = t and state in ('pulse_queued', 'offers_ready', 'plan_queued') and start_on <= today;
  select id into run from public.strategy_runs
    where tenant_id = t and state in ('pulse_queued', 'offers_ready', 'plan_queued');
  if found then return run; end if;
  insert into public.strategy_runs (tenant_id, start_on, created_by)
    values (t, today + 1, auth.uid())
    returning id into run;
  return run;
end $$;

-- The owner's offer pick (D20, optional): auto, none, or picked offer ids
-- that the run's pulse lists.
create or replace function public.pick_strategy_offers(t uuid, run uuid, pick jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
  mode text;
  ids text[];
begin
  perform private.require_member(t, true);
  select * into r from public.strategy_runs where id = run and tenant_id = t for update;
  if not found then raise exception 'Plan unavailable' using errcode = '42501'; end if;
  if r.state <> 'offers_ready' then
    raise exception 'This plan is not waiting for your offers' using errcode = 'PT409';
  end if;
  if r.start_on <= (now() at time zone coalesce((select timezone from public.tenants where id = t), 'UTC'))::date then
    raise exception 'These 15 days have begun; start a new plan' using errcode = 'PT409';
  end if;
  if pick is null or jsonb_typeof(pick) <> 'object' then
    raise exception 'Choose auto, none or the offers to run' using errcode = '22023';
  end if;
  mode := pick->>'mode';
  if mode in ('auto', 'none') then
    if (select count(*) from jsonb_object_keys(pick)) <> 1 then
      raise exception 'Choose auto, none or the offers to run' using errcode = '22023';
    end if;
  elsif mode = 'picked' then
    if (select count(*) from jsonb_object_keys(pick)) <> 2
       or coalesce(jsonb_typeof(pick->'offers'), '') <> 'array'
       or jsonb_array_length(pick->'offers') not between 1 and 20
       or exists (select 1 from jsonb_array_elements(pick->'offers') e
                  where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 120) then
      raise exception 'Choose auto, none or the offers to run' using errcode = '22023';
    end if;
    select array_agg(distinct e) into ids from jsonb_array_elements_text(pick->'offers') e;
    if exists (
      select 1 from unnest(ids) id
      where not exists (
        select 1 from jsonb_array_elements(coalesce(r.pulse->'offers', '[]'::jsonb)) o where o->>'id' = id
      )
    ) then
      raise exception 'Pick only offers this plan found' using errcode = '22023';
    end if;
    pick := jsonb_build_object('mode', 'picked', 'offers', to_jsonb(ids));
  else
    raise exception 'Choose auto, none or the offers to run' using errcode = '22023';
  end if;
  update public.strategy_runs
    set offer_pick = pick, state = 'plan_queued', attempts = 0, error_code = null, updated_at = now()
    where id = run;
end $$;

-- A job takes the oldest waiting step with a short lease.
-- `target` claims that one run (the owner's click runs his own plan).
create or replace function public.claim_strategy_run(target uuid default null)
returns table (id uuid, tenant_id uuid, state text, start_on date, pulse jsonb, offer_pick jsonb, lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
  lease uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs run plans' using errcode = '42501';
  end if;
  loop
    select * into r from public.strategy_runs s
      where s.state in ('pulse_queued', 'plan_queued')
        and (s.lease_until is null or s.lease_until < now())
        -- A failed step waits a minute before its next try.
        and (s.attempts = 0 or s.updated_at < now() - interval '1 minute')
        and exists (select 1 from public.tenants w where w.id = s.tenant_id and w.status = 'active')
        and (target is null or s.id = target)
      order by s.updated_at, s.id
      limit 1
      for update skip locked;
    if not found then return; end if;
    -- A step whose lease ran out three times is not tried again; look on.
    exit when r.attempts < 3;
    update public.strategy_runs s
      set state = 'failed', error_code = 'step_timed_out', lease_token = null, lease_until = null, updated_at = now()
      where s.id = r.id;
  end loop;
  update public.strategy_runs s
    set attempts = s.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where s.id = r.id;
  return query select r.id, r.tenant_id, r.state, r.start_on, r.pulse, r.offer_pick, lease;
end $$;

create or replace function private.leased_strategy_run(run uuid, lease uuid, expected text)
returns public.strategy_runs language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs run plans' using errcode = '42501';
  end if;
  select * into r from public.strategy_runs where id = run for update;
  if not found or lease is null or r.state <> expected or r.lease_token is distinct from lease or r.lease_until < now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return r;
end $$;

create or replace function public.finish_strategy_pulse(run uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.leased_strategy_run(run, lease, 'pulse_queued');
  if result is null or jsonb_typeof(result) <> 'object' or coalesce(jsonb_typeof(result->'offers'), '') <> 'array'
     or exists (select 1 from jsonb_array_elements(result->'offers') o where coalesce(jsonb_typeof(o->'id'), '') <> 'string') then
    raise exception 'A pulse needs its offers' using errcode = '22023';
  end if;
  update public.strategy_runs
    set pulse = result, state = 'offers_ready', attempts = 0, error_code = null, lease_token = null, lease_until = null, updated_at = now()
    where id = run;
end $$;

create or replace function public.finish_strategy_plan(run uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.leased_strategy_run(run, lease, 'plan_queued');
  if result is null or jsonb_typeof(result) <> 'object' or coalesce(jsonb_typeof(result->'slots'), '') <> 'array' then
    raise exception 'A plan needs its slots' using errcode = '22023';
  end if;
  update public.strategy_runs
    set plan = result, state = 'planned', attempts = 0, error_code = null, lease_token = null, lease_until = null, updated_at = now()
    where id = run;
end $$;

-- A step that failed: tried again by the next job, or failed for good
-- after its third attempt.
-- `final`: the failure cannot change on a retry (bad store data, a pick the
-- pulse does not have): the plan fails now instead of trying again.
create or replace function public.fail_strategy_step(run uuid, lease uuid, code text, final boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs run plans' using errcode = '42501';
  end if;
  if code is null or code !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A short error code is required' using errcode = '22023';
  end if;
  select * into r from public.strategy_runs where id = run for update;
  if not found or lease is null or r.lease_token is distinct from lease or r.lease_until < now()
     or r.state not in ('pulse_queued', 'plan_queued') then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  update public.strategy_runs
    set state = case when final or r.attempts >= 3 then 'failed' else r.state end,
        error_code = code, lease_token = null, lease_until = null, updated_at = now()
    where id = run;
  return case when final or r.attempts >= 3 then 'failed' else 'retry' end;
end $$;

revoke all on function public.start_strategy_run(uuid), public.pick_strategy_offers(uuid, uuid, jsonb) from public, anon;
grant execute on function public.start_strategy_run(uuid), public.pick_strategy_offers(uuid, uuid, jsonb) to authenticated;
revoke all on function public.claim_strategy_run(uuid), public.finish_strategy_pulse(uuid, uuid, jsonb),
  public.finish_strategy_plan(uuid, uuid, jsonb), public.fail_strategy_step(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_strategy_run(uuid), public.finish_strategy_pulse(uuid, uuid, jsonb),
  public.finish_strategy_plan(uuid, uuid, jsonb), public.fail_strategy_step(uuid, uuid, text, boolean) to service_role;
revoke all on function private.leased_strategy_run(uuid, uuid, text) from public, anon, authenticated;
