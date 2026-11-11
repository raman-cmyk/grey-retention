-- KLV-001 part 1: a live Klaviyo connection keeps the owner's private API
-- key, encrypted, so the server can read the account later (VISION §5).
--
-- The key itself lives in Supabase Vault (encrypted at rest with a key the
-- database never shows); the app only keeps which Vault secret it is, a
-- masked hint, the Klaviyo account id and what the key's check found. Only
-- the workspace owner saves a key (the app first checks it with Klaviyo;
-- the database cannot know that, so an owner calling this command directly
-- only affects their own workspace), and only the server (service role)
-- can read it back. Disconnecting, or a sample connection replacing a live
-- one, deletes it. Live connections exist only when the app runs with
-- KLAVIYO_MODE=live.

alter table public.workspace_connections drop constraint workspace_connections_mode_check;
alter table public.workspace_connections add constraint workspace_connections_mode_check
  check (mode in ('fixture', 'live') and (mode = 'fixture' or provider = 'klaviyo'));

create table public.klaviyo_credentials (
  tenant_id uuid primary key references public.tenants(id),
  -- The Vault secret holding the key (vault.secrets.id).
  secret_id uuid not null unique,
  key_hint text not null check (key_hint ~ '^pk_[A-Za-z0-9]{5}•{8}[A-Za-z0-9]{4}$'),
  -- Which Klaviyo account the key belongs to: another key from another
  -- account is noticed, and later caches can be dropped.
  klaviyo_account_id text not null check (klaviyo_account_id ~ '^[A-Za-z0-9]{1,64}$'),
  -- The Klaviyo API revision the key was checked with.
  api_revision text not null check (api_revision ~ '^\d{4}-\d{2}-\d{2}(\.pre)?$'),
  -- Scopes later steps need that this key lacks (a warning, not a refusal).
  later_missing text[] not null default '{}' check (cardinality(later_missing) <= 20),
  status text not null default 'active' check (status in ('active', 'revoked')),
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.klaviyo_credentials enable row level security;
create policy tenant_read on public.klaviyo_credentials for select to authenticated using (private.is_active_member(tenant_id));
revoke all on public.klaviyo_credentials from public, anon, authenticated, service_role;
-- Members see what was checked, never which Vault secret holds the key;
-- the server reads it through klaviyo_api_key only.
grant select (tenant_id, key_hint, klaviyo_account_id, api_revision, later_missing, status, checked_at)
  on public.klaviyo_credentials to authenticated;
grant select on public.klaviyo_credentials to service_role;

-- Each key check calls Klaviyo nine times and shares the store's Klaviyo
-- quota: at most 5 checks per workspace in 15 minutes.
create table public.klaviyo_key_checks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  checked_at timestamptz not null default now()
);
create index klaviyo_key_checks_recent on public.klaviyo_key_checks (tenant_id, checked_at desc);
alter table public.klaviyo_key_checks enable row level security;
revoke all on public.klaviyo_key_checks from public, anon, authenticated;

-- The owner asks to check a key: refused after 5 tries in 15 minutes.
create or replace function public.begin_klaviyo_key_check(t uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member(t, true);
  perform 1 from public.tenants where id = t for update;
  if (select count(*) from public.klaviyo_key_checks c where c.tenant_id = t and c.checked_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many key checks; wait 15 minutes' using errcode = 'PT409';
  end if;
  insert into public.klaviyo_key_checks(tenant_id) values (t);
  delete from public.klaviyo_key_checks c where c.tenant_id = t and c.checked_at < now() - interval '1 day';
end $$;

-- A credential row never outlives its Vault secret, or the other way round.
create or replace function private.drop_klaviyo_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets s where s.id = old.secret_id;
  return old;
end $$;
create trigger drop_klaviyo_secret before delete on public.klaviyo_credentials
  for each row execute function private.drop_klaviyo_secret();

-- The owner connects Klaviyo with a key the app has just checked with
-- Klaviyo: the connection is saved as for a sample one (account facts, the
-- brand timezone when none was chosen), marked live, and the key is kept
-- in Vault (replaced when the owner pastes a new one).
create or replace function public.connect_klaviyo_live(
  t uuid,
  api_key text,
  credential_hint text,
  account_label text,
  klaviyo_account_id text,
  api_revision text,
  later_missing text[] default '{}',
  account_timezone text default null,
  account_website text default null,
  account_currency text default null,
  account_country text default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare r integer; stored uuid; missing text[] := coalesce(later_missing, '{}'); secret_name text := 'klaviyo_key:' || t;
begin
  perform private.require_member(t, true);
  perform 1 from public.tenants where id = t for update;
  -- Every check runs before anything is written, so no error ever echoes a
  -- row holding the key.
  if api_key is null or api_key !~ '^pk_[A-Za-z0-9]{20,64}$' then
    raise exception 'A Klaviyo private API key starts with pk_' using errcode = '23514';
  end if;
  if credential_hint is null or credential_hint !~ '^pk_[A-Za-z0-9]{5}•{8}[A-Za-z0-9]{4}$'
     or left(credential_hint, 8) <> left(api_key, 8) or right(credential_hint, 4) <> right(api_key, 4) then
    raise exception 'The hint does not match the key' using errcode = '23514';
  end if;
  if klaviyo_account_id is null or klaviyo_account_id !~ '^[A-Za-z0-9]{1,64}$' then
    raise exception 'Unknown Klaviyo account' using errcode = '23514';
  end if;
  if api_revision is null or api_revision !~ '^\d{4}-\d{2}-\d{2}(\.pre)?$' then
    raise exception 'Unknown Klaviyo API revision' using errcode = '23514';
  end if;
  if cardinality(missing) > 20 or exists (select 1 from unnest(missing) s where s !~ '^[a-z-]+:(read|write)$') then
    raise exception 'Invalid scopes' using errcode = '23514';
  end if;
  r := public.connect_sample_provider(t, 'klaviyo', account_label, credential_hint, null, null,
    account_timezone, account_website, account_currency, account_country);
  update public.workspace_connections set mode = 'live' where tenant_id = t and provider = 'klaviyo';
  select c.secret_id into stored from public.klaviyo_credentials c where c.tenant_id = t for update;
  if stored is not null and exists (select 1 from vault.secrets s where s.id = stored) then
    perform vault.update_secret(stored, api_key);
  else
    -- A secret left behind under this workspace's name is replaced.
    delete from vault.secrets s where s.name = secret_name;
    stored := vault.create_secret(api_key, secret_name, 'Klaviyo private API key of one workspace');
  end if;
  insert into public.klaviyo_credentials(tenant_id, secret_id, key_hint, klaviyo_account_id, api_revision, later_missing)
    values (t, stored, credential_hint, connect_klaviyo_live.klaviyo_account_id, connect_klaviyo_live.api_revision, missing)
    on conflict (tenant_id) do update
      set secret_id = excluded.secret_id, key_hint = excluded.key_hint, klaviyo_account_id = excluded.klaviyo_account_id,
          api_revision = excluded.api_revision, later_missing = excluded.later_missing, status = 'active',
          checked_at = now(), updated_at = now();
  return r;
end $$;

-- The server reads a workspace's key back (jobs, never a page): only for
-- an active workspace whose live Klaviyo connection is connected.
create or replace function public.klaviyo_api_key(t uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare key text;
begin
  perform private.require_service();
  select s.decrypted_secret into key from public.klaviyo_credentials c
    join public.tenants tn on tn.id = c.tenant_id and tn.status = 'active'
    join public.workspace_connections w on w.tenant_id = c.tenant_id and w.provider = 'klaviyo'
      and w.mode = 'live' and w.status = 'connected'
    join vault.decrypted_secrets s on s.id = c.secret_id
    where c.tenant_id = t and c.status = 'active';
  return key;
end $$;

-- The stored key goes when Klaviyo is disconnected, or when a sample
-- connection (another hint) replaces the live one; the connection is then
-- a sample one.
create or replace function private.forget_klaviyo_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.provider = 'klaviyo' and (new.status = 'disconnected'
      or (tg_op = 'UPDATE' and new.credential_hint is distinct from old.credential_hint)) then
    delete from public.klaviyo_credentials c
      where c.tenant_id = new.tenant_id and (new.status = 'disconnected' or c.key_hint is distinct from new.credential_hint);
    if new.mode = 'live' and not exists (select 1 from public.klaviyo_credentials c where c.tenant_id = new.tenant_id) then
      update public.workspace_connections set mode = 'fixture' where tenant_id = new.tenant_id and provider = 'klaviyo';
    end if;
  end if;
  return null;
end $$;
create trigger forget_klaviyo_key after insert or update of status, credential_hint on public.workspace_connections
  for each row execute function private.forget_klaviyo_key();

revoke all on function public.connect_klaviyo_live(uuid, text, text, text, text, text, text[], text, text, text, text) from public, anon, service_role;
grant execute on function public.connect_klaviyo_live(uuid, text, text, text, text, text, text[], text, text, text, text) to authenticated;
revoke all on function public.begin_klaviyo_key_check(uuid) from public, anon, service_role;
grant execute on function public.begin_klaviyo_key_check(uuid) to authenticated;
revoke all on function public.klaviyo_api_key(uuid) from public, anon, authenticated;
grant execute on function public.klaviyo_api_key(uuid) to service_role;
revoke all on function private.forget_klaviyo_key() from public, anon, authenticated;
revoke all on function private.drop_klaviyo_secret() from public, anon, authenticated;
