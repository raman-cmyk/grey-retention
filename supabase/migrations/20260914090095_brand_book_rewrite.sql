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
--     taken back (`brand-book:withdrawn:<id>`), by any path.
--   A write that has not started yet covers every later change (it reads
--   everything when it runs), so a waiting write is reused and made due
--   now instead of adding another: at most one waiting write a workspace.
--   A write already running may have read before the change, so a new one
--   is queued behind it. The key makes a repeated cause idempotent.
-- * The app runs the write right after the click (`after()`, the worker's
--   client); the onboarding readers' run picks up any left behind. Leased
--   (60 s), at most four tries (`fail_job`'s back-off), a stale lease is
--   recovered, and never two writes of one workspace at once (a later
--   save could otherwise put an older book on top). Writing an unchanged
--   book saves nothing (`saveBrandBook`), so running a write twice is safe.
--   The fixture sweep (`claim_job`) no longer takes these jobs.
-- * `correct_brand_book_at` and `withdraw_brand_book_correction_at`: the
--   owner only (not admins), with the Brand book version the page showed
--   (a newer book is `PT409`, hint `brand_book_changed`); several
--   corrections in one call are all or nothing. The checks of
--   `correct_brand_book` (ONB-058) are unchanged and still apply.
-- * `retry_brand_book_write`: the owner's Try again after a failed or
--   stuck write.
-- * Members read the jobs as before (`job_runs` tenant read); claiming and
--   finishing are the worker's only.
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
-- workspace lock). A waiting write is reused and made due now; otherwise
-- a new one is added under its key (once per cause). Null when nobody can
-- be named as its creator (a change made by the worker itself).
create or replace function private.queue_brand_book_write(t uuid, cause text, ref text, who uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare j uuid; key text := 'brand-book:' || cause || ':' || ref;
begin
  select r.id into j from public.job_runs r
    where r.tenant_id = t and r.kind = 'brand.write_book' and r.status in ('queued', 'retry_wait') and r.attempt < 4
    order by r.created_at desc limit 1 for update;
  if j is not null then
    update public.job_runs set status = 'queued', available_at = now(), updated_at = now() where id = j;
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

-- Approving a brand version rewrites the book: the owner's approved words
-- are in a book only while the approved version is the current one.
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
    perform public.correct_brand_book(t, c->>'section', c->>'original', c->>'action', c->>'value');
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
  perform public.withdraw_brand_book_correction(t, correction);
end $$;

-- Try again: a rewrite that failed, is waiting to try again or never
-- started is due now. A write running under a live lease is left alone.
create or replace function public.retry_brand_book_write(t uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare last public.job_runs;
begin
  perform private.require_member(t, true);
  select * into last from public.job_runs r where r.tenant_id = t and r.kind = 'brand.write_book'
    order by r.created_at desc limit 1;
  if last.id is not null and last.status in ('leased', 'running') and last.lease_until > now() then
    return last.id;
  end if;
  return private.queue_brand_book_write(t, 'retry', coalesce(last.id::text, 'first'), auth.uid());
end $$;

-- The worker takes one due rewrite (of one workspace when `t` is given),
-- never while another rewrite of the same workspace holds a live lease.
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

-- The worker finishes a rewrite under its lease; `book_version` is the
-- newest version afterwards (null: no book, e.g. a real store with only
-- sample data). A failed try goes through `fail_job` as every job's does.
create or replace function public.finish_brand_book_write(job uuid, lease uuid, book_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare t uuid; j public.job_runs;
begin
  perform private.require_service();
  select r.tenant_id into t from public.job_runs r where r.id = job;
  if t is null then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  perform 1 from public.tenants where id = t for update;
  select * into j from public.job_runs where id = job for update;
  if j.kind <> 'brand.write_book' or j.status <> 'running' or j.lease_token is distinct from lease
    or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  update public.job_runs set status = 'succeeded', checkpoint = jsonb_build_object('version', book_version),
      lease_token = null, lease_until = null, failure_class = null, error_code = null, updated_at = now()
    where id = j.id;
end $$;

-- The rewrites waiting across the workspaces (the readers' run's peek).
create or replace function public.brand_book_writes_waiting() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.job_runs r
    join public.tenants w on w.id = r.tenant_id and w.status = 'active'
    where r.kind = 'brand.write_book'
      and ((r.status in ('queued', 'retry_wait') and r.attempt < 4 and r.available_at <= now())
        or (r.status in ('leased', 'running') and r.lease_until < now()))
$$;

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

revoke all on function public.correct_brand_book_at(uuid, integer, jsonb) from public, anon, service_role;
grant execute on function public.correct_brand_book_at(uuid, integer, jsonb) to authenticated;
revoke all on function public.withdraw_brand_book_correction_at(uuid, integer, uuid) from public, anon, service_role;
grant execute on function public.withdraw_brand_book_correction_at(uuid, integer, uuid) to authenticated;
revoke all on function public.retry_brand_book_write(uuid) from public, anon, service_role;
grant execute on function public.retry_brand_book_write(uuid) to authenticated;
revoke all on function public.claim_brand_book_write(uuid) from public, anon, authenticated;
grant execute on function public.claim_brand_book_write(uuid) to service_role;
revoke all on function public.finish_brand_book_write(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.finish_brand_book_write(uuid, uuid, integer) to service_role;
revoke all on function public.brand_book_writes_waiting() from public, anon, authenticated;
grant execute on function public.brand_book_writes_waiting() to service_role;
