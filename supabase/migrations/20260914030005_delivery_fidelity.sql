alter table public.job_runs drop constraint job_runs_kind_check;
alter table public.job_runs add constraint job_runs_kind_check check(kind in ('copy.generate','delivery.schedule','delivery.cancel','delivery.reschedule','assets.classify','drive.sync','commerce.sync','brand.extract','competitors.capture','playbook.synthesize','calendar.plan','reviews.remind','design.render'));
create table public.segment_registry (
 tenant_id uuid not null references public.tenants(id),account_id text not null,canonical_key text not null check(canonical_key in ('engaged','purchasers','suppressed')),
 provider_id text not null,definition text not null,synthetic boolean not null default true check(synthetic),created_at timestamptz not null default now(),primary key(tenant_id,account_id,canonical_key)
);
create table public.fixture_fault_controls (
 tenant_id uuid not null references public.tenants(id),campaign_id uuid not null,scenario text not null check(scenario in ('none','transient_once','rate_limit_once','auth_permanent','validation_permanent','timeout_after_success','unknown_reconcile','cancel_rejected')),
 consumed boolean not null default false,revision integer not null default 1,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),primary key(tenant_id,campaign_id)
);
create table public.fixture_delivery_history (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),delivery_id uuid not null references public.fixture_deliveries(id),package_id uuid not null,
 state text not null,snapshot jsonb not null,scheduled_at timestamptz,recorded_at timestamptz not null default now(),foreign key(tenant_id,package_id) references public.delivery_packages(tenant_id,id)
);
alter table public.fixture_deliveries add column sent_at timestamptz;
do $$declare tab text;begin foreach tab in array array['segment_registry','fixture_fault_controls','fixture_delivery_history'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',tab);
 execute format('grant select on public.%I to authenticated',tab);
end loop;end $$;
