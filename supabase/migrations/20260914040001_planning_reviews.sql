create table public.planning_preferences (
 tenant_id uuid primary key references public.tenants(id),revision integer not null default 1,weekly_cap integer not null default 5 check(weekly_cap between 1 and 5),discount_cap integer not null default 40 check(discount_cap between 0 and 40),sitewide_gap integer not null default 7 check(sitewide_gap>=7),generation integer not null default 0,updated_by uuid references public.profiles(id),updated_at timestamptz not null default now()
);
create table public.campaign_sequences (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),plan_id uuid not null,key text not null,brief text not null,created_at timestamptz not null default now(),unique(plan_id,key),unique(tenant_id,id)
);
create table public.campaign_rejections (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),campaign_id uuid not null,kind text not null check(kind in ('calendar','copy')),revision integer not null,
 reason text not null check(length(reason) between 5 and 5000),scope text not null check(scope in ('single','sequence','audience')),actor_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create table public.owner_rules (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),campaign_id uuid,sequence_id uuid,audience_id uuid,
 scope text not null check(scope in ('single','sequence','audience')),forbidden_phrase text not null check(length(forbidden_phrase) between 1 and 200),active boolean not null default true,
 revision integer not null default 1,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(tenant_id,id)
);
create table public.copy_review_batches (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),week_start date not null,timezone text not null,
 revisions jsonb not null check(jsonb_typeof(revisions)='array'),status text not null default 'open' check(status in ('open','approved')),expires_at timestamptz not null default now()+interval '30 minutes',
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),approved_at timestamptz
);
alter table public.campaigns add column superseded_by_plan uuid;
alter table public.campaign_content add column input_revisions jsonb not null default '{}',add column verified_claims jsonb not null default '[]',add column validation_state text not null default 'pending' check(validation_state in ('pending','passed','blocked')),add column validation_errors text[] not null default '{}';
do $$ declare t text; begin foreach t in array array['planning_preferences','campaign_sequences','campaign_rejections','owner_rules','copy_review_batches'] loop
 execute format('alter table public.%I enable row level security',t);execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
