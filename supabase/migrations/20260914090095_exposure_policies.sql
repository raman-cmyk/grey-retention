-- SEG-EXP-a (SEG-EXPOSURE-001, a PROPOSAL): how many marketing emails one
-- profile may get in a rolling window, and which segment wins when
-- segments overlap. These defaults were chosen for this implementation;
-- Raman has not supplied numbers. He can change them in Settings.
--
-- One row per workspace; with no row the defaults hold
-- (features/segments/exposure.ts): at most 3 marketing emails per profile
-- in any rolling 7 days, and no segment set ahead of another. The rules
-- that are not settings live in the engine: suppressed and unsubscribed
-- profiles are left out first; each profile is counted once across
-- overlapping segments; a segment in `priority` wins an overlap; then the
-- earliest scheduled slot, then the segment id; transactional mail never
-- counts toward the cap.
--
-- Every active member reads it; only the owner changes it, through
-- save_exposure_policy (the tenant locked first, the revision the page
-- read or PT409, bad input 23514). Each change is recorded for Settings'
-- Recent changes (`exposure_policy_changed`, as BAS-006 does for the
-- offer limits). The number is chosen at merge time (D24).

-- Segment ids as the provider gives them (Klaviyo segment and list ids),
-- each once, at most 50.
create or replace function private.exposure_priority_ok(priority text[])
returns boolean language sql immutable set search_path = '' as $$
  select priority is not null and cardinality(priority) <= 50
    and not exists (select 1 from unnest(priority) p where p is null or p !~ '^[A-Za-z0-9_-]{1,64}$')
    and cardinality(priority) = (select count(distinct p) from unnest(priority) p);
$$;
revoke all on function private.exposure_priority_ok(text[]) from public, anon, authenticated;

create table public.exposure_policies (
  tenant_id uuid primary key references public.tenants(id),
  -- The rolling window, in days, and the most marketing emails in it.
  window_days integer not null check (window_days between 1 and 30),
  max_marketing integer not null check (max_marketing between 1 and 14),
  -- Segments that win an overlap, highest first; one not named here wins
  -- none, and ties go to the earliest slot, then the segment id.
  priority text[] not null default '{}' check (private.exposure_priority_ok(priority)),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.exposure_policies enable row level security;
create policy exposure_policies_member_read on public.exposure_policies for select to authenticated
  using (private.is_active_member(tenant_id));
revoke all on public.exposure_policies from public, anon, authenticated;
grant select on public.exposure_policies to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.exposure_policies from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.exposure_policies from public, anon, authenticated, service_role';
  end if;
end $$;

-- The owner saves the policy. `expected_revision` is the revision the page
-- read (0 when none was saved yet); a change from another window is PT409.
-- Returns the new revision.
create or replace function public.save_exposure_policy(t uuid, window_days integer, max_marketing integer,
  priority text[], expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare p public.exposure_policies;
begin
  perform private.require_member(t, true);
  if window_days is null or window_days not between 1 and 30 then
    raise exception 'The window is 1 to 30 days' using errcode = '23514';
  end if;
  if max_marketing is null or max_marketing not between 1 and 14 then
    raise exception 'The cap is 1 to 14 marketing emails' using errcode = '23514';
  end if;
  if not private.exposure_priority_ok(priority) then
    raise exception 'Invalid segment order' using errcode = '23514';
  end if;
  select * into p from public.exposure_policies e where e.tenant_id = t for update;
  if p.tenant_id is null then
    if coalesce(expected_revision, -1) <> 0 then raise exception 'Exposure policy changed' using errcode = 'PT409'; end if;
    insert into public.exposure_policies (tenant_id, window_days, max_marketing, priority, updated_by)
      values (t, window_days, max_marketing, priority, auth.uid());
    return 1;
  end if;
  if p.revision <> coalesce(expected_revision, -1) then raise exception 'Exposure policy changed' using errcode = 'PT409'; end if;
  update public.exposure_policies e
    set window_days = save_exposure_policy.window_days, max_marketing = save_exposure_policy.max_marketing,
        priority = save_exposure_policy.priority, revision = e.revision + 1, updated_by = auth.uid(), updated_at = now()
    where e.tenant_id = t;
  return p.revision + 1;
end $$;
revoke all on function public.save_exposure_policy(uuid, integer, integer, text[], integer) from public, anon;
grant execute on function public.save_exposure_policy(uuid, integer, integer, text[], integer) to authenticated;

-- Who changed it, for Settings' Recent changes: the window and cap before
-- and after, and whether the segment order changed. A save that changes
-- nothing is not a change.
create or replace function private.record_exposure_policy_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.window_days = old.window_days and new.max_marketing = old.max_marketing
    and new.priority = old.priority then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail, created_at)
  values (new.tenant_id, auth.uid(), 'exposure_policy_changed',
    jsonb_build_object(
      'from_window', case when tg_op = 'UPDATE' then old.window_days end,
      'from_cap', case when tg_op = 'UPDATE' then old.max_marketing end,
      'to_window', new.window_days, 'to_cap', new.max_marketing,
      'order_changed', tg_op = 'UPDATE' and new.priority <> old.priority), clock_timestamp());
  return null;
end $$;
revoke all on function private.record_exposure_policy_change() from public, anon, authenticated;
create trigger exposure_policy_changed after insert or update on public.exposure_policies
  for each row execute function private.record_exposure_policy_change();
