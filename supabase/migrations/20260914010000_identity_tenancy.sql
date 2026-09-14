create type public.profile_status as enum ('active', 'inactive');
create type public.tenant_status as enum ('active', 'paused');
create type public.onboarding_state as enum ('pending', 'in_progress', 'complete');
create type public.tenant_role as enum ('owner', 'admin', 'staff');
create type public.membership_status as enum ('invited', 'active', 'inactive');
create type public.platform_admin_role as enum ('super_admin', 'admin');
create type public.designer_status as enum ('invited', 'active', 'inactive');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  job_title text,
  phone text,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  status public.tenant_status not null default 'active',
  timezone text not null default 'UTC',
  onboarding_state public.onboarding_state not null default 'pending',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.platform_admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  role public.platform_admin_role not null default 'admin',
  active boolean not null default true,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role public.tenant_role not null default 'staff',
  status public.membership_status not null default 'invited',
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (tenant_id, profile_id)
);

create table public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role public.tenant_role not null check (role <> 'owner'),
  token_hash text not null unique check (char_length(token_hash) >= 43),
  expires_at timestamptz not null,
  invited_by uuid not null references public.profiles (id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);

create unique index tenant_invites_one_open_email_idx
  on public.tenant_invites (tenant_id, email)
  where accepted_at is null and revoked_at is null;

create table public.designers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  status public.designer_status not null default 'invited',
  activation_sent_at timestamptz,
  activated_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.designer_tenant_access (
  id uuid primary key default gen_random_uuid(),
  designer_id uuid not null references public.designers (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (designer_id, tenant_id)
);

create index tenant_memberships_profile_status_idx
  on public.tenant_memberships (profile_id, status, tenant_id);
create index tenant_memberships_tenant_status_idx
  on public.tenant_memberships (tenant_id, status, role);
create index tenant_invites_tenant_created_idx
  on public.tenant_invites (tenant_id, created_at desc);
create index designer_tenant_access_tenant_idx
  on public.designer_tenant_access (tenant_id, designer_id);

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger tenants_set_updated_at before update on public.tenants
for each row execute function private.set_updated_at();
create trigger platform_admins_set_updated_at before update on public.platform_admins
for each row execute function private.set_updated_at();
create trigger tenant_memberships_set_updated_at before update on public.tenant_memberships
for each row execute function private.set_updated_at();
create trigger tenant_invites_set_updated_at before update on public.tenant_invites
for each row execute function private.set_updated_at();
create trigger designers_set_updated_at before update on public.designers
for each row execute function private.set_updated_at();
create trigger designer_tenant_access_set_updated_at before update on public.designer_tenant_access
for each row execute function private.set_updated_at();

create or replace function private.protect_last_tenant_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
    and (
      tg_op = 'DELETE'
      or new.role <> 'owner'
      or new.status <> 'active'
      or new.tenant_id <> old.tenant_id
    )
    and not exists (
      select 1
      from public.tenant_memberships other
      where other.tenant_id = old.tenant_id
        and other.id <> old.id
        and other.role = 'owner'
        and other.status = 'active'
    )
  then
    raise exception 'tenant requires at least one active owner'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tenant_memberships_protect_last_owner
before update or delete on public.tenant_memberships
for each row execute function private.protect_last_tenant_owner();

create or replace function private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created_profile
after insert on auth.users
for each row execute function private.create_profile_for_auth_user();

create or replace function private.is_profile_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active'
  );
$$;

create or replace function private.is_active_member(
  target_tenant_id uuid,
  allowed_roles public.tenant_role[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships m
    join public.profiles p on p.id = m.profile_id and p.status = 'active'
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
    where m.profile_id = (select auth.uid())
      and m.tenant_id = target_tenant_id
      and m.status = 'active'
      and (allowed_roles is null or m.role = any (allowed_roles))
  );
$$;

create or replace function private.shares_active_tenant(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    join public.tenants t on t.id = mine.tenant_id and t.status = 'active'
    where mine.profile_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.profile_id = target_profile_id
      and theirs.status = 'active'
  );
$$;

create or replace function private.is_active_designer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.designers d
    join public.profiles p on p.id = d.profile_id and p.status = 'active'
    where d.profile_id = (select auth.uid()) and d.status = 'active'
  );
$$;

create or replace function private.current_designer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.designers d
  join public.profiles p on p.id = d.profile_id and p.status = 'active'
  where d.profile_id = (select auth.uid()) and d.status = 'active'
  limit 1;
$$;

create or replace function private.designer_has_tenant_access(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.designers d
    join public.designer_tenant_access a on a.designer_id = d.id
    join public.profiles p on p.id = d.profile_id and p.status = 'active'
    join public.tenants t on t.id = a.tenant_id and t.status = 'active'
    where d.profile_id = (select auth.uid())
      and d.status = 'active'
      and a.tenant_id = target_tenant_id
  );
$$;

create or replace function private.can_view_designer(target_designer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.designer_tenant_access a
    where a.designer_id = target_designer_id
      and private.is_active_member(
        a.tenant_id,
        array['owner', 'admin']::public.tenant_role[]
      )
  );
$$;

create or replace function public.resolve_client_context(requested_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  tenant_role public.tenant_role,
  tenant_name text,
  tenant_slug text,
  tenant_timezone text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id, m.role, t.name, t.slug, t.timezone
  from public.tenant_memberships m
  join public.profiles p on p.id = m.profile_id and p.status = 'active'
  join public.tenants t on t.id = m.tenant_id and t.status = 'active'
  where m.profile_id = (select auth.uid())
    and m.status = 'active'
    and (requested_tenant_id is null or m.tenant_id = requested_tenant_id)
  order by m.created_at, m.tenant_id
  limit 1;
$$;

create or replace function public.resolve_admin_context()
returns table (admin_role public.platform_admin_role)
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public.platform_admins a
  join public.profiles p on p.id = a.profile_id and p.status = 'active'
  where a.profile_id = (select auth.uid()) and a.active
  limit 1;
$$;

create or replace function public.resolve_designer_context()
returns table (designer_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id
  from public.designers d
  join public.profiles p on p.id = d.profile_id and p.status = 'active'
  where d.profile_id = (select auth.uid()) and d.status = 'active'
  limit 1;
$$;

create or replace function public.create_tenant_workspace(
  workspace_name text,
  workspace_slug text,
  workspace_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_tenant_id uuid;
begin
  if (select auth.uid()) is null or not private.is_profile_active() then
    raise exception 'active authentication required' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(workspace_name)) not between 2 and 120 then
    raise exception 'workspace name is invalid' using errcode = 'check_violation';
  end if;
  if workspace_slug <> lower(workspace_slug)
    or workspace_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  then
    raise exception 'workspace slug is invalid' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = workspace_timezone) then
    raise exception 'workspace timezone is invalid' using errcode = 'check_violation';
  end if;

  insert into public.tenants (name, slug, timezone, onboarding_state)
  values (btrim(workspace_name), workspace_slug, workspace_timezone, 'in_progress')
  returning id into created_tenant_id;

  insert into public.tenant_memberships (
    tenant_id, profile_id, role, status, accepted_at
  ) values (
    created_tenant_id, (select auth.uid()), 'owner', 'active', timezone('utc', now())
  );
  return created_tenant_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.platform_admins enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_invites enable row level security;
alter table public.designers enable row level security;
alter table public.designer_tenant_access enable row level security;

create policy profiles_read_self_or_teammate on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.shares_active_tenant(id));
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid()) and private.is_profile_active())
with check (id = (select auth.uid()) and private.is_profile_active());

create policy tenants_read_member_or_designer on public.tenants for select to authenticated
using (private.is_active_member(id) or private.designer_has_tenant_access(id));
create policy tenants_update_admin on public.tenants for update to authenticated
using (private.is_active_member(id, array['owner', 'admin']::public.tenant_role[]))
with check (private.is_active_member(id, array['owner', 'admin']::public.tenant_role[]));

create policy platform_admins_read_self on public.platform_admins for select to authenticated
using (profile_id = (select auth.uid()) and active and private.is_profile_active());

create policy memberships_read_tenant on public.tenant_memberships for select to authenticated
using (private.is_active_member(tenant_id));
create policy memberships_insert_admin on public.tenant_memberships for insert to authenticated
with check (
  private.is_active_member(tenant_id, array['owner']::public.tenant_role[])
  or (
    role <> 'owner'
    and private.is_active_member(tenant_id, array['admin']::public.tenant_role[])
  )
);
create policy memberships_update_admin on public.tenant_memberships for update to authenticated
using (
  private.is_active_member(tenant_id, array['owner']::public.tenant_role[])
  or (
    role <> 'owner'
    and private.is_active_member(tenant_id, array['admin']::public.tenant_role[])
  )
)
with check (
  private.is_active_member(tenant_id, array['owner']::public.tenant_role[])
  or (
    role <> 'owner'
    and private.is_active_member(tenant_id, array['admin']::public.tenant_role[])
  )
);
create policy memberships_delete_admin on public.tenant_memberships for delete to authenticated
using (
  private.is_active_member(tenant_id, array['owner']::public.tenant_role[])
  or (
    role <> 'owner'
    and private.is_active_member(tenant_id, array['admin']::public.tenant_role[])
  )
);

create policy invites_read_admin on public.tenant_invites for select to authenticated
using (private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy invites_insert_admin on public.tenant_invites for insert to authenticated
with check (
  invited_by = (select auth.uid())
  and private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[])
);
create policy invites_update_admin on public.tenant_invites for update to authenticated
using (private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[]))
with check (private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy designers_read_authorized on public.designers for select to authenticated
using (profile_id = (select auth.uid()) or private.can_view_designer(id));
create policy designer_access_read_authorized on public.designer_tenant_access for select to authenticated
using (
  private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[])
  or designer_id = private.current_designer_id()
);
create policy designer_access_manage_tenant_admin on public.designer_tenant_access for all to authenticated
using (private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[]))
with check (private.is_active_member(tenant_id, array['owner', 'admin']::public.tenant_role[]));

revoke all on all tables in schema public from anon, authenticated;
grant select, update (full_name, job_title, phone) on public.profiles to authenticated;
grant select, update (name, timezone, onboarding_state) on public.tenants to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update (role, status, accepted_at), delete on public.tenant_memberships to authenticated;
grant select, insert, update (accepted_at, revoked_at) on public.tenant_invites to authenticated;
grant select on public.designers to authenticated;
grant select, insert, delete on public.designer_tenant_access to authenticated;

revoke all on function public.resolve_client_context(uuid) from public, anon;
revoke all on function public.resolve_admin_context() from public, anon;
revoke all on function public.resolve_designer_context() from public, anon;
revoke all on function public.create_tenant_workspace(text, text, text) from public, anon;
grant execute on function public.resolve_client_context(uuid) to authenticated;
grant execute on function public.resolve_admin_context() to authenticated;
grant execute on function public.resolve_designer_context() to authenticated;
grant execute on function public.create_tenant_workspace(text, text, text) to authenticated;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_profile_active() to authenticated;
grant execute on function private.is_active_member(uuid, public.tenant_role[]) to authenticated;
grant execute on function private.shares_active_tenant(uuid) to authenticated;
grant execute on function private.is_active_designer() to authenticated;
grant execute on function private.current_designer_id() to authenticated;
grant execute on function private.designer_has_tenant_access(uuid) to authenticated;
grant execute on function private.can_view_designer(uuid) to authenticated;

comment on function public.resolve_client_context(uuid) is
  'Returns only an active membership for auth.uid(); an untrusted tenant hint cannot expand access.';
comment on function public.resolve_admin_context() is
  'Returns a platform role only for an active profile and active platform admin record.';
comment on function public.resolve_designer_context() is
  'Returns a designer ID only for an active profile and active designer record.';
comment on function public.create_tenant_workspace(text, text, text) is
  'Creates a tenant and first owner atomically for the authenticated active profile.';
