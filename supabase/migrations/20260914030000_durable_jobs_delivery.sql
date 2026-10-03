create table public.job_runs (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),campaign_id uuid,
 kind text not null check(kind in ('copy.generate','delivery.schedule','delivery.cancel')), idempotency_key text not null,
 status text not null default 'queued' check(status in ('queued','leased','running','retry_wait','succeeded','failed','cancelled')),
 input jsonb not null check(jsonb_typeof(input)='object'),checkpoint jsonb not null default '{}',
 attempt integer not null default 0 check(attempt between 0 and 4),max_attempts integer not null default 4 check(max_attempts=4),
 lease_token uuid,lease_until timestamptz,available_at timestamptz not null default now(), failure_class text, error_code text,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,idempotency_key),unique(tenant_id,id)
);
create table public.delivery_packages (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),campaign_id uuid not null,revision integer not null,
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(campaign_id,revision),unique(tenant_id,id)
);
create table public.fixture_deliveries (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),package_id uuid not null,
 idempotency_key text not null,snapshot jsonb not null, state text not null check(state in ('prepared','scheduled','sent','cancelled')),scheduled_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,idempotency_key),unique(package_id),
 foreign key(tenant_id,package_id) references public.delivery_packages(tenant_id,id)
);
do $$ declare t text; begin
 foreach t in array array['job_runs','delivery_packages','fixture_deliveries'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create index %I on public.%I(tenant_id,created_at)',t||'_tenant_idx',t);
 end loop;
end $$;
create index job_runs_due_idx on public.job_runs(tenant_id,available_at) where status in ('queued','retry_wait','leased','running');
