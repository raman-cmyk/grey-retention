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
-- * Saving ends the claim (the lease) and starts the step's tries afresh:
--   saved work is progress. Code bounds its own rounds; as a backstop, a
--   step saves at most 16 times (22023 after that).
-- * Only jobs (service role) save, under a live lease, for the copy and
--   design steps. "Try again" makes a new build, without the saved work.
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
  -- Only this command writes the count, always as a number.
  saves := coalesce((b.progress->'work'->step->>'saves')::integer, 0) + 1;
  if saves > 16 then
    raise exception 'This step saved too many rounds' using errcode = '22023';
  end if;
  saved := jsonb_set(
    b.progress, '{work}',
    coalesce(b.progress->'work', '{}'::jsonb)
      || jsonb_build_object(step, work || jsonb_build_object('saves', saves)));
  if octet_length(saved::text) > 300000 then
    raise exception 'A step''s work is too large' using errcode = '22023';
  end if;
  update public.email_builds
    set progress = saved, attempts = 0, waits = 0, error_code = null, not_before = null,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return saves;
end $$;

revoke all on function public.save_email_round(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_email_round(uuid, uuid, text, jsonb) to service_role;
