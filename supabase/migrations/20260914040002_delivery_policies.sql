create table public.delivery_policies (
 tenant_id uuid primary key references public.tenants(id),revision integer not null default 1,level text not null default 'L0' check(level in ('L0','L1')),enabled boolean not null default false,
 defaults jsonb not null check(jsonb_typeof(defaults)='object'),approved_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),check(level='L1' or not enabled)
);
create table public.delivery_policy_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),revision integer not null,snapshot jsonb not null,actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(tenant_id,revision)
);
alter table public.delivery_policies enable row level security;
alter table public.delivery_policy_events enable row level security;
create policy tenant_read on public.delivery_policies for select to authenticated using(private.is_active_member(tenant_id));
create policy tenant_read on public.delivery_policy_events for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.delivery_policies,public.delivery_policy_events to authenticated;
