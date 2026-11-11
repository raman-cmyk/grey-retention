-- RET-002 (decision D16): nothing waits for a person. When an agent's check
-- keeps failing, the job falls back to a safer option and records why here.
-- This is a log, not a queue: there is no open/resolved state and nobody has
-- to act on it. Platform admins read it (Admin -> Operations); the learning
-- agents (LRN-002) later turn repeated entries into "don'ts".
--
-- * Only jobs write (service role, through public.record_fallback).
-- * One row per problem (tenant + dedupe key); a repeat adds to `occurrences`
--   and keeps the latest reason, so a retried job does not flood the log.
-- * Platform-wide work (competitor intelligence) has no tenant.
-- * Not the run log: agent_runs (MEM-001) keeps every AI call; this keeps one
--   line per give-up decision, AI or code, with detail.runId when there is one.
-- * Platform admins read every workspace's entries, so the reason is fixed
--   words per rule or code, never the email's copy, codes or products.

create table public.agent_fallbacks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  campaign_id uuid,
  -- Which agent or check gave up: the AgentDefinition name (MEM-001), for
  -- example 'copy-check', 'brand-inspector' or 'assembly'.
  agent text not null check (agent ~ '^[a-z][a-z0-9_-]{1,59}$'),
  -- A stable reason key for grouping, for example 'copy_check_failed'.
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  -- Plain words for an admin: what went wrong.
  reason text not null check (length(btrim(reason)) between 1 and 500),
  -- Plain words: what the system did instead.
  fallback text not null check (length(btrim(fallback)) between 1 and 300),
  attempts integer not null default 0 check (attempts between 0 and 10),
  -- Small structured facts (failed rules, revision, model); never prompts,
  -- copy, provider payloads or secrets.
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 4000),
  -- Built by the caller from stable ids, for example 'copy_check:<campaign>:<revision>'.
  dedupe_key text not null check (length(dedupe_key) <= 300 and dedupe_key ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]*$'),
  occurrences integer not null default 1 check (occurrences >= 1),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (campaign_id is null or tenant_id is not null),
  foreign key (tenant_id, campaign_id) references public.campaigns(tenant_id, id) on delete cascade
);
create unique index agent_fallbacks_one_per_problem on public.agent_fallbacks (tenant_id, dedupe_key) nulls not distinct;
create index agent_fallbacks_recent on public.agent_fallbacks (last_seen_at desc);
create index agent_fallbacks_campaign on public.agent_fallbacks (tenant_id, campaign_id) where campaign_id is not null;

alter table public.agent_fallbacks enable row level security;
create policy operator_read on public.agent_fallbacks for select to authenticated using ((select private.is_operator()));
-- Only the command below writes, so every entry is checked and counted:
-- jobs (service role) cannot write the table directly either.
revoke all on public.agent_fallbacks from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.agent_fallbacks from service_role;
grant select on public.agent_fallbacks to authenticated;

create or replace function public.record_fallback(
  tenant uuid,
  campaign uuid,
  agent_key text,
  reason_key text,
  reason_text text,
  fallback_text text,
  tries integer,
  facts jsonb,
  dedupe text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  entry uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs record fallbacks.' using errcode = '42501';
  end if;
  if agent_key is null or reason_key is null or reason_text is null or fallback_text is null or dedupe is null then
    raise exception 'A fallback needs an agent, a reason, what was done instead and a dedupe key.' using errcode = '22023';
  end if;
  if campaign is not null and tenant is null then
    raise exception 'A campaign fallback needs its workspace.' using errcode = '22023';
  end if;
  -- Lock order: tenant first, then the campaign. Key-share locks only keep
  -- the rows from being deleted while the entry is written.
  if tenant is not null then
    perform 1 from public.tenants where id = tenant for key share;
    if not found then
      raise exception 'Unknown workspace.' using errcode = '22023';
    end if;
  end if;
  if campaign is not null then
    perform 1 from public.campaigns where id = campaign and tenant_id = tenant for key share;
    if not found then
      raise exception 'That campaign is not in this workspace.' using errcode = '22023';
    end if;
  end if;

  insert into public.agent_fallbacks as f
    (tenant_id, campaign_id, agent, reason_code, reason, fallback, attempts, detail, dedupe_key)
  values
    (tenant, campaign, agent_key, reason_key, btrim(reason_text), btrim(fallback_text),
     coalesce(tries, 0), coalesce(facts, '{}'::jsonb), dedupe)
  -- A repeat keeps its campaign, so it still goes when that campaign goes.
  on conflict (tenant_id, dedupe_key) do update set
    agent = excluded.agent,
    reason_code = excluded.reason_code,
    reason = excluded.reason,
    fallback = excluded.fallback,
    attempts = excluded.attempts,
    detail = excluded.detail,
    occurrences = f.occurrences + 1,
    last_seen_at = now()
  returning f.id into entry;
  return entry;
end $$;

revoke all on function public.record_fallback(uuid, uuid, text, text, text, text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_fallback(uuid, uuid, text, text, text, text, integer, jsonb, text) to service_role;

-- Admin -> Operations reads the latest entries with their workspace names
-- (platform admins cannot read workspaces directly).
create or replace function public.admin_fallback_log(max_rows integer default 50)
returns table (
  id uuid,
  workspace text,
  campaign_id uuid,
  agent text,
  reason_code text,
  reason text,
  fallback text,
  attempts integer,
  occurrences integer,
  detail jsonb,
  created_at timestamptz,
  last_seen_at timestamptz
) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_operator() then
    raise exception 'Only platform admins read the fallback log.' using errcode = '42501';
  end if;
  return query
    select f.id, t.name, f.campaign_id, f.agent, f.reason_code, f.reason, f.fallback,
           f.attempts, f.occurrences, f.detail, f.created_at, f.last_seen_at
    from public.agent_fallbacks f
    left join public.tenants t on t.id = f.tenant_id
    order by f.last_seen_at desc, f.id
    limit least(greatest(coalesce(max_rows, 50), 1), 200);
end $$;

revoke all on function public.admin_fallback_log(integer) from public, anon;
grant execute on function public.admin_fallback_log(integer) to authenticated;
