create table public.workspace_connections (
 tenant_id uuid not null references public.tenants(id),provider text not null check(provider in ('klaviyo','shopify','drive')),
 mode text not null default 'fixture' check(mode='fixture'),status text not null check(status in ('connected','disconnected','expired','error')),
 fixture_account text not null,folder_id text,read_only boolean not null default true check(read_only),revision integer not null default 1,
 last_sync_at timestamptz,last_error text,updated_at timestamptz not null default now(),primary key(tenant_id,provider)
);
alter table public.workspace_connections enable row level security;
create policy tenant_read on public.workspace_connections for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.workspace_connections to authenticated;
alter table public.job_runs drop constraint job_runs_kind_check;
alter table public.job_runs add constraint job_runs_kind_check check(kind in ('copy.generate','delivery.schedule','delivery.cancel','assets.classify','drive.sync','commerce.sync','brand.extract'));
