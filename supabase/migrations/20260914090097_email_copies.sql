-- DES-ENGINE-002b2 (step 2 of the email design plan, owner decisions of 25
-- Nov): "Use this design" with Copy copies the chosen inspiration email 1:1
-- in structure for the brand. The copy needs a browser (photos cut, the
-- email drawn, measured and checked), so the build's design step asks for
-- it and waits, like the design studio's pictures (DST-006b), and a
-- browser job outside the app makes it (`scripts/design-copies.mjs`).
--
-- * email_copies: one per build (its design step), written only through
--   its commands. `input` is what the copy needs (the brand, its products,
--   its words and rules; never an address to fetch photos from: those are
--   the server's fixed list); `result` the drawn email (cut photos as
--   placeholders until the app signs their links), each section's outcome
--   and why, the leak check, and each stored photo's path, tag and size.
--   Members of the workspace read their own copies (and operators every
--   copy); nobody in a browser writes one.
-- * Job kind `design.copy`, leased like every platform job (4 tries), but
--   claimed through `claim_email_copy`, whose lease is 10 minutes (photos
--   are fetched and cut, and the email drawn up to 6 times); a job of a
--   workspace that is not active waits an hour, no try counted.
-- * Its cut photos go to the private bucket `email-copies`, at
--   `<workspace>/<build>/<lease>/<n>.jpg` (JPEG, at most 3 MiB), through
--   signed upload links that never overwrite; nobody in a browser reads or
--   writes the bucket. A copy is recorded only when every photo it names is
--   stored under its own claim's folder, and `result.stored` pins each one
--   (path, tag, size): a stale claim cannot change a recorded photo, and
--   the app checks the tag again before it signs a link. The push imports
--   them into Klaviyo (rule 11). `cleaned_at`: the photos were removed
--   (`clean_email_copy`, once the email no longer needs them).
-- * Recording a copy (or its job failing for good) brings the build's
--   design step forward (`not_before` now), so the next claim goes on.
-- * Tenant first, then the build or copy (as every build-leased command).
-- * The number is chosen at merge time (D24).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('email-copies', 'email-copies', false, 3145728, array['image/jpeg'])
  on conflict (id) do nothing;

create table public.email_copies (
  build_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  inbox_message_id uuid not null references public.inbox_messages(id),
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  input jsonb not null check (jsonb_typeof(input) = 'object' and octet_length(input::text) <= 300000),
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 400000)),
  failure text check (failure ~ '^[a-z0-9_]{1,60}$'),
  photos integer not null default 0 check (photos between 0 and 24),
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, build_id) references public.email_builds (tenant_id, id) on delete cascade,
  check ((state = 'done') = (result is not null)),
  check ((state = 'failed') = (failure is not null))
);
create index email_copies_tenant on public.email_copies (tenant_id, created_at desc);
create index email_copies_to_clean on public.email_copies (updated_at) where cleaned_at is null and state <> 'queued';
alter table public.email_copies enable row level security;
create policy email_copies_member_read on public.email_copies for select to authenticated
  using (private.is_active_member(tenant_id) or (select private.is_operator()));
revoke all on public.email_copies from public, anon, authenticated, service_role;
grant select on public.email_copies to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_copies from public, anon, authenticated, service_role';
  end if;
end $$;

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview','inbox.blueprint','design.copy'));

-- Only jobs (the service role) run the copy commands.
create or replace function private.copy_job_role()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs copy emails' using errcode = '42501';
  end if;
end $$;
revoke all on function private.copy_job_role() from public, anon, authenticated, service_role;

-- The design step asks for its copy (under its live lease). The first ask
-- stores the input and queues the job; later asks only read the state.
-- Returns {state, result, failure, photos}.
create or replace function public.request_email_copy(build uuid, lease uuid, message uuid, input jsonb,
  photos integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.email_builds; c public.email_copies; t uuid;
begin
  perform private.copy_job_role();
  -- Tenant first, then the build (as every build-leased command).
  select e.tenant_id into t from public.email_builds e where e.id = build;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for share;
  b := private.leased_email_build(build, lease, 'build_queued');
  if b.step is distinct from 'design' then
    raise exception 'Only the design step copies an email' using errcode = 'PT409', detail = 'not_design_step';
  end if;
  select * into c from public.email_copies where build_id = build;
  if not found then
    if message is null or input is null or jsonb_typeof(input) <> 'object' or octet_length(input::text) > 300000 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if photos is null or photos not between 0 and 24 then
      raise exception 'Invalid copy input' using errcode = '22023';
    end if;
    if not exists (select 1 from public.inbox_blueprints p where p.inbox_message_id = message and p.version = 1
                   and p.state = 'ready') then
      raise exception 'The inspiration email has no blueprint' using errcode = 'PT409', detail = 'no_blueprint';
    end if;
    insert into public.email_copies(build_id, tenant_id, inbox_message_id, input, photos)
      values (build, b.tenant_id, message, input, photos)
      returning * into c;
    insert into public.platform_jobs(kind, subject_key, idempotency_key)
      values ('design.copy', build::text, 'design.copy:' || build)
      on conflict do nothing;
  elsif c.inbox_message_id is distinct from message then
    raise exception 'This build copies another email' using errcode = 'PT409', detail = 'other_email';
  end if;
  return jsonb_build_object('state', c.state, 'result', c.result, 'failure', c.failure, 'photos', c.photos);
end $$;
revoke all on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.request_email_copy(uuid, uuid, uuid, jsonb, integer) to service_role;

-- The browser job's claim: one copy job of an active workspace, leased for
-- 10 minutes. A job of a paused or closed workspace waits an hour and its
-- try is given back (the next job is looked at).
create or replace function public.claim_email_copy()
returns table (id uuid, subject_key text, lease_token uuid, attempt integer)
language plpgsql security definer set search_path='' as $$
declare j record; active boolean;
begin
  perform private.copy_job_role();
  for i in 1..10 loop
    select c.id, c.subject_key, c.lease_token, c.attempt into j
      from public.claim_platform_job(array['design.copy']) c;
    if j.id is null then return; end if;
    select coalesce(w.status = 'active', false) into active
      from public.email_copies x join public.tenants w on w.id = x.tenant_id
      where j.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and x.build_id = j.subject_key::uuid;
    -- No copy row: handed out, and the job's side settles it.
    if active is distinct from false then
      update public.platform_jobs p set lease_expires_at = now() + interval '10 minutes', updated_at = now()
        where p.id = j.id and p.lease_token = j.lease_token;
      return query select j.id, j.subject_key, j.lease_token, j.attempt;
      return;
    end if;
    update public.platform_jobs p
      set status = 'retry_wait', lease_token = null, lease_expires_at = null,
          attempt = greatest(0, p.attempt - 1), last_error_code = 'workspace_inactive',
          available_at = now() + interval '1 hour', updated_at = now()
      where p.id = j.id;
  end loop;
end $$;
revoke all on function public.claim_email_copy() from public, anon, authenticated;
grant execute on function public.claim_email_copy() to service_role;

-- The browser job's result: the copy, or a reason it could not be made.
-- Once per build. Every photo it names must be stored under this claim's
-- own folder (`<workspace>/<build>/<lease>/<n>.jpg`, n below the build's
-- `photos`); each is pinned in `result.stored` with its tag and size.
-- Finishes the job and brings the design step forward.
create or replace function public.record_email_copy(job uuid, lease uuid, result jsonb default null,
  failure text default null)
returns text language plpgsql security definer set search_path='' as $$
declare j public.platform_jobs; build uuid; c public.email_copies; n jsonb; t uuid; o storage.objects;
  stored jsonb := '[]'::jsonb; path text;
begin
  perform private.copy_job_role();
  -- Tenant first, then the job and the copy.
  select x.tenant_id into t from public.platform_jobs p join public.email_copies x
    on p.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and x.build_id = p.subject_key::uuid
    where p.id = job and p.kind = 'design.copy';
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.copy' then raise exception 'Not a copy job' using errcode = '23514'; end if;
  build := j.subject_key::uuid;
  if (result is null) = (failure is null) then
    raise exception 'Give a result or a failure' using errcode = '23514';
  end if;
  if failure is not null and failure !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  if result is not null and (jsonb_typeof(result) <> 'object' or octet_length(result::text) > 400000
     or jsonb_typeof(result->'html') is distinct from 'string' or jsonb_typeof(result->'sections') is distinct from 'array'
     or jsonb_typeof(result->'photos') is distinct from 'array') then
    raise exception 'Invalid copy' using errcode = '23514';
  end if;
  select * into c from public.email_copies where build_id = build for update;
  if not found then
    raise exception 'The copy is gone' using errcode = 'PT409', detail = 'copy_gone';
  end if;
  if result is not null then
    for n in select * from jsonb_array_elements(result->'photos') loop
      if jsonb_typeof(n) <> 'number' or (n #>> '{}') !~ '^[0-9]{1,2}$' or (n #>> '{}')::integer >= c.photos then
        raise exception 'Invalid copy photo' using errcode = '23514';
      end if;
      path := c.tenant_id || '/' || c.build_id || '/' || lease || '/' || (n #>> '{}') || '.jpg';
      select * into o from storage.objects s where s.bucket_id = 'email-copies' and s.name = path;
      if not found or coalesce(o.metadata->>'eTag', '') = '' then
        raise exception 'Stored photo missing' using errcode = '23514';
      end if;
      stored := stored || jsonb_build_array(jsonb_build_object('index', (n #>> '{}')::integer, 'path', path,
        'etag', o.metadata->>'eTag', 'size', (o.metadata->>'size')::bigint));
    end loop;
  end if;
  update public.email_copies
    set state = case when record_email_copy.result is null then 'failed' else 'done' end,
        result = case when record_email_copy.result is null then null
                      else record_email_copy.result || jsonb_build_object('stored', stored) end,
        failure = record_email_copy.failure, updated_at = now()
    where build_id = build and state = 'queued';
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', case when record_email_copy.result is null then 'failed' else 'done' end),
        finished_at = now(), updated_at = now()
    where id = j.id;
  -- The waiting design step goes on at the next claim.
  update public.email_builds set not_before = now(), updated_at = now()
    where id = build and state = 'build_queued' and step = 'design' and not_before > now();
  return (select x.state from public.email_copies x where x.build_id = build);
end $$;
revoke all on function public.record_email_copy(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_email_copy(uuid, uuid, jsonb, text) to service_role;

-- A browser job on another engine version hands its job back: it waits 10
-- minutes, no try is counted and nothing is recorded.
create or replace function public.release_email_copy(job uuid, lease uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  perform private.copy_job_role();
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.copy' then raise exception 'Not a copy job' using errcode = '23514'; end if;
  update public.platform_jobs
    set status = 'retry_wait', lease_token = null, lease_expires_at = null,
        attempt = greatest(0, j.attempt - 1), last_error_code = 'version_skew',
        available_at = now() + interval '10 minutes', updated_at = now()
    where id = j.id;
end $$;
revoke all on function public.release_email_copy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_email_copy(uuid, uuid) to service_role;

-- The app removed a copy's photos (the email no longer needs them).
create or replace function public.clean_email_copy(build uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.copy_job_role();
  update public.email_copies set cleaned_at = now()
    where build_id = build and state <> 'queued' and cleaned_at is null;
end $$;
revoke all on function public.clean_email_copy(uuid) from public, anon, authenticated;
grant execute on function public.clean_email_copy(uuid) to service_role;

-- A job that failed four times (its tries, or its leases running out)
-- leaves its copy failed (the design step then draws coded blocks and says
-- why). A job whose key is no build's (only a server bug could make one)
-- is left alone: this runs inside every job claim's lease recovery, which
-- must never stop on it.
create or replace function private.fail_email_copy()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.kind = 'design.copy' and new.status = 'failed' and old.status is distinct from 'failed'
     and new.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.email_copies set state = 'failed', failure = 'copy_job_failed', updated_at = now()
      where build_id = new.subject_key::uuid and state = 'queued';
    update public.email_builds set not_before = now(), updated_at = now()
      where id = new.subject_key::uuid and state = 'build_queued' and step = 'design' and not_before > now();
  end if;
  return null;
end $$;
revoke all on function private.fail_email_copy() from public, anon, authenticated, service_role;
create trigger fail_email_copy after update of status on public.platform_jobs
  for each row when (new.kind = 'design.copy' and new.status = 'failed')
  execute function private.fail_email_copy();

-- The design studio's claim (DST-006b) never takes a design step waiting
-- for its library copy, nor one waiting for its blueprint to be measured
-- (its saved work says `library`; no copy row yet) before its time: the
-- copy's own record brings that step forward, for the ordinary claims.
-- Otherwise as in 090079.
create or replace function public.claim_studio_build(target uuid default null)
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
      where e.state = 'build_queued' and e.step = 'design'
        -- Waiting for its pictures (DST-006b).
        and e.waits > 0 and e.not_before is not null and e.error_code is null
        and (e.lease_until is null or e.lease_until < now())
        -- A failed step waits a minute before its next try.
        and (e.attempts = 0 or e.updated_at < now() - interval '1 minute')
        -- Every picture and view it asked for is drawn or failed, or its time is up.
        and (e.not_before <= now() or (
          not exists (select 1 from public.section_renders r where r.build_id = e.id and r.state = 'queued')
          and not exists (select 1 from public.email_renders v where v.build_id = e.id and v.state = 'queued')))
        -- DES-ENGINE-002b2: never a step waiting for its library copy.
        and not exists (select 1 from public.email_copies c where c.build_id = e.id and c.state = 'queued')
        and not coalesce(e.progress->'work'->'design' ? 'library' and e.not_before > now()
                 and not exists (select 1 from public.email_copies c where c.build_id = e.id and c.state <> 'queued'), false)
        and exists (select 1 from public.tenants w where w.id = e.tenant_id and w.status = 'active')
        and (target is null or e.id = target)
      order by e.updated_at, e.id
      limit 1
      for update skip locked;
    if not found then return; end if;
    -- As `claim_email_build`: a planned day that has passed (store time)
    -- needs no draft any more, and a step out of tries is not tried again.
    begin
      select (s.plan->'slots'->b.slot->>'date')::date < (now() at time zone coalesce(w.timezone, 'UTC'))::date
        into passed
        from public.strategy_runs s, public.tenants w
        where s.id = b.run_id and w.id = b.tenant_id;
    exception when others then
      passed := true;
    end;
    passed := coalesce(passed, true);
    exit when b.attempts < 3 and not passed;
    update public.email_builds e
      set state = 'failed', error_code = case when passed then 'day_passed' else 'step_timed_out' end,
          lease_token = null, lease_until = null, updated_at = now()
      where e.id = b.id;
  end loop;
  update public.email_builds e
    set attempts = e.attempts + 1, lease_token = lease, lease_until = now() + interval '5 minutes', updated_at = now()
    where e.id = b.id;
  return query
    select b.id, b.tenant_id, b.state, b.step, b.progress, b.run_id, b.slot, s.plan->'slots'->b.slot,
      b.email, b.push_key, coalesce(w.timezone, 'UTC'), s.start_on, lease
    from public.strategy_runs s, public.tenants w
    where s.id = b.run_id and w.id = b.tenant_id;
end $$;

revoke all on function public.claim_studio_build(uuid) from public, anon, authenticated;
grant execute on function public.claim_studio_build(uuid) to service_role;
