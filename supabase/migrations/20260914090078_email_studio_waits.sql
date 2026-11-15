-- DST-006b (D25, AGENT_MAP §4 layer 3): the email build's design step waits
-- for its designed sections' pictures, then goes on with the agents.
--
-- The design step asks for its sections to be drawn (DST-001b) by a browser
-- that runs outside the app every 10 minutes (DST-001c), so it cannot wait
-- inside one claim. It saves its work and waits (`wait_email_round`); the
-- design studio's own job claims it again as soon as every picture it asked
-- for is drawn or failed (`claim_studio_build`), and runs it with the
-- agents. Nothing else takes it before its time is up: the ordinary claims
-- (the owner's click, the sweep) wait for `not_before`, and past it the
-- sweep draws the email with coded blocks (D16: never stuck).
--
-- * Only the design step waits, only under a live lease (jobs, service
--   role). Its work is kept under progress->'work'->'design' as
--   `save_email_round` keeps it (at most 64 kB), with that command's save
--   count carried over, never the caller's.
-- * Waiting ends the claim and gives back its try, as a save does; earlier
--   failures still count towards the step's 3 tries.
-- * A wait is 60 seconds to an hour (the time the pictures may take before
--   the coded blocks are drawn instead). A design step waits at most 6
--   times (22023, detail `too_many_waits`): the studio's rounds are 3 at
--   most. It counts in the build's `waits`, which only the push used
--   (Klaviyo's waits) and which starts again at 0 on each step.
-- * `claim_studio_build` claims one named waiting design step: no lease,
--   an active workspace, no picture of the build still queued (or its time
--   is up), a failed try a minute behind it. A step that ran out of tries,
--   or whose planned day has passed, fails as `claim_email_build` fails it.
--   It returns what `claim_email_build` returns. A design step is waiting
--   when it has waited and has a `not_before`: only this command sets one
--   on a design step (Klaviyo's waits are the push's).
-- * The number is chosen at merge time (D24).

create or replace function public.wait_email_round(build uuid, lease uuid, work jsonb, seconds integer)
returns integer language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  select * into b from private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step waits for its pictures' using errcode = 'PT409';
  end if;
  if work is null or jsonb_typeof(work) <> 'object' then
    raise exception 'A step''s work is an object' using errcode = '22023';
  end if;
  if octet_length(work::text) > 64000 then
    raise exception 'A step''s work is too large' using errcode = '22023';
  end if;
  if seconds is null or seconds not between 60 and 3600 then
    raise exception 'Wait 1 minute to 1 hour' using errcode = '22023';
  end if;
  if b.waits >= 6 then
    raise exception 'This step waited too often' using errcode = '22023', detail = 'too_many_waits';
  end if;
  -- The save count is `save_email_round`'s own: carried over, never the caller's.
  saved := jsonb_set(
    b.progress, '{work}',
    coalesce(b.progress->'work', '{}'::jsonb)
      || jsonb_build_object('design', work || jsonb_build_object(
           'saves', coalesce((b.progress->'work'->'design'->>'saves')::integer, 0))));
  if octet_length(saved::text) > 300000 then
    raise exception 'A step''s work is too large' using errcode = '22023';
  end if;
  update public.email_builds
    set progress = saved, attempts = greatest(b.attempts - 1, 0), waits = b.waits + 1,
        not_before = now() + make_interval(secs => seconds),
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return b.waits + 1;
end $$;

revoke all on function public.wait_email_round(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.wait_email_round(uuid, uuid, jsonb, integer) to service_role;

create or replace function public.claim_studio_build(target uuid)
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
  if target is null then
    raise exception 'Name the build to claim' using errcode = '22023';
  end if;
  select * into b from public.email_builds e
    where e.id = target
      and e.state = 'build_queued' and e.step = 'design'
      and e.waits > 0 and e.not_before is not null
      and (e.lease_until is null or e.lease_until < now())
      -- A failed step waits a minute before its next try.
      and (e.attempts = 0 or e.updated_at < now() - interval '1 minute')
      -- Every picture it asked for is drawn or failed, or its time is up.
      and (e.not_before <= now() or not exists (
        select 1 from public.section_renders r where r.build_id = e.id and r.state = 'queued'))
      and exists (select 1 from public.tenants w where w.id = e.tenant_id and w.status = 'active')
    for update skip locked;
  if not found then return; end if;
  -- As `claim_email_build`: a planned day that has passed (store time)
  -- needs no draft any more, and a step out of tries is not tried again.
  begin
    select (s.plan->'slots'->b.slot->>'date')::date < (now() at time zone coalesce(w.timezone, 'UTC'))::date
      into passed
      from public.strategy_runs s, public.tenants w
      where s.id = b.run_id and w.id = b.tenant_id;
  exception when others then
    passed := true;
  end;
  passed := coalesce(passed, true);
  if passed or b.attempts >= 3 then
    update public.email_builds e
      set state = 'failed', error_code = case when passed then 'day_passed' else 'step_timed_out' end,
          lease_token = null, lease_until = null, updated_at = now()
      where e.id = b.id;
    return;
  end if;
  update public.email_builds e
    set attempts = e.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where e.id = b.id;
  return query
    select b.id, b.tenant_id, b.state, b.step, b.progress, b.run_id, b.slot, s.plan->'slots'->b.slot,
      b.email, b.push_key, coalesce(w.timezone, 'UTC'), s.start_on, lease
    from public.strategy_runs s, public.tenants w
    where s.id = b.run_id and w.id = b.tenant_id;
end $$;

revoke all on function public.claim_studio_build(uuid) from public, anon, authenticated;
grant execute on function public.claim_studio_build(uuid) to service_role;
