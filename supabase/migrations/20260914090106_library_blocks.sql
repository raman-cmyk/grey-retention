-- DES-ENGINE-004 (step 4 of the email design plan, "Scratch from the real
-- library", owner decisions of 25 Nov): every section of every stored
-- Inspiration blueprint becomes a library block, so Scratch can build an
-- email from real layouts in the brand's own look; a workspace's own
-- uploaded emails become that workspace's private blocks.
--
-- * library_blocks: one row per distinct structure (its fingerprint,
--   features/design-engine/blocks.ts) in its scope: the shared library
--   (tenant_id null, source 'inbox') or one workspace's private library
--   (tenant_id set, source 'upload'). A block is structure only (rule 8):
--   one section's blueprint with no picture address, no link
--   (`private.blueprint_is_bare`) and every letter and digit blanked by the
--   app; its colours and fonts stay for the brand swap and are never shown.
--   `uses` counts the different emails (inbox emails or uploads) that have
--   this structure, so an email that repeats a layout counts once (the
--   de-dup count: "this layout is used a lot"); `brands` the different inbox
--   brands that sent it, the stronger signal. `quality` is the gate: 'passed' (a safe size, and drawn back on
--   its own it looks like its source section) or 'failed' with its code.
--   Written only through record_library_blocks (the block browser job,
--   service role). Platform operators read every row; members of a
--   workspace read only their own private blocks; nobody else reads any.
-- * library_block_sources: where each use came from (an inbox email's
--   section, or an upload's), once per section: a retry records nothing
--   twice. Operators only: a workspace never learns which competitor email
--   a shared block came from, or anything of another workspace's uploads.
--   An upload being deleted (`deleting`) loses its uses at once, under its
--   workspace's lock, and a private block left with no use is removed.
-- * Job kind `design.blocks`, subject `inbox:<message>` or
--   `upload:<upload>`: queued when a blueprint is stored ready, when an
--   upload is measured ready, and for every ready one already stored (the
--   backfill, 30 every 10 minutes). The browser job
--   (scripts/design-blocks.mjs) claims one through claim_library_blocks (5
--   minutes), draws the new structures back and reports; the app recomputes
--   every block from the stored blueprint itself and records it.
-- * release_library_blocks: a job handed back without counting a try (the
--   browser ran another engine version, or the app could not read now);
--   renew_library_blocks: the browser keeps its lease while it draws.
-- * library_block_counts(): the count the Admin shows (operators).
-- * Merging starts production work where the scheduled jobs are on
--   (SCHEDULED_JOBS_ENABLED): the design copies job checks the backfill's
--   blocks in its browser. It never sends, uploads or calls an AI.
-- * The number is chosen at merge time (D24).

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview','inbox.blueprint','design.copy','design.upload','design.blocks'));

create table public.library_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source text not null check (source in ('inbox', 'upload')),
  version integer not null check (version = 1),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{32}$'),
  kind text not null check (kind in ('header','hero','text','image','button','product_grid','columns','offer','social',
    'footer','mixed')),
  -- The section tagger's labels (CI-001) of the first tagged section seen.
  family text check (family in ('announcement_bar','header_logo','hero_product','hero_image','offer_banner','text','steps',
    'product_feature','product_grid_2col','product_grid_3col','category_tiles','image_text','founder_note','review_strip',
    'ugc_grid','before_after','faq','cta','signoff','footer')),
  layout text check (layout ~ '^[a-z_]{1,40}$'),
  purpose text check (purpose ~ '^[a-z_]{1,40}$'),
  styles text[] check (cardinality(styles) <= 3),
  roles text[] not null check (cardinality(roles) between 1 and 22 and roles <@ array['logo','nav','headline',
    'subheadline','eyebrow','body','price','old_price','product_name','product_photo','hero_photo','photo','icon','social',
    'main_button','secondary_button','link','code','caption','footer_text','legal','divider']::text[]),
  facts jsonb not null check (jsonb_typeof(facts) = 'object' and octet_length(facts::text) <= 8000),
  blueprint jsonb not null check (jsonb_typeof(blueprint) = 'object' and octet_length(blueprint::text) <= 200000
    and private.blueprint_is_bare(blueprint)),
  -- The email labels (CI-001) of the inbox emails that used it.
  email_types text[] not null default '{}' check (cardinality(email_types) <= 20),
  industries text[] not null default '{}' check (cardinality(industries) <= 20),
  uses integer not null default 0 check (uses >= 0),
  brands integer not null default 0 check (brands >= 0),
  quality text not null check (quality in ('passed', 'failed')),
  -- The email the stored geometry came from (its first section with this
  -- structure, or the one that later drew back alike): the email a copy's
  -- leak check and the visibility rules start from.
  geometry_message uuid references public.inbox_messages(id),
  geometry_upload uuid references public.email_uploads(id) on delete set null,
  failure text check (failure ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source = 'upload') = (tenant_id is not null)),
  check ((quality = 'failed') = (failure is not null))
);
create unique index library_blocks_shared_print on public.library_blocks (version, fingerprint) where tenant_id is null;
create unique index library_blocks_private_print on public.library_blocks (tenant_id, version, fingerprint)
  where tenant_id is not null;
create index library_blocks_pick on public.library_blocks (kind, uses desc) where quality = 'passed';

create table public.library_block_sources (
  block_id uuid not null references public.library_blocks(id) on delete cascade,
  inbox_message_id uuid references public.inbox_messages(id),
  upload_id uuid references public.email_uploads(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 40),
  -- The inbox brand (competitor_captures.id) that sent it; null for an upload.
  brand uuid,
  created_at timestamptz not null default now(),
  check (num_nonnulls(inbox_message_id, upload_id) = 1),
  unique (inbox_message_id, ordinal),
  unique (upload_id, ordinal)
);
create index library_block_sources_block on public.library_block_sources (block_id);

alter table public.library_blocks enable row level security;
alter table public.library_block_sources enable row level security;
create policy library_blocks_read on public.library_blocks for select to authenticated
  using ((select private.is_operator()) or (tenant_id is not null and (select private.is_active_member(tenant_id))));
create policy library_block_sources_operator_read on public.library_block_sources for select to authenticated
  using ((select private.is_operator()));
revoke all on public.library_blocks, public.library_block_sources from public, anon, authenticated, service_role;
grant select on public.library_blocks, public.library_block_sources to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.library_blocks, public.library_block_sources from public, anon, authenticated, service_role';
  end if;
end $$;

-- Only jobs (the service role) claim and record blocks.
create or replace function private.blocks_job_role()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs record library blocks' using errcode = '42501';
  end if;
end $$;
revoke all on function private.blocks_job_role() from public, anon, authenticated, service_role;

-- Queues a source's blocks once (a recorded one is never cut again).
create or replace function private.queue_library_blocks(subject text)
returns void language sql security definer set search_path = '' as $$
  insert into public.platform_jobs(kind, subject_key, idempotency_key)
    values ('design.blocks', subject, 'design.blocks:' || subject || ':v1')
    on conflict do nothing
$$;
revoke all on function private.queue_library_blocks(text) from public, anon, authenticated, service_role;

create or replace function private.queue_inbox_blocks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_library_blocks('inbox:' || new.inbox_message_id);
  return null;
end $$;
revoke all on function private.queue_inbox_blocks() from public, anon, authenticated, service_role;
create trigger queue_library_blocks after insert on public.inbox_blueprints
  for each row when (new.state = 'ready' and new.version = 1)
  execute function private.queue_inbox_blocks();

create or replace function private.queue_upload_blocks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.queue_library_blocks('upload:' || new.id);
  return null;
end $$;
revoke all on function private.queue_upload_blocks() from public, anon, authenticated, service_role;
create trigger queue_library_blocks after update of state on public.email_uploads
  for each row when (new.state = 'ready' and old.state is distinct from 'ready')
  execute function private.queue_upload_blocks();

-- A use that goes (a deleted upload): the block's counts follow, and a
-- private block left with no use goes too.
create or replace function private.library_block_source_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.library_blocks b
    set uses = (select count(distinct coalesce(s.inbox_message_id, s.upload_id)) from public.library_block_sources s
                where s.block_id = b.id),
        brands = (select count(distinct s.brand) from public.library_block_sources s where s.block_id = b.id),
        updated_at = now()
    where b.id = old.block_id;
  delete from public.library_blocks b
    where b.id = old.block_id and b.tenant_id is not null
      and not exists (select 1 from public.library_block_sources s where s.block_id = b.id);
  return null;
end $$;
revoke all on function private.library_block_source_gone() from public, anon, authenticated, service_role;
create trigger library_block_source_gone after delete on public.library_block_sources
  for each row execute function private.library_block_source_gone();

-- An upload being deleted loses its uses at once (its private blocks are
-- never read or used again), inside delete_email_upload, which holds its
-- workspace's lock: the block rows are only ever written tenant first.
create or replace function private.upload_blocks_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.library_block_sources where upload_id = new.id;
  return null;
end $$;
revoke all on function private.upload_blocks_gone() from public, anon, authenticated, service_role;
create trigger library_blocks_upload_gone after update of state on public.email_uploads
  for each row when (new.state = 'deleting' and old.state is distinct from 'deleting')
  execute function private.upload_blocks_gone();

-- The browser job's claim: one source whose blueprint is ready, leased for
-- 5 minutes, with that blueprint. A job whose source is gone or no longer
-- ready is cancelled; an upload of a paused or closed workspace waits an
-- hour, its try given back.
create or replace function public.claim_library_blocks()
returns table (id uuid, subject_key text, lease_token uuid, attempt integer, tenant_id uuid, blueprint jsonb)
language plpgsql security definer set search_path = '' as $$
declare j record; src uuid; bp jsonb; t uuid; active boolean;
begin
  perform private.blocks_job_role();
  for i in 1..10 loop
    select c.id, c.subject_key, c.lease_token, c.attempt into j
      from public.claim_platform_job(array['design.blocks']) c;
    if j.id is null then return; end if;
    bp := null; t := null; active := true;
    if j.subject_key ~ '^(inbox|upload):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      src := split_part(j.subject_key, ':', 2)::uuid;
      if j.subject_key like 'inbox:%' then
        select b.blueprint into bp from public.inbox_blueprints b
          where b.inbox_message_id = src and b.version = 1 and b.state = 'ready';
      else
        select x.blueprint, x.tenant_id into bp, t from public.email_uploads x where x.id = src and x.state = 'ready';
        if t is not null then
          select coalesce(w.status = 'active', false) into active from public.tenants w where w.id = t;
        end if;
      end if;
    end if;
    if bp is null then
      update public.platform_jobs p set status = 'cancelled', lease_token = null, lease_expires_at = null,
          result = jsonb_build_object('state', 'gone'), finished_at = now(), updated_at = now()
        where p.id = j.id;
      continue;
    end if;
    if not active then
      update public.platform_jobs p
        set status = 'retry_wait', lease_token = null, lease_expires_at = null,
            attempt = greatest(0, p.attempt - 1), last_error_code = 'workspace_inactive',
            available_at = now() + interval '1 hour', updated_at = now()
        where p.id = j.id;
      continue;
    end if;
    update public.platform_jobs p set lease_expires_at = now() + interval '5 minutes', updated_at = now()
      where p.id = j.id and p.lease_token = j.lease_token;
    return query select j.id, j.subject_key, j.lease_token, j.attempt, t, bp;
    return;
  end loop;
end $$;
revoke all on function public.claim_library_blocks() from public, anon, authenticated;
grant execute on function public.claim_library_blocks() to service_role;

-- Which structures a source's candidates already have in its scope and
-- passed: the browser job draws only the others (service role).
create or replace function public.known_library_blocks(t uuid, prints text[])
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.blocks_job_role();
  return query select b.fingerprint from public.library_blocks b
    where b.version = 1 and b.fingerprint = any(prints) and b.quality = 'passed'
      and b.tenant_id is not distinct from t;
end $$;
revoke all on function public.known_library_blocks(uuid, text[]) from public, anon, authenticated;
grant execute on function public.known_library_blocks(uuid, text[]) to service_role;

-- The browser job's result, every block of one source as the app cut it
-- from the stored blueprint: each joins the block of its structure in the
-- source's scope (a new one is made with its quality), once per section.
-- Finishes the job. An upload deleted meanwhile: 'gone', the job cancelled.
create or replace function public.record_library_blocks(job uuid, lease uuid, blocks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.platform_jobs; src uuid; t uuid; is_inbox boolean; u public.email_uploads; m public.inbox_messages;
  b jsonb; blk uuid; tag record; added integer := 0; joined integer := 0; created integer := 0;
begin
  perform private.blocks_job_role();
  -- Tenant first (an upload's workspace), then the job and the source.
  select x.tenant_id into t from public.platform_jobs p join public.email_uploads x
    on p.subject_key ~ '^upload:[0-9a-f-]{36}$' and x.id = split_part(p.subject_key, ':', 2)::uuid
    where p.id = job and p.kind = 'design.blocks';
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.blocks' then raise exception 'Not a blocks job' using errcode = '23514'; end if;
  if j.subject_key !~ '^(inbox|upload):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Not a blocks job' using errcode = '23514';
  end if;
  if jsonb_typeof(blocks) is distinct from 'array' or jsonb_array_length(blocks) > 40 then
    raise exception 'Invalid blocks' using errcode = '23514';
  end if;
  for b in select * from jsonb_array_elements(blocks) loop
    if jsonb_typeof(b) <> 'object'
       or jsonb_typeof(b->'ordinal') <> 'number' or (b->>'ordinal') !~ '^[0-9]{1,2}$'
       or (b->>'ordinal')::integer not between 1 and 40
       or coalesce(b->>'fingerprint', '') !~ '^[0-9a-f]{32}$'
       or coalesce(b->>'kind', '') not in ('header','hero','text','image','button','product_grid','columns','offer','social',
         'footer','mixed')
       or jsonb_typeof(b->'roles') <> 'array'
       or jsonb_typeof(b->'facts') <> 'object' or octet_length((b->'facts')::text) > 8000
       or jsonb_typeof(b->'blueprint') <> 'object' or octet_length((b->'blueprint')::text) > 200000
       or (b->'blueprint'->>'version') is distinct from '1'
       or jsonb_typeof(b->'blueprint'->'sections') is distinct from 'array'
       or jsonb_array_length(b->'blueprint'->'sections') <> 1
       or not private.blueprint_is_bare(b->'blueprint')
       or coalesce(b->>'quality', '') not in ('passed', 'failed')
       or ((b->>'quality') = 'failed') <> (coalesce(b->>'failure', '') ~ '^[a-z_]{1,40}$')
       or ((b->>'quality') = 'passed' and b ? 'failure' and jsonb_typeof(b->'failure') <> 'null') then
      raise exception 'Invalid block' using errcode = '23514';
    end if;
  end loop;
  is_inbox := j.subject_key like 'inbox:%';
  src := split_part(j.subject_key, ':', 2)::uuid;
  if is_inbox then
    select * into m from public.inbox_messages where id = src for share;
    t := null;
  else
    select * into u from public.email_uploads x where x.id = src for update;
    if not found or u.state <> 'ready' then
      update public.platform_jobs set status = 'cancelled', lease_token = null, lease_expires_at = null,
          result = jsonb_build_object('state', 'gone'), finished_at = now(), updated_at = now()
        where id = j.id;
      return jsonb_build_object('state', 'gone');
    end if;
    t := u.tenant_id;
  end if;
  -- Blocks are locked in fingerprint order (two jobs never wait on each
  -- other in opposite orders).
  for b in select x from jsonb_array_elements(blocks) x order by x->>'fingerprint', (x->>'ordinal')::integer loop
    if exists (select 1 from public.library_block_sources s
               where (is_inbox and s.inbox_message_id = src or not is_inbox and s.upload_id = src)
                 and s.ordinal = (b->>'ordinal')::integer) then
      continue;
    end if;
    blk := null;
    -- Insert, or join the block of this structure; tried twice when the
    -- block went between the two (its last use removed meanwhile).
    for try_n in 1..2 loop
      if t is null then
        insert into public.library_blocks(tenant_id, source, version, fingerprint, kind, roles, facts, blueprint, quality, failure,
            geometry_message)
          values (null, 'inbox', 1, b->>'fingerprint', b->>'kind',
            array(select jsonb_array_elements_text(b->'roles')), b->'facts', b->'blueprint', b->>'quality', b->>'failure', src)
          on conflict (version, fingerprint) where tenant_id is null do nothing
          returning id into blk;
      else
        insert into public.library_blocks(tenant_id, source, version, fingerprint, kind, roles, facts, blueprint, quality, failure,
            geometry_upload)
          values (t, 'upload', 1, b->>'fingerprint', b->>'kind',
            array(select jsonb_array_elements_text(b->'roles')), b->'facts', b->'blueprint', b->>'quality', b->>'failure', src)
          on conflict (tenant_id, version, fingerprint) where tenant_id is not null do nothing
          returning id into blk;
      end if;
      if blk is not null then
        created := created + 1;
        exit;
      end if;
      select x.id into blk from public.library_blocks x
        where x.version = 1 and x.fingerprint = b->>'fingerprint' and x.tenant_id is not distinct from t
        for update;
      if blk is not null then
        -- A structure that failed once and now draws back alike is kept.
        if (b->>'quality') = 'passed' then
          update public.library_blocks x set quality = 'passed', failure = null, blueprint = b->'blueprint',
              facts = b->'facts', geometry_message = case when is_inbox then src end,
              geometry_upload = case when is_inbox then null else src end, updated_at = now()
            where x.id = blk and x.quality = 'failed';
        end if;
        joined := joined + 1;
        exit;
      end if;
    end loop;
    if blk is null then
      raise exception 'Library block busy' using errcode = 'PT409';
    end if;
    insert into public.library_block_sources(block_id, inbox_message_id, upload_id, ordinal, brand)
      values (blk, case when is_inbox then src end, case when is_inbox then null else src end,
        (b->>'ordinal')::integer, case when is_inbox then m.capture_id end);
    update public.library_blocks x
      set uses = (select count(distinct coalesce(s.inbox_message_id, s.upload_id)) from public.library_block_sources s
                  where s.block_id = x.id),
          brands = (select count(distinct s.brand) from public.library_block_sources s where s.block_id = x.id),
          email_types = case when is_inbox and m.labels_state = 'tagged' and m.email_type is not null
                               and not m.email_type = any(x.email_types) and cardinality(x.email_types) < 20
                             then x.email_types || m.email_type else x.email_types end,
          industries = case when is_inbox and m.labels_state = 'tagged' and m.industry is not null
                              and not m.industry = any(x.industries) and cardinality(x.industries) < 20
                            then x.industries || m.industry else x.industries end,
          updated_at = now()
      where x.id = blk;
    if is_inbox then
      select e.block_type, e.layout, e.purpose, e.styles into tag from public.email_sections e
        where e.inbox_message_id = src and e.ordinal = (b->>'ordinal')::integer and e.tag_state = 'tagged';
      if found then
        update public.library_blocks x
          set family = tag.block_type, layout = tag.layout, purpose = tag.purpose, styles = tag.styles
          where x.id = blk and x.family is null;
      end if;
    end if;
    added := added + 1;
  end loop;
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', 'done', 'sections', added, 'new', created, 'joined', joined),
        finished_at = now(), updated_at = now()
    where id = j.id;
  return jsonb_build_object('state', 'done', 'sections', added, 'new', created, 'joined', joined);
end $$;
revoke all on function public.record_library_blocks(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_library_blocks(uuid, uuid, jsonb) to service_role;

-- A job handed back without counting a try: the browser ran another
-- engine version than the app, or the app could not read the library just
-- now. It waits 10 minutes; nothing is recorded.
create or replace function public.release_library_blocks(job uuid, lease uuid, code text default 'version_skew')
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  perform private.blocks_job_role();
  if code is null or code not in ('version_skew', 'read_failed') then
    raise exception 'Invalid code' using errcode = '23514';
  end if;
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.blocks' then raise exception 'Not a blocks job' using errcode = '23514'; end if;
  update public.platform_jobs
    set status = 'retry_wait', lease_token = null, lease_expires_at = null,
        attempt = greatest(0, j.attempt - 1), last_error_code = code,
        available_at = now() + interval '10 minutes', updated_at = now()
    where id = j.id;
end $$;
revoke all on function public.release_library_blocks(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_library_blocks(uuid, uuid, text) to service_role;

-- The browser keeps its lease while it draws a long email: 5 more
-- minutes, at most 30 minutes after the claim.
create or replace function public.renew_library_blocks(job uuid, lease uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  perform private.blocks_job_role();
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.blocks' then raise exception 'Not a blocks job' using errcode = '23514'; end if;
  if j.updated_at < now() - interval '30 minutes' then
    raise exception 'Lease held too long' using errcode = 'PT409';
  end if;
  update public.platform_jobs set lease_expires_at = now() + interval '5 minutes'
    where id = j.id;
  return now() + interval '5 minutes';
end $$;
revoke all on function public.renew_library_blocks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.renew_library_blocks(uuid, uuid) to service_role;

-- The Admin's count (platform operators and jobs): blocks by source, kind
-- and quality, with their uses (the sections behind them) and how many are
-- used more than once or by two brands or more.
create or replace function public.library_block_counts()
returns table (source text, kind text, quality text, blocks bigint, uses bigint, reused bigint, two_brands bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(auth.role(), '') = 'service_role' or private.is_operator()) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return query select b.source, b.kind, b.quality, count(*), coalesce(sum(b.uses), 0)::bigint,
      count(*) filter (where b.uses >= 2), count(*) filter (where b.brands >= 2)
    from public.library_blocks b
    group by b.source, b.kind, b.quality
    order by b.source, b.kind, b.quality;
end $$;
revoke all on function public.library_block_counts() from public, anon;
grant execute on function public.library_block_counts() to authenticated, service_role;

-- How many sources wait for their blocks (claims nothing).
create or replace function public.library_block_jobs_waiting()
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.blocks_job_role();
  -- An upload of a paused or closed workspace waits without calling the
  -- browser in: it is not counted.
  return (select count(*) from public.platform_jobs p
    where p.kind = 'design.blocks' and p.status in ('queued', 'retry_wait') and p.available_at <= now()
      and not exists (select 1 from public.email_uploads x join public.tenants w on w.id = x.tenant_id
                      where p.subject_key = 'upload:' || x.id and w.status <> 'active'));
end $$;
revoke all on function public.library_block_jobs_waiting() from public, anon, authenticated;
grant execute on function public.library_block_jobs_waiting() to service_role;

-- Blueprints and uploads already ready: their blocks over the next runs
-- (30 every 10 minutes), newest first.
insert into public.platform_jobs(kind, subject_key, idempotency_key, available_at)
  select 'design.blocks', s.subject, 'design.blocks:' || s.subject || ':v1',
    now() + ((row_number() over (order by s.at desc, s.subject) - 1) / 30) * interval '10 minutes'
  from (
    select 'inbox:' || b.inbox_message_id as subject, b.measured_at as at
      from public.inbox_blueprints b where b.state = 'ready' and b.version = 1
    union all
    select 'upload:' || x.id, x.updated_at from public.email_uploads x where x.state = 'ready'
  ) s
  on conflict do nothing;
