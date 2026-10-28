create table public.brand_profiles (
  tenant_id uuid primary key references public.tenants(id),
  brand_name text not null check(char_length(brand_name) between 2 and 120),
  domain text not null default '',
  positioning text not null default '' check(char_length(positioning) <= 5000),
  voice text not null default '' check(char_length(voice) <= 5000),
  prohibitions text not null default '' check(char_length(prohibitions) <= 5000),
  corrections jsonb not null default '{}' check(jsonb_typeof(corrections) = 'object'),
  revision integer not null default 1 check(revision > 0),
  approved_revision integer,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(approved_revision is null or approved_revision = revision)
);
create table public.products (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  title text not null check(char_length(title) between 2 and 200),
  url text not null check(url ~ '^https://'),
  price_minor integer not null default 0 check(price_minor >= 0), currency text not null default 'USD' check(char_length(currency)=3),
  stock integer not null default 0 check(stock >= 0), stock_observed_at timestamptz not null,
  source text not null check(source in ('manual','fixture')), synthetic boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,id)
);
create table public.offers (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  label text not null check(char_length(label) between 2 and 200), kind text not null check(kind in ('evergreen','discount','sitewide')),
  depth_percent integer not null default 0 check(depth_percent between 0 and 100), conditions text not null check(char_length(conditions) between 1 and 2000),
  starts_at timestamptz not null, ends_at timestamptz not null, revision integer not null default 1,
  approved_by uuid not null references public.profiles(id), synthetic boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_at > starts_at), check(kind <> 'evergreen' or depth_percent = 0), unique(tenant_id,id)
);

alter table public.brand_profiles enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
create policy brand_read on public.brand_profiles for select to authenticated using(private.is_active_member(tenant_id));
create policy product_read on public.products for select to authenticated using(private.is_active_member(tenant_id));
create policy offer_read on public.offers for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.brand_profiles, public.products, public.offers to authenticated;
create index products_tenant_idx on public.products(tenant_id,created_at);
create index offers_tenant_idx on public.offers(tenant_id,starts_at,ends_at);
