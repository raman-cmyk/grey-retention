-- UI-USE: "Use this design" on Inspiration (owner decision of 24 Nov). The
-- owner picks an Inspiration email, then a planned email of the current
-- plan, and clicks "Create email": the email is built (Copy or Remix) from
-- that inspiration email instead of one the worker picks (D16, D17).
--
-- * email_builds.reference_id: the inspiration email the owner chose
--   (`competitor_emails.id`), null when the worker picks (every build until
--   now, and every Scratch build). A plain id, no foreign key: the inbox
--   removes emails platform-wide (inbox ops), and a build whose chosen
--   email is gone says so in its run log and is made from scratch.
-- * create_email_build takes it as an optional last argument (default
--   null): the app before this change (t, run, slot and mode) keeps
--   working, with exactly the same checks and answers.
-- * A reference must be an email of a brand this workspace follows now
--   (an active subscription) and has not hidden; anything else (another
--   workspace's brand, an unknown id, a hidden brand) is refused the same
--   way, hint `build_reference_unknown`, so nothing is learned about other
--   workspaces. It is checked under the workspace lock (tenant first), as
--   following and hiding take it.
-- * A reference comes with Copy or Remix only (hint
--   `build_mode_reference`): Scratch follows no email. A text email is
--   never copied or remixed (the existing `build_mode_text` refusal).
-- * Clicking again on an email already being made returns that build, as
--   before: its mode and reference are the ones it was started with.
-- * The worker still checks the chosen email itself (tagged sections, its
--   age, its heights for Copy, an offer or an idea): when it cannot be
--   followed, the email is made from scratch and the run log says why.
-- * The number is chosen at merge time (D24).

alter table public.email_builds
  add column reference_id uuid,
  add constraint email_builds_reference_mode
    check (reference_id is null or mode in ('copy', 'remix'));

drop function public.create_email_build(uuid, uuid, integer, text);

-- The owner's "Create email" on a planned email (D17). Returns the build:
-- the open or drafted one for that email, or a new one made in `mode`,
-- from the chosen inspiration email when one is given.
create function public.create_email_build(t uuid, run uuid, slot integer,
  mode text default 'scratch', reference uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.strategy_runs;
  zone text;
  day date;
  build uuid;
  key uuid;
begin
  -- require_member locks the workspace row (tenant first), then the run.
  perform private.require_member(t, true);
  if mode is null or mode not in ('copy', 'remix', 'scratch') then
    raise exception 'Choose Copy, Remix or Scratch' using errcode = '22023', hint = 'build_mode_unknown';
  end if;
  if create_email_build.reference is not null and mode = 'scratch' then
    raise exception 'Choose Copy or Remix for an inspiration email' using errcode = '22023', hint = 'build_mode_reference';
  end if;
  -- Under the workspace lock: following and hiding a brand take it too.
  if create_email_build.reference is not null and not exists (
    select 1 from public.competitor_emails e
      join public.competitor_subscriptions s
        on s.capture_id = e.capture_id and s.tenant_id = t and s.active
    where e.id = create_email_build.reference
      and not exists (select 1 from public.competitor_hidden h
                      where h.tenant_id = t and h.capture_id = e.capture_id)
  ) then
    raise exception 'This inspiration email is not one you can use' using errcode = '22023', hint = 'build_reference_unknown';
  end if;
  select * into r from public.strategy_runs s where s.id = run and s.tenant_id = t for update;
  if not found then raise exception 'Plan unavailable' using errcode = '42501'; end if;
  if r.state <> 'planned' then
    raise exception 'This plan is not ready yet' using errcode = 'PT409';
  end if;
  -- Only the latest plan: an older one (an old tab) has been replaced.
  if exists (select 1 from public.strategy_runs s
             where s.tenant_id = t and s.created_at > r.created_at) then
    raise exception 'This plan has been replaced; use the latest plan' using errcode = 'PT409';
  end if;
  if slot is null or slot < 0 or slot >= jsonb_array_length(coalesce(r.plan->'slots', '[]'::jsonb)) then
    raise exception 'This plan has no such email' using errcode = '22023';
  end if;
  if mode <> 'scratch' and r.plan->'slots'->slot->>'format' = 'text' then
    raise exception 'A text email is written, not copied or remixed' using errcode = '22023', hint = 'build_mode_text';
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
  if (select count(*) from public.email_builds b
      where b.run_id = run and b.slot = create_email_build.slot and b.state = 'failed') >= 5 then
    raise exception 'This email failed 5 times; plan again' using errcode = 'PT409';
  end if;
  -- A failed build that reached the push may have made a draft already:
  -- its key is kept, so a new push returns (and updates) that draft.
  select b.push_key into key from public.email_builds b
    where b.run_id = run and b.slot = create_email_build.slot
      and b.state = 'failed' and b.email is not null
    order by b.created_at desc limit 1;
  insert into public.email_builds (tenant_id, run_id, slot, push_key, created_by, mode, reference_id)
    values (t, run, create_email_build.slot, coalesce(key, gen_random_uuid()), auth.uid(),
      create_email_build.mode, create_email_build.reference)
    returning id into build;
  return build;
end $$;

revoke all on function public.create_email_build(uuid, uuid, integer, text, uuid) from public, anon;
grant execute on function public.create_email_build(uuid, uuid, integer, text, uuid) to authenticated;
