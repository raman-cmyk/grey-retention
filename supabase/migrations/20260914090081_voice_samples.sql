-- PIC-23 part 2b (owner pick #23, the founder's voice): the owner's own
-- words from the emails the store sent, as short excerpts safe to keep
-- (features/letter/voice/excerpt.ts): people's names, emails, links,
-- phones, addresses, reviews and Klaviyo's tags already out; never raw
-- HTML. At most 20 a workspace, 60,000 characters in all. Only the history
-- read (`brand.read_history`) writes them, under its own lease, replacing
-- the ones an earlier read kept; the workspace's active members read them.

create table public.brand_voice_samples (
  tenant_id uuid not null references public.tenants(id),
  -- The Klaviyo message the words come from.
  message_id text not null check (message_id ~ '^[A-Za-z0-9]{1,64}$'),
  -- The history read that kept them.
  run_id uuid not null,
  text text not null check (char_length(text) between 1 and 8000),
  -- 3: Klaviyo's rich text editor (a letter), 2: custom code, 1: designed.
  weight smallint not null check (weight between 1 and 3),
  -- The owner's words in it (placeholders not counted).
  words integer not null check (words between 25 and 8000),
  sent_at timestamptz,
  read_at timestamptz not null default now(),
  primary key (tenant_id, message_id),
  foreign key (tenant_id, run_id) references public.job_runs(tenant_id, id)
);
alter table public.brand_voice_samples enable row level security;
create policy member_read on public.brand_voice_samples for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.brand_voice_samples from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.brand_voice_samples from authenticated;
grant select on public.brand_voice_samples to authenticated;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.brand_voice_samples from authenticated';
  end if;
end $$;

-- The history read keeps what it found: every sample checked, then the
-- workspace's samples replaced at once (an empty list clears them: a read
-- that found none). The sample account's words only for a synthetic brand.
create or replace function public.record_voice_samples(job uuid, lease uuid, samples jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; n integer;
  keys constant text[] := array['messageId','text','weight','words','sentAt'];
  iso constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$';
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_history' then raise exception 'Not a history reading job' using errcode = '23514'; end if;
  if coalesce(j.input->>'mode', '') <> 'live'
    and not coalesce((select b.synthetic from public.brand_profiles b where b.tenant_id = j.tenant_id), false) then
    raise exception 'Invalid voice samples' using errcode = '23514';
  end if;
  if jsonb_typeof(samples) is distinct from 'array' or jsonb_array_length(samples) > 20 then
    raise exception 'Invalid voice samples' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(samples) e
    where jsonb_typeof(e) <> 'object'
      or not (e ?& array['messageId','text','weight','words'])
      or exists (select 1 from jsonb_object_keys(e) k where not (k = any (keys)))
      or jsonb_typeof(e->'messageId') <> 'string' or (e->>'messageId') !~ '^[A-Za-z0-9]{1,64}$'
      or jsonb_typeof(e->'text') <> 'string' or char_length(e->>'text') not between 1 and 8000
      or jsonb_typeof(e->'weight') <> 'number' or (e->>'weight') !~ '^[123]$'
      or jsonb_typeof(e->'words') <> 'number' or (e->>'words') !~ '^[0-9]{2,4}$'
      or (e->>'words')::integer < 25
      or (e ? 'sentAt' and jsonb_typeof(e->'sentAt') <> 'null'
        and (jsonb_typeof(e->'sentAt') <> 'string' or (e->>'sentAt') !~ iso))
  ) then
    raise exception 'Invalid voice samples' using errcode = '23514';
  end if;
  if (select count(distinct e->>'messageId') from jsonb_array_elements(samples) e) <> jsonb_array_length(samples)
    or (select coalesce(sum(char_length(e->>'text')), 0) from jsonb_array_elements(samples) e) > 60000 then
    raise exception 'Invalid voice samples' using errcode = '23514';
  end if;
  delete from public.brand_voice_samples where tenant_id = j.tenant_id;
  insert into public.brand_voice_samples(tenant_id, message_id, run_id, text, weight, words, sent_at)
    select j.tenant_id, e->>'messageId', j.id, e->>'text', (e->>'weight')::smallint, (e->>'words')::integer,
      (e->>'sentAt')::timestamptz
    from jsonb_array_elements(samples) e;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.record_voice_samples(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_voice_samples(uuid, uuid, jsonb) to service_role;
