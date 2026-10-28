create table public.assets (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),storage_path text not null,
 filename text not null check(length(filename) between 1 and 250),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 media_type text not null check(media_type in ('image/png','image/jpeg','image/webp')),byte_size integer not null check(byte_size between 12 and 10485760),
 source text not null check(source in ('upload','zip','drive_fixture')),category text check(category in ('product','lifestyle','proof','logo','unusable')),
 product_id uuid,variant_id uuid,confidence numeric check(confidence between 0 and 1),revision integer not null default 1,
 classification_source text check(classification_source in ('fixture','owner')),synthetic boolean not null default false,
 uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,sha256),unique(tenant_id,id),unique(storage_path),
 foreign key(tenant_id,product_id) references public.products(tenant_id,id),foreign key(tenant_id,variant_id) references public.product_variants(tenant_id,id)
);
create table public.asset_imports (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),idempotency_key text not null,
 state text not null default 'processing' check(state in ('processing','complete','partial','failed')),source text not null check(source in ('upload','zip')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(tenant_id,idempotency_key),unique(tenant_id,id)
);
create table public.asset_import_items (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),import_id uuid not null,filename text not null,
 asset_id uuid,status text not null check(status in ('stored','duplicate','failed')),error_code text,
 unique(import_id,filename),foreign key(tenant_id,import_id) references public.asset_imports(tenant_id,id),foreign key(tenant_id,asset_id) references public.assets(tenant_id,id)
);
create table public.asset_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),asset_id uuid not null,actor_id uuid references public.profiles(id),
 action text not null,detail jsonb not null,created_at timestamptz not null default now(),foreign key(tenant_id,asset_id) references public.assets(tenant_id,id)
);
do $$ declare t text; begin foreach t in array array['assets','asset_imports','asset_import_items','asset_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
end loop; end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('brand-assets','brand-assets',false,10485760,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
