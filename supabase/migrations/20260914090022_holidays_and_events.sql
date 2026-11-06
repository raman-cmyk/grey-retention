-- UIR-012: Holidays & Events (docs/UI_REBUILD_SPEC.md §12, OWNER_JOURNEYS
-- §12 and §18 decision 20). The workspace's own entries get a type
-- (holiday or event), "repeats annually", a revision and edit/delete
-- commands. Platform holidays are not stored: they are computed per country
-- in features/holidays/platform.ts; the owner's country choice lives in
-- holiday_preferences. Planning reads repeating entries on their next date.
-- Apply after 20260914090021.

alter table public.holidays
  add column kind text not null default 'event' check (kind in ('holiday','event')),
  add column repeats_annually boolean not null default false,
  add column revision integer not null default 1 check (revision > 0),
  add column updated_at timestamptz not null default now();

create table public.holiday_preferences (
  tenant_id uuid primary key references public.tenants(id),
  country text not null check (country in ('US','GB','AU','CA','NZ','IN','INTL')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.holiday_preferences enable row level security;
create policy tenant_read on public.holiday_preferences
  for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.holiday_preferences from public, anon, authenticated, service_role;
grant select on public.holiday_preferences to authenticated;
-- Members only read holidays; every write goes through the commands.
revoke insert, update, delete, truncate on public.holidays from public, anon, authenticated;

-- The next date on or after `from_date` with the entry's month and day
-- (29 February becomes 28 February in other years).
create function private.next_occurrence(event_date date, from_date date)
returns date language plpgsql immutable set search_path = '' as $$
declare y integer := extract(year from from_date); m integer := extract(month from event_date);
  d integer := extract(day from event_date); candidate date;
begin
  for i in 0..1 loop
    candidate := make_date(y + i, m, least(d, extract(day from
      (make_date(y + i, m, 1) + interval '1 month - 1 day'))::integer));
    if candidate >= from_date then return candidate; end if;
  end loop;
  return candidate;
end $$;

-- Name: 2–200 characters, one line. Notes: up to 2000 characters.
create function private.holiday_input_valid(name text, event_date date, kind text,
  repeats_annually boolean, notes text)
returns boolean language sql immutable set search_path = '' as $$
  select char_length(btrim(coalesce(name, ''))) between 2 and 200
    and btrim(name) !~ '[[:cntrl:]]'
    and event_date is not null
    and kind in ('holiday','event')
    and repeats_annually is not null
    and char_length(coalesce(notes, '')) <= 2000
$$;

-- Add (holiday_id null, expected_revision 0) or edit an entry. Owner only,
-- workspace lock first, PT409 when the entry changed or was removed.
create function public.save_holiday(
  t uuid, holiday_id uuid, expected_revision integer, name text, event_date date,
  kind text, repeats_annually boolean, notes text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.holidays; new_id uuid; r integer;
begin
  perform private.require_member(t, true);
  if not private.holiday_input_valid(name, event_date, kind, repeats_annually, notes) then
    raise exception 'Check the entry' using errcode = '23514';
  end if;
  if holiday_id is null then
    if expected_revision is distinct from 0 then
      raise exception 'Reload the page' using errcode = 'PT409';
    end if;
    insert into public.holidays (tenant_id, name, event_date, notes, created_by, kind, repeats_annually)
    values (t, btrim(name), event_date, coalesce(notes, ''), auth.uid(), kind, repeats_annually)
    returning id, revision into new_id, r;
    insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
    values (t, auth.uid(), 'holiday_created', new_id);
    return jsonb_build_object('id', new_id, 'revision', r);
  end if;
  select * into h from public.holidays x where x.tenant_id = t and x.id = holiday_id for update;
  if not found then
    raise exception 'This entry was removed in another window' using errcode = 'PT409';
  end if;
  if h.revision is distinct from expected_revision then
    raise exception 'This entry changed in another window' using errcode = 'PT409';
  end if;
  update public.holidays x set name = btrim(save_holiday.name), event_date = save_holiday.event_date,
    notes = coalesce(save_holiday.notes, ''), kind = save_holiday.kind,
    repeats_annually = save_holiday.repeats_annually, revision = x.revision + 1, updated_at = now()
  where x.id = h.id
  returning x.revision into r;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
  values (t, auth.uid(), 'holiday_updated', h.id);
  return jsonb_build_object('id', h.id, 'revision', r);
end $$;

create function public.delete_holiday(t uuid, holiday_id uuid, expected_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare h public.holidays;
begin
  perform private.require_member(t, true);
  select * into h from public.holidays x where x.tenant_id = t and x.id = holiday_id for update;
  if not found then
    raise exception 'This entry was removed in another window' using errcode = 'PT409';
  end if;
  if h.revision is distinct from expected_revision then
    raise exception 'This entry changed in another window' using errcode = 'PT409';
  end if;
  delete from public.holidays x where x.id = h.id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
  values (t, auth.uid(), 'holiday_deleted', h.id);
end $$;

-- The country whose platform holidays the workspace sees.
create function public.set_holiday_country(t uuid, country text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  if country is null or country not in ('US','GB','AU','CA','NZ','IN','INTL') then
    raise exception 'Choose a country from the list' using errcode = '23514';
  end if;
  insert into public.holiday_preferences as x (tenant_id, country, updated_by)
  values (t, set_holiday_country.country, auth.uid())
  on conflict (tenant_id) do update set country = excluded.country,
    updated_by = auth.uid(), updated_at = now();
end $$;

-- Planning sees each entry on its date in the next 30 days; a repeating
-- entry on its next yearly date. The shape stays {id, name, date, notes}
-- plus kind, so planner inputs keep matching at completion.
create or replace function private.planning_holidays(t uuid, start_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'date', e.d,
      'notes', e.notes, 'kind', e.kind) order by e.id), '[]'::jsonb)
  from (
    select h.id, h.name, h.notes, h.kind,
      case when h.repeats_annually
        then private.next_occurrence(h.event_date, (start_at at time zone tenant.timezone)::date)
        else h.event_date end as d,
      (start_at at time zone tenant.timezone)::date as s
    from public.holidays h join public.tenants tenant on tenant.id = h.tenant_id
    where h.tenant_id = t
  ) e
  where e.d >= e.s and e.d < e.s + 30
$$;

revoke all on function private.next_occurrence(date, date),
  private.holiday_input_valid(text, date, text, boolean, text),
  private.planning_holidays(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.save_holiday(uuid, uuid, integer, text, date, text, boolean, text),
  public.delete_holiday(uuid, uuid, integer), public.set_holiday_country(uuid, text)
  from public, anon, service_role;
grant execute on function public.save_holiday(uuid, uuid, integer, text, date, text, boolean, text),
  public.delete_holiday(uuid, uuid, integer), public.set_holiday_country(uuid, text)
  to authenticated;
