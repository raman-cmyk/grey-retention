-- PLN-033a (owner pick #33, D27): the owner's revenue goal for a month,
-- e.g. "$20k this month". It is the email revenue Klaviyo reports for that
-- month, in the store's currency; the planner works backwards from it
-- (PLN-033b). One row per workspace and month (the store's calendar);
-- clearing a goal keeps the row with no amount, so its revision never
-- restarts and an old page cannot overwrite a newer save. Owners and admins
-- change it through set_revenue_goal only; members read it; the worker
-- reads it. The number is chosen at merge time (D24).

create table public.revenue_goals (
  tenant_id uuid not null references public.tenants(id),
  month date not null check (extract(day from month) = 1 and month between '2000-01-01' and '2999-12-01'),
  amount numeric(12, 2) check (amount > 0 and amount <= 1000000000),
  currency text check (currency ~ '^[A-Z]{3}$'),
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, month),
  check ((amount is null) = (currency is null))
);

alter table public.revenue_goals enable row level security;
create policy revenue_goals_member_read on public.revenue_goals for select to authenticated
  using (private.is_active_member(tenant_id) or private.is_operator());

revoke all on public.revenue_goals from public, anon, authenticated;
grant select on public.revenue_goals to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.revenue_goals from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.revenue_goals from public, anon, authenticated, service_role';
  end if;
end $$;

-- Sets (or, with no amount and no currency, clears) the goal for one month.
-- `expected_revision` is the revision the page read, 0 when the month had
-- no row yet; a change from another window is PT409. Owner or admin only,
-- workspace locked first (private.require_offer_editor).
create or replace function public.set_revenue_goal(t uuid, goal_month date, goal_amount numeric,
  goal_currency text, expected_revision integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare g public.revenue_goals;
begin
  perform private.require_offer_editor(t);
  if goal_month is null or extract(day from goal_month) <> 1
    or goal_month < '2000-01-01' or goal_month > '2999-12-01' then
    raise exception 'A goal is for a month' using errcode = '23514';
  end if;
  if (goal_amount is null) <> (goal_currency is null)
    or goal_amount <= 0 or goal_amount > 1000000000 or goal_amount <> round(goal_amount, 2)
    or goal_currency !~ '^[A-Z]{3}$' then
    raise exception 'A goal is an amount and a currency' using errcode = '23514';
  end if;
  select * into g from public.revenue_goals where tenant_id = t and month = goal_month for update;
  if g.tenant_id is null then
    if coalesce(expected_revision, -1) <> 0 then
      raise exception 'Revenue goal changed' using errcode = 'PT409';
    end if;
    -- Clearing a month that never had a goal changes nothing.
    if goal_amount is null then
      return 0;
    end if;
    insert into public.revenue_goals (tenant_id, month, amount, currency, updated_by)
      values (t, goal_month, goal_amount, goal_currency, auth.uid());
    return 1;
  end if;
  if g.revision <> coalesce(expected_revision, -1) then
    raise exception 'Revenue goal changed' using errcode = 'PT409';
  end if;
  update public.revenue_goals
    set amount = goal_amount, currency = goal_currency, revision = revision + 1,
      updated_by = auth.uid(), updated_at = now()
    where tenant_id = t and month = goal_month;
  return g.revision + 1;
end $$;

revoke all on function public.set_revenue_goal(uuid, date, numeric, text, integer) from public, anon, service_role;
grant execute on function public.set_revenue_goal(uuid, date, numeric, text, integer) to authenticated;

-- Each real change goes in the change history (BAS-006).
create or replace function private.record_revenue_goal_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.amount is not distinct from old.amount
    and new.currency is not distinct from old.currency then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail, created_at)
  values (new.tenant_id, auth.uid(), 'revenue_goal_set',
    jsonb_build_object('month', new.month,
      'from_amount', case when tg_op = 'UPDATE' then old.amount end,
      'from_currency', case when tg_op = 'UPDATE' then old.currency end,
      'to_amount', new.amount, 'to_currency', new.currency), clock_timestamp());
  return null;
end $$;

revoke all on function private.record_revenue_goal_change() from public, anon, authenticated, service_role;

create trigger revenue_goals_recorded after insert or update of amount, currency on public.revenue_goals
  for each row execute function private.record_revenue_goal_change();
