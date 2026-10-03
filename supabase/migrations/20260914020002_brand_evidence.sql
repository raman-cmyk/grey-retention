create table public.brand_versions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),revision integer not null,
 snapshot jsonb not null,recorded_by uuid references public.profiles(id),created_at timestamptz not null default now(),unique(tenant_id,revision)
);
create table public.brand_kits (
 tenant_id uuid primary key references public.tenants(id),revision integer not null default 1,
 colors text[] not null default '{}',fonts text[] not null default '{}',source_text text not null default '',
 synthetic boolean not null default true,approved_by uuid references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.product_variants (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),product_id uuid not null,
 sku text not null,title text not null,stock integer not null check(stock>=0),observed_at timestamptz not null default now(),synthetic boolean not null default true,
 unique(tenant_id,sku),unique(tenant_id,id),foreign key(tenant_id,product_id) references public.products(tenant_id,id)
);
do $$ declare t text; begin foreach t in array array['brand_versions','brand_kits','product_variants'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
end loop; end $$;
