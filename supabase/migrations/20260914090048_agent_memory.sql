-- MEM-001 part 2: shared agent memory (AGENT_MAP.md §0, decisions D16 and D22).
-- Do's and don'ts, Brand book versions and the agent run log. Only the
-- server worker (service role) writes; a workspace's active members read
-- their own rows; operators read everything for the fallback log. Platform
-- and industry rules (tenant_id null) are never shown to clients.
-- The number is chosen at merge time (D24).

create table public.agent_memory_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  industry text check (industry is null or char_length(btrim(industry)) between 1 and 60),
  kind text not null check (kind in ('do', 'dont')),
  rule text not null check (char_length(btrim(rule)) between 5 and 500),
  why text not null default '' check (char_length(why) <= 1000),
  applies_to text[] not null default '{}' check (cardinality(applies_to) <= 30),
  confidence numeric(3,2) not null check (confidence between 0 and 1),
  source text not null check (source in ('results', 'inspector', 'owner_edit', 'seed')),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  status text not null default 'active' check (status in ('active', 'expired', 'retired')),
  expires_at timestamptz,
  -- A retried learning job sends the same key and gets the same rule back.
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_memory_rules_tenant_idx on public.agent_memory_rules (tenant_id, status);
create index agent_memory_rules_industry_idx on public.agent_memory_rules (industry, status) where tenant_id is null;

create table public.brand_books (
  tenant_id uuid not null references public.tenants(id),
  version integer not null check (version >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 200000),
  written_by text not null check (char_length(written_by) between 1 and 60),
  created_at timestamptz not null default now(),
  primary key (tenant_id, version)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  agent text not null check (char_length(agent) between 1 and 60),
  version text not null check (char_length(version) between 1 and 40),
  caller_key text not null check (char_length(caller_key) between 1 and 200),
  prompt_digest text not null check (prompt_digest ~ '^[0-9a-f]{64}$'),
  rule_ids uuid[] not null default '{}',
  brand_book_version integer,
  provider text,
  model text,
  cost_micro bigint not null default 0 check (cost_micro >= 0),
  verdict text not null check (verdict in ('ok', 'invalid_output', 'failed', 'fallback')),
  detail text check (detail is null or char_length(detail) <= 500),
  output jsonb,
  -- One key per recorded run: a retried write returns the same row.
  run_key uuid not null unique,
  created_at timestamptz not null default now()
);
create index agent_runs_tenant_idx on public.agent_runs (tenant_id, created_at desc);
create index agent_runs_agent_idx on public.agent_runs (agent, verdict, created_at desc);

alter table public.agent_memory_rules enable row level security;
alter table public.brand_books enable row level security;
alter table public.agent_runs enable row level security;

create policy memory_rules_member_read on public.agent_memory_rules for select to authenticated
  using ((tenant_id is not null and private.is_active_member(tenant_id)) or private.is_operator());
create policy brand_books_member_read on public.brand_books for select to authenticated
  using (private.is_active_member(tenant_id) or private.is_operator());
-- Runs carry AI cost and raw output: owners and admins only, like other cost tables.
create policy agent_runs_member_read on public.agent_runs for select to authenticated
  using ((tenant_id is not null and private.is_active_member(tenant_id, array['owner','admin']::public.tenant_role[])) or private.is_operator());

revoke all on public.agent_memory_rules, public.brand_books, public.agent_runs from public, anon, authenticated;
grant select on public.agent_memory_rules, public.brand_books, public.agent_runs to authenticated;
-- Even the worker writes only through the commands below.
revoke insert, update, delete, truncate, references, trigger on public.agent_memory_rules, public.brand_books, public.agent_runs from service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.agent_memory_rules, public.brand_books, public.agent_runs from public, anon, authenticated, service_role';
  end if;
end $$;

-- Writes go through these worker commands (service role only).
create or replace function public.record_agent_run(run jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; ids jsonb := nullif(run->'ruleIds', 'null'::jsonb);
begin
 perform private.require_service();
 if ids is not null and jsonb_typeof(ids) <> 'array' then raise exception 'ruleIds must be a list' using errcode='23514'; end if;
 insert into public.agent_runs (tenant_id, agent, version, caller_key, prompt_digest, rule_ids, brand_book_version,
   provider, model, cost_micro, verdict, detail, output, run_key)
 values ((run->>'tenantId')::uuid, run->>'agent', run->>'version', run->>'callerKey', run->>'promptDigest',
   coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(ids, '[]'::jsonb)) x), '{}'),
   (run->>'brandBookVersion')::integer, run->>'provider', run->>'model', coalesce((run->>'costMicro')::bigint, 0),
   run->>'verdict', left(run->>'detail', 500), nullif(run->'output', 'null'::jsonb), (run->>'runKey')::uuid)
 on conflict (run_key) do nothing
 returning id into rid;
 if rid is null then select a.id into rid from public.agent_runs a where a.run_key = (run->>'runKey')::uuid; end if;
 return rid;
end $$;

create or replace function public.add_memory_rule(r jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; c numeric; applies jsonb := nullif(r->'appliesTo', 'null'::jsonb); ev jsonb := coalesce(nullif(r->'evidence', 'null'::jsonb), '[]'::jsonb);
begin
 perform private.require_service();
 c := (r->>'confidence')::numeric;
 if c is null or c < 0 or c > 1 then raise exception 'Confidence must be between 0 and 1' using errcode='23514'; end if;
 if applies is not null and jsonb_typeof(applies) <> 'array' then raise exception 'appliesTo must be a list' using errcode='23514'; end if;
 insert into public.agent_memory_rules (tenant_id, industry, kind, rule, why, applies_to, confidence, source,
   evidence_count, evidence, expires_at, idempotency_key)
 values ((r->>'tenantId')::uuid, nullif(btrim(r->>'industry'), ''), r->>'kind', btrim(r->>'rule'), coalesce(r->>'why', ''),
   coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(applies, '[]'::jsonb)) x), '{}'),
   c, r->>'source', coalesce((r->>'evidenceCount')::integer, 0), ev, (r->>'expiresAt')::timestamptz, r->>'idempotencyKey')
 on conflict (idempotency_key) do nothing
 returning id into rid;
 if rid is null then select m.id into rid from public.agent_memory_rules m where m.idempotency_key = r->>'idempotencyKey'; end if;
 return rid;
end $$;

-- Later results can weaken or retire a rule (D22). The caller passes the
-- revision it read; expired and retired rules never come back.
create or replace function public.update_memory_rule(rule_id uuid, expected_revision integer, new_status text, new_confidence numeric) returns integer language plpgsql security definer set search_path='' as $$
declare m public.agent_memory_rules;
begin
 perform private.require_service();
 if new_status is null or new_status not in ('active', 'expired', 'retired') or new_confidence is null or new_confidence < 0 or new_confidence > 1 then
  raise exception 'Invalid rule update' using errcode='23514';
 end if;
 select * into m from public.agent_memory_rules where id = rule_id for update;
 if m.id is null then raise exception 'Rule unavailable' using errcode='42501'; end if;
 if m.revision <> expected_revision then raise exception 'Rule changed since it was read' using errcode='PT409'; end if;
 if m.status <> 'active' and new_status = 'active' then raise exception 'An expired or retired rule cannot come back' using errcode='PT409'; end if;
 update public.agent_memory_rules set status = new_status, confidence = new_confidence, revision = revision + 1, updated_at = now() where id = rule_id;
 return m.revision + 1;
end $$;

create or replace function public.save_brand_book(t uuid, content jsonb, written_by text) returns integer language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 perform private.require_service();
 perform 1 from public.tenants where id = t and status = 'active' for update;
 if not found then raise exception 'Active workspace required' using errcode='42501'; end if;
 select coalesce(max(b.version), 0) + 1 into v from public.brand_books b where b.tenant_id = t;
 insert into public.brand_books (tenant_id, version, content, written_by) values (t, v, content, written_by);
 return v;
end $$;

revoke all on function public.record_agent_run(jsonb), public.add_memory_rule(jsonb),
  public.update_memory_rule(uuid, integer, text, numeric), public.save_brand_book(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_agent_run(jsonb), public.add_memory_rule(jsonb),
  public.update_memory_rule(uuid, integer, text, numeric), public.save_brand_book(uuid, jsonb, text) to service_role;
