-- PICK-99 (owner pick #99, "Draft status sync"): what the results sync
-- (LRN-001) already reads about each email GROS put into Klaviyo, now
-- kept whole enough to show it in plain words and to keep GROS from ever
-- replacing the owner's work:
--
-- * `scheduled_for`: when Klaviyo will send it, while it is scheduled (or
--   sending), and `send_strategy`, how (`static`, `local_timezone`…), so
--   the page can say "Scheduled in Klaviyo for 14 Jan, 9:00 (store time)".
--   Cleared once it is no longer scheduled or sending.
-- * `design_changed`: its design (a template's HTML, or another template
--   on a variation) was changed in Klaviyo since GROS pushed it, seen by
--   comparing the template with the fingerprint the push stored
--   (`klaviyo_draft_pushes.shown`). Like `changed` (its subject, preview
--   or campaign), once seen it stays so. Learning says so with its results.
-- * `claim_klaviyo_result`: the owner opening one email's page checks that
--   email now (cheap and cached: never more than once in `fresh` seconds,
--   only while it is a draft, scheduled or sending), under the same lease
--   as the hourly run, so the two never write the same row at once.
--
-- Still only the results run writes these rows (service role, through
-- `save_klaviyo_result` under its lease); members read their own
-- workspace's rows (unchanged policy). Nothing here writes to Klaviyo.
-- The number is chosen at merge time (D24).

alter table public.klaviyo_email_results
  add column if not exists scheduled_for timestamptz,
  add column if not exists send_strategy text
    check (send_strategy is null or send_strategy ~ '^[a-z_]{1,40}$'),
  add column if not exists design_changed boolean not null default false;

alter table public.klaviyo_email_results drop constraint if exists klaviyo_email_results_scheduled_for_status;
alter table public.klaviyo_email_results add constraint klaviyo_email_results_scheduled_for_status
  check (scheduled_for is null or status in ('scheduled', 'sending'));

-- One check's outcome, saved under its lease (LRN-001), now also with when
-- and how Klaviyo will send it and whether its design changed there.
create or replace function public.save_klaviyo_result(build uuid, lease uuid, patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.klaviyo_email_results;
  t uuid;
  made timestamptz;
  allowed constant text[] := array['status', 'changed', 'sent_at', 'pulls', 'results', 'clicks', 'complete',
    'context', 'final', 'paused', 'next_check_at', 'scheduled_for', 'send_strategy', 'design_changed'];
  new_status text; new_sent timestamptz; new_pulls integer; new_final boolean; next_at timestamptz;
  new_scheduled timestamptz; new_strategy text;
  planned_day date;
  today date := (now() at time zone 'UTC')::date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if jsonb_typeof(patch) is distinct from 'object' or exists (select 1 from jsonb_object_keys(patch) k where k <> all(allowed))
    or not patch ? 'next_check_at' then
    raise exception 'Invalid result' using errcode = '23514';
  end if;
  if build is null or lease is null then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  select r.tenant_id into t from public.klaviyo_email_results r where r.build_id = build;
  if t is null then raise exception 'Result unavailable' using errcode = 'PT409'; end if;
  -- A workspace paused since the claim saves nothing.
  perform 1 from public.tenants where id = t and status = 'active' for share;
  if not found then raise exception 'Lease unavailable' using errcode = 'PT409'; end if;
  select * into e from public.klaviyo_email_results r where r.tenant_id = t and r.build_id = build for update;
  if e.final or e.lease_token is distinct from lease or e.lease_until is null or e.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  select b.created_at into made from public.email_builds b where b.id = build;
  begin
    new_status := coalesce(patch->>'status', e.status);
    new_sent := case when patch ? 'sent_at' and jsonb_typeof(patch->'sent_at') = 'string' then (patch->>'sent_at')::timestamptz
      when patch ? 'sent_at' then 'infinity'::timestamptz
      else e.sent_at end;
    new_pulls := coalesce((patch->>'pulls')::integer, e.pulls);
    next_at := (patch->>'next_check_at')::timestamptz;
    new_final := case when jsonb_typeof(patch->'final') = 'boolean' then (patch->>'final')::boolean else false end;
    new_scheduled := case when patch ? 'scheduled_for' and jsonb_typeof(patch->'scheduled_for') = 'string'
        then (patch->>'scheduled_for')::timestamptz
      when patch ? 'scheduled_for' and jsonb_typeof(patch->'scheduled_for') = 'null' then null
      when patch ? 'scheduled_for' then 'infinity'::timestamptz
      else e.scheduled_for end;
    new_strategy := case when patch ? 'send_strategy' then patch->>'send_strategy' else e.send_strategy end;
  exception when others then
    raise exception 'Invalid result' using errcode = '23514';
  end;
  -- No longer scheduled or sending: when and how it was to send is gone.
  if new_status not in ('scheduled', 'sending') then
    new_scheduled := null;
    new_strategy := null;
  end if;
  -- The planned day matters only to a stale outcome (read only for one).
  if new_status = 'stale' then
    begin
      planned_day := coalesce((e.planned->>'date')::date, today);
    exception when others then
      raise exception 'Invalid result' using errcode = '23514';
    end;
  end if;
  if new_status not in ('draft', 'scheduled', 'sending', 'sent', 'cancelled', 'deleted', 'stale')
    or (patch ? 'status' and jsonb_typeof(patch->'status') <> 'string')
    -- Nothing comes back from sent, cancelled or deleted (any can be deleted).
    or (e.status in ('sent', 'cancelled', 'deleted') and new_status <> e.status and new_status <> 'deleted')
    -- Stale ends it: only a draft or a scheduled email long past its day.
    or (new_status = 'stale' and (e.status not in ('draft', 'scheduled') or planned_day >= today - 14 or not new_final))
    -- The send time: set only with the sent status, a real time after the
    -- email was built and not ahead of now, and once known it stays.
    or (patch ? 'sent_at' and (new_status <> 'sent' or e.sent_at is not null))
    or (e.sent_at is not null and new_sent is distinct from e.sent_at)
    or (new_sent is not null and (not isfinite(new_sent) or new_sent > now() + interval '1 hour'
      or new_sent < coalesce(made, e.created_at) - interval '1 hour'))
    or (new_status = 'sent' and new_sent is null)
    -- When Klaviyo will send it: a real time, from a day before the email
    -- was built to a year and a half ahead, given only while scheduled or
    -- sending (`static`, `local_timezone`… for how).
    or (patch ? 'scheduled_for' and jsonb_typeof(patch->'scheduled_for') not in ('string', 'null'))
    or (patch ? 'scheduled_for' and jsonb_typeof(patch->'scheduled_for') = 'string'
      and new_status not in ('scheduled', 'sending'))
    or (new_scheduled is not null and (not isfinite(new_scheduled) or new_scheduled > now() + interval '550 days'
      or new_scheduled < coalesce(made, e.created_at) - interval '1 day'))
    or (patch ? 'send_strategy' and jsonb_typeof(patch->'send_strategy') not in ('string', 'null'))
    or (patch ? 'send_strategy' and jsonb_typeof(patch->'send_strategy') = 'string'
      and (new_status not in ('scheduled', 'sending') or patch->>'send_strategy' !~ '^[a-z_]{1,40}$'))
    or (patch ? 'changed' and jsonb_typeof(patch->'changed') <> 'boolean')
    or (patch ? 'design_changed' and jsonb_typeof(patch->'design_changed') <> 'boolean')
    or (patch ? 'complete' and jsonb_typeof(patch->'complete') <> 'boolean')
    or (patch ? 'final' and jsonb_typeof(patch->'final') <> 'boolean')
    or (patch ? 'paused' and jsonb_typeof(patch->'paused') <> 'null'
      and (jsonb_typeof(patch->'paused') <> 'string' or patch->>'paused' !~ '^[a-z][a-z_]{1,39}$'))
    or (patch ? 'context' and not private.klaviyo_context_ok(patch->'context'))
    -- One results read a day after the send and a day after the last,
    -- with what was read, three in all.
    or (patch ? 'pulls' and jsonb_typeof(patch->'pulls') <> 'number')
    or new_pulls not in (e.pulls, e.pulls + 1) or new_pulls > 3
    or (new_pulls = e.pulls + 1 and (new_status <> 'sent' or not patch ? 'results' or not patch ? 'clicks'
      or not patch ? 'complete' or not patch ? 'context'
      or now() < new_sent + make_interval(hours => 24 * new_pulls) - interval '10 minutes'
      or (e.results_at is not null and now() < e.results_at + interval '23 hours 50 minutes')))
    -- What was read, and how, only with a read.
    or ((patch ? 'results' or patch ? 'clicks' or patch ? 'complete' or patch ? 'context') and new_pulls = e.pulls)
    or (patch ? 'results' and (jsonb_typeof(patch->'results') <> 'array' or jsonb_array_length(patch->'results') > 8
      or octet_length((patch->'results')::text) > 20000
      or exists (select 1 from jsonb_array_elements(patch->'results') r where not private.klaviyo_result_ok(r))))
    or (patch ? 'clicks' and (jsonb_typeof(patch->'clicks') <> 'array' or jsonb_array_length(patch->'clicks') > 200
      or octet_length((patch->'clicks')::text) > 200000
      or exists (select 1 from jsonb_array_elements(patch->'clicks') c where not private.klaviyo_click_ok(c))))
    -- Final only when nothing is left to check: three reads, or a sent
    -- email unread for ten days (saying why).
    or (new_final and not (new_status in ('cancelled', 'deleted', 'stale') or (new_status = 'sent' and new_pulls = 3)
      or (new_status = 'sent' and patch->>'paused' is not null and now() > new_sent + interval '10 days')))
    or (not new_final and new_status = 'sent' and new_pulls = 3)
    or next_at is null or next_at < now() - interval '1 minute' or next_at > now() + interval '8 days' then
    raise exception 'Invalid result' using errcode = '23514';
  end if;
  update public.klaviyo_email_results r
    set status = new_status,
        changed = r.changed or coalesce((patch->>'changed')::boolean, false),
        design_changed = r.design_changed or coalesce((patch->>'design_changed')::boolean, false),
        scheduled_for = new_scheduled,
        send_strategy = new_strategy,
        sent_at = new_sent,
        pulls = new_pulls,
        results = case when patch ? 'results' then patch->'results' else r.results end,
        clicks = case when patch ? 'clicks' then patch->'clicks' else r.clicks end,
        results_at = case when patch ? 'results' then now() else r.results_at end,
        complete = case when patch ? 'complete' then (patch->>'complete')::boolean else r.complete end,
        context = case when patch ? 'context' then patch->'context' else r.context end,
        final = new_final,
        paused = case when patch ? 'paused' then patch->>'paused' else null end,
        checked_at = now(),
        next_check_at = next_at,
        lease_token = null, lease_until = null, updated_at = now()
    where r.tenant_id = t and r.build_id = build;
end $$;

-- The owner opened this email's page: lease its check now (one minute),
-- only when it is still a draft, scheduled or sending, not checked in the
-- last `fresh` seconds (60 to 3600), not held by another run, and in an
-- active workspace. Nothing (no row) otherwise: the page shows what was
-- last read. Locks: the workspace first (shared), then the row.
create or replace function public.claim_klaviyo_result(t uuid, build uuid, fresh integer default 600)
returns setof public.klaviyo_email_results
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Access denied' using errcode = '42501'; end if;
  if t is null or build is null or fresh is null or fresh < 60 or fresh > 3600 then
    raise exception 'Invalid claim' using errcode = '23514';
  end if;
  perform 1 from public.tenants where id = t and status = 'active' for share;
  if not found then return; end if;
  return query
    with one as (
      select e.tenant_id, e.build_id from public.klaviyo_email_results e
        where e.tenant_id = t and e.build_id = build and not e.final
          and e.status in ('draft', 'scheduled', 'sending')
          and (e.checked_at is null or e.checked_at < now() - make_interval(secs => fresh))
          and (e.lease_until is null or e.lease_until < now())
        for update of e skip locked)
    update public.klaviyo_email_results e
      set lease_token = gen_random_uuid(), lease_until = now() + interval '1 minute', updated_at = now()
      from one where e.tenant_id = one.tenant_id and e.build_id = one.build_id
      returning e.*;
end $$;

revoke all on function public.save_klaviyo_result(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_klaviyo_result(uuid, uuid, jsonb) to service_role;
revoke all on function public.claim_klaviyo_result(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_klaviyo_result(uuid, uuid, integer) to service_role;
