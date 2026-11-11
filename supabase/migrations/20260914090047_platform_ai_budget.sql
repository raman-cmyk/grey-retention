-- GEM-003: a platform-level AI budget for work that belongs to no client,
-- such as labelling competitor email sections in the Inspiration inbox
-- (lane B, INB-003). Client work is metered against the client's package
-- (GEM-002); this is the platform's own daily cap. Service role only, except
-- the operator commands to settle stale usage and change the cap.

create table private.platform_ai_budget (
  id smallint primary key default 1 check (id = 1),
  -- $0.50 a day by default: tens of thousands of Flash-Lite labelling calls.
  daily_cap_micro bigint not null default 500000 check (daily_cap_micro between 1000 and 1000000000),
  updated_at timestamptz not null default now()
);
insert into private.platform_ai_budget (id) values (1);

create table private.platform_ai_usage (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null unique check (operation_id like 'ai:%' and length(operation_id) between 4 and 200),
  feature text not null check (feature in ('copy','design','assets','playbook','calendar','gros','learning')),
  estimate_micro bigint not null check (estimate_micro between 1 and 1000000000),
  actual_micro bigint check (actual_micro >= 0 and actual_micro <= estimate_micro),
  state text not null default 'reserved' check (state in ('reserved','reconciled','released')),
  usage_date date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create index platform_ai_usage_date_idx on private.platform_ai_usage (usage_date, state);
alter table private.platform_ai_budget enable row level security;
alter table private.platform_ai_usage enable row level security;
revoke all on private.platform_ai_budget, private.platform_ai_usage from public, anon, authenticated, service_role;

-- The budget row is the single lock: reserve and settle both take it first,
-- so concurrent reservations can't overshoot the daily cap.
create or replace function public.reserve_platform_ai_usage(operation text, feature text, estimate bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare cap bigint; spent bigint; rid uuid; today date := (now() at time zone 'utc')::date;
begin
 perform private.require_service();
 if operation is null or operation not like 'ai:%' or length(operation) not between 4 and 200
   or feature is null or feature not in ('copy','design','assets','playbook','calendar','gros','learning')
   or estimate is null or estimate < 1 or estimate > 1000000000 then
  raise exception 'Invalid usage request' using errcode='23514';
 end if;
 select b.daily_cap_micro into cap from private.platform_ai_budget b where b.id = 1 for update;
 if exists (select 1 from private.platform_ai_usage u where u.operation_id = operation) then
  raise exception 'AI operation already reserved' using errcode='PT409';
 end if;
 select coalesce(sum(case when u.state = 'reserved' then u.estimate_micro else coalesce(u.actual_micro, 0) end), 0) into spent
   from private.platform_ai_usage u where u.usage_date = today;
 if spent + estimate > cap then
  raise exception 'Platform AI allowance reached; no AI request was sent' using errcode='23514';
 end if;
 insert into private.platform_ai_usage (operation_id, feature, estimate_micro, usage_date)
   values (operation, feature, estimate, today) returning id into rid;
 return rid;
end $$;

create or replace function private.settle_platform_usage(reservation uuid, actual bigint) returns void language plpgsql security definer set search_path='' as $$
declare r private.platform_ai_usage;
begin
 perform 1 from private.platform_ai_budget b where b.id = 1 for update;
 select * into r from private.platform_ai_usage u where u.id = reservation for update;
 if r.id is null or actual is null or actual < 0 or actual > r.estimate_micro then
  raise exception 'Actual usage must fit reservation' using errcode='23514';
 end if;
 if r.state in ('reconciled', 'released') and r.actual_micro = actual then return; end if;
 if r.state <> 'reserved' then raise exception 'Usage reservation already closed' using errcode='PT409'; end if;
 update private.platform_ai_usage u
   set state = case when actual = 0 then 'released' else 'reconciled' end, actual_micro = actual
   where u.id = r.id;
end $$;

create or replace function public.settle_platform_ai_usage(reservation uuid, actual bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_service();
 perform private.settle_platform_usage(reservation, actual);
end $$;

-- A live call left unsettled is charged at its full estimate.
create or replace function public.settle_stale_platform_ai_usage(older_than interval default interval '1 hour') returns integer language plpgsql security definer set search_path='' as $$
declare r private.platform_ai_usage; n integer := 0;
begin
 if not (coalesce(auth.role(), '') = 'service_role' or private.is_operator()) then raise exception 'Access denied' using errcode='42501'; end if;
 if older_than is null or older_than < interval '10 minutes' then raise exception 'Stale window too short' using errcode='23514'; end if;
 -- Lock first, so a worker settling the same row can't race the sweep.
 perform 1 from private.platform_ai_budget b where b.id = 1 for update;
 for r in select * from private.platform_ai_usage u where u.state = 'reserved' and u.created_at < now() - older_than order by u.created_at loop
  perform private.settle_platform_usage(r.id, r.estimate_micro); n := n + 1;
 end loop;
 return n;
end $$;

-- Raising a paid spend ceiling is super-admin only, like package limits.
create or replace function public.set_platform_ai_daily_cap(cap bigint) returns void language plpgsql security definer set search_path='' as $$
begin
 if not (coalesce(auth.role(), '') = 'service_role' or exists (
   select 1 from public.platform_admins a join public.profiles p on p.id = a.profile_id
   where a.profile_id = auth.uid() and a.active and a.role = 'super_admin' and p.status = 'active')) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if cap is null or cap < 1000 or cap > 1000000000 then raise exception 'Invalid cap' using errcode='23514'; end if;
 update private.platform_ai_budget b set daily_cap_micro = cap, updated_at = now() where b.id = 1;
end $$;

-- Today's platform spend, for the ops dashboard.
create or replace function public.platform_ai_usage_today() returns table(cap_micro bigint, spent_micro bigint, reserved_micro bigint) language plpgsql stable security definer set search_path='' as $$
begin
 if not (coalesce(auth.role(), '') = 'service_role' or private.is_operator()) then raise exception 'Access denied' using errcode='42501'; end if;
 return query
  select b.daily_cap_micro,
    coalesce((select sum(u.actual_micro) from private.platform_ai_usage u where u.usage_date = (now() at time zone 'utc')::date and u.state = 'reconciled'), 0)::bigint,
    coalesce((select sum(u.estimate_micro) from private.platform_ai_usage u where u.usage_date = (now() at time zone 'utc')::date and u.state = 'reserved'), 0)::bigint
  from private.platform_ai_budget b where b.id = 1;
end $$;

revoke all on function public.reserve_platform_ai_usage(text,text,bigint), public.settle_platform_ai_usage(uuid,bigint),
  public.settle_stale_platform_ai_usage(interval), public.set_platform_ai_daily_cap(bigint), public.platform_ai_usage_today(),
  private.settle_platform_usage(uuid,bigint) from public, anon, authenticated;
revoke all on function private.settle_platform_usage(uuid,bigint) from service_role;
grant execute on function public.reserve_platform_ai_usage(text,text,bigint), public.settle_platform_ai_usage(uuid,bigint),
  public.settle_stale_platform_ai_usage(interval), public.set_platform_ai_daily_cap(bigint), public.platform_ai_usage_today() to service_role;
-- Operators use their authenticated session; each body checks private.is_operator().
grant execute on function public.settle_stale_platform_ai_usage(interval), public.set_platform_ai_daily_cap(bigint), public.platform_ai_usage_today() to authenticated;
