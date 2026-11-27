-- PICK-107 (owner pick #107): notifications. The owner and his team are
-- told, in the app, when a 15-day plan is ready, when drafts are in
-- Klaviyo (drafts that finish close together are one item: "12 of 15
-- drafts are in Klaviyo") and when an email's first results are in.
--
-- * Built on the existing `notifications` table (one row per person, its
--   own `read_at`, read only by that person while a member: RLS from
--   20260914070000). New columns: the item's key, its link and when it last
--   changed.
-- * Each event is written once: `notification_events` keeps one row per
--   event (`plan_ready:<run>`, `drafted:<build>`, `results_in:<build>`),
--   so a retried job, a second trigger or a replayed step never adds an
--   item twice. The events are written by triggers on the state changes
--   themselves (in the same transaction as the change), so every path
--   that makes a plan ready, a draft or a first result is covered.
-- * A notice never stops the work it reports: if writing it fails, the
--   plan, draft or result is kept and a warning is logged.
-- * Email is off unless the owner turns it on (`set_notification_email`).
--   The scheduled sweep then claims each item once
--   (`claim_notification_emails`, recorded in `notification_deliveries`)
--   and hands it to the email adapter, which is the fake one: no email is
--   sent by this build ('simulated', 'fixture'). A live provider needs its
--   own states (queued, sent, failed) in a later migration.
-- * The number is chosen at merge time (D24).

alter table public.notifications
  add column event_key text check (event_key is null or event_key ~ '^[a-z_]{2,30}:[0-9a-f-]{36}$'),
  add column href text check (href is null or (href ~ '^/[A-Za-z0-9/_-]{0,199}$' and href !~ '//')),
  add column updated_at timestamptz;
update public.notifications set updated_at = created_at where updated_at is null;
alter table public.notifications
  alter column updated_at set default now(),
  alter column updated_at set not null;
-- Notices are written only by the functions below (they were closed by
-- RLS alone; now by privileges too). Members keep reading their own.
revoke insert, update, delete, truncate, references, trigger on public.notifications, public.notification_deliveries
  from public, anon, authenticated;
revoke select on public.notifications, public.notification_deliveries from public, anon;
-- One row per person per item.
create unique index notifications_event_once on public.notifications (recipient_id, event_key)
  where event_key is not null;
-- The list in the app: a person's items, latest change first.
create index notifications_items on public.notifications (recipient_id, tenant_id, updated_at desc)
  where event_key is not null;
-- Finding the drafts item a new draft joins.
create index notifications_drafts_group on public.notifications (tenant_id, entity_id, updated_at desc)
  where kind = 'drafts_ready';

create table public.notification_events (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null check (event_key ~ '^[a-z_]{2,30}:[0-9a-f-]{36}$'),
  -- The item it made or joined (`notifications.event_key`).
  item_key text not null check (item_key ~ '^[a-z_]{2,30}:[0-9a-f-]{36}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, event_key)
);
alter table public.notification_events enable row level security;
revoke all on public.notification_events from public, anon, authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.notification_events from public, anon, authenticated, service_role';
  end if;
end $$;

-- The owner's email switch, per workspace. Off until he turns it on;
-- `email_since` keeps older items from being emailed when he does.
create table public.notification_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  email_on boolean not null default false,
  email_since timestamptz,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (email_on = (email_since is not null))
);
alter table public.notification_settings enable row level security;
create policy notification_settings_member_read on public.notification_settings for select to authenticated
  using (private.is_active_member(tenant_id));
revoke all on public.notification_settings from public, anon, authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.notification_settings from public, anon, authenticated, service_role';
  end if;
end $$;
grant select on public.notification_settings to authenticated;

-- Who is told: every active member (owner, managers, staff).
create or replace function private.notice_recipients(t uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.profile_id from public.tenant_memberships m
    join public.profiles p on p.id = m.profile_id
  where m.tenant_id = t and m.status = 'active' and p.status = 'active';
$$;

-- Records one event and makes or refreshes its item for every member,
-- unread. False when the event was recorded before (nothing changes).
create or replace function private.post_notice(t uuid, event text, item text, notice_kind text,
  entity uuid, words text, link text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  added integer;
begin
  insert into public.notification_events (tenant_id, event_key, item_key) values (t, event, item)
    on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then return false; end if;
  insert into public.notifications (tenant_id, recipient_id, kind, entity_id, message, event_key, href, updated_at)
    select t, r, notice_kind, entity, words, item, link, now() from private.notice_recipients(t) r
    on conflict (recipient_id, event_key) where event_key is not null
    do update set message = excluded.message, href = excluded.href, read_at = null, updated_at = now();
  return true;
end $$;

-- "Your 15-day plan is ready", when a run becomes planned.
create or replace function private.notice_plan_ready()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform private.post_notice(new.tenant_id, 'plan_ready:' || new.id, 'plan_ready:' || new.id, 'plan_ready', new.id,
      case when new.pulse->>'sample' = 'true' then 'Your 15-day sample plan is ready' else 'Your 15-day plan is ready' end,
      '/plan');
  exception when others then
    raise warning 'Plan notice not recorded (%)', sqlstate;
  end;
  return null;
end $$;

-- "12 of 15 drafts are in Klaviyo", when a build is drafted. A draft joins
-- the plan's drafts item while that item changed in the last hour (Create
-- all emails builds one after another, and the sweep every half hour the
-- rest), otherwise it starts a new one.
create or replace function private.notice_email_drafted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  item text;
  done integer;
  total integer;
  words text;
begin
  begin
    -- Two drafts of one plan finishing at once join the same item.
    perform pg_advisory_xact_lock(hashtextextended('notice:drafts:' || new.run_id::text, 0));
    if exists (select 1 from public.notification_events
               where tenant_id = new.tenant_id and event_key = 'drafted:' || new.id) then
      return null;
    end if;
    select n.event_key into item from public.notifications n
      where n.tenant_id = new.tenant_id and n.kind = 'drafts_ready' and n.entity_id = new.run_id
        and n.updated_at > now() - interval '1 hour'
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
  exception when others then
    raise warning 'Draft notice not recorded (%)', sqlstate;
  end;
  return null;
end $$;

-- "Results are in for the Tuesday, Dec 2 email", when the results sync
-- reads an email's first results (the later two daily reads add to the
-- same email's page, not a new item).
create or replace function private.notice_results_in()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  day date;
  email text;
begin
  begin
    if new.planned->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then
      day := (new.planned->>'date')::date;
    end if;
    email := case when day is null then 'an email' else 'the ' || to_char(day, 'FMDay, Mon FMDD') || ' email' end;
    perform private.post_notice(new.tenant_id, 'results_in:' || new.build_id, 'results_in:' || new.build_id, 'results_in',
      new.build_id,
      case when new.sample then 'Sample results are in for ' || email else 'Results are in for ' || email end,
      '/plan/email/' || new.build_id);
  exception when others then
    raise warning 'Results notice not recorded (%)', sqlstate;
  end;
  return null;
end $$;

create trigger strategy_runs_notice_ready after update of state on public.strategy_runs
  for each row when (new.state = 'planned' and old.state is distinct from 'planned')
  execute function private.notice_plan_ready();
create trigger email_builds_notice_drafted after update of state on public.email_builds
  for each row when (new.state = 'drafted' and old.state is distinct from 'drafted')
  execute function private.notice_email_drafted();
create trigger klaviyo_email_results_notice_results after update of pulls on public.klaviyo_email_results
  for each row when (old.pulls = 0 and new.pulls > 0)
  execute function private.notice_results_in();

-- Mark as read, for the person only: the given items, or all of them.
create or replace function public.mark_notifications_read(t uuid, ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  marked integer;
begin
  if auth.uid() is null or not private.is_active_member(t) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if ids is not null and cardinality(ids) > 100 then
    raise exception 'Mark at most 100 at a time' using errcode = '22023';
  end if;
  update public.notifications set read_at = now()
    where tenant_id = t and recipient_id = auth.uid() and event_key is not null and read_at is null
      and (ids is null or id = any(ids));
  get diagnostics marked = row_count;
  return marked;
end $$;

-- The owner's email switch. Returns whether it changed.
create or replace function public.set_notification_email(t uuid, turn_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  was boolean;
begin
  -- require_member locks the workspace row (tenant first).
  perform private.require_member(t, true);
  if turn_on is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  select email_on into was from public.notification_settings where tenant_id = t for update;
  if coalesce(was, false) = turn_on then return false; end if;
  insert into public.notification_settings (tenant_id, email_on, email_since, updated_by, updated_at)
    values (t, turn_on, case when turn_on then now() end, auth.uid(), now())
    on conflict (tenant_id) do update
      set email_on = excluded.email_on, email_since = excluded.email_since,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail)
    values (t, auth.uid(), 'notification_email_set', jsonb_build_object('on', turn_on));
  return true;
end $$;

-- The sweep's claim: items to email, each once. Only for workspaces whose
-- owner turned email on, items made since then (and in the last two days),
-- to people still in the workspace; a drafts item once it has been quiet
-- for an hour (so its count is final). The claim is the delivery row.
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
    where n.event_key is not null
      and n.created_at >= s.email_since and n.created_at > now() - interval '2 days'
      and (n.kind <> 'drafts_ready' or n.updated_at <= now() - interval '1 hour')
      and n.recipient_id in (select private.notice_recipients(n.tenant_id))
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

revoke all on function private.notice_recipients(uuid), private.post_notice(uuid, text, text, text, uuid, text, text),
  private.notice_plan_ready(), private.notice_email_drafted(), private.notice_results_in()
  from public, anon, authenticated, service_role;
revoke all on function public.mark_notifications_read(uuid, uuid[]), public.set_notification_email(uuid, boolean),
  public.claim_notification_emails(integer) from public, anon, authenticated, service_role;
grant execute on function public.mark_notifications_read(uuid, uuid[]), public.set_notification_email(uuid, boolean)
  to authenticated;
grant execute on function public.claim_notification_emails(integer) to service_role;
