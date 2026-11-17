-- DST-002b part b1: how a designed email is made, chosen by the owner when
-- they click "Create email" (D25, AGENT_MAP §4): Copy (rebuild a competitor
-- email for this brand), Remix (keep its idea, a new layout) or Scratch
-- (design from nothing, the only way until now).
--
-- * Every existing build was made from scratch, so the column defaults to
--   'scratch' and old builds keep reading as they were made.
-- * create_email_build takes the mode as an optional last argument with
--   the same default, so the app before this change (which names t, run and
--   slot only) keeps working while this migration and the new app deploy.
-- * A text email (the plan's slot format 'text', D26) has no layout to copy
--   or remix: asking for one is refused, before any other check of the
--   planned email (a missing format is a designed email). A future switch of
--   a slot's format must rewrite that format in the plan.
-- * The two new refusals carry a stable hint (`build_mode_unknown`,
--   `build_mode_text`) the app reads instead of their words.
-- * Clicking again on an email already being made (in any allowed mode)
--   returns that build; its mode is the one it was started with.
-- * The worker picks the reference email itself (the inbox is not a
--   member's to read); nothing here names one.
-- * The number is chosen at merge time (D24).

alter table public.email_builds
  add column mode text not null default 'scratch'
    check (mode in ('copy', 'remix', 'scratch'));

drop function public.create_email_build(uuid, uuid, integer);

-- The owner's "Create email" on a planned email (D17). Returns the build:
-- the open or drafted one for that email, or a new one made in `mode`.
create function public.create_email_build(t uuid, run uuid, slot integer, mode text default 'scratch')
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
  insert into public.email_builds (tenant_id, run_id, slot, push_key, created_by, mode)
    values (t, run, create_email_build.slot, coalesce(key, gen_random_uuid()), auth.uid(),
      create_email_build.mode)
    returning id into build;
  return build;
end $$;

revoke all on function public.create_email_build(uuid, uuid, integer, text) from public, anon;
grant execute on function public.create_email_build(uuid, uuid, integer, text) to authenticated;
