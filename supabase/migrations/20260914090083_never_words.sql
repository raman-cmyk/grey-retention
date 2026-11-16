-- PIC-29 part 2a (owner pick #29, "Words this brand never uses"): the
-- phrases the owner takes out of GROS's emails, learned from his edits
-- (PIC-29 part 1, `learnNeverWords`): those he took out often enough are
-- never used again (`never`); the others are watched. A phrase is GROS's
-- own words (one to four of them), never the owner's or a customer's. At
-- most 100 of each a workspace, 160,000 characters in all. Only the history
-- read (`brand.read_history`) writes them, under its own lease, replacing
-- the list an older read kept (never a newer read's); the workspace's
-- active members read them.

create table public.brand_never_words (
  tenant_id uuid not null references public.tenants(id),
  -- One to four words, one space between, no space or control character
  -- anywhere else, in one Unicode spelling (as the learner writes them).
  phrase text not null check (
    char_length(phrase) between 1 and 170
    and phrase ~ '^[^[:space:][:cntrl:]]+( [^[:space:][:cntrl:]]+){0,3}$'
    and phrase is nfkc normalized
  ),
  state text not null check (state in ('never', 'watched')),
  -- The emails he took it out of, and those he left it in.
  removed integer not null check (removed between 1 and 100000),
  kept integer not null check (kept between 0 and 100000),
  -- What he wrote in its place, the latest three at most.
  instead jsonb not null default '[]' check (
    jsonb_typeof(instead) = 'array' and jsonb_array_length(instead) <= 3
  ),
  -- Never used only when taken out at least twice, more often than kept.
  check (state <> 'never' or (removed >= 2 and removed > kept)),
  -- The history read that learned them.
  run_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (tenant_id, phrase),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);
alter table public.brand_never_words enable row level security;
create policy member_read on public.brand_never_words for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.brand_never_words from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_never_words from authenticated;
grant select on public.brand_never_words to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_never_words from authenticated';
  end if;
end $$;

-- The history read keeps what it learned: every phrase checked (23514 for
-- any bad one), then the workspace's list replaced at once (an empty list
-- clears it). A read older than the one that kept the list, or than the
-- stored history's, writes nothing (0). The sample account's edits only for
-- a synthetic brand.
create or replace function public.record_never_words(job uuid, lease uuid, words jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; n integer;
  keys constant text[] := array['phrase','state','removed','kept','instead'];
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_history' then raise exception 'Not a history reading job' using errcode = '23514'; end if;
  if coalesce(j.input->>'mode', '') <> 'live'
    and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = j.tenant_id), false) then
    raise exception 'Invalid never words' using errcode = '23514';
  end if;
  if jsonb_typeof(words) is distinct from 'array' or jsonb_array_length(words) > 200
    or length(words::text) > 160000 then
    raise exception 'Invalid never words' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(words) e
    where jsonb_typeof(e) <> 'object'
      or not (e ?& array['phrase','state','removed','kept','instead'])
      or exists (select 1 from jsonb_object_keys(e) k where not (k = any (keys)))
      or jsonb_typeof(e->'phrase') <> 'string' or char_length(e->>'phrase') not between 1 and 170
      or (e->>'phrase') !~ '^[^[:space:][:cntrl:]]+( [^[:space:][:cntrl:]]+){0,3}$'
      or not ((e->>'phrase') is nfkc normalized)
      or jsonb_typeof(e->'state') <> 'string' or (e->>'state') not in ('never','watched')
      or jsonb_typeof(e->'removed') <> 'number' or (e->>'removed') !~ '^[0-9]{1,6}$'
      or (e->>'removed')::integer not between 1 and 100000
      or jsonb_typeof(e->'kept') <> 'number' or (e->>'kept') !~ '^[0-9]{1,6}$'
      or (e->>'kept')::integer > 100000
      or ((e->>'state') = 'never'
        and ((e->>'removed')::integer < 2 or (e->>'removed')::integer <= (e->>'kept')::integer))
      or jsonb_typeof(e->'instead') <> 'array' or jsonb_array_length(e->'instead') > 3
      or exists (
        select 1 from jsonb_array_elements(e->'instead') i
        where jsonb_typeof(i) <> 'string' or char_length(i #>> '{}') not between 1 and 170
          or (i #>> '{}') !~ '^[^[:space:][:cntrl:]]+( [^[:space:][:cntrl:]]+){0,3}$'
      )
  ) then
    raise exception 'Invalid never words' using errcode = '23514';
  end if;
  if (select count(distinct e->>'phrase') from jsonb_array_elements(words) e) <> jsonb_array_length(words)
    or (select count(*) from jsonb_array_elements(words) e where e->>'state' = 'never') > 100
    or (select count(*) from jsonb_array_elements(words) e where e->>'state' = 'watched') > 100 then
    raise exception 'Invalid never words' using errcode = '23514';
  end if;
  -- A newer read already kept the list or the history: nothing to write.
  if exists (
    select 1 from public.brand_never_words w
      join public.job_runs r on r.tenant_id = w.tenant_id and r.id = w.run_id
    where w.tenant_id = j.tenant_id and r.id <> j.id and r.created_at > j.created_at
  ) or exists (
    select 1 from public.klaviyo_history h
      join public.job_runs r on r.tenant_id = h.tenant_id and r.id = h.run_id
    where h.tenant_id = j.tenant_id and h.state in ('ready','empty') and r.id <> j.id and r.created_at > j.created_at
  ) then
    return 0;
  end if;
  delete from public.brand_never_words where tenant_id = j.tenant_id;
  insert into public.brand_never_words(tenant_id, phrase, state, removed, kept, instead, run_id)
    select j.tenant_id, e->>'phrase', e->>'state', (e->>'removed')::integer, (e->>'kept')::integer,
      e->'instead', j.id
    from jsonb_array_elements(words) e;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_never_words(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_never_words(uuid, uuid, jsonb) to service_role;
