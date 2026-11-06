-- UIR-13: what the Connections screen shows for a connected Klaviyo or Shopify
-- account. Numbered in the integration range so it applies after 90016 on the
-- hosted project (Supabase refuses out-of-order versions by default).
--
-- No credential is ever stored. In sample (fake-adapter) mode the server only
-- checks a key's format and keeps a masked hint (first characters, bullets,
-- last four) so the owner can recognise which key was used.
alter table public.workspace_connections
  add column account_label text
    check (account_label is null or char_length(account_label) between 1 and 200),
  add column credential_hint text
    check (credential_hint is null or credential_hint ~ '^(pk|shpat|shpca)_[A-Za-z0-9]{1,8}•{8}[A-Za-z0-9]{4}$'),
  add column shop_domain text
    check (shop_domain is null or shop_domain ~ '^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$'),
  add column template_count integer
    check (template_count is null or template_count between 0 and 100000),
  add column connected_at timestamptz;

-- Owner-only. Locks the workspace first (require_member), then upserts the one
-- row for this provider. Returns the new connection revision.
create function public.connect_sample_provider(
  t uuid,
  provider text,
  account_label text,
  credential_hint text,
  shop_domain text default null,
  template_count integer default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare r integer;
begin
  perform private.require_member(t, true);
  if provider is null or provider not in ('klaviyo', 'shopify') then
    raise exception 'Unsupported connection' using errcode = '23514';
  end if;
  if account_label is null or credential_hint is null
    or (provider = 'shopify') <> (shop_domain is not null)
    or (provider = 'klaviyo' and credential_hint !~ '^pk_')
    or (provider = 'shopify' and credential_hint !~ '^shp(at|ca)_')
    or (provider = 'shopify' and template_count is not null) then
    raise exception 'Connection details required' using errcode = '23514';
  end if;
  insert into public.workspace_connections as c (
    tenant_id, provider, status, fixture_account, account_label, credential_hint,
    shop_domain, template_count, connected_at, last_sync_at, last_error
  ) values (
    t, provider, 'connected', 'fixture:' || t || ':' || provider, account_label,
    credential_hint, shop_domain, template_count, now(), now(), null
  )
  on conflict on constraint workspace_connections_pkey do update set
    status = 'connected',
    account_label = excluded.account_label,
    credential_hint = excluded.credential_hint,
    shop_domain = excluded.shop_domain,
    template_count = excluded.template_count,
    connected_at = now(),
    last_sync_at = now(),
    last_error = null,
    revision = c.revision + 1,
    updated_at = now()
  returning c.revision into r;
  return r;
end $$;

revoke all on function public.connect_sample_provider(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.connect_sample_provider(uuid, text, text, text, text, integer) to authenticated;
