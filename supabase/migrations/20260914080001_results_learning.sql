create table public.campaign_send_metadata (
 package_id uuid primary key references public.delivery_packages(id),tenant_id uuid not null references public.tenants(id),campaign_id uuid not null,subject_group text not null check(subject_group in ('short','detailed')),comparison_key jsonb not null,snapshot jsonb not null,created_at timestamptz not null default now(),foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id)
);
create table public.campaign_results (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),delivery_id uuid not null references public.fixture_deliveries(id),package_id uuid not null references public.delivery_packages(id),window_key text not null check(window_key in ('48h','7d')),source text not null check(source='fixture'),window_start timestamptz not null,window_end timestamptz not null,collected_at timestamptz not null,complete boolean not null,comparable boolean not null,recipients integer not null check(recipients>=0),clicks integer not null check(clicks between 0 and recipients),revenue_minor bigint not null check(revenue_minor>=0),currency text not null check(currency='USD'),unsubscribes integer not null check(unsubscribes between 0 and recipients),spam integer not null check(spam between 0 and recipients),confounders jsonb not null check(jsonb_typeof(confounders)='array'),created_at timestamptz not null default now(),unique(delivery_id,window_key),check(window_end>window_start and collected_at>=window_end)
);
create table public.fixture_metric_controls (
 delivery_id uuid primary key references public.fixture_deliveries(id),tenant_id uuid not null references public.tenants(id),scenario text not null check(scenario in ('complete','partial','incomparable')),updated_at timestamptz not null default now()
);
create table public.learned_rules (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),kind text not null check(kind='subject_length'),preferred_group text not null check(preferred_group in ('short','detailed')),comparison_key jsonb not null,evidence jsonb not null,evidence_hash text not null,summary text not null,status text not null default 'proposed' check(status in ('proposed','pinned','dismissed')),revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,kind,evidence_hash)
);
create table public.learning_runs (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),job_id uuid not null unique references public.job_runs(id),status text not null check(status in ('proposed','insufficient')),detail jsonb not null,created_at timestamptz not null default now()
);
create table public.result_digests (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),local_date date not null,observed_at timestamptz not null,snapshot jsonb not null,created_at timestamptz not null default now(),unique(tenant_id,local_date)
);
do $$declare tab text;begin foreach tab in array array['campaign_send_metadata','campaign_results','fixture_metric_controls','learned_rules','learning_runs','result_digests'] loop execute format('alter table public.%I enable row level security',tab);execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id,array[''owner'',''admin'']::public.tenant_role[]))',tab);execute format('grant select on public.%I to authenticated',tab);end loop;end $$;
