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
-- * A restore's `outcome`: 'pending' while its push runs, then 'applied'
--   (the draft holds it), 'failed' (`failure`: the push's code; it wrote
--   nothing to the draft, which kept the email it had) or 'unknown'
--   (`failure`: the push's code; it may have written part of it: what
--   Klaviyo holds is not known, and the page says to check it there).
--   Nothing else of a version ever changes. No
--   member, job or service role writes versions directly; only the
--   commands and the build trigger here do. Members of the workspace (and
--   platform operators) read their own workspace's versions (RLS).
-- * The current version is the newest one that is not a pending or failed
--   restore. When that one is an unknown restore, nothing is confirmed as
--   current (and any version may be brought back, that one too).
-- * Retention: at most 20 versions per planned email
--   (`private.email_versions_kept`): when one is added, the oldest past 20
--   are dropped, never the current one. A restored version is a full copy,
--   so dropping its source loses nothing. Versions live as long as their
--   plan run: deleting a run (or the workspace) deletes them; there is no
--   time-based expiry.
-- * restore_email_version: the owner only, under the workspace lock; only
--   for an active workspace (a paused one's owner is refused by the
--   membership check), the latest plan (still planned), the planned
--   email's draft (in Klaviyo or a sample draft) and the page's current
--   version (a stale page or a build in progress is PT409). It adds the old
--   version as a new one (pending) and puts that email on the build's push
--   step with the planned email's push key, so the worker's push updates
--   the same GROS draft with every check and switch of the push. The draft's
--   email and campaign id are kept beside it (`restore_*`), with what the
--   push row said the draft showed (`restore_push`: written, target,
--   shown). When the push ends any other way than drafted, the build is
--   never "failed" (never counted as a failed try): if the push row is as
--   the restore found it, nothing reached the draft, so the build goes
--   back to its email and the restore is 'failed'; if it changed, part of
--   the restore may be in Klaviyo, so the build stays a draft of the same
--   campaign with the restored email, the restore is 'unknown', and the
--   results sync goes on checking the draft. Either way the owner can try
--   again. Nothing is scheduled or sent. A draft
--   the owner scheduled, sent, deleted, cancelled or changed in Klaviyo (as
--   PICK-99's sync last read it) is refused, as is an email whose day has
--   passed. Each refusal carries a stable hint.
-- * When a restore reaches the draft, the email's results row (PICK-99,
--   LRN-001) gets the restored subject, code, approach and send time in
--   `planned` (and the designs the push left), so learning credits the
--   version that is sent.
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
  -- A restore's push: pending, applied or failed (null for an email GROS made).
  outcome text check (outcome is null or outcome in ('pending', 'applied', 'failed', 'unknown')),
  failure text check (failure is null or failure ~ '^[a-z][a-z0-9_]{1,59}$'),
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
  check ((how = 'restore') = (outcome is not null)),
  check ((failure is not null) = (outcome is not distinct from 'failed' or outcome is not distinct from 'unknown')),
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

-- A restore's push: the version it puts on the draft, and the draft's own
-- email and campaign id to go back to if the push does not get there.
alter table public.email_builds
  add column restore_version uuid,
  add column restore_email jsonb
    check (restore_email is null or (jsonb_typeof(restore_email) = 'object' and octet_length(restore_email::text) <= 300000)),
  add column restore_campaign_id text
    check (restore_campaign_id is null or length(restore_campaign_id) between 1 and 200),
  -- What the push row said the draft showed when the restore began (null:
  -- no push row): unchanged when its push ends means nothing was written.
  add column restore_push jsonb
    check (restore_push is null or (jsonb_typeof(restore_push) = 'object' and octet_length(restore_push::text) <= 2000)),
  add constraint email_builds_restore_parts
    check ((restore_version is null) = (restore_email is null) and (restore_version is null) = (restore_campaign_id is null)
      and (restore_version is not null or restore_push is null)),
  add constraint email_builds_restore_push
    check (restore_version is null or (state = 'push_queued' and step = 'push'));

-- Versions kept per planned email.
create or replace function private.email_versions_kept()
returns integer language sql immutable set search_path = '' as $$ select 20 $$;

-- The current version's number of a planned email: the newest that is not
-- a pending or failed restore (null: none). It may be an unknown restore:
-- then nothing is confirmed (`restore_email_version` lets any be used).
create or replace function private.current_email_version(t uuid, run uuid, s integer)
returns integer language sql stable security definer set search_path = '' as $$
  select max(v.number) from public.email_versions v
  where v.tenant_id = t and v.run_id = run and v.slot = s and v.outcome is distinct from 'pending'
    and v.outcome is distinct from 'failed'
$$;

-- Adds one version of a planned email (the caller holds the workspace and
-- its build), then drops the oldest past the limit, never the current one.
-- Returns its number, or null when this build's output is kept already.
create or replace function private.add_email_version(b public.email_builds, made text, output jsonb,
  source integer default null, who uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  keep integer;
begin
  select coalesce(max(v.number), 0) + 1 into n from public.email_versions v
    where v.tenant_id = b.tenant_id and v.run_id = b.run_id and v.slot = b.slot;
  insert into public.email_versions as v (tenant_id, run_id, slot, number, build_id, how, restored_from, outcome,
      subject, email, created_by)
    values (b.tenant_id, b.run_id, b.slot, n, b.id, made, source,
      case when made = 'restore' then 'pending' end,
      left(coalesce(nullif(btrim(output->>'subject'), ''), 'No subject'), 500), output, who)
    on conflict (build_id) where how <> 'restore' do nothing;
  if not found then return null; end if;
  -- The current one and the newest others, 20 in all.
  keep := private.current_email_version(b.tenant_id, b.run_id, b.slot);
  delete from public.email_versions v
    where v.tenant_id = b.tenant_id and v.run_id = b.run_id and v.slot = b.slot
      and v.number is distinct from keep
      and v.number not in (select x.number from public.email_versions x
        where x.tenant_id = b.tenant_id and x.run_id = b.run_id and x.slot = b.slot and x.number is distinct from keep
        order by x.number desc
        limit private.email_versions_kept() - case when keep is null then 0 else 1 end);
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

-- A failed step, as in 090058, the workspace first (a restore's push that
-- gives up writes its version's outcome through the trigger below).
create or replace function public.fail_email_step(build uuid, lease uuid, code text,
  final boolean default false, retry_after_seconds integer default null)
returns text language plpgsql security definer set search_path='' as $$
declare
  b public.email_builds;
  give_up boolean;
  t uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs build emails' using errcode = '42501';
  end if;
  if code is null or code !~ '^[a-z][a-z0-9_]{1,59}$' then
    raise exception 'A short error code is required' using errcode = '22023';
  end if;
  if retry_after_seconds is not null and retry_after_seconds not between 1 and 86400 then
    raise exception 'Retry after 1 second to 1 day' using errcode = '22023';
  end if;
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  select * into b from public.email_builds where id = build for update;
  if not found or lease is null or b.lease_token is distinct from lease or b.lease_until < now()
     or b.state not in ('build_queued', 'push_queued') then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  give_up := coalesce(final, false)
    or (retry_after_seconds is null and b.attempts >= 3)
    or (retry_after_seconds is not null and b.waits >= 19);
  update public.email_builds
    set state = case when give_up then 'failed' else b.state end,
        -- Klaviyo asking to wait does not use up an attempt.
        attempts = case when retry_after_seconds is not null and not give_up
                        then greatest(b.attempts - 1, 0) else b.attempts end,
        waits = case when retry_after_seconds is not null then least(b.waits + 1, 20) else b.waits end,
        error_code = code,
        not_before = case when give_up or retry_after_seconds is null then null
                          else now() + make_interval(secs => retry_after_seconds) end,
        lease_token = null, lease_until = null, updated_at = now()
    where id = build;
  return case when give_up then 'failed' else 'retry' end;
end $$;

-- A restore's push ends: reached the draft (applied), or did not, for
-- good. The push row says whether anything was written: as the restore
-- found it (written, target, shown), nothing reached the draft and the
-- build goes back to it (failed); changed, part of it may be in Klaviyo,
-- so the build stays a draft of that campaign with the restored email and
-- nothing is claimed (unknown). Every way a push ends goes through here:
-- the push's finish, its refusal or last failure, and a claim that gives
-- it up (its day passed, its lease ran out three times).
create or replace function private.email_restore_ended()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  now_push jsonb;
begin
  if new.state = 'drafted' then
    update public.email_versions set outcome = 'applied' where id = old.restore_version;
    -- The results row describes the email now in the draft, and the
    -- designs the push left (a sample draft holds design A only).
    update public.klaviyo_email_results r
      set planned = (r.planned - 'subject' - 'code' - 'approach' - 'plannedSendAt' - 'designs')
        || jsonb_strip_nulls(jsonb_build_object('subject', new.email->'subject', 'code', new.email->'code',
          'approach', new.email->'approach', 'plannedSendAt', new.email->'plannedSendAt',
          'designs', case when new.sample_draft then '"A"'::jsonb
            else (select to_jsonb(p.designs) from public.klaviyo_draft_pushes p
                  where p.tenant_id = new.tenant_id and p.push_key = new.push_key) end)),
        updated_at = now()
      where r.tenant_id = new.tenant_id and r.build_id = new.id;
  else
    select jsonb_build_object('written', p.written, 'target', p.target, 'shown', p.shown) into now_push
      from public.klaviyo_draft_pushes p where p.tenant_id = new.tenant_id and p.push_key = new.push_key;
    if now_push is not distinct from old.restore_push then
      update public.email_versions set outcome = 'failed', failure = coalesce(new.error_code, 'push_failed')
        where id = old.restore_version;
      new.email := old.restore_email;
    else
      -- The restored email stays: it is what may be there; nothing is claimed.
      update public.email_versions set outcome = 'unknown', failure = coalesce(new.error_code, 'push_failed')
        where id = old.restore_version;
    end if;
    new.state := 'drafted';
    new.klaviyo_campaign_id := old.restore_campaign_id;
    new.step := 'push';
    new.error_code := null;
    new.attempts := 0;
    new.waits := 0;
    new.not_before := null;
    new.lease_token := null;
    new.lease_until := null;
  end if;
  new.restore_version := null;
  new.restore_email := null;
  new.restore_campaign_id := null;
  new.restore_push := null;
  return new;
end $$;
create trigger email_builds_restore_ended before update of state on public.email_builds
  for each row when (old.restore_version is not null and new.state is distinct from old.state)
  execute function private.email_restore_ended();

-- The owner's "Use this version": the planned email's older version made
-- the current one, as a new version, and put on its draft through the
-- push (see above). `shown`: the newest version the page showed.
-- Returns the new version's number.
create or replace function public.restore_email_version(t uuid, build uuid, version integer, shown integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b public.email_builds;
  r public.strategy_runs;
  v public.email_versions;
  newest integer;
  cur integer;
  cv public.email_versions;
  zone text;
  day date;
  seen text[];
  n integer;
  made uuid;
begin
  -- The owner only; require_member locks the workspace row (tenant first).
  -- A paused workspace's owner is refused here too (its jobs do not run).
  perform private.require_member(t, true);
  if version is null or shown is null then
    raise exception 'Choose a version' using errcode = '22023', hint = 'version_unknown';
  end if;
  select * into b from public.email_builds e where e.id = build and e.tenant_id = t for update;
  if not found then
    raise exception 'Email unavailable' using errcode = '42501', hint = 'version_no_email';
  end if;
  -- Only the latest plan, still planned (as create_email_build).
  select * into r from public.strategy_runs s where s.id = b.run_id and s.tenant_id = t;
  if not found or r.state <> 'planned' or exists (select 1 from public.strategy_runs s
       where s.tenant_id = t and s.created_at > r.created_at) then
    raise exception 'This plan has been replaced' using errcode = 'PT409', hint = 'version_plan_replaced';
  end if;
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
  -- The current version, or one it holds word for word (nothing is current
  -- while an unknown restore is the newest settled one).
  cur := private.current_email_version(t, b.run_id, b.slot);
  select * into cv from public.email_versions x
    where x.tenant_id = t and x.run_id = b.run_id and x.slot = b.slot and x.number = cur;
  if cv.outcome is distinct from 'unknown' and (v.number = cur or v.email = cv.email) then
    raise exception 'This is the current version' using errcode = '22023', hint = 'version_current';
  end if;
  -- PICK-99: what the owner did with this planned email's draft in Klaviyo
  -- (every build with its push key), as the results sync last read it.
  select array_agg(x.status || case when x.changed or x.design_changed then ':edited' else '' end) into seen
    from public.klaviyo_email_results x
    join public.email_builds e on e.tenant_id = x.tenant_id and e.id = x.build_id
    where x.tenant_id = t and e.push_key = b.push_key;
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
  -- The push of a day that has passed is given up (claim_email_build).
  select w.timezone into zone from public.tenants w where w.id = t;
  begin
    day := (r.plan->'slots'->b.slot->>'date')::date;
  exception when others then
    day := null;
  end;
  if day is null or day < (now() at time zone coalesce(zone, 'UTC'))::date then
    raise exception 'This email''s day has passed' using errcode = 'PT409', hint = 'version_day_passed';
  end if;
  n := private.add_email_version(b, 'restore', v.email, v.number, auth.uid());
  select x.id into made from public.email_versions x
    where x.tenant_id = t and x.run_id = b.run_id and x.slot = b.slot and x.number = n;
  -- Back to the push: the same key updates the same draft (a new step:
  -- its own attempts and waits). The draft's email and campaign id wait
  -- beside it until the push ends (the trigger above).
  update public.email_builds e
    set email = v.email, step = 'push', state = 'push_queued', klaviyo_campaign_id = null,
        restore_version = made, restore_email = b.email, restore_campaign_id = b.klaviyo_campaign_id,
        restore_push = (select jsonb_build_object('written', p.written, 'target', p.target, 'shown', p.shown)
          from public.klaviyo_draft_pushes p where p.tenant_id = t and p.push_key = b.push_key),
        attempts = 0, waits = 0, error_code = null, not_before = null, lease_token = null, lease_until = null,
        updated_at = now()
    where e.id = b.id;
  return n;
end $$;

revoke all on function private.email_versions_kept(), private.add_email_version(public.email_builds, text, jsonb, integer, uuid),
  private.email_build_how(public.email_builds), private.current_email_version(uuid, uuid, integer),
  private.email_restore_ended() from public, anon, authenticated, service_role;
revoke all on function public.finish_email_build(uuid, uuid, jsonb), public.fail_email_step(uuid, uuid, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.finish_email_build(uuid, uuid, jsonb), public.fail_email_step(uuid, uuid, text, boolean, integer)
  to service_role;
revoke all on function public.restore_email_version(uuid, uuid, integer, integer) from public, anon, service_role;
grant execute on function public.restore_email_version(uuid, uuid, integer, integer) to authenticated;
