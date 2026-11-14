-- REL-081 (owner pick 81): "Create email" runs as saved steps. A build
-- goes sections, content, copy, design, then the push. Each step is its
-- own short job (well under a minute); its output is saved before the next
-- step starts, so a step that fails is tried again on its own, from the
-- saved steps before it, never from the start.
--
-- * `step`: the next step to run. `progress`: each finished step's output,
--   by step name. Only jobs (service role) write either, under a lease.
-- * Each step has its own 3 attempts (the push keeps its Klaviyo waits).
-- * Members read the step with the row, as before, so the screen can show
--   how far the email got.
-- * "Try again" after a failure starts a new build at the first step; only
--   the push key carries over (one Klaviyo draft per planned email).
-- * Builds are claimed furthest step first, so emails being built finish
--   before new ones start.
-- * The number is chosen at merge time (D24).

alter table public.email_builds
  add column step text not null default 'sections'
    check (step in ('sections', 'content', 'copy', 'design', 'push')),
  add column progress jsonb not null default '{}'::jsonb
    check (jsonb_typeof(progress) = 'object' and octet_length(progress::text) <= 300000);

-- Builds made before this change: a built email is past every build step.
update public.email_builds set step = 'push' where email is not null;

alter table public.email_builds
  add constraint email_builds_step_email check ((step = 'push') = (email is not null));

-- A build step's output, saved; the build moves to its next step. Returns
-- that step. The design step is finished by finish_email_build.
create or replace function public.finish_email_step(build uuid, lease uuid, done text, output jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  next_step text;
  saved jsonb;
begin
  select * into b from private.leased_email_build(build, lease, 'build_queued');
  if done is null or done not in ('sections', 'content', 'copy', 'design') then
    raise exception 'Unknown build step' using errcode = '22023';
  end if;
  next_step := case done when 'sections' then 'content' when 'content' then 'copy' when 'copy' then 'design' end;
  if next_step is null or b.step is distinct from done then
    raise exception 'This is not the build''s next step' using errcode = 'PT409';
  end if;
  if output is null or jsonb_typeof(output) <> 'object' then
    raise exception 'A step''s output is an object' using errcode = '22023';
  end if;
  saved := b.progress || jsonb_build_object(done, output);
  if octet_length(saved::text) > 300000 then
    raise exception 'A step''s output is too large' using errcode = '22023';
  end if;
  -- The next step is a new step: its own attempts.
  update public.email_builds
    set progress = saved, step = next_step, attempts = 0, waits = 0, error_code = null, not_before = null,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return next_step;
end $$;

-- The built email (the design step): what the pusher puts into Klaviyo.
create or replace function public.finish_email_build(build uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
begin
  select * into b from private.leased_email_build(build, lease, 'build_queued');
  if b.step <> 'design' then
    raise exception 'This is not the build''s next step' using errcode = 'PT409';
  end if;
  if result is null or jsonb_typeof(result) <> 'object'
     or coalesce(jsonb_typeof(result->'html'), '') <> 'string'
     or coalesce(jsonb_typeof(result->'subject'), '') <> 'string'
     or coalesce(jsonb_typeof(result->'preheader'), '') <> 'string'
     or length(btrim(result->>'subject')) = 0
     or octet_length(result->>'html') not between 1 and 200000 then
    raise exception 'A built email needs its subject, preview and HTML' using errcode = '22023';
  end if;
  -- The push is a new step: its own attempts and waits.
  update public.email_builds
    set email = result, step = 'push', state = 'push_queued', attempts = 0, waits = 0, error_code = null,
        not_before = null, lease_token = null, lease_until = null, updated_at = now()
    where id = build;
end $$;

-- The claim now brings the step to run and the saved steps before it.
drop function public.claim_email_build(uuid);
create function public.claim_email_build(target uuid default null)
returns table (id uuid, tenant_id uuid, state text, step text, progress jsonb, run_id uuid, slot integer,
  planned jsonb, email jsonb, push_key uuid, timezone text, start_on date, lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  lease uuid := gen_random_uuid();
  passed boolean;
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
      -- Furthest step first (pushes first): an email being built should
      -- not wait behind new builds.
      order by array_position(array['push', 'design', 'copy', 'content', 'sections'], e.step), e.updated_at, e.id
      limit 1
      for update skip locked;
    if not found then return; end if;
    -- A planned day that has passed (store time) needs no draft any more:
    -- a long wait or a paused workspace must not push one late.
    begin
      select (s.plan->'slots'->b.slot->>'date')::date < (now() at time zone coalesce(w.timezone, 'UTC'))::date
        into passed
        from public.strategy_runs s, public.tenants w
        where s.id = b.run_id and w.id = b.tenant_id;
    exception when others then
      passed := true;
    end;
    passed := coalesce(passed, true);
    -- A step whose lease ran out three times is not tried again; look on.
    exit when b.attempts < 3 and not passed;
    update public.email_builds e
      set state = 'failed', error_code = case when passed then 'day_passed' else 'step_timed_out' end,
          lease_token = null, lease_until = null, updated_at = now()
      where e.id = b.id;
  end loop;
  update public.email_builds e
    set attempts = e.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where e.id = b.id;
  -- The workspace's one brand timezone (every screen's "store time").
  return query
    select b.id, b.tenant_id, b.state, b.step, b.progress, b.run_id, b.slot, s.plan->'slots'->b.slot,
      b.email, b.push_key, coalesce(w.timezone, 'UTC'), s.start_on, lease
    from public.strategy_runs s, public.tenants w
    where s.id = b.run_id and w.id = b.tenant_id;
end $$;

revoke all on function public.claim_email_build(uuid), public.finish_email_step(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_email_build(uuid), public.finish_email_step(uuid, uuid, text, jsonb)
  to service_role;
