create table public.workspace_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),actor_id uuid references public.profiles(id),kind text not null,entity_id uuid,detail jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.holidays (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),name text not null check(length(name) between 2 and 200),event_date date not null,notes text not null default '' check(length(notes)<=2000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create table public.support_tickets (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),creator_id uuid not null references public.profiles(id),kind text not null check(kind in ('support','feedback')),subject text not null check(length(subject) between 2 and 200),state text not null default 'open' check(state in ('open','in_progress','closed')),revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,id)
);
create table public.support_messages (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,ticket_id uuid not null,actor_id uuid not null references public.profiles(id),body text not null check(length(body) between 1 and 5000),created_at timestamptz not null default now(),foreign key(tenant_id,ticket_id) references public.support_tickets(tenant_id,id)
);
create table public.assignment_requests (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),campaign_id uuid not null,requested_by uuid not null references public.profiles(id),state text not null default 'open' check(state in ('open','assigned')),created_at timestamptz not null default now()
);
do $$declare tab text;begin foreach tab in array array['workspace_events','holidays','support_tickets','support_messages','assignment_requests'] loop execute format('alter table public.%I enable row level security',tab);execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',tab);execute format('grant select on public.%I to authenticated',tab);end loop;end $$;
