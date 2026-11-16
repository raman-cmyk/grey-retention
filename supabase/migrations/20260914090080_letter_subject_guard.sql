-- TXT-001d (D26): a text email's copy step saves a letter, not a draft.
-- The subject guard (REL-AI1b, 20260914090070) read only a draft's subject:
-- it refused every letter ("A copy step needs its subject") and never saw
-- a letter's saved subject, so another email of the plan could take it.
-- It now reads either, the same way: case and spacing aside, one copy
-- step at a time per plan (tenant, plan, then build), PT409 when another
-- email of the plan has the subject. Nothing else changes.
-- * The number is chosen at merge time (D24).

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
    -- A designed email's subject, or a text email's letter's (TXT-001d).
    subject := private.subject_key(coalesce(output->'draft'->>'subject', output->'letter'->>'subject'));
    if subject = '' then
      raise exception 'A copy step needs its subject' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.email_builds o
      where o.tenant_id = b.tenant_id and o.run_id = b.run_id and o.slot <> b.slot
        and (o.state <> 'failed' or o.email is not null)
        and subject in (private.subject_key(o.email->>'subject'),
                        private.subject_key(o.progress->'copy'->'draft'->>'subject'),
                        private.subject_key(o.progress->'copy'->'letter'->>'subject'))
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
