-- UIR-011 review fixes, applied together with 20260914090020 (neither has
-- reached production). Stricter input checks for direct RPC calls:
--   * audience ids are Klaviyo-style ids (letters, digits, _ and -), in a
--     one-dimensional list, so padded, blank or nested ids cannot slip
--     past the "not in both lists" and "no duplicates" rules;
--   * the sender name (the From label sent to Klaviyo) has no control
--     characters, and outer whitespace of any kind is trimmed;
--   * the primary link is https to a real host name (no user@host trick,
--     no spaces or control characters);
--   * deleting a login keeps the defaults (updated_by is cleared).

alter table public.campaign_defaults
  drop constraint campaign_defaults_sender_name_check,
  add constraint campaign_defaults_sender_name_check
    check (char_length(sender_name) <= 100 and sender_name !~ '[[:cntrl:]]'),
  drop constraint campaign_defaults_primary_link_check,
  add constraint campaign_defaults_primary_link_check check (primary_link = '' or (
    char_length(primary_link) <= 2000
    and primary_link ~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$')),
  drop constraint campaign_defaults_send_to_check,
  add constraint campaign_defaults_send_to_check
    check (cardinality(send_to) <= 20 and coalesce(array_ndims(send_to), 1) = 1),
  drop constraint campaign_defaults_dont_send_to_check,
  add constraint campaign_defaults_dont_send_to_check
    check (cardinality(dont_send_to) <= 20 and coalesce(array_ndims(dont_send_to), 1) = 1),
  drop constraint campaign_defaults_updated_by_fkey,
  add constraint campaign_defaults_updated_by_fkey
    foreign key (updated_by) references public.profiles(id) on delete set null;

create or replace function private.audience_ids_valid(ids text[])
returns boolean language sql immutable set search_path = '' as $$
  select ids is not null
    and coalesce(array_ndims(ids), 1) = 1
    and cardinality(ids) <= 20
    and not exists (select 1 from unnest(ids) i where i is null or i !~ '^[A-Za-z0-9_-]{1,100}$')
    and cardinality(ids) = (select count(distinct i) from unnest(ids) i)
$$;

-- Text as typed, without outer whitespace of any kind (tabs, line breaks,
-- no-break spaces).
create function private.trim_text(value text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(value, ''), '^[[:space:] ]+|[[:space:] ]+$', '', 'g')
$$;

create or replace function public.save_campaign_defaults(
  t uuid, expected_revision integer, featured_product_id uuid, sender_name text,
  primary_link text, send_to text[], dont_send_to text[], include_footer boolean,
  footer_source text default 'auto'
) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.campaign_defaults; r integer;
  name text := private.trim_text(sender_name);
  link text := private.trim_text(primary_link);
begin
  perform private.require_member(t, true);
  select * into d from public.campaign_defaults where tenant_id = t for update;
  if coalesce(d.revision, 0) is distinct from expected_revision then
    raise exception 'Campaign defaults changed in another window' using errcode = 'PT409';
  end if;
  if featured_product_id is not null and not exists (
      select 1 from public.products p where p.tenant_id = t and p.id = featured_product_id) then
    raise exception 'Choose a product from your catalogue' using errcode = '23514';
  end if;
  if char_length(name) > 100 or name ~ '[[:cntrl:]]' then
    raise exception 'Check the sender name' using errcode = '23514';
  end if;
  if link <> '' and (char_length(link) > 2000 or link !~
      '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$') then
    raise exception 'Primary link must start with https://' using errcode = '23514';
  end if;
  if not private.audience_ids_valid(send_to) or not private.audience_ids_valid(dont_send_to) then
    raise exception 'Check the audiences' using errcode = '23514';
  end if;
  if send_to && dont_send_to then
    raise exception 'An audience cannot be in both Send to and Don''t send to' using errcode = '23514';
  end if;
  if include_footer is null or coalesce(footer_source, '') <> 'auto' then
    raise exception 'Check the email settings' using errcode = '23514';
  end if;
  insert into public.campaign_defaults as x (tenant_id, featured_product_id, sender_name,
    primary_link, send_to, dont_send_to, include_footer, footer_source, updated_by)
  values (t, featured_product_id, name, link, send_to, dont_send_to, include_footer, 'auto', auth.uid())
  on conflict (tenant_id) do update set featured_product_id = excluded.featured_product_id,
    sender_name = excluded.sender_name, primary_link = excluded.primary_link,
    send_to = excluded.send_to, dont_send_to = excluded.dont_send_to,
    include_footer = excluded.include_footer, footer_source = excluded.footer_source,
    updated_by = auth.uid(), updated_at = now(), revision = x.revision + 1
  returning x.revision into r;
  return r;
end $$;

revoke all on function private.audience_ids_valid(text[]), private.trim_text(text)
  from public, anon, authenticated, service_role;
revoke all on function public.save_campaign_defaults(uuid, integer, uuid, text, text, text[], text[], boolean, text)
  from public, anon, service_role;
grant execute on function public.save_campaign_defaults(uuid, integer, uuid, text, text, text[], text[], boolean, text)
  to authenticated;
