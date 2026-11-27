-- PICK-97 (owner pick #97, "Best send time per segment"): from what the
-- store already sent with Klaviyo, the hours and weekdays when each list or
-- segment's people open and click most, in the store's timezone. One row
-- per workspace and audience (a Klaviyo list or segment id), and one for
-- the whole store (`*`). The facts (counted sends, opens, clicks, per hour
-- and weekday) are kept apart from the recommendation (`best_hour`,
-- `best_weekday`, `compared`); a recommendation needs enough history, and
-- `reason` says why there is none. Only the history read
-- (`brand.read_history`) writes them, under its own lease, replacing the
-- rows an older read kept (never a newer read's); the workspace's active
-- members read them. The number is chosen at merge time (D24).

-- What a read counted for one audience: known keys only, each of its kind.
create or replace function private.send_time_tally_ok(v jsonb, slot text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'object'
    and v - slot - 'sends' - 'recipients' - 'opens' - 'clicks' - 'machineOpens' = '{}'::jsonb
    and v ?& array[slot, 'sends', 'recipients', 'opens', 'clicks', 'machineOpens']
    and case slot
      when 'hour' then jsonb_typeof(v->'hour') = 'number' and v->>'hour' ~ '^\d{1,2}$' and (v->>'hour')::integer between 0 and 23
      when 'weekday' then jsonb_typeof(v->'weekday') = 'string' and v->>'weekday' in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')
      else false end
    and jsonb_typeof(v->'sends') = 'number' and v->>'sends' ~ '^\d{1,3}$' and (v->>'sends')::integer between 1 and 300
    and not exists (select 1 from unnest(array['recipients','opens','clicks','machineOpens']) k
      where jsonb_typeof(v->k) <> 'number' or v->>k !~ '^\d{1,10}$' or (v->>k)::bigint > 1000000000), false);
$$;
revoke all on function private.send_time_tally_ok(jsonb, text) from public, anon, authenticated;

create or replace function private.send_time_facts_ok(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'object' and octet_length(v::text) <= 8000
    and v ?& array['sends','leftOut','firstSentAt','lastSentAt','recipients','opens','clicks','machineOpens','hours','weekdays']
    and v - 'sends' - 'leftOut' - 'firstSentAt' - 'lastSentAt' - 'recipients' - 'opens' - 'clicks' - 'machineOpens'
      - 'hours' - 'weekdays' = '{}'::jsonb
    and jsonb_typeof(v->'sends') = 'number' and v->>'sends' ~ '^\d{1,3}$' and (v->>'sends')::integer <= 300
    and jsonb_typeof(v->'leftOut') = 'number' and v->>'leftOut' ~ '^\d{1,3}$' and (v->>'leftOut')::integer <= 300
    and not exists (select 1 from unnest(array['recipients','opens','clicks','machineOpens']) k
      where jsonb_typeof(v->k) <> 'number' or v->>k !~ '^\d{1,10}$' or (v->>k)::bigint > 1000000000)
    and not exists (select 1 from unnest(array['firstSentAt','lastSentAt']) k
      where not (jsonb_typeof(v->k) = 'null'
        or (jsonb_typeof(v->k) = 'string' and v->>k ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$')))
    and ((v->>'sends')::integer = 0) = (jsonb_typeof(v->'firstSentAt') = 'null')
    and jsonb_typeof(v->'hours') = 'array' and jsonb_array_length(v->'hours') <= 24
    and not exists (select 1 from jsonb_array_elements(v->'hours') e where not private.send_time_tally_ok(e, 'hour'))
    and (select count(distinct e->>'hour') from jsonb_array_elements(v->'hours') e) = jsonb_array_length(v->'hours')
    and jsonb_typeof(v->'weekdays') = 'array' and jsonb_array_length(v->'weekdays') <= 7
    and not exists (select 1 from jsonb_array_elements(v->'weekdays') e where not private.send_time_tally_ok(e, 'weekday'))
    and (select count(distinct e->>'weekday') from jsonb_array_elements(v->'weekdays') e) = jsonb_array_length(v->'weekdays'),
    false);
$$;
revoke all on function private.send_time_facts_ok(jsonb) from public, anon, authenticated;

create table public.klaviyo_send_times (
  tenant_id uuid not null references public.tenants(id),
  -- A Klaviyo list or segment id, or `*` for every send of the store.
  audience_id text not null check (audience_id = '*' or audience_id ~ '^[A-Za-z0-9]{1,64}$'),
  facts jsonb not null check (private.send_time_facts_ok(facts)),
  -- The recommendation: the hour (inside the planner's send hours, 07 to
  -- 21) and weekday its people open and click most; null without enough
  -- history.
  best_hour smallint check (best_hour between 7 and 21),
  best_weekday text check (best_weekday in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
  -- The best hour beat another hour tried enough.
  compared boolean not null,
  reason text not null check (reason in ('enough', 'few_sends', 'no_repeated_time')),
  check ((reason = 'enough') = (best_hour is not null)),
  check (best_hour is not null or not compared),
  check (reason <> 'few_sends' or best_weekday is null),
  -- Every hour and weekday is in this timezone (the store's).
  timezone text not null check (char_length(timezone) between 1 and 60),
  -- Counted from a live Klaviyo read (false: the sample account).
  live boolean not null,
  -- The history read that counted them.
  run_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (tenant_id, audience_id),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);
alter table public.klaviyo_send_times enable row level security;
create policy member_read on public.klaviyo_send_times for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.klaviyo_send_times from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.klaviyo_send_times from authenticated;
grant select on public.klaviyo_send_times to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.klaviyo_send_times from authenticated';
  end if;
end $$;

-- The history read keeps what it counted: every row checked (23514 for any
-- bad one; the store's row `*` is required), then the workspace's rows
-- replaced at once. A read older than the one that kept the rows, or than
-- the stored history's, writes nothing (0).
create or replace function public.record_send_times(job uuid, lease uuid, timezone text, times jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; n integer;
  keys constant text[] := array['audienceId','facts','bestHour','bestWeekday','compared','reason'];
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_history' then raise exception 'Not a history reading job' using errcode = '23514'; end if;
  if timezone is null or char_length(timezone) not between 1 and 60
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = timezone) then
    raise exception 'Invalid send times' using errcode = '23514';
  end if;
  if jsonb_typeof(times) is distinct from 'array' or jsonb_array_length(times) not between 1 and 121
    or length(times::text) > 600000 then
    raise exception 'Invalid send times' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(times) e
    where jsonb_typeof(e) <> 'object'
      or not (e ?& keys)
      or exists (select 1 from jsonb_object_keys(e) k where not (k = any (keys)))
      or jsonb_typeof(e->'audienceId') <> 'string'
      or not ((e->>'audienceId') = '*' or (e->>'audienceId') ~ '^[A-Za-z0-9]{1,64}$')
      or not private.send_time_facts_ok(e->'facts')
      or jsonb_typeof(e->'bestHour') not in ('number','null')
      or (jsonb_typeof(e->'bestHour') = 'number' and ((e->>'bestHour') !~ '^\d{1,2}$' or (e->>'bestHour')::integer not between 7 and 21))
      or jsonb_typeof(e->'bestWeekday') not in ('string','null')
      or (jsonb_typeof(e->'bestWeekday') = 'string' and (e->>'bestWeekday') not in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun'))
      or jsonb_typeof(e->'compared') <> 'boolean'
      or jsonb_typeof(e->'reason') <> 'string' or (e->>'reason') not in ('enough','few_sends','no_repeated_time')
      or ((e->>'reason') = 'enough') <> (jsonb_typeof(e->'bestHour') = 'number')
      or (jsonb_typeof(e->'bestHour') = 'null' and (e->>'compared')::boolean)
      or ((e->>'reason') = 'few_sends' and jsonb_typeof(e->'bestWeekday') = 'string')
  ) then
    raise exception 'Invalid send times' using errcode = '23514';
  end if;
  if (select count(distinct e->>'audienceId') from jsonb_array_elements(times) e) <> jsonb_array_length(times)
    or not exists (select 1 from jsonb_array_elements(times) e where e->>'audienceId' = '*') then
    raise exception 'Invalid send times' using errcode = '23514';
  end if;
  -- A newer read already kept its rows or the history: nothing to write.
  if exists (
    select 1 from public.klaviyo_send_times s
      join public.job_runs r on r.tenant_id = s.tenant_id and r.id = s.run_id
    where s.tenant_id = j.tenant_id and r.id <> j.id and r.created_at > j.created_at
  ) or exists (
    select 1 from public.klaviyo_history h
      join public.job_runs r on r.tenant_id = h.tenant_id and r.id = h.run_id
    where h.tenant_id = j.tenant_id and h.state in ('ready','empty') and r.id <> j.id and r.created_at > j.created_at
  ) then
    return 0;
  end if;
  delete from public.klaviyo_send_times where tenant_id = j.tenant_id;
  insert into public.klaviyo_send_times(tenant_id, audience_id, facts, best_hour, best_weekday, compared, reason,
      timezone, live, run_id)
    select j.tenant_id, e->>'audienceId', e->'facts', (e->>'bestHour')::smallint, e->>'bestWeekday',
      (e->>'compared')::boolean, e->>'reason', timezone, coalesce(j.input->>'mode', '') = 'live', j.id
    from jsonb_array_elements(times) e;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_send_times(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_send_times(uuid, uuid, text, jsonb) to service_role;
