-- UI-BRAND-2 (owner decisions of 25 Nov 2026): approving the brand rewrites
-- the Brand book right away, and the owner types corrections straight into
-- the Brand book.
--
-- * A new job kind, `brand.write_book`: one rewrite of a workspace's Brand
--   book from what is stored (the readers' findings, the catalog, the
--   approved brand and the owner's corrections, ONB-058b). It is queued in
--   the same transaction as the change that needs it:
--   - the owner approves a brand version (`approve_brand` sets a new
--     `approved_revision`), key `brand-book:approved:<revision>`;
--   - a Brand book correction is made (`brand-book:corrected:<id>`) or
--     taken back (`brand-book:withdrawn:<id>`);
--   - the onboarding readers' run after a read, or to catch up a stale
--     book (`queue_brand_book_write_as_worker`), so every book the code
--     writes goes through the same fenced save.
--   A write that has not started yet covers every later change (it reads
--   everything when it runs), so a waiting write is reused and made due
--   now: at most one waiting write a workspace. The owner's own change
--   (approve, a correction, take back, Try again) gives it its full tries
--   again; the worker's (a read, a stale book) never does, so retries stay
--   bounded. A write already running may have read before the change,
--   so a new one is queued behind it. The key makes a repeated cause
--   idempotent.
-- * Leased (60 s), at most four tries (`fail_job`'s back-off, the worker's
--   only for this kind), a stale lease is recovered, and never two writes
--   of one workspace at once; a workspace with a write running never holds
--   up the others. The book is saved by `finish_brand_book_write` under
--   the lease and the workspace lock, only on top of the version the
--   write read (a newer one is `PT409`, tried again): a write that lost
--   its lease, or read before a newer book, never saves. The fixture sweep
--   (`claim_job`) no longer takes these jobs.
-- * The owner's commands are the owner's only (not admins), here and for
--   ONB-058's `correct_brand_book` and `withdraw_brand_book_correction`
--   (made owner only: what they write reaches the agents as the owner's
--   own words). `correct_brand_book_at` and
--   `withdraw_brand_book_correction_at` take the Brand book version the
--   page showed (a newer one is `PT409`, hint `brand_book_changed`);
--   several corrections in one call are all or nothing.
-- * `retry_brand_book_write`: the owner's Try again after a failed or
--   stuck write.
-- * Members read the jobs as before (`job_runs` tenant read); claiming,
--   finishing and failing are the worker's only.
-- * The number is chosen at merge time (D24).

alter table public.job_runs drop constraint job_runs_kind_check,
  add constraint job_runs_kind_check check (kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule',
    'assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan',
    'reviews.remind','design.render','ops.health','results.pull','reports.digest','learning.synthesize','optimizer.winback',
    'optimizer.suppress','email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history',
    'brand.read_ads','brand.read_reviews','brand.write_book'));

create index job_runs_brand_book_writes on public.job_runs (tenant_id, created_at)
  where kind = 'brand.write_book';

-- Queues a rewrite of the workspace's Brand book (the caller holds the
-- workspace lock). A waiting write is reused: due now, with its full
-- tries again only for the owner's own change. Otherwise a new one is
-- added under its key (once per cause). Null when nobody can be named as
-- its creator.
create or replace function private.queue_brand_book_write(t uuid, cause text, ref text, who uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j uuid; key text := 'brand-book:' || cause || ':' || ref;
begin
  select r.id into j from public.job_runs r
    where r.tenant_id = t and r.kind = 'brand.write_book' and r.status in ('queued', 'retry_wait')
    order by r.created_at desc limit 1 for update;
  if j is not null then
    update public.job_runs set status = 'queued',
        attempt = case when cause in ('approved', 'corrected', 'withdrawn', 'retry') then 0 else attempt end,
        available_at = now(), failure_class = null, error_code = null, updated_at = now()
      where id = j;
    return j;
  end if;
  if who is null then return null; end if;
  insert into public.job_runs (tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'brand.write_book', key, jsonb_build_object('cause', cause), who)
    on conflict (tenant_id, idempotency_key) do nothing
    returning id into j;
  if j is null then
    select r.id into j from public.job_runs r where r.tenant_id = t and r.idempotency_key = key;
  end if;
  return j;
end $$;
revoke all on function private.queue_brand_book_write(uuid, text, text, uuid) from public, anon, authenticated, service_role;

-- Whom a rewrite the worker queues is created for: the workspace's first
-- active owner, else its first active member (active profiles only).
create or replace function private.workspace_actor(t uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.profile_id from public.tenant_memberships m
    join public.profiles p on p.id = m.profile_id and p.status = 'active'
    where m.tenant_id = t and m.status = 'active'
    order by (m.role = 'owner') desc, m.created_at, m.profile_id
    limit 1
$$;
revoke all on function private.workspace_actor(uuid) from public, anon, authenticated, service_role;

-- The readers' run queues a rewrite after a read or for a stale book.
create or replace function public.queue_brand_book_write_as_worker(t uuid, cause text, ref text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_service();
  if cause is null or cause !~ '^[a-z]{1,20}$' or ref is null or char_length(ref) not between 1 and 100 then
    raise exception 'Invalid Brand book rewrite' using errcode = '23514';
  end if;
  perform 1 from public.tenants where id = t and status = 'active' for update;
  if not found then return null; end if;
  return private.queue_brand_book_write(t, cause, ref, private.workspace_actor(t));
end $$;

-- Approving a brand version rewrites the book: it carries the owner's
-- approved words.
create or replace function private.brand_book_after_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.approved_revision is not null and new.approved_revision is distinct from old.approved_revision then
    perform private.queue_brand_book_write(new.tenant_id, 'approved', new.approved_revision::text,
      coalesce(auth.uid(), new.approved_by));
  end if;
  return null;
end $$;
revoke all on function private.brand_book_after_approval() from public, anon, authenticated, service_role;
create trigger brand_book_rewrite_on_approval after update of approved_revision on public.brand_profiles
  for each row execute function private.brand_book_after_approval();

-- A correction made or taken back rewrites the book. A correction withdrawn
-- because a newer one replaced it comes with that newer one's insert.
create or replace function private.brand_book_after_correction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.queue_brand_book_write(new.tenant_id, 'corrected', new.id::text, coalesce(auth.uid(), new.created_by));
  elsif old.withdrawn_at is null and new.withdrawn_at is not null and not new.replaced then
    perform private.queue_brand_book_write(new.tenant_id, 'withdrawn', new.id::text, coalesce(auth.uid(), new.created_by));
  end if;
  return null;
end $$;
revoke all on function private.brand_book_after_correction() from public, anon, authenticated, service_role;
create trigger brand_book_rewrite_on_correction after insert or update of withdrawn_at on public.brand_book_corrections
  for each row execute function private.brand_book_after_correction();

-- ONB-058's commands, the owner's only: their checks move, unchanged, to
-- private functions; the public commands check the owner first.
alter function public.correct_brand_book(uuid, text, text, text, text) rename to correct_brand_book_checked;
alter function public.correct_brand_book_checked(uuid, text, text, text, text) set schema private;
revoke all on function private.correct_brand_book_checked(uuid, text, text, text, text) from public, anon, authenticated, service_role;
alter function public.withdraw_brand_book_correction(uuid, uuid) rename to withdraw_brand_book_correction_checked;
alter function public.withdraw_brand_book_correction_checked(uuid, uuid) set schema private;
revoke all on function private.withdraw_brand_book_correction_checked(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.correct_brand_book(t uuid, book_section text, book_original text,
  book_action text, book_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  return private.correct_brand_book_checked(t, book_section, book_original, book_action, book_value);
end $$;

create or replace function public.withdraw_brand_book_correction(t uuid, correction uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  perform private.withdraw_brand_book_correction_checked(t, correction);
end $$;

-- The newest Brand book version the page showed is still the newest.
create or replace function private.require_brand_book_version(t uuid, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if expected_version is null or expected_version < 0
    or coalesce((select max(b.version) from public.brand_books b where b.tenant_id = t), 0) <> expected_version then
    raise exception 'Brand book changed' using errcode = 'PT409', hint = 'brand_book_changed';
  end if;
end $$;
revoke all on function private.require_brand_book_version(uuid, integer) from public, anon, authenticated, service_role;

-- The owner's corrections typed into the Brand book: owner only, against
-- the version he read, all or nothing (1 to 10 corrections, each checked by
-- `correct_brand_book`). Returns how many were made.
create or replace function public.correct_brand_book_at(t uuid, expected_version integer, corrections jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare c jsonb; n integer := 0;
begin
  perform private.require_member(t, true);
  if corrections is null or jsonb_typeof(corrections) <> 'array'
    or jsonb_array_length(corrections) not between 1 and 10 then
    raise exception 'Invalid Brand book correction' using errcode = '23514';
  end if;
  perform private.require_brand_book_version(t, expected_version);
  for c in select value from jsonb_array_elements(corrections) loop
    if jsonb_typeof(c) <> 'object' then
      raise exception 'Invalid Brand book correction' using errcode = '23514';
    end if;
    perform private.correct_brand_book_checked(t, c->>'section', c->>'original', c->>'action', c->>'value');
    n := n + 1;
  end loop;
  return n;
end $$;

-- The owner takes one of his corrections back, against the version he read.
create or replace function public.withdraw_brand_book_correction_at(t uuid, expected_version integer, correction uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  perform private.require_brand_book_version(t, expected_version);
  perform private.withdraw_brand_book_correction_checked(t, correction);
end $$;

-- Try again: a rewrite that failed, is waiting to try again, lost its
-- lease or never started is due now. A write running under a live lease
-- is left alone.
create or replace function public.retry_brand_book_write(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare last public.job_runs;
begin
  perform private.require_member(t, true);
  select * into last from public.job_runs r where r.tenant_id = t and r.kind = 'brand.write_book'
    order by r.created_at desc limit 1 for update;
  if last.id is not null and last.status in ('leased', 'running') then
    if last.lease_until > now() then return last.id; end if;
    -- A lost lease: the write is waiting again (and is reused below).
    update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null,
        lease_until = null, error_code = 'stale_lease', updated_at = now()
      where id = last.id;
  end if;
  return private.queue_brand_book_write(t, 'retry', coalesce(last.id::text, 'first'), auth.uid());
end $$;

-- The worker takes one due rewrite (of one workspace when `t` is given),
-- never while another rewrite of the same workspace holds a live lease,
-- and never stuck behind such a workspace.
create or replace function public.claim_brand_book_write(t uuid default null) returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare candidate uuid; tenant uuid; j public.job_runs;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  select r.id, r.tenant_id into candidate, tenant from public.job_runs r
    join public.tenants w on w.id = r.tenant_id and w.status = 'active'
    where r.kind = 'brand.write_book' and (t is null or r.tenant_id = t)
      and ((r.status in ('queued', 'retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased', 'running') and r.lease_until < now()))
      and not exists (select 1 from public.job_runs o where o.tenant_id = r.tenant_id and o.kind = 'brand.write_book'
        and o.status in ('leased', 'running') and o.lease_until >= now())
    order by r.available_at, r.created_at limit 1;
  if candidate is null then return; end if;
  perform 1 from public.tenants where id = tenant and status = 'active' for update;
  if not found then return; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null,
      lease_until = null, available_at = now(), error_code = 'stale_lease', updated_at = now()
    where tenant_id = tenant and kind = 'brand.write_book' and status in ('leased', 'running') and lease_until < now();
  if exists (select 1 from public.job_runs o where o.tenant_id = tenant and o.kind = 'brand.write_book'
      and o.status in ('leased', 'running') and o.lease_until >= now()) then
    return;
  end if;
  select * into j from public.job_runs
    where id = candidate and status in ('queued', 'retry_wait') and attempt < 4 and available_at <= now()
    for update skip locked;
  if j.id is null then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '60 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

-- The worker finishes a rewrite under its lease and the workspace lock:
-- with `content`, the new book is saved on top of `based_on` (the newest
-- version the write read; a newer one is `PT409`, so the write is tried
-- again from it); without, the book did not change (or a real store has
-- only sample data). Returns the newest version afterwards (null: none).
create or replace function public.finish_brand_book_write(job uuid, lease uuid, based_on integer, content jsonb,
  written_by text) returns integer
language plpgsql security definer set search_path = '' as $$
declare t uuid; j public.job_runs; v integer;
begin
  perform private.require_service();
  select r.tenant_id into t from public.job_runs r where r.id = job;
  if t is null then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  -- An active workspace only, as `save_brand_book`.
  perform 1 from public.tenants where id = t and status = 'active' for update;
  if not found then raise exception 'Active workspace required' using errcode = '42501'; end if;
  select * into j from public.job_runs where id = job for update;
  if j.kind <> 'brand.write_book' or j.status <> 'running' or j.lease_token is distinct from lease
    or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  select max(b.version) into v from public.brand_books b where b.tenant_id = t;
  if coalesce(v, 0) <> coalesce(based_on, -1) then
    raise exception 'Brand book changed' using errcode = 'PT409', hint = 'brand_book_changed';
  end if;
  if content is not null then
    if jsonb_typeof(content) <> 'object' or written_by is null or written_by !~ '^[a-z-]{1,40}@[0-9]{1,4}$' then
      raise exception 'Invalid Brand book' using errcode = '23514';
    end if;
    v := coalesce(v, 0) + 1;
    insert into public.brand_books (tenant_id, version, content, written_by) values (t, v, content, written_by);
  end if;
  update public.job_runs set status = 'succeeded', checkpoint = jsonb_build_object('version', v),
      lease_token = null, lease_until = null, failure_class = null, error_code = null, updated_at = now()
    where id = j.id;
  return v;
end $$;

-- The rewrites waiting across the workspaces (the readers' run's peek).
create or replace function public.brand_book_writes_waiting() returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_service();
  return (select count(*)::integer from public.job_runs r
    join public.tenants w on w.id = r.tenant_id and w.status = 'active'
    where r.kind = 'brand.write_book'
      and ((r.status in ('queued', 'retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased', 'running') and r.lease_until < now())));
end $$;

-- A rewrite's lease is the worker's only: as 20260914090062, with
-- `brand.write_book` beside the source reads (members read the lease
-- token through `job_runs`).
create or replace function private.onboarding_lease(job uuid, lease uuid)
returns public.job_runs language plpgsql security definer set search_path = '' as $$
declare j public.job_runs; t uuid;
begin
  select tenant_id into t from public.job_runs where id = job;
  if t is null or not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  select * into j from public.job_runs where id = job for update;
  if j.kind in ('email.rewrite','email.import') then raise exception 'Access denied' using errcode = '42501'; end if;
  if j.kind in ('brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads','brand.read_reviews',
      'brand.write_book')
    and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if j.status <> 'running' or j.lease_token is distinct from lease or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  return j;
end $$;

-- The fixture sweep never takes a rewrite: as 20260914090062, with
-- `brand.write_book` left to its own claim.
create or replace function public.claim_job(t uuid) returns setof public.job_runs
language plpgsql security definer set search_path = '' as $$
declare j public.job_runs;
begin
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if not private.worker_access(t) then raise exception 'Access denied' using errcode = '42501'; end if;
  update public.job_runs set status = case when attempt >= 4 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease'
    where tenant_id = t and status in ('leased','running') and lease_until < now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads',
        'brand.read_reviews','brand.write_book');
  select * into j from public.job_runs
    where tenant_id = t and status in ('queued','retry_wait') and attempt < 4 and available_at <= now()
      and kind not in ('email.rewrite','email.import','brand.read_site','brand.read_catalog','brand.read_history','brand.read_ads',
        'brand.read_reviews','brand.write_book')
    order by available_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.job_runs set status = 'running', attempt = attempt + 1, lease_token = gen_random_uuid(),
      lease_until = now() + interval '90 seconds', updated_at = now()
    where id = j.id returning *;
end $$;

revoke all on function public.correct_brand_book(uuid, text, text, text, text) from public, anon, service_role;
grant execute on function public.correct_brand_book(uuid, text, text, text, text) to authenticated;
revoke all on function public.withdraw_brand_book_correction(uuid, uuid) from public, anon, service_role;
grant execute on function public.withdraw_brand_book_correction(uuid, uuid) to authenticated;
revoke all on function public.correct_brand_book_at(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.correct_brand_book_at(uuid, integer, jsonb) to authenticated;
revoke all on function public.withdraw_brand_book_correction_at(uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.withdraw_brand_book_correction_at(uuid, integer, uuid) to authenticated;
revoke all on function public.retry_brand_book_write(uuid) from public, anon, service_role;
grant execute on function public.retry_brand_book_write(uuid) to authenticated;
revoke all on function public.queue_brand_book_write_as_worker(uuid, text, text) from public, anon, authenticated;
grant execute on function public.queue_brand_book_write_as_worker(uuid, text, text) to service_role;
revoke all on function public.claim_brand_book_write(uuid) from public, anon, authenticated;
grant execute on function public.claim_brand_book_write(uuid) to service_role;
revoke all on function public.finish_brand_book_write(uuid, uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_brand_book_write(uuid, uuid, integer, jsonb, text) to service_role;
revoke all on function public.brand_book_writes_waiting() from public, anon, authenticated;
grant execute on function public.brand_book_writes_waiting() to service_role;
