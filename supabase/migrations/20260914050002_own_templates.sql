create table public.own_templates (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),name text not null check(length(name) between 2 and 200),
 skeleton jsonb not null check(jsonb_typeof(skeleton)='object'),campaign_id uuid not null,delivery_id uuid not null references public.fixture_deliveries(id),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(delivery_id),foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id)
);
alter table public.own_templates enable row level security;
create policy tenant_read on public.own_templates for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.own_templates to authenticated;
