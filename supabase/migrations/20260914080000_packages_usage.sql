create table public.packages (
 id uuid primary key default gen_random_uuid(),name text not null unique check(length(name) between 2 and 200),revision integer not null default 1,allocation_micro bigint not null check(allocation_micro between 1000 and 1000000000),daily_micro bigint not null check(daily_micro between 1000 and allocation_micro),price_minor integer not null default 0 check(price_minor>=0),currency text not null default 'USD' check(currency='USD'),cycle_days integer not null default 30 check(cycle_days between 1 and 366),synthetic boolean not null default true check(synthetic),active boolean not null default true,created_at timestamptz not null default now()
);
create table public.package_cycles (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),package_id uuid not null references public.packages(id),snapshot jsonb not null,allocation_micro bigint not null check(allocation_micro>0),daily_micro bigint not null check(daily_micro>0),used_micro bigint not null default 0 check(used_micro>=0),reserved_micro bigint not null default 0 check(reserved_micro>=0),starts_at timestamptz not null default now(),ends_at timestamptz not null,state text not null default 'active' check(state in ('active','closed')),created_at timestamptz not null default now(),unique(tenant_id,id)
);
create unique index one_active_cycle on public.package_cycles(tenant_id) where state='active';
create table public.usage_reservations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,cycle_id uuid not null,operation_id text not null,feature text not null check(feature in ('copy','design','assets','playbook','calendar','gros','learning')),estimate_micro bigint not null check(estimate_micro>0),actual_micro bigint check(actual_micro>=0),state text not null default 'reserved' check(state in ('reserved','reconciled','released')),local_date date not null,expires_at timestamptz not null default now()+interval '10 minutes',created_at timestamptz not null default now(),unique(tenant_id,operation_id),foreign key(tenant_id,cycle_id) references public.package_cycles(tenant_id,id)
);
create table public.budget_alerts (
 cycle_id uuid not null references public.package_cycles(id),tenant_id uuid not null references public.tenants(id),window_key text not null,created_at timestamptz not null default now(),primary key(cycle_id,window_key)
);
alter table public.packages enable row level security;
create policy readable on public.packages for select to authenticated using(private.is_profile_active());
grant select on public.packages to authenticated;
do $$declare tab text;begin foreach tab in array array['package_cycles','usage_reservations','budget_alerts'] loop execute format('alter table public.%I enable row level security',tab);execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id,array[''owner'',''admin'']::public.tenant_role[]))',tab);execute format('grant select on public.%I to authenticated',tab);end loop;end $$;
insert into public.packages(name,allocation_micro,daily_micro) values('Synthetic fixture starter',20000000,2000000);
