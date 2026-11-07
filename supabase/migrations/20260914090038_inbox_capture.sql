-- INB-001 Inspiration inbox (VISION Step 2, BUILD_BRIEF D4 and D7).
--
-- Real competitor newsletters arrive at <inbox>+<brand-slug>@gmail.com and
-- are read over IMAP by the scheduled worker. This migration
-- adds the platform-level tables; 20260914090039 adds the commands.
--
-- * platform_jobs: leased, retryable jobs that belong to no workspace
--   (polling the inbox; later images, screenshots and labelling).
-- * inbox_mailboxes: one row per transport with its IMAP cursor
--   (UIDVALIDITY + last UID). No address and no credentials are stored:
--   those live only in the server environment.
-- * inbox_messages: every message read, once (message key = SHA-256 of the
--   normalized Message-ID, or of the raw bytes when it has none), with
--   where its raw copy is stored and which brand it was assigned to.
-- * competitor_captures become brands: an alias slug (the +alias), a
--   name, a niche and a subscription status. Real (non-synthetic) brands
--   are allowed now; workspaces still subscribe only to sample domains.
-- * competitor_sender_domains: sender domains an admin registered for a
--   brand (the fallback when an email has no known alias).
-- * competitor_emails can be real and point at their inbox message.
-- * ops_tasks: work for a person (unknown sender, parse failure, ...).
--
-- Everything here is read by platform admins only (RLS); workspaces see
-- competitor emails only through their subscriptions, as before.

create table public.platform_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm')),
  subject_key text not null check (length(subject_key) between 1 and 200),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 300),
  status text not null default 'queued' check (status in ('queued','leased','retry_wait','succeeded','failed','cancelled')),
  attempt integer not null default 0 check (attempt between 0 and 4),
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  failure_class text check (failure_class in ('auth','unavailable','timeout','protocol','too_large','internal')),
  last_error_code text check (length(last_error_code) <= 80),
  result jsonb not null default '{}' check (jsonb_typeof(result) = 'object' and length(result::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'leased') = (lease_token is not null and lease_expires_at is not null))
);
-- One active job per kind and subject (one poll per mailbox at a time).
create unique index platform_jobs_one_active on public.platform_jobs (kind, subject_key)
  where status in ('queued','leased','retry_wait');
create index platform_jobs_due on public.platform_jobs (available_at)
  where status in ('queued','retry_wait','leased');

create table public.inbox_mailboxes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key in ('fake','gmail')),
  transport text not null check (transport in ('fake','gmail_imap')),
  uidvalidity bigint check (uidvalidity > 0),
  last_uid bigint not null default 0 check (last_uid >= 0),
  last_polled_at timestamptz,
  last_error_code text check (length(last_error_code) <= 80),
  paused_until timestamptz,
  created_at timestamptz not null default now(),
  check ((key = 'fake') = (transport = 'fake'))
);

create table public.competitor_sender_domains (
  domain text primary key check (length(domain) <= 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  capture_id uuid not null references public.competitor_captures(id),
  created_at timestamptz not null default now()
);
create index competitor_sender_domains_capture on public.competitor_sender_domains (capture_id);

-- Brands: real domains allowed; the sample-only rule stays in
-- subscribe_competitor, so workspaces cannot follow real brands yet.
-- A brand is a sample exactly when its domain ends in .example, so real
-- mail can never land in a sample brand that workspaces read, and a
-- workspace can never subscribe to a real one. The old sample pattern is
-- still accepted so existing rows stay valid.
alter table public.competitor_captures
  drop constraint competitor_captures_domain_check,
  add constraint competitor_captures_domain_check
    check (length(domain) <= 253 and (domain ~ '^[a-z0-9][a-z0-9.-]*\.example$'
      or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  drop constraint competitor_captures_synthetic_check,
  add constraint competitor_captures_synthetic_check check (synthetic = (domain ~ '\.example$')),
  add column alias_slug text unique check (alias_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  add column brand_name text check (length(brand_name) between 1 and 120),
  add column niche text check (length(niche) between 1 and 60),
  add column subscription_status text not null default 'not_subscribed'
    check (subscription_status in ('not_subscribed','pending','subscribed','unsubscribed'));

create table public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.inbox_mailboxes(id),
  message_key text not null check (message_key ~ '^[a-f0-9]{64}$'),
  uidvalidity bigint not null check (uidvalidity > 0),
  uid bigint not null check (uid > 0),
  transport_id text check (length(transport_id) <= 100),
  raw_path text check (length(raw_path) <= 300),
  raw_sha256 text check (raw_sha256 ~ '^[a-f0-9]{64}$'),
  raw_bytes integer not null check (raw_bytes between 1 and 52428800),
  html_path text check (length(html_path) <= 300),
  from_address text check (length(from_address) <= 320),
  from_domain text check (length(from_domain) <= 253),
  alias_slug text check (alias_slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  subject text not null default '' check (length(subject) <= 200),
  received_at timestamptz not null,
  synthetic boolean not null,
  state text not null check (state in ('assigned','unassigned','parse_failed','too_large')),
  method text check (method in ('alias','sender','admin')),
  capture_id uuid references public.competitor_captures(id),
  created_at timestamptz not null default now(),
  unique (mailbox_id, message_key),
  unique (mailbox_id, uidvalidity, uid),
  check ((state = 'assigned') = (capture_id is not null and method is not null)),
  check (state = 'too_large' or (raw_path is not null and raw_sha256 is not null))
);
create index inbox_messages_capture on public.inbox_messages (capture_id, received_at desc);

-- A real email always comes from the inbox (its message is kept).
alter table public.competitor_emails
  drop constraint competitor_emails_synthetic_check,
  add constraint competitor_emails_source_check check (synthetic or inbox_message_id is not null),
  add column inbox_message_id uuid unique references public.inbox_messages(id),
  add column raw_path text check (length(raw_path) <= 300),
  add column html_path text check (length(html_path) <= 300),
  add column preview_text text check (length(preview_text) <= 300),
  add column labelled_at timestamptz,
  add column extraction_version integer check (extraction_version > 0);

create table public.ops_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inbox_unknown_sender','inbox_parse_failure','inbox_too_large','inbox_opt_in','inbox_unsubscribed','inbox_pending_subscription','inbox_auth_failed','job_failed')),
  state text not null default 'open' check (state in ('open','resolved','dismissed')),
  subject_id uuid,
  dedupe_key text not null check (length(dedupe_key) between 1 and 300),
  occurrences integer not null default 1 check (occurrences >= 1),
  detail jsonb not null default '{}' check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  check ((state = 'open') = (resolved_at is null))
);
-- One open task per problem; a resolved one can come back as a new task.
create unique index ops_tasks_one_open on public.ops_tasks (dedupe_key) where state = 'open';
create index ops_tasks_open on public.ops_tasks (kind, created_at desc) where state = 'open';

do $$ declare t text; begin
  foreach t in array array['platform_jobs','inbox_mailboxes','inbox_messages','competitor_sender_domains','ops_tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy operator_read on public.%I for select to authenticated using (private.is_operator())', t);
    -- Read-only from the browser: only the security-definer commands write.
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from public, anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Platform admins also read every brand and its emails (the brand
-- directory and the ops queue); workspaces still read only what they follow.
create policy operator_read on public.competitor_captures for select to authenticated using (private.is_operator());
create policy operator_read on public.competitor_emails for select to authenticated using (private.is_operator());

-- Raw messages (.eml) and their HTML part. Private; only the service role
-- (the worker) writes, and nobody reads it from the browser.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('inbox-raw', 'inbox-raw', false, 10485760, array['message/rfc822','text/html'])
  on conflict (id) do nothing;
