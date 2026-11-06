-- UIR-019 Team page (docs/OWNER_JOURNEYS.md §14).
--
-- The page shows members with their sign-in email, invites people, resends
-- or cancels pending invites, changes a teammate's role between Manager
-- (stored as 'admin') and Staff, and deactivates or reactivates them.
-- Every write goes through a command here; members can no longer write the
-- membership or invite tables directly.
--
-- Rules:
--   * only an active owner or manager manages the team;
--   * the owner's row is never changed from the Team page, and nobody
--     changes their own access;
--   * an email that is already an active member, or already has an open
--     invite, cannot be invited again (PT409);
--   * email delivery stays simulated: nothing is sent.

-- Who is on the team. Emails come from sign-in accounts, so the page needs
-- this command (profiles keep no email). Active members of the workspace
-- only; owners first, then active members, then by name.
create or replace function public.team_members(t uuid)
returns table (id uuid, profile_id uuid, name text, email text,
  role public.tenant_role, status public.membership_status,
  updated_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.is_active_member(t) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query
    select m.id, m.profile_id, btrim(p.full_name), coalesce(u.email, '')::text,
      m.role, m.status, m.updated_at, m.profile_id = auth.uid()
    from public.tenant_memberships m
    join public.profiles p on p.id = m.profile_id
    left join auth.users u on u.id = m.profile_id
    where m.tenant_id = t and m.status in ('active', 'inactive')
    order by m.role = 'owner' desc, m.status = 'active' desc,
      lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text, '')), m.id
    limit 500;
end $$;

-- Invite: the same command as before, plus duplicate checks. An older
-- invite to the same address that has expired is cancelled, so the pending
-- list shows one row per person.
create or replace function public.invite_team(t uuid, email text, role public.tenant_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
  address text := lower(btrim(coalesce(invite_team.email, '')));
begin
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if char_length(address) > 254
    or address !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
    or invite_team.role is null or invite_team.role not in ('admin', 'staff') then
    raise exception 'Valid non-owner invite required' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.tenant_memberships m join auth.users u on u.id = m.profile_id
    where m.tenant_id = t and m.status = 'active' and lower(u.email) = address
  ) then
    raise exception 'Already a member' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.tenant_invites i
    where i.tenant_id = t and i.email = address
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) then
    raise exception 'Already invited' using errcode = 'PT409';
  end if;
  update public.tenant_invites set revoked_at = now()
  where tenant_id = t and tenant_invites.email = address
    and accepted_at is null and revoked_at is null and expires_at <= now();
  insert into public.tenant_invites (tenant_id, email, role, token_hash, expires_at, invited_by)
  values (t, address, invite_team.role,
    encode(extensions.digest(extensions.gen_random_bytes(32), 'sha512'), 'hex'),
    now() + interval '7 days', auth.uid())
  returning tenant_invites.id into id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
  values (t, auth.uid(), 'invitation_simulated', id,
    jsonb_build_object('role', invite_team.role, 'emailDelivery', 'simulated'));
  perform private.notify_owners(t, 'team_invitation', id,
    'Team invitation persisted. Email delivery is simulated; no message was sent.');
  return id;
end $$;

-- Resend: a new link and a new 7-day expiry (the old link stops working).
-- Works for an open or expired invite; not for a cancelled or accepted one.
create or replace function public.resend_team_invite(t uuid, invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.tenant_invites;
begin
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  select * into i from public.tenant_invites where id = invite and tenant_id = t for update;
  if i.id is null then
    raise exception 'Invite unavailable' using errcode = '42501';
  end if;
  if i.accepted_at is not null or i.revoked_at is not null then
    raise exception 'This invite was cancelled or accepted' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.tenant_memberships m join auth.users u on u.id = m.profile_id
    where m.tenant_id = t and m.status = 'active' and lower(u.email) = i.email
  ) then
    raise exception 'Already a member' using errcode = 'PT409';
  end if;
  update public.tenant_invites
  set token_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha512'), 'hex'),
    expires_at = now() + interval '7 days'
  where id = i.id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
  values (t, auth.uid(), 'invitation_resent', i.id,
    jsonb_build_object('role', i.role, 'emailDelivery', 'simulated'));
end $$;

-- Cancel: the same rules as before; a second cancel says it is gone.
create or replace function public.revoke_team_invite(t uuid, invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  update public.tenant_invites set revoked_at = now()
  where id = invite and tenant_id = t and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'This invite was cancelled or accepted' using errcode = 'PT409';
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
  values (t, auth.uid(), 'invitation_revoked', invite);
end $$;

-- Change a teammate's role (Manager or Staff) and/or status (active or
-- inactive). The membership trigger writes the change to the workspace log.
create or replace function public.change_team_member(t uuid, membership uuid,
  expected_at timestamptz, role public.tenant_role, status public.membership_status)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.tenant_memberships;
begin
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  select * into m from public.tenant_memberships where id = membership and tenant_id = t for update;
  if m.id is null then
    raise exception 'Member unavailable' using errcode = '42501';
  end if;
  if m.role = 'owner' then
    raise exception 'The owner''s access cannot be changed here' using errcode = '42501';
  end if;
  if m.profile_id = auth.uid() then
    raise exception 'You cannot change your own access' using errcode = '42501';
  end if;
  if change_team_member.role is null or change_team_member.role not in ('admin', 'staff')
    or change_team_member.status is null
    or change_team_member.status not in ('active', 'inactive') then
    raise exception 'Choose Manager or Staff, active or inactive' using errcode = '23514';
  end if;
  if m.updated_at is distinct from expected_at then
    raise exception 'Membership changed' using errcode = 'PT409';
  end if;
  if m.role = change_team_member.role and m.status = change_team_member.status then
    return;
  end if;
  update public.tenant_memberships
  set role = change_team_member.role, status = change_team_member.status
  where id = m.id;
end $$;

-- Members write through the commands above only. (The older
-- update_team_access command, which could also change owner rows, is no
-- longer offered to members; nothing in the app calls it.)
revoke insert, update, delete, truncate on public.tenant_memberships from public, anon, authenticated;
revoke insert, update, delete, truncate on public.tenant_invites from public, anon, authenticated;
revoke all on function public.update_team_access(uuid, uuid, timestamptz, public.tenant_role, public.membership_status)
  from public, anon, authenticated;

revoke all on function public.team_members(uuid), public.invite_team(uuid, text, public.tenant_role),
  public.resend_team_invite(uuid, uuid), public.revoke_team_invite(uuid, uuid),
  public.change_team_member(uuid, uuid, timestamptz, public.tenant_role, public.membership_status)
  from public, anon, service_role;
grant execute on function public.team_members(uuid), public.invite_team(uuid, text, public.tenant_role),
  public.resend_team_invite(uuid, uuid), public.revoke_team_invite(uuid, uuid),
  public.change_team_member(uuid, uuid, timestamptz, public.tenant_role, public.membership_status)
  to authenticated;
