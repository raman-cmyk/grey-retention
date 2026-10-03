create table public.audiences (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 label text not null check(char_length(label) between 2 and 200), account_id text not null,
 canonical_key text not null check(canonical_key in ('engaged','purchasers')), provider_id text not null,
 excluded_provider_ids text[] not null check(cardinality(excluded_provider_ids) > 0),
 synthetic boolean not null default false, created_at timestamptz not null default now(), unique(tenant_id,id), unique(tenant_id,canonical_key)
);
create table public.campaigns (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 title text not null check(char_length(title) between 2 and 200), goal text not null default '' check(char_length(goal)<=5000),
 channel text not null check(channel in ('email_design','email_text')), planned_at timestamptz not null, timezone text not null,
 audience_id uuid, product_id uuid, offer_id uuid, reference_notes text not null default '' check(char_length(reference_notes)<=5000),
 calendar_revision integer not null default 1 check(calendar_revision>0), calendar_state text not null default 'proposed' check(calendar_state in ('proposed','approved','rejected')),
 copy_revision integer not null default 1 check(copy_revision>0), copy_state text not null default 'draft' check(copy_state in ('draft','pending_approval','approved','rejected')),
 design_revision integer not null default 1 check(design_revision>0), design_state text not null default 'unassigned' check(design_state in ('unassigned','assigned','submitted','revisions_requested','owner_approved')),
 delivery_revision integer not null default 1 check(delivery_revision>0), delivery_state text not null default 'not_ready' check(delivery_state in ('not_ready','ready','queued','preparing','prepared','scheduling','scheduled','sent','reconciling','blocked','cancelled','failed')),
 lineage jsonb not null default '{}' check(jsonb_typeof(lineage)='object'), sequence_id uuid, sequence_position integer,
 created_by uuid not null references public.profiles(id), synthetic boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(tenant_id,id),
 foreign key(tenant_id,audience_id) references public.audiences(tenant_id,id),
 foreign key(tenant_id,product_id) references public.products(tenant_id,id),
 foreign key(tenant_id,offer_id) references public.offers(tenant_id,id)
);
create table public.campaign_content (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, campaign_id uuid not null, revision integer not null check(revision>0),
 subject text not null default '' check(char_length(subject)<=200), subject_options text[] not null default '{}',
 preheader text not null default '' check(char_length(preheader)<=300), body text not null default '' check(char_length(body)<=20000),
 cta text not null default '' check(char_length(cta)<=200), primary_url text not null default '' check(primary_url='' or primary_url ~ '^https://'),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id), unique(campaign_id,revision)
);
create table public.campaign_approvals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, campaign_id uuid not null,
 kind text not null check(kind in ('calendar','copy','design','delivery')), revision integer not null check(revision>0),
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id), unique(campaign_id,kind,revision)
);
create table public.campaign_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, campaign_id uuid not null,
 actor_id uuid not null references public.profiles(id), action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id)
);
create table public.campaign_comments (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, campaign_id uuid not null,
 actor_id uuid not null references public.profiles(id), body text not null check(char_length(body) between 1 and 5000), created_at timestamptz not null default now(),
 foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id)
);
create table public.calendar_plans (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 starts_at timestamptz not null, input_revisions jsonb not null, lineage jsonb not null, synthetic boolean not null default false,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
-- Only transactional domain RPCs may write; RLS remains the read boundary.
do $$ declare t text; begin
 foreach t in array array['audiences','campaigns','campaign_content','campaign_approvals','campaign_events','campaign_comments','calendar_plans'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create index %I on public.%I(tenant_id,created_at)',t||'_tenant_idx',t);
 end loop;
end $$;
