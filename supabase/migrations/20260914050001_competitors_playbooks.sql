create table public.competitor_captures (
 id uuid primary key default gen_random_uuid(),domain text not null unique check(domain ~ '^[a-z0-9][a-z0-9.-]*\.example$'),
 synthetic boolean not null default true check(synthetic),status text not null default 'opt_in_pending' check(status in ('opt_in_pending','live','degraded','error')),
 last_received_at timestamptz,cursor text,last_error text,created_at timestamptz not null default now()
);
create table public.competitor_subscriptions (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),capture_id uuid not null references public.competitor_captures(id),
 active boolean not null default true,revision integer not null default 1,label text not null check(length(label) between 2 and 120),
 private_rules text not null default '' check(length(private_rules)<=5000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(tenant_id,capture_id),unique(tenant_id,id)
);
create table public.competitor_emails (
 id uuid primary key default gen_random_uuid(),capture_id uuid not null references public.competitor_captures(id),external_id text not null,
 received_at timestamptz not null,subject text not null check(length(subject) between 1 and 200),text_content text not null check(length(text_content) between 1 and 10000),
 safe_html text not null,micro jsonb not null check(jsonb_typeof(micro)='object'),synthetic boolean not null default true check(synthetic),created_at timestamptz not null default now(),unique(capture_id,external_id)
);
create table public.competitor_sequences (
 id uuid primary key default gen_random_uuid(),capture_id uuid not null references public.competitor_captures(id),key text not null,
 evidence_ids uuid[] not null,confidence text not null check(confidence in ('candidate','supported')),pattern text not null,synthetic boolean not null default true check(synthetic),
 unique(capture_id,key)
);
create table public.playbooks (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),revision integer not null,
 brand_revision integer not null,patterns jsonb not null check(jsonb_typeof(patterns)='array'),evidence_ids uuid[] not null,subscription_revisions jsonb not null,
 source_count integer not null,synthetic boolean not null default true check(synthetic),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(tenant_id,revision)
);
create or replace function private.capture_access(capture uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.competitor_subscriptions s where s.capture_id=capture and s.active and private.is_active_member(s.tenant_id));
$$;
revoke all on function private.capture_access(uuid) from public,anon;
grant execute on function private.capture_access(uuid) to authenticated;
do $$ declare t text; begin foreach t in array array['competitor_captures','competitor_emails','competitor_sequences'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy subscriber_read on public.%I for select to authenticated using(private.capture_access(%I))',t,case when t='competitor_captures' then 'id' else 'capture_id' end);
 execute format('grant select on public.%I to authenticated',t);
end loop;
foreach t in array array['competitor_subscriptions','playbooks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(private.is_active_member(tenant_id))',t);
 execute format('grant select on public.%I to authenticated',t);
end loop;end $$;
create index competitor_emails_capture_received_idx on public.competitor_emails(capture_id,received_at desc);
