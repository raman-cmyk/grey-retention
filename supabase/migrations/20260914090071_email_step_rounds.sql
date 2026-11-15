-- REL-AI part 2b: a build step can save its work and go on in the next
-- claim. With the agents on, the copy step's Copywriter and inspectors make
-- several model calls (each capped at 15 s). A claim runs only the calls
-- that still fit in its time budget, saves the rounds so far
-- (`save_email_round`) and ends; the job claims the same step again at
-- once and goes on from the saved rounds. So a long step never runs past
-- its time limit, and never starts over and pays twice.
--
-- * The work is kept under progress->'work'->step; the build stays on the
--   same step. The step's finished output is saved as before
--   (`finish_email_step`).
-- * Saving ends the claim (the lease) and gives back this claim's try, as
--   a Klaviyo wait does: a step that had not failed is claimed again at
--   once, and earlier failures (a lease that ran out, a taken subject)
--   still count towards its 3 tries. Code bounds its own rounds; as a
--   backstop, a step saves at most 16 times (22023, detail
--   `too_many_rounds`, after that).
-- * One step's work is at most 64 kB, so the steps' outputs still fit in
--   the build's 300,000-byte progress.
-- * Only jobs (service role) save, under a live lease, for the copy and
--   design steps. "Try again" makes a new build, without the saved work.
-- * The sweep (a claim for any build) leaves a step that just moved on or
--   saved its rounds to the job that moved it for 30 seconds: between two
--   claims of the owner's click it never takes the build over and finishes
--   it without the agents. The click's own claim (`target`) takes it at
--   once, as before. `claim_email_build` is made again for this only.
-- * The number is chosen at merge time (D24).

create or replace function public.save_email_round(build uuid, lease uuid, step text, work jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  saves integer;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  select * into b from private.leased_email_build(build, lease, 'build_queued');
  if step is null or step not in ('copy', 'design') then
    raise exception 'This step saves no rounds' using errcode = '22023';
  end if;
  if b.step is distinct from step then
    raise exception 'This is not the build''s step' using errcode = 'PT409';
  end if;
  if work is null or jsonb_typeof(work) <> 'object' then
    raise exception 'A step''s work is an object' using errcode = '22023';
  end if;
  if octet_length(work::text) > 64000 then
    raise exception 'A step''s work is too large' using errcode = '22023';
  end if;
  -- Only this command writes the count, always as a number.
  saves := coalesce((b.progress->'work'->step->>'saves')::integer, 0) + 1;
  if saves > 16 then
    raise exception 'This step saved too many rounds' using errcode = '22023', detail = 'too_many_rounds';
  end if;
  saved := jsonb_set(
    b.progress, '{work}',
    coalesce(b.progress->'work', '{}'::jsonb)
      || jsonb_build_object(step, work || jsonb_build_object('saves', saves)));
  if octet_length(saved::text) > 300000 then
    raise exception 'A step''s work is too large' using errcode = '22023';
  end if;
  update public.email_builds
    set progress = saved, attempts = greatest(b.attempts - 1, 0), not_before = null,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return saves;
end $$;

revoke all on function public.save_email_round(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_email_round(uuid, uuid, text, jsonb) to service_role;

-- As in 20260914090067, with one more condition: the sweep's grace.
create or replace function public.claim_email_build(target uuid default null)
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
        -- A step that just moved on or saved its rounds is its own job's
        -- for 30 seconds; only a claim for this build takes it sooner.
        and (target is not null or e.attempts > 0 or e.updated_at < now() - interval '30 seconds')
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

revoke all on function public.claim_email_build(uuid) from public, anon, authenticated;
grant execute on function public.claim_email_build(uuid) to service_role;
