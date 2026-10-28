create table public.notifications (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),recipient_id uuid not null references public.profiles(id),
 kind text not null,entity_id uuid,message text not null check(char_length(message)<=1000),read_at timestamptz,created_at timestamptz not null default now()
);
create table public.notification_deliveries (
 id uuid primary key default gen_random_uuid(),notification_id uuid not null unique references public.notifications(id),tenant_id uuid not null references public.tenants(id),
 channel text not null check(channel='email'),state text not null check(state='simulated'),provider text not null check(provider='fixture'),created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
create policy notification_recipient on public.notifications for select to authenticated using(recipient_id=auth.uid() and (private.is_active_member(tenant_id) or private.designer_has_tenant_access(tenant_id)));
create policy notification_audit_read on public.notification_deliveries for select to authenticated using(exists(select 1 from public.notifications n where n.id=notification_id and n.recipient_id=auth.uid()));
grant select on public.notifications,public.notification_deliveries to authenticated;
create index notifications_recipient_idx on public.notifications(recipient_id,created_at);
