create table public.ai_calls (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 job_id uuid not null unique, feature text not null, prompt_version text not null, provider text not null check(provider='fixture'),
 status text not null check(status in ('succeeded','failed')), input_tokens integer not null check(input_tokens>=0),output_tokens integer not null check(output_tokens>=0),
 cost_micro_usd bigint not null default 0 check(cost_micro_usd>=0), input_revisions jsonb not null, created_at timestamptz not null default now()
);
alter table public.ai_calls enable row level security;
create policy ai_call_read on public.ai_calls for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.ai_calls to authenticated;
create index ai_calls_tenant_idx on public.ai_calls(tenant_id,created_at);
