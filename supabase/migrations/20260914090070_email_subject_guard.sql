-- REL-AI1b: two emails in one plan never save the same subject. The copy
-- step (REL-AI part 1) skips the subjects the plan's other emails use, but
-- two copy steps running at the same moment (the owner clicks Create on
-- two emails back to back: each click runs its own build) could both pick
-- the same free one. Saving a copy step now takes the plan's row lock
-- (tenant first, then the plan, then the build), so these saves run one
-- at a time, and refuses a subject another email of the plan already has
-- (PT409): the job tries the copy step again, which reads the subjects
-- afresh and picks another.
--
-- * Subjects compare as an inbox shows them: case and spacing aside.
-- * Another email's subject counts while it is open or drafted, and after
--   it failed only when it reached the push (its Klaviyo draft may still
--   carry the subject). This email's own earlier builds never count.
-- * The number is chosen at merge time (D24).

create or replace function private.subject_key(subject text)
returns text language sql immutable set search_path='' as $$
  select lower(btrim(regexp_replace(coalesce(subject, ''), '\s+', ' ', 'g')))
$$;
revoke all on function private.subject_key(text) from public, anon, authenticated;

create or replace function public.finish_email_step(build uuid, lease uuid, done text, output jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  next_step text;
  saved jsonb;
  t uuid;
  plan_id uuid;
  subject text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  -- A copy step is saved one at a time per plan: tenant, plan, then build.
  if done = 'copy' then
    select e.tenant_id, e.run_id into t, plan_id from public.email_builds e where e.id = build;
    if found then
      perform 1 from public.tenants w where w.id = t for share;
      perform 1 from public.strategy_runs s where s.id = plan_id for update;
    end if;
  end if;
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
  if done = 'copy' then
    subject := private.subject_key(output->'draft'->>'subject');
    if subject = '' then
      raise exception 'A copy step needs its subject' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.email_builds o
      where o.tenant_id = b.tenant_id and o.run_id = b.run_id and o.slot <> b.slot
        and (o.state <> 'failed' or o.email is not null)
        and subject in (private.subject_key(o.email->>'subject'),
                        private.subject_key(o.progress->'copy'->'draft'->>'subject'))
    ) then
      raise exception 'Another email in this plan has this subject' using errcode = 'PT409', detail = 'subject_taken';
    end if;
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
