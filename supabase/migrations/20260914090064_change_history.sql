-- BAS-006: a record of who changed what (master handoff section 8). Team
-- changes are already recorded in workspace_events by the team commands.
-- These triggers add the owner's offer limits (the max discount and the
-- codes) and the Klaviyo connection, whoever changes them: a person through
-- a command (auth.uid()), or the system (null actor, shown as GROS).
-- Members read them through workspace_events' existing tenant_read policy;
-- nobody writes them directly. Each is stamped with the real time
-- (clock_timestamp), so changes in one transaction keep their order. The
-- number is chosen at merge time (D24).

create or replace function private.record_offer_limit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.max_discount_percent is not distinct from old.max_discount_percent then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail, created_at)
  values (new.tenant_id, auth.uid(), 'max_discount_changed',
    jsonb_build_object('from', case when tg_op = 'UPDATE' then old.max_discount_percent end,
      'to', new.max_discount_percent), clock_timestamp());
  return null;
end $$;

create or replace function private.record_discount_code_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare ended boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail, created_at)
    values (new.tenant_id, auth.uid(), 'discount_code_added', new.id,
      jsonb_build_object('code', new.code, 'percent', new.percent, 'expires_at', new.expires_at), clock_timestamp());
  elsif old.status = 'active' and new.status = 'retired' then
    ended := new.expires_at is not null and new.expires_at <= new.retired_at;
    -- A code that ended is retired by the system, whoever's change ran it.
    insert into public.workspace_events (tenant_id, actor_id, kind, entity_id, detail, created_at)
    values (new.tenant_id, case when ended then null else auth.uid() end, 'discount_code_retired', new.id,
      jsonb_build_object('code', new.code, 'ended', ended), clock_timestamp());
  end if;
  return null;
end $$;

create or replace function private.record_klaviyo_connection_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.provider <> 'klaviyo' or (tg_op = 'UPDATE'
    and new.status is not distinct from old.status and new.mode is not distinct from old.mode)
    -- Inside a live connect (connect_klaviyo_live) only its last step, the
    -- switch to live, is the change: its sample step first is not.
    or (coalesce(current_setting('grey.live_klaviyo_check', true), '') = 'on' and new.mode <> 'live')
    -- The mode put back to sample after a disconnect is the same change.
    or (tg_op = 'UPDATE' and old.status = 'disconnected' and new.status = 'disconnected') then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail, created_at)
  values (new.tenant_id, auth.uid(), 'klaviyo_connection_changed',
    jsonb_build_object('from_status', case when tg_op = 'UPDATE' then old.status end, 'to_status', new.status,
      'from_mode', case when tg_op = 'UPDATE' then old.mode end, 'to_mode', new.mode), clock_timestamp());
  return null;
end $$;

-- The key itself is never recorded: only its masked hint, as members see it.
create or replace function private.record_klaviyo_key_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.key_hint is not distinct from old.key_hint
    and new.status is not distinct from old.status then
    return null;
  end if;
  insert into public.workspace_events (tenant_id, actor_id, kind, detail, created_at)
  values (new.tenant_id, auth.uid(),
    case when new.status = 'revoked' then 'klaviyo_key_refused' else 'klaviyo_key_saved' end,
    jsonb_build_object('hint', new.key_hint), clock_timestamp());
  return null;
end $$;

revoke all on function private.record_offer_limit_change(), private.record_discount_code_change(),
  private.record_klaviyo_connection_change(), private.record_klaviyo_key_change()
  from public, anon, authenticated, service_role;

create trigger brand_offers_recorded after insert or update of max_discount_percent on public.brand_offers
  for each row execute function private.record_offer_limit_change();
create trigger discount_codes_recorded after insert or update of status on public.discount_codes
  for each row execute function private.record_discount_code_change();
create trigger workspace_connections_recorded after insert or update of status, mode on public.workspace_connections
  for each row execute function private.record_klaviyo_connection_change();
create trigger klaviyo_credentials_recorded after insert or update of key_hint, status on public.klaviyo_credentials
  for each row execute function private.record_klaviyo_key_change();

-- Nobody writes the record directly: the commands and these triggers do
-- (as the table's owner). Row security already refused it; the grants
-- Supabase gives new tables by default are taken back too.
revoke insert, update, delete, truncate, references, trigger on public.workspace_events from anon, authenticated;
revoke select on public.workspace_events from anon;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.workspace_events from public, anon, authenticated';
  end if;
end $$;

-- The history is read newest first per workspace.
create index if not exists workspace_events_tenant_recent on public.workspace_events (tenant_id, created_at desc);
