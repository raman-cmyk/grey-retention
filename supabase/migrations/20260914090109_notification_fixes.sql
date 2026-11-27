-- PICK-107 review fixes (PR #688), kept apart from 20260914090109 because a
-- committed migration is never edited. The number is chosen at merge time
-- (D24).
--
-- 1. Lock order: tenant first. A notice's rows point at the workspace, so
--    writing one takes a key-share lock on it. The plan and draft finishes
--    now take the workspace (for share) before their leased row, as
--    `save_klaviyo_result` and `request_email_copy` already do, so an owner
--    command holding the workspace and waiting on the run cannot deadlock
--    with them.
-- 2. A late draft never joins a drafts item already emailed: it starts a
--    new one.
-- 3. Email goes to the owner only (until he decides otherwise), and only
--    for a ready plan and drafts in Klaviyo; results stay in the app.
-- 4. Fail-soft: a notice waits at most two seconds for any lock (the
--    per-plan advisory lock included: lock_timeout bounds it), and a
--    cancelled or timed-out notice is a warning too, never a lost plan or
--    draft.

create or replace function public.finish_strategy_plan(run uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  t uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs run plans' using errcode = '42501';
  end if;
  -- Tenant first (the notice it triggers writes rows that point at it).
  select tenant_id into t from public.strategy_runs where id = run;
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  perform private.leased_strategy_run(run, lease, 'plan_queued');
  if result is null or jsonb_typeof(result) <> 'object' or coalesce(jsonb_typeof(result->'slots'), '') <> 'array' then
    raise exception 'A plan needs its slots' using errcode = '22023';
  end if;
  update public.strategy_runs
    set plan = result, state = 'planned', attempts = 0, error_code = null, lease_token = null, lease_until = null, updated_at = now()
    where id = run;
end $$;

create or replace function public.finish_email_push(build uuid, lease uuid, campaign text, sample boolean)
returns void language plpgsql security definer set search_path='' as $$
declare
  t uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  -- Tenant first (the notice it triggers writes rows that point at it).
  select tenant_id into t from public.email_builds where id = build;
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  perform private.leased_email_build(build, lease, 'push_queued');
  if campaign is null or length(campaign) not between 1 and 200 or sample is null then
    raise exception 'A draft needs its campaign id' using errcode = '22023';
  end if;
  update public.email_builds
    set klaviyo_campaign_id = campaign, sample_draft = sample, state = 'drafted', attempts = 0,
        error_code = null, not_before = null, lease_token = null, lease_until = null, updated_at = now()
    where id = build;
end $$;

-- Runs a notice's writes with a short lock wait, restoring the caller's
-- setting after, whatever happens.
create or replace function private.notice_lock_wait(on_ boolean)
returns void language plpgsql set search_path = '' as $$
begin
  if on_ then
    perform set_config('notice.lock_timeout', current_setting('lock_timeout'), true);
    perform set_config('lock_timeout', '2s', true);
  else
    perform set_config('lock_timeout', coalesce(nullif(current_setting('notice.lock_timeout', true), ''), '0'), true);
  end if;
end $$;

create or replace function private.notice_plan_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notice_lock_wait(true);
  begin
    perform private.post_notice(new.tenant_id, 'plan_ready:' || new.id, 'plan_ready:' || new.id, 'plan_ready', new.id,
      case when new.pulse->>'sample' = 'true' then 'Your 15-day sample plan is ready' else 'Your 15-day plan is ready' end,
      '/plan');
  exception
    when query_canceled then raise warning 'Plan notice not recorded (%)', sqlstate;
    when others then raise warning 'Plan notice not recorded (%)', sqlstate;
  end;
  perform private.notice_lock_wait(false);
  return null;
end $$;

create or replace function private.notice_email_drafted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item text;
  done integer;
  total integer;
  words text;
begin
  perform private.notice_lock_wait(true);
  begin
    if not exists (select 1 from public.notification_events
                   where tenant_id = new.tenant_id and event_key = 'drafted:' || new.id) then
      -- Two drafts of one plan finishing at once join the same item: the
      -- second waits for the first. The wait is bounded by the 2 s
      -- lock_timeout set above (it applies to advisory locks too); past it
      -- the notice is a warning and the draft is kept.
      perform pg_advisory_xact_lock(hashtextextended('notice:drafts:' || new.run_id::text, 0));
      select n.event_key into item from public.notifications n
        where n.tenant_id = new.tenant_id and n.kind = 'drafts_ready' and n.entity_id = new.run_id
          and n.updated_at > now() - interval '1 hour'
          -- An item already emailed is closed: a late draft starts a new one.
          and not exists (select 1 from public.notifications x
                            join public.notification_deliveries d on d.notification_id = x.id
                          where x.tenant_id = n.tenant_id and x.event_key = n.event_key)
        order by n.updated_at desc limit 1;
      item := coalesce(item, 'drafts_ready:' || new.id);
      select count(distinct b.slot) into done from public.email_builds b
        where b.run_id = new.run_id and b.state = 'drafted' and b.sample_draft = new.sample_draft;
      select coalesce(jsonb_array_length(r.plan->'slots'), 0) into total from public.strategy_runs r
        where r.id = new.run_id;
      total := greatest(total, done);
      words := case
        when total = 1 and new.sample_draft then 'Your sample draft is ready'
        when total = 1 then 'Your draft is in Klaviyo'
        when new.sample_draft then format('%s of %s sample drafts %s ready', done, total, case when done = 1 then 'is' else 'are' end)
        else format('%s of %s drafts %s in Klaviyo', done, total, case when done = 1 then 'is' else 'are' end)
      end;
      perform private.post_notice(new.tenant_id, 'drafted:' || new.id, item, 'drafts_ready', new.run_id, words, '/plan');
    end if;
  exception
    when query_canceled then raise warning 'Draft notice not recorded (%)', sqlstate;
    when others then raise warning 'Draft notice not recorded (%)', sqlstate;
  end;
  perform private.notice_lock_wait(false);
  return null;
end $$;

create or replace function private.notice_results_in()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  day date;
  email text;
begin
  perform private.notice_lock_wait(true);
  begin
    if new.planned->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then
      day := (new.planned->>'date')::date;
    end if;
    email := case when day is null then 'an email' else 'the ' || to_char(day, 'FMDay, Mon FMDD') || ' email' end;
    perform private.post_notice(new.tenant_id, 'results_in:' || new.build_id, 'results_in:' || new.build_id, 'results_in',
      new.build_id,
      case when new.sample then 'Sample results are in for ' || email else 'Results are in for ' || email end,
      '/plan/email/' || new.build_id);
  exception
    when query_canceled then raise warning 'Results notice not recorded (%)', sqlstate;
    when others then raise warning 'Results notice not recorded (%)', sqlstate;
  end;
  perform private.notice_lock_wait(false);
  return null;
end $$;

-- Email: the owner only, a ready plan and drafts only (results stay in the
-- app until they can be grouped per send day).
create or replace function public.claim_notification_emails(lim integer default 50)
returns table (notification_id uuid, tenant_id uuid, recipient_id uuid, kind text, message text, href text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the sweep sends notices' using errcode = '42501';
  end if;
  return query
  with due as (
    select n.id, n.tenant_id from public.notifications n
      join public.notification_settings s on s.tenant_id = n.tenant_id and s.email_on
      join public.tenants w on w.id = n.tenant_id and w.status = 'active'
    where n.event_key is not null and n.kind in ('plan_ready', 'drafts_ready')
      and n.created_at >= s.email_since and n.created_at > now() - interval '2 days'
      and (n.kind <> 'drafts_ready' or n.updated_at <= now() - interval '1 hour')
      and exists (select 1 from public.tenant_memberships m join public.profiles p on p.id = m.profile_id
                  where m.tenant_id = n.tenant_id and m.profile_id = n.recipient_id
                    and m.role = 'owner' and m.status = 'active' and p.status = 'active')
      and not exists (select 1 from public.notification_deliveries d where d.notification_id = n.id)
    order by n.updated_at
    limit greatest(1, least(coalesce(lim, 50), 200))
    for update of n skip locked
  ), claimed as (
    insert into public.notification_deliveries (notification_id, tenant_id, channel, state, provider)
      select due.id, due.tenant_id, 'email', 'simulated', 'fixture' from due
      on conflict (notification_id) do nothing
      returning notification_deliveries.notification_id
  )
  select n.id, n.tenant_id, n.recipient_id, n.kind, n.message, n.href
    from public.notifications n join claimed c on c.notification_id = n.id;
end $$;

revoke all on function private.notice_lock_wait(boolean), private.notice_plan_ready(), private.notice_email_drafted(),
  private.notice_results_in() from public, anon, authenticated, service_role;
revoke all on function public.finish_strategy_plan(uuid, uuid, jsonb), public.finish_email_push(uuid, uuid, text, boolean),
  public.claim_notification_emails(integer) from public, anon, authenticated;
grant execute on function public.finish_strategy_plan(uuid, uuid, jsonb), public.finish_email_push(uuid, uuid, text, boolean),
  public.claim_notification_emails(integer) to service_role;
