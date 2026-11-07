-- UIR-012 review fixes, applied together with 20260914090022 (neither has
-- reached production):
--   * a yearly entry is never shown or planned before its own first date;
--   * dates must be real calendar dates (1900–2999, no infinity);
--   * the old add_holiday command goes through the same checks as
--     save_holiday (trimmed one-line name, valid date);
--   * holidays grants match the other tables: members read through RLS,
--     nobody else reads or writes directly (not even the service role);
--   * choosing a country is written to the workspace log.

-- Starts from the saved date when that is later than `from_date`.
create or replace function private.next_occurrence(event_date date, from_date date)
returns date language plpgsql immutable set search_path = '' as $$
declare start date := greatest(event_date, from_date);
  y integer := extract(year from start); m integer := extract(month from event_date);
  d integer := extract(day from event_date); candidate date;
begin
  for i in 0..1 loop
    candidate := make_date(y + i, m, least(d, extract(day from
      (make_date(y + i, m, 1) + interval '1 month - 1 day'))::integer));
    if candidate >= start then return candidate; end if;
  end loop;
  return candidate;
end $$;

create or replace function private.holiday_input_valid(name text, event_date date, kind text,
  repeats_annually boolean, notes text)
returns boolean language sql immutable set search_path = '' as $$
  select char_length(btrim(coalesce(name, ''))) between 2 and 200
    and btrim(name) !~ '[[:cntrl:]]'
    and event_date is not null and isfinite(event_date)
    and event_date between date '1900-01-01' and date '2999-12-31'
    and kind in ('holiday','event')
    and repeats_annually is not null
    and char_length(coalesce(notes, '')) <= 2000
$$;

-- New and changed rows only: old rows are never rejected by this check.
alter table public.holidays add constraint holidays_event_date_range
  check (event_date between date '1900-01-01' and date '2999-12-31') not valid;

-- The old command (still used by older scripts) adds a one-off event with
-- the same checks as the page.
create or replace function public.add_holiday(t uuid, name text, event_date date, notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return (public.save_holiday(t, null, 0, name, event_date, 'event', false, coalesce(notes, ''))->>'id')::uuid;
end $$;

create or replace function public.set_holiday_country(t uuid, country text)
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
  insert into public.workspace_events (tenant_id, actor_id, kind, detail)
  values (t, auth.uid(), 'holiday_country_set', jsonb_build_object('country', set_holiday_country.country));
end $$;

revoke all on public.holidays from public, anon, authenticated, service_role;
grant select on public.holidays to authenticated;
revoke all on function private.next_occurrence(date, date),
  private.holiday_input_valid(text, date, text, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.add_holiday(uuid, text, date, text), public.set_holiday_country(uuid, text)
  from public, anon, service_role;
grant execute on function public.add_holiday(uuid, text, date, text), public.set_holiday_country(uuid, text)
  to authenticated;
