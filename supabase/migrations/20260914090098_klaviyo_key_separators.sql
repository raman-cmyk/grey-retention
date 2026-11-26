-- KLV-KEY-001: provider-issued keys may have internal underscore separators.
-- Keep the existing hint, membership, Vault and live-check guard contracts.
-- The function signature and privileges are unchanged by CREATE OR REPLACE.

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
  if api_key is null or api_key !~ '^pk_[A-Za-z0-9]{5}[A-Za-z0-9_]{11,55}[A-Za-z0-9]{4}$' then
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
  perform set_config('grey.live_klaviyo_check', 'on', true);
  r := public.connect_sample_provider(t, 'klaviyo', account_label, credential_hint, null, null,
    account_timezone, account_website, account_currency, account_country);
  update public.workspace_connections set mode = 'live' where tenant_id = t and provider = 'klaviyo';
  perform set_config('grey.live_klaviyo_check', '', true);
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
