-- PICK-106 (owner pick #106): version history. Every email GROS makes or
-- makes again for a planned email (a run's slot) is kept as a version, and
-- the owner can bring an older one back ("Use this version").
--
-- * A version is one finished build output: written by finish_email_build,
--   in the same transaction as the build's finish (the workspace first,
--   then the build, then the versions). One version per build output: a
--   unique index on the build for made versions, and the insert does
--   nothing on a second try.
-- * `how`: how GROS made it, from the build: 'scratch', 'library_copy' (an
--   Inspiration email copied), 'upload_copy' (one of the owner's own
--   emails copied), 'remix', 'try_again' (a planned email made again after
--   an earlier build of it), or 'restore' (the owner's "Use this version":
--   `restored_from` names the version brought back).
-- * Versions are never changed: no member, job or service role may insert,
--   update or delete them directly; only the two commands here write
--   them. Members of the workspace (and platform operators) read their own
--   workspace's versions (RLS).
-- * At most 20 versions per planned email (`private.email_versions_kept`):
--   when a new one is added, the oldest past 20 are dropped. The newest
--   (the current one) is never dropped.
-- * restore_email_version: the owner only (checked here, under the
--   workspace lock). Only on the planned email's open build when it is a
--   draft (in Klaviyo or a sample draft), from the page's current version
--   (a stale page or a build in progress is PT409). It adds the old
--   version as a new one and puts that email back on the build's push
--   step: the same worker pushes it with the planned email's push key, so
--   the pusher updates the same GROS draft, with every check and switch
--   of the push (KLAVIYO_DRAFT_PUSH, the write lock, the final checks, the
--   offer check, PICK-99's never-overwrite). Nothing is scheduled or sent.
--   A draft the owner scheduled, sent, deleted, cancelled or changed in
--   Klaviyo (as PICK-99's sync last read it) is refused, as is an email
--   whose day has passed. Each refusal carries a stable hint.
-- * The number is chosen at merge time (D24).

create table public.email_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null,
  slot integer not null check (slot between 0 and 19),
  -- 1, 2, 3 … per planned email; a dropped old number is never reused.
  number integer not null check (number between 1 and 100000),
  -- The build that made it, or (a restore) the build it was put back on.
  build_id uuid not null,
  how text not null
    check (how in ('scratch', 'library_copy', 'upload_copy', 'remix', 'try_again', 'restore')),
  restored_from integer check (restored_from is null or restored_from between 1 and 100000),
  subject text not null check (length(subject) between 1 and 500),
  -- The built email as stored (email_builds.email), at most as large.
  email jsonb not null check (jsonb_typeof(email) = 'object' and octet_length(email::text) <= 300000),
  -- The owner who brought it back; null for an email GROS made.
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, run_id) references public.strategy_runs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, build_id) references public.email_builds (tenant_id, id) on delete cascade,
  check ((how = 'restore') = (restored_from is not null)),
  check ((how = 'restore') = (created_by is not null)),
  check (restored_from is null or restored_from < number),
  unique (tenant_id, run_id, slot, number)
);
-- One version per finished build output (a retry adds nothing).
create unique index email_versions_one_per_build on public.email_versions (build_id) where how <> 'restore';
create index email_versions_build on public.email_versions (tenant_id, build_id);

alter table public.email_versions enable row level security;
create policy email_versions_member_read on public.email_versions for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.email_versions from public, anon, authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_versions from public, anon, authenticated, service_role';
  end if;
end $$;
grant select on public.email_versions to authenticated, service_role;

-- Versions kept per planned email.
create or replace function private.email_versions_kept()
returns integer language sql immutable set search_path = '' as $$ select 20 $$;

-- Adds one version of a planned email (the caller holds the workspace and
-- its build), then drops the oldest past the limit. Returns its number, or
-- null when this build's output is kept already.
create or replace function private.add_email_version(b public.email_builds, made text, output jsonb,
  source integer default null, who uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  select coalesce(max(v.number), 0) + 1 into n from public.email_versions v
    where v.tenant_id = b.tenant_id and v.run_id = b.run_id and v.slot = b.slot;
  insert into public.email_versions as v (tenant_id, run_id, slot, number, build_id, how, restored_from, subject, email, created_by)
    values (b.tenant_id, b.run_id, b.slot, n, b.id, made, source,
      left(coalesce(nullif(btrim(output->>'subject'), ''), 'No subject'), 500), output, who)
    on conflict (build_id) where how <> 'restore' do nothing;
  if not found then return null; end if;
  delete from public.email_versions v
    where v.tenant_id = b.tenant_id and v.run_id = b.run_id and v.slot = b.slot
      and v.number <= n - private.email_versions_kept();
  return n;
end $$;

-- How a build made its email: made again after an earlier build of the
-- same planned email (Try again), else the way the owner chose.
create or replace function private.email_build_how(b public.email_builds)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.email_builds e
                 where e.tenant_id = b.tenant_id and e.run_id = b.run_id and e.slot = b.slot
                   and e.id <> b.id and e.created_at <= b.created_at) then 'try_again'
    when b.mode = 'copy' and b.upload_id is not null then 'upload_copy'
    when b.mode = 'copy' then 'library_copy'
    when b.mode = 'remix' then 'remix'
    else 'scratch'
  end
$$;

-- The built email (the design step): as in 090067, and (PICK-106) the
-- workspace first, then the build, and the email kept as a version.
create or replace function public.finish_email_build(build uuid, lease uuid, result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  t uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  -- Tenant first (the version it writes belongs to the workspace).
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
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
  perform private.add_email_version(b, private.email_build_how(b), result);
end $$;

-- The owner's "Use this version": the planned email's older version made
-- the current one, as a new version, and put back on its draft through the
-- push (see above). `shown`: the newest version the page showed.
-- Returns the new version's number.
create or replace function public.restore_email_version(t uuid, build uuid, version integer, shown integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b public.email_builds;
  v public.email_versions;
  newest integer;
  zone text;
  day date;
  seen text[];
  n integer;
begin
  -- The owner only; require_member locks the workspace row (tenant first).
  perform private.require_member(t, true);
  if version is null or shown is null then
    raise exception 'Choose a version' using errcode = '22023', hint = 'version_unknown';
  end if;
  select * into b from public.email_builds e where e.id = build and e.tenant_id = t for update;
  if not found then raise exception 'Email unavailable' using errcode = '42501'; end if;
  if b.state in ('build_queued', 'push_queued') then
    raise exception 'This email is being made or put in Klaviyo' using errcode = 'PT409', hint = 'version_busy';
  end if;
  if b.state <> 'drafted' then
    raise exception 'This email is not a draft' using errcode = 'PT409', hint = 'version_not_drafted';
  end if;
  select max(x.number) into newest from public.email_versions x
    where x.tenant_id = t and x.run_id = b.run_id and x.slot = b.slot;
  if newest is distinct from shown then
    raise exception 'This email has changed since the page was opened' using errcode = 'PT409', hint = 'version_stale';
  end if;
  select * into v from public.email_versions x
    where x.tenant_id = t and x.run_id = b.run_id and x.slot = b.slot and x.number = version;
  if not found then
    raise exception 'This version is not kept' using errcode = '22023', hint = 'version_unknown';
  end if;
  if v.number = newest then
    raise exception 'This is the current version' using errcode = '22023', hint = 'version_current';
  end if;
  -- PICK-99: what the owner did with this planned email's draft in Klaviyo
  -- (every build with its push key), as the results sync last read it.
  select array_agg(r.status || case when r.changed or r.design_changed then ':edited' else '' end) into seen
    from public.klaviyo_email_results r
    join public.email_builds e on e.tenant_id = r.tenant_id and e.id = r.build_id
    where r.tenant_id = t and e.push_key = b.push_key;
  seen := coalesce(seen, array[]::text[]);
  if exists (select 1 from unnest(seen) s where split_part(s, ':', 1) in ('sent', 'sending')) then
    raise exception 'This email was sent from Klaviyo' using errcode = 'PT409', hint = 'version_sent';
  end if;
  if exists (select 1 from unnest(seen) s where split_part(s, ':', 1) = 'scheduled') then
    raise exception 'This email is scheduled in Klaviyo' using errcode = 'PT409', hint = 'version_scheduled';
  end if;
  if exists (select 1 from unnest(seen) s where split_part(s, ':', 1) in ('deleted', 'cancelled')) then
    raise exception 'This draft was deleted or cancelled in Klaviyo' using errcode = 'PT409', hint = 'version_gone';
  end if;
  if exists (select 1 from unnest(seen) s where s like '%:edited') then
    raise exception 'This draft was changed in Klaviyo' using errcode = 'PT409', hint = 'version_edited';
  end if;
  -- The push of a day that has passed fails (claim_email_build): refused here.
  select w.timezone into zone from public.tenants w where w.id = t;
  begin
    select (s.plan->'slots'->b.slot->>'date')::date into day
      from public.strategy_runs s where s.tenant_id = t and s.id = b.run_id;
  exception when others then
    day := null;
  end;
  if day is null or day < (now() at time zone coalesce(zone, 'UTC'))::date then
    raise exception 'This email''s day has passed' using errcode = 'PT409', hint = 'version_day_passed';
  end if;
  n := private.add_email_version(b, 'restore', v.email, v.number, auth.uid());
  -- Back to the push: the same key updates the same draft (a new step:
  -- its own attempts and waits). The campaign id comes back with it.
  update public.email_builds e
    set email = v.email, step = 'push', state = 'push_queued', klaviyo_campaign_id = null,
        attempts = 0, waits = 0, error_code = null, not_before = null, lease_token = null, lease_until = null,
        updated_at = now()
    where e.id = b.id;
  return n;
end $$;

revoke all on function private.email_versions_kept(), private.add_email_version(public.email_builds, text, jsonb, integer, uuid),
  private.email_build_how(public.email_builds) from public, anon, authenticated, service_role;
revoke all on function public.finish_email_build(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_email_build(uuid, uuid, jsonb) to service_role;
revoke all on function public.restore_email_version(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.restore_email_version(uuid, uuid, integer, integer) to authenticated;
