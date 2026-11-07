-- INB-001 commands. The worker (service role) polls the inbox through
-- platform_jobs; admins register brands. Business conflicts are PT409.

-- Opens (or reuses) the one active poll job for a mailbox. Null while the
-- mailbox is paused after an authentication failure.
create or replace function public.enqueue_inbox_poll(mailbox text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.inbox_mailboxes; job uuid;
begin
  if mailbox is null or mailbox not in ('fake','gmail') then
    raise exception 'Unknown mailbox' using errcode = '23514';
  end if;
  insert into public.inbox_mailboxes(key, transport)
    values (mailbox, case mailbox when 'fake' then 'fake' else 'gmail_imap' end)
    on conflict (key) do nothing;
  select * into m from public.inbox_mailboxes where key = mailbox for update;
  if m.paused_until is not null and m.paused_until > now() then return null; end if;
  select id into job from public.platform_jobs
    where kind = 'inbox.poll' and subject_key = mailbox and status in ('queued','leased','retry_wait');
  if job is not null then return job; end if;
  insert into public.platform_jobs(kind, subject_key, idempotency_key)
    values ('inbox.poll', mailbox, 'inbox.poll:' || mailbox || ':' || gen_random_uuid())
    returning id into job;
  return job;
end $$;

-- Claims the next due job of the given kinds (and subject, when given).
-- Expired leases are recovered first (retried, or failed after the 4th
-- attempt, which opens a job_failed task like any other final failure).
create or replace function public.claim_platform_job(kinds text[], subject text default null)
returns table (id uuid, kind text, subject_key text, lease_token uuid, attempt integer, context jsonb)
language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; m public.inbox_mailboxes; gone record;
begin
  for gone in
    with stale as (
      select p.id from public.platform_jobs p
        where p.status = 'leased' and p.lease_expires_at < now()
        order by p.id for update skip locked
    )
    update public.platform_jobs p
      set status = case when p.attempt >= 4 then 'failed' else 'retry_wait' end,
          lease_token = null, lease_expires_at = null,
          failure_class = 'timeout', last_error_code = 'lease_expired',
          finished_at = case when p.attempt >= 4 then now() end, updated_at = now()
      from stale where p.id = stale.id
      returning p.id, p.kind, p.subject_key, p.status
  loop
    if gone.kind = 'inbox.poll' then
      update public.inbox_mailboxes set last_error_code = 'lease_expired' where key = gone.subject_key;
    end if;
    if gone.status = 'failed' then
      perform private.open_ops_task('job_failed', 'job_failed:' || gone.kind || ':' || gone.subject_key, gone.id,
        jsonb_build_object('kind', gone.kind, 'failure', 'timeout', 'code', 'lease_expired'));
    end if;
  end loop;
  select * into j from public.platform_jobs p
    where p.kind = any(kinds) and (subject is null or p.subject_key = subject)
      and p.status in ('queued','retry_wait') and p.available_at <= now()
    order by p.available_at, p.id
    for update skip locked limit 1;
  if j.id is null then return; end if;
  update public.platform_jobs p
    set status = 'leased', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '120 seconds',
        attempt = p.attempt + 1, updated_at = now()
    where p.id = j.id returning * into j;
  if j.kind = 'inbox.poll' then
    select * into m from public.inbox_mailboxes where key = j.subject_key;
    context := jsonb_build_object('mailbox', m.key, 'transport', m.transport,
      'uidValidity', m.uidvalidity, 'lastUid', m.last_uid);
  else
    context := '{}'::jsonb;
  end if;
  id := j.id; kind := j.kind; subject_key := j.subject_key; lease_token := j.lease_token; attempt := j.attempt;
  return next;
end $$;

-- The job row for a live lease, locked; PT409 for a stale or wrong lease.
create or replace function private.platform_lease(job uuid, lease uuid)
returns public.platform_jobs language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  select * into j from public.platform_jobs where id = job for update;
  if j.id is null or j.status <> 'leased' or j.lease_token is distinct from lease or j.lease_expires_at < now() then
    raise exception 'Stale platform job lease' using errcode = 'PT409';
  end if;
  return j;
end $$;

-- One open task per problem: a repeat only counts up.
create or replace function private.open_ops_task(task_kind text, dedupe text, subject uuid, info jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.ops_tasks set occurrences = occurrences + 1, updated_at = now()
    where dedupe_key = dedupe and state = 'open';
  if not found then
    insert into public.ops_tasks(kind, dedupe_key, subject_id, detail)
      values (task_kind, dedupe, subject, coalesce(info, '{}'::jsonb))
      on conflict (dedupe_key) where state = 'open'
      do update set occurrences = public.ops_tasks.occurrences + 1, updated_at = now();
  end if;
end $$;

-- Records one message read from the inbox, once, and assigns its brand:
-- the +alias slug first, then a registered sender domain (or its parent),
-- otherwise an ops task. Returns what happened.
create or replace function public.record_inbox_message(job uuid, lease uuid, msg jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.platform_jobs; m public.inbox_mailboxes; c public.competitor_captures;
  message uuid; state text; how text; msg_key text := msg->>'messageKey';
  raw text := msg->>'rawPath'; html text := msg->>'htmlPath';
  sender text := lower(nullif(btrim(coalesce(msg->>'fromDomain','')), ''));
  slug text := lower(nullif(btrim(coalesce(msg->>'aliasSlug','')), ''));
  subject text := left(btrim(regexp_replace(coalesce(msg->>'subject',''), '\s+', ' ', 'g')), 200);
  body text := coalesce(msg->>'text','');
  email uuid; mismatch uuid;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.poll' then raise exception 'Not an inbox job' using errcode = '23514'; end if;
  select * into m from public.inbox_mailboxes where key = j.subject_key;
  if jsonb_typeof(msg) is distinct from 'object' or msg_key is null or msg_key !~ '^[a-f0-9]{64}$'
     or (msg->>'uid') is null or (msg->>'uid')::bigint < 1 or (msg->>'uidValidity')::bigint < 1
     or (msg->>'rawBytes')::integer not between 1 and 52428800
     or (msg->>'receivedAt') is null or (msg->>'synthetic') is null
     or coalesce(msg->>'kind','') not in ('message','parse_failed','too_large')
     or (slug is not null and slug !~ '^[a-z0-9][a-z0-9-]{1,39}$')
     or (sender is not null and (length(sender) > 253 or sender !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')) then
    raise exception 'Invalid inbox message' using errcode = '23514';
  end if;
  -- A synthetic message only from the fake mailbox, a real one only from Gmail.
  if (msg->>'synthetic')::boolean is distinct from (m.transport = 'fake') then
    raise exception 'Message does not match its mailbox' using errcode = '23514';
  end if;
  if msg->>'kind' <> 'too_large' then
    if raw is null or raw !~ ('^' || m.key || '/[a-f0-9]{64}\.eml$')
       or (html is not null and html !~ ('^' || m.key || '/[a-f0-9]{64}\.html$'))
       or (msg->>'rawSha256') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid stored copy' using errcode = '23514';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-raw' and o.name = raw)
       or (html is not null and not exists (select 1 from storage.objects o where o.bucket_id = 'inbox-raw' and o.name = html)) then
      raise exception 'Stored copy missing' using errcode = 'PT409';
    end if;
  end if;

  if msg->>'kind' = 'message' then
    -- Sample mail only reaches sample brands and real mail only real ones.
    if slug is not null then
      select * into c from public.competitor_captures cc
        where cc.alias_slug = slug and cc.synthetic = (m.transport = 'fake');
      if c.id is not null then how := 'alias'; end if;
      -- The +alias address is easy to guess: when the brand has registered
      -- sender domains, the sender must be one of them.
      if c.id is not null and exists (select 1 from public.competitor_sender_domains d where d.capture_id = c.id)
         and not exists (select 1 from public.competitor_sender_domains d
           where d.capture_id = c.id and sender is not null and (sender = d.domain or sender like '%.' || d.domain)) then
        mismatch := c.id; c := null; how := null;
      end if;
    end if;
    if c.id is null and mismatch is null and sender is not null then
      select cc.* into c from public.competitor_sender_domains d
        join public.competitor_captures cc on cc.id = d.capture_id
        where (sender = d.domain or sender like '%.' || d.domain) and cc.synthetic = (m.transport = 'fake')
        order by length(d.domain) desc limit 1;
      if c.id is not null then how := 'sender'; end if;
    end if;
    state := case when c.id is null then 'unassigned' else 'assigned' end;
  else
    state := msg->>'kind';
  end if;

  insert into public.inbox_messages(mailbox_id, message_key, uidvalidity, uid, transport_id, raw_path, raw_sha256, raw_bytes,
      html_path, from_address, from_domain, alias_slug, subject, received_at, synthetic, state, method, capture_id)
    values (m.id, msg_key, (msg->>'uidValidity')::bigint, (msg->>'uid')::bigint, left(msg->>'transportId', 100),
      case when state = 'too_large' then null else raw end,
      case when state = 'too_large' then null else msg->>'rawSha256' end,
      (msg->>'rawBytes')::integer,
      case when state = 'too_large' then null else html end,
      left(lower(msg->>'fromAddress'), 320), sender, slug, subject, (msg->>'receivedAt')::timestamptz,
      (msg->>'synthetic')::boolean, state, how, c.id)
    on conflict do nothing
    returning id into message;
  if message is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if state = 'assigned' then
    insert into public.competitor_emails(capture_id, external_id, received_at, subject, text_content, safe_html, micro, synthetic,
        inbox_message_id, raw_path, html_path, preview_text)
      values (c.id, 'msg:' || msg_key, (msg->>'receivedAt')::timestamptz, coalesce(nullif(subject, ''), '(no subject)'),
        left(coalesce(nullif(btrim(body), ''), '(no text)'), 10000),
        -- Text only, escaped by the server; the real design is rendered from
        -- the stored HTML in a sandbox later (INB-002).
        '<!doctype html><html><body style="font-family:Arial;padding:24px"><h1>' || private.escape_html(coalesce(nullif(subject, ''), '(no subject)'))
          || '</h1><pre style="white-space:pre-wrap">' || private.escape_html(left(body, 10000)) || '</pre></body></html>',
        '{}'::jsonb, (msg->>'synthetic')::boolean, message, raw, html, left(nullif(btrim(msg->>'preview'), ''), 300))
      on conflict (capture_id, external_id) do nothing
      returning id into email;
    update public.competitor_captures
      set last_received_at = greatest(coalesce(last_received_at, '-infinity'::timestamptz), (msg->>'receivedAt')::timestamptz),
          status = 'live',
          subscription_status = case when subscription_status in ('not_subscribed','pending') then 'subscribed' else subscription_status end
      where id = c.id;
  elsif state = 'unassigned' and mismatch is not null then
    -- The sender is hashed: a forged From domain can be 253 characters.
    perform private.open_ops_task('inbox_unknown_sender', 'inbox_sender_mismatch:' || slug || ':' || md5(coalesce(sender, 'none')), message,
      jsonb_build_object('fromDomain', sender, 'aliasSlug', slug, 'reason', 'sender_not_registered', 'brand', mismatch));
  elsif state = 'unassigned' then
    perform private.open_ops_task('inbox_unknown_sender', 'inbox_unknown_sender:' || coalesce(sender, 'none'), message,
      jsonb_build_object('fromDomain', sender, 'aliasSlug', slug));
  elsif state = 'parse_failed' then
    perform private.open_ops_task('inbox_parse_failure', 'inbox_parse_failure:' || msg_key, message,
      jsonb_build_object('fromDomain', sender, 'reason', left(msg->>'reason', 80)));
  else
    perform private.open_ops_task('inbox_too_large', 'inbox_too_large:' || msg_key, message,
      jsonb_build_object('fromDomain', sender, 'bytes', (msg->>'rawBytes')::integer));
  end if;
  return jsonb_build_object('duplicate', false, 'state', state, 'method', how, 'brand', c.id, 'email', email);
end $$;

-- Moves the mailbox cursor forward only; a new UIDVALIDITY starts over.
create or replace function public.advance_inbox_cursor(job uuid, lease uuid, uid_validity bigint, last_seen bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  j := private.platform_lease(job, lease);
  if j.kind <> 'inbox.poll' then raise exception 'Not an inbox job' using errcode = '23514'; end if;
  if uid_validity is null or uid_validity < 1 or last_seen is null or last_seen < 0 then
    raise exception 'Invalid cursor' using errcode = '23514';
  end if;
  update public.inbox_mailboxes
    set last_uid = case when uidvalidity is distinct from uid_validity then last_seen else greatest(last_uid, last_seen) end,
        uidvalidity = uid_validity
    where key = j.subject_key;
end $$;

create or replace function public.finish_platform_job(job uuid, lease uuid, outcome jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  j := private.platform_lease(job, lease);
  if jsonb_typeof(coalesce(outcome, '{}'::jsonb)) <> 'object' or length(coalesce(outcome, '{}'::jsonb)::text) > 4000 then
    raise exception 'Invalid job result' using errcode = '23514';
  end if;
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null, result = coalesce(outcome, '{}'::jsonb),
        finished_at = now(), updated_at = now()
    where id = j.id;
  if j.kind = 'inbox.poll' then
    update public.inbox_mailboxes set last_polled_at = now(), last_error_code = null, paused_until = null
      where key = j.subject_key;
    -- The login works again: the "check the inbox login" task is done.
    update public.ops_tasks set state = 'resolved', resolved_at = now(), updated_at = now()
      where dedupe_key = 'inbox_auth_failed:' || j.subject_key and state = 'open';
  end if;
end $$;

-- A failed attempt retries with backoff; the 4th failure becomes an ops
-- task. A failed login pauses the mailbox for 6 hours (so repeated wrong
-- logins never lock the Gmail account) and asks a person to check it.
create or replace function public.fail_platform_job(job uuid, lease uuid, failure text, error_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; final boolean;
begin
  j := private.platform_lease(job, lease);
  if failure is null or failure not in ('auth','unavailable','timeout','protocol','too_large','internal')
     or error_code is null or error_code !~ '^[a-z0-9_.-]{1,80}$' then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  final := failure = 'auth' or j.attempt >= 4;
  update public.platform_jobs
    set status = case when final then 'failed' else 'retry_wait' end,
        lease_token = null, lease_expires_at = null, failure_class = failure, last_error_code = error_code,
        available_at = now() + make_interval(secs => least(300, 5 * power(2, j.attempt))::double precision),
        finished_at = case when final then now() end, updated_at = now()
    where id = j.id;
  if j.kind = 'inbox.poll' then
    update public.inbox_mailboxes
      set last_error_code = error_code,
          paused_until = case when failure = 'auth' then now() + interval '6 hours' else paused_until end
      where key = j.subject_key;
  end if;
  if failure = 'auth' then
    perform private.open_ops_task('inbox_auth_failed', 'inbox_auth_failed:' || j.subject_key, j.id,
      jsonb_build_object('mailbox', j.subject_key, 'code', error_code));
  elsif final then
    perform private.open_ops_task('job_failed', 'job_failed:' || j.kind || ':' || j.subject_key, j.id,
      jsonb_build_object('kind', j.kind, 'failure', failure, 'code', error_code));
  end if;
end $$;

-- Platform admins register a brand: its domain, +alias slug, name, niche
-- and the sender domains its emails come from. A .example domain is a
-- sample brand (fake inbox only); any other domain is a real brand.
-- An alias or sender domain that belongs to another brand is PT409.
create or replace function public.admin_save_inbox_brand(brand_domain text, alias text, name text, brand_niche text, senders text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c uuid; d text; owner uuid; got text; sample boolean;
  clean_domain text := lower(btrim(coalesce(brand_domain, '')));
  clean_slug text := lower(btrim(coalesce(alias, '')));
  host text := '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
begin
  if not private.is_operator() then raise exception 'Platform admin required' using errcode = '42501'; end if;
  if length(clean_domain) > 253 or clean_domain !~ host then
    raise exception 'Enter the brand''s domain, for example northwind.com' using errcode = '23514';
  end if;
  if clean_slug !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Use 2 to 40 lowercase letters, digits or dashes for the alias' using errcode = '23514'; end if;
  if length(btrim(coalesce(name, ''))) not between 1 and 120 or length(btrim(coalesce(brand_niche, ''))) not between 1 and 60 then
    raise exception 'Name and niche are required' using errcode = '23514';
  end if;
  if coalesce(array_length(senders, 1), 0) > 10 then raise exception 'At most 10 sender domains' using errcode = '23514'; end if;
  foreach d in array coalesce(senders, '{}') loop
    if d is null or length(lower(btrim(d))) > 253 or lower(btrim(d)) !~ host then
      raise exception 'Sender domains look like mail.northwind.com' using errcode = '23514';
    end if;
  end loop;
  sample := clean_domain ~ '\.example$';
  perform 1 from public.competitor_captures cc where cc.alias_slug = clean_slug and cc.domain <> clean_domain;
  if found then raise exception 'That alias belongs to another brand' using errcode = 'PT409'; end if;
  begin
    insert into public.competitor_captures(domain, synthetic, alias_slug, brand_name, niche, subscription_status)
      values (clean_domain, sample, clean_slug, btrim(name), btrim(brand_niche), 'pending')
      on conflict (domain) do update set alias_slug = excluded.alias_slug, brand_name = excluded.brand_name, niche = excluded.niche
      returning id into c;
    foreach d in array coalesce(senders, '{}') loop
      select capture_id into owner from public.competitor_sender_domains where domain = lower(btrim(d)) for update;
      if owner is not null and owner <> c then
        raise exception 'Sender domain % belongs to another brand', lower(btrim(d)) using errcode = 'PT409';
      end if;
      insert into public.competitor_sender_domains(domain, capture_id) values (lower(btrim(d)), c)
        on conflict (domain) do nothing
        returning domain into got;
      -- Another save took the domain at the same moment.
      if got is null and (select capture_id from public.competitor_sender_domains where domain = lower(btrim(d))) <> c then
        raise exception 'Sender domain % belongs to another brand', lower(btrim(d)) using errcode = 'PT409';
      end if;
    end loop;
  exception when unique_violation then
    -- Two saves at once: the other one won the alias or a sender domain.
    raise exception 'That alias or sender domain belongs to another brand' using errcode = 'PT409';
  end;
  return c;
end $$;

revoke all on function public.enqueue_inbox_poll(text) from public, anon, authenticated;
revoke all on function public.claim_platform_job(text[], text) from public, anon, authenticated;
revoke all on function public.record_inbox_message(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.advance_inbox_cursor(uuid, uuid, bigint, bigint) from public, anon, authenticated;
revoke all on function public.finish_platform_job(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_platform_job(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.platform_lease(uuid, uuid) from public, anon, authenticated;
revoke all on function private.open_ops_task(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_inbox_poll(text) to service_role;
grant execute on function public.claim_platform_job(text[], text) to service_role;
grant execute on function public.record_inbox_message(uuid, uuid, jsonb) to service_role;
grant execute on function public.advance_inbox_cursor(uuid, uuid, bigint, bigint) to service_role;
grant execute on function public.finish_platform_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_platform_job(uuid, uuid, text, text) to service_role;
revoke all on function public.admin_save_inbox_brand(text, text, text, text, text[]) from public, anon;
grant execute on function public.admin_save_inbox_brand(text, text, text, text, text[]) to authenticated;
