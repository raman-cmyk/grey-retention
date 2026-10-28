create table public.conversations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),creator_id uuid not null references public.profiles(id),title text not null check(length(title) between 1 and 200),visibility text not null default 'private' check(visibility in ('private','shared')),status text not null default 'active' check(status in ('active','archived')),created_at timestamptz not null default now(),unique(tenant_id,id)
);
create or replace function private.chat_visible(t uuid,chat uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active_member(t) and exists(select 1 from public.conversations c where c.id=chat and c.tenant_id=t and (c.creator_id=auth.uid() or c.visibility='shared'));
$$;
create table public.chat_messages (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,conversation_id uuid not null,actor_id uuid not null references public.profiles(id),role text not null check(role in ('user','assistant')),body text not null check(length(body) between 1 and 8000),evidence jsonb not null default '{}',synthetic boolean not null default true,created_at timestamptz not null default now(),foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id)
);
create table public.chat_proposals (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,conversation_id uuid not null,actor_id uuid not null references public.profiles(id),campaign_id uuid not null,kind text not null check(kind in ('edit_goal','select_reference','schedule','cancel','request_assignment')),target_revisions jsonb not null,payload jsonb not null check(jsonb_typeof(payload)='object'),payload_hash text generated always as (encode(extensions.digest(payload::text,'sha256'),'hex')) stored,consequence text not null,status text not null default 'pending' check(status in ('pending','confirmed','rejected','expired')),expires_at timestamptz not null default now()+interval '15 minutes',created_at timestamptz not null default now(),confirmed_at timestamptz,foreign key(tenant_id,conversation_id) references public.conversations(tenant_id,id)
);
alter table public.conversations enable row level security;
create policy visible on public.conversations for select to authenticated using(private.chat_visible(tenant_id,id));
grant select on public.conversations to authenticated;
do $$declare tab text;begin foreach tab in array array['chat_messages','chat_proposals'] loop execute format('alter table public.%I enable row level security',tab);execute format('create policy visible on public.%I for select to authenticated using(private.chat_visible(tenant_id,conversation_id))',tab);execute format('grant select on public.%I to authenticated',tab);end loop;end $$;
revoke all on function private.chat_visible(uuid,uuid) from public,anon;
grant execute on function private.chat_visible(uuid,uuid) to authenticated;
