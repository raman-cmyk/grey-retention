-- UIR-019 review fixes, applied together with 20260914090024 (neither has
-- reached production):
--   * a deactivated teammate cannot be invited again (that skipped the
--     Reactivate confirmation and brought back their old role); they are
--     reactivated from the Team page instead. Accepting an invite now
--     applies the invited role, never touches an owner row, and refuses a
--     deactivated membership;
--   * every team command checks the caller's role again after the
--     workspace lock, so a manager demoted or deactivated meanwhile cannot
--     finish a change;
--   * deactivated people (name and email) are listed for owners and
--     managers only;
--   * cancelling an unknown or other workspace's invite says "unavailable"
--     (42501) like resend; a change needs an active or inactive member;
--   * cancelling an expired invite on re-invite is logged;
--   * the retired update_team_access is not offered to the service role.
--
-- Resend renews the expiry only in effect: acceptance is by invite id and
-- verified email, so the new token is not a separate link.

create or replace function private.require_team_manager(t uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = t for update;
  if not private.is_active_member(t, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Team administrator required' using errcode = '42501';
  end if;
end $$;

-- The address's current standing in the workspace: 'active', 'inactive'
-- or null.
create or replace function private.team_address_status(t uuid, address text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when bool_or(m.status = 'active') then 'active'
    when bool_or(m.status = 'inactive') then 'inactive'
  end
  from public.tenant_memberships m join auth.users u on u.id = m.profile_id
  where m.tenant_id = t and lower(u.email) = address
$$;

create or replace function public.team_members(t uuid)
returns table (id uuid, profile_id uuid, name text, email text,
  role public.tenant_role, status public.membership_status,
  updated_at timestamptz, is_me boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare manager boolean;
begin
  if not private.is_active_member(t) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  manager := private.is_active_member(t, array['owner','admin']::public.tenant_role[]);
  return query
    select m.id, m.profile_id, btrim(p.full_name), coalesce(u.email, '')::text,
      m.role, m.status, m.updated_at, m.profile_id = auth.uid()
    from public.tenant_memberships m
    join public.profiles p on p.id = m.profile_id
    left join auth.users u on u.id = m.profile_id
    where m.tenant_id = t
      and (m.status = 'active' or (m.status = 'inactive' and manager))
    order by m.role = 'owner' desc, m.status = 'active' desc,
      lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text, '')), m.id
    limit 500;
end $$;

create or replace function public.invite_team(t uuid, email text, role public.tenant_role)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  id uuid;
  address text := lower(btrim(coalesce(invite_team.email, '')));
  standing text;
  expired record;
begin
  perform private.require_team_manager(t);
  if char_length(address) > 254
    or address !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
    or invite_team.role is null or invite_team.role not in ('admin', 'staff') then
    raise exception 'Valid non-owner invite required' using errcode = '23514';
  end if;
  standing := private.team_address_status(t, address);
  if standing = 'active' then
    raise exception 'Already a member' using errcode = 'PT409';
  end if;
  if standing = 'inactive' then
    raise exception 'Deactivated member' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.tenant_invites i
    where i.tenant_id = t and i.email = address
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) then
    raise exception 'Already invited' using errcode = 'PT409';
  end if;
  for expired in
    update public.tenant_invites set revoked_at = now()
    where tenant_id = t and tenant_invites.email = address
      and accepted_at is null and revoked_at is null and expires_at <= now()
    returning tenant_invites.id
  loop
    insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
    values (t, auth.uid(), 'invitation_revoked', expired.id, jsonb_build_object('reason', 'expired'));
  end loop;
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

create or replace function public.resend_team_invite(t uuid, invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.tenant_invites; standing text;
begin
  perform private.require_team_manager(t);
  select * into i from public.tenant_invites where id = invite and tenant_id = t for update;
  if i.id is null then
    raise exception 'Invite unavailable' using errcode = '42501';
  end if;
  if i.accepted_at is not null or i.revoked_at is not null then
    raise exception 'This invite was cancelled or accepted' using errcode = 'PT409';
  end if;
  standing := private.team_address_status(t, i.email);
  if standing = 'active' then
    raise exception 'Already a member' using errcode = 'PT409';
  end if;
  if standing = 'inactive' then
    raise exception 'Deactivated member' using errcode = 'PT409';
  end if;
  update public.tenant_invites
  set token_hash = encode(extensions.digest(extensions.gen_random_bytes(32), 'sha512'), 'hex'),
    expires_at = now() + interval '7 days'
  where id = i.id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail)
  values (t, auth.uid(), 'invitation_resent', i.id,
    jsonb_build_object('role', i.role, 'emailDelivery', 'simulated'));
end $$;

create or replace function public.revoke_team_invite(t uuid, invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.tenant_invites;
begin
  perform private.require_team_manager(t);
  select * into i from public.tenant_invites where id = invite and tenant_id = t for update;
  if i.id is null then
    raise exception 'Invite unavailable' using errcode = '42501';
  end if;
  if i.accepted_at is not null or i.revoked_at is not null then
    raise exception 'This invite was cancelled or accepted' using errcode = 'PT409';
  end if;
  update public.tenant_invites set revoked_at = now() where id = i.id;
  insert into public.workspace_events (tenant_id, actor_id, kind, entity_id)
  values (t, auth.uid(), 'invitation_revoked', invite);
end $$;

create or replace function public.change_team_member(t uuid, membership uuid,
  expected_at timestamptz, role public.tenant_role, status public.membership_status)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.tenant_memberships;
begin
  perform private.require_team_manager(t);
  select * into m from public.tenant_memberships where id = membership and tenant_id = t for update;
  if m.id is null or m.status not in ('active', 'inactive') then
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

-- Accept: as before (verified email, open invite, active workspace), but
-- the invited role applies, an owner row is never changed, and someone the
-- workspace deactivated must be reactivated there instead.
create or replace function public.accept_team_invite(invite uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.tenant_invites; existing public.tenant_memberships;
begin
  select invitation.* into i from public.tenant_invites invitation
  join auth.users u on u.id = auth.uid() and u.email_confirmed_at is not null
    and lower(u.email) = invitation.email
  where invitation.id = invite and private.is_profile_active();
  if i.id is null then
    raise exception 'Verified invite email required' using errcode = '42501';
  end if;
  perform 1 from public.tenants where tenants.id = i.tenant_id for update;
  select * into i from public.tenant_invites where id = invite for update;
  if not exists (select 1 from public.tenants where id = i.tenant_id and status = 'active') then
    raise exception 'Workspace unavailable' using errcode = '42501';
  end if;
  if i.revoked_at is not null or i.expires_at <= now() then
    raise exception 'Invite revoked or expired' using errcode = '23514';
  end if;
  if i.accepted_at is not null then
    return i.tenant_id;
  end if;
  select * into existing from public.tenant_memberships
  where tenant_id = i.tenant_id and profile_id = auth.uid() for update;
  if existing.status = 'inactive' then
    raise exception 'Ask the workspace to reactivate you' using errcode = 'PT409';
  end if;
  if existing.id is null then
    insert into public.tenant_memberships (tenant_id, profile_id, role, status, invited_by, accepted_at)
    values (i.tenant_id, auth.uid(), i.role, 'active', i.invited_by, now());
  elsif existing.status <> 'active' and existing.role <> 'owner' then
    update public.tenant_memberships
    set role = i.role, status = 'active', accepted_at = now()
    where id = existing.id;
  end if;
  update public.tenant_invites set accepted_at = now() where id = i.id;
  return i.tenant_id;
end $$;

revoke all on function private.require_team_manager(uuid), private.team_address_status(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.update_team_access(uuid, uuid, timestamptz, public.tenant_role, public.membership_status)
  from public, anon, authenticated, service_role;
revoke all on function public.team_members(uuid), public.invite_team(uuid, text, public.tenant_role),
  public.resend_team_invite(uuid, uuid), public.revoke_team_invite(uuid, uuid),
  public.change_team_member(uuid, uuid, timestamptz, public.tenant_role, public.membership_status),
  public.accept_team_invite(uuid)
  from public, anon, service_role;
grant execute on function public.team_members(uuid), public.invite_team(uuid, text, public.tenant_role),
  public.resend_team_invite(uuid, uuid), public.revoke_team_invite(uuid, uuid),
  public.change_team_member(uuid, uuid, timestamptz, public.tenant_role, public.membership_status),
  public.accept_team_invite(uuid)
  to authenticated;
