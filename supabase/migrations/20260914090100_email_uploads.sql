-- DES-ENGINE-003a (step 3 of the email design plan, "Upload 1:1", owner
-- decisions of 25 Nov): an owner adds his own email file (.html or .eml)
-- on the GROS page "Add your own email". It becomes a private library item
-- of that workspace only: reusable for later emails, never shown to
-- another workspace. The owner says whether it is **his brand's own
-- design** (copied keeping its colours, fonts and pictures, only the
-- content changes) or **another brand's email** (copied like a library
-- email: structure only, rule 8).
--
-- * email_uploads: one row per added email, written only through its
--   commands. Members of the workspace read their own (RLS); nobody else,
--   operators included, reads another workspace's uploads. The owner and
--   admins add and delete (`add_email_upload`, `finish_email_upload`,
--   `delete_email_upload`, tenant first); staff only read.
-- * Its files go to the private bucket `email-uploads`, under
--   `<workspace>/<upload>/`: `original.html|eml` (the file exactly as
--   uploaded, never changed), `email.html` (the prepared HTML: our own
--   section marks, every picture of the file at a placeholder address,
--   `https://email-uploads.invalid/<n>.<ext>`) and, for an own design,
--   `picture-<n>.<ext>` (each picture the file carried, inline or `cid:`,
--   or fetched by the server from a fixed list of picture hosts). The
--   server writes them with its own key, never over a stored object;
--   nobody in a browser reads or writes the bucket. `finish_email_upload`
--   accepts the upload only when every file it names is stored, and pins
--   each picture's tag and size.
-- * Job kind `design.upload`: the upload measured once into a blueprint
--   by the browser job (`scripts/design-uploads.mjs`), claimed through
--   `claim_email_upload` with a 5-minute lease (4 tries, as every platform
--   job); a job of a workspace that is not active waits an hour, its try
--   given back. Another workspace's design is stored bare (no picture
--   address, no link: `private.blueprint_is_bare`, as `inbox_blueprints`).
-- * Bounds: 100 uploads per workspace, 20 added per hour, 4 MiB per file,
--   40 pictures per upload.
-- * The number is chosen at merge time (D24).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('email-uploads', 'email-uploads', false, 4194304,
          array['text/html', 'message/rfc822', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  on conflict (id) do nothing;

create table public.email_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_key uuid not null,
  name text not null check (char_length(name) between 1 and 80 and name ~ '\S' and name !~ '[[:cntrl:]]'),
  design text not null check (design in ('own', 'other')),
  file_kind text not null check (file_kind in ('html', 'eml')),
  byte_size integer not null check (byte_size between 1 and 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Each stored picture: {index, type, width, height, bytes, from, etag?}.
  pictures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(pictures) = 'array' and jsonb_array_length(pictures) <= 40
           and octet_length(pictures::text) <= 40000),
  -- Pictures the file names on sites GROS does not load from: {host, count, why}.
  missing jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missing) = 'array' and jsonb_array_length(missing) <= 20
           and octet_length(missing::text) <= 8000),
  state text not null default 'saving' check (state in ('saving', 'measuring', 'ready', 'failed')),
  blueprint jsonb check (blueprint is null or (jsonb_typeof(blueprint) = 'object'
                         and octet_length(blueprint::text) <= 600000)),
  failure text check (failure ~ '^[a-z0-9_]{1,60}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, request_key),
  -- For later rows that belong to an upload in the same workspace.
  unique (tenant_id, id),
  check ((state = 'ready') = (blueprint is not null)),
  check ((state = 'failed') = (failure is not null)),
  -- Another brand's email keeps no picture address and no link (rule 8).
  constraint email_uploads_other_bare check (design = 'own' or blueprint is null or private.blueprint_is_bare(blueprint))
);
create index email_uploads_tenant on public.email_uploads (tenant_id, created_at desc);
alter table public.email_uploads enable row level security;
create policy email_uploads_member_read on public.email_uploads for select to authenticated
  using (private.is_active_member(tenant_id));
revoke all on public.email_uploads from public, anon, authenticated, service_role;
grant select on public.email_uploads to authenticated, service_role;
do $$ begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on public.email_uploads from public, anon, authenticated, service_role';
  end if;
end $$;

alter table public.platform_jobs drop constraint platform_jobs_kind_check,
  add constraint platform_jobs_kind_check
    check (kind in ('inbox.poll','inbox.assets','inbox.screenshot','inbox.label','inbox.confirm','inbox.variant',
                    'studio.render','studio.preview','inbox.blueprint','design.copy','design.upload'));

-- The owner or an admin of an active workspace, under its lock (tenant first).
create or replace function private.require_upload_manager(t uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_member(t, array['owner', 'admin']::public.tenant_role[]) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  perform 1 from public.tenants where id = t for update;
  if not private.is_active_member(t, array['owner', 'admin']::public.tenant_role[])
     or not exists (select 1 from public.tenants where id = t and status = 'active') then
    raise exception 'Access denied' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_upload_manager(uuid) from public, anon, authenticated, service_role;

-- Only jobs (the service role) run the measuring commands.
create or replace function private.upload_job_role()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only jobs measure uploads' using errcode = '42501';
  end if;
end $$;
revoke all on function private.upload_job_role() from public, anon, authenticated, service_role;

-- A picture's file name in the bucket.
create or replace function private.upload_picture_path(t uuid, upload uuid, p jsonb)
returns text language sql immutable set search_path = '' as $$
  select t || '/' || upload || '/picture-' || (p->>'index') || '.' ||
    case p->>'type' when 'image/png' then 'png' when 'image/jpeg' then 'jpg'
                    when 'image/gif' then 'gif' else 'webp' end
$$;
revoke all on function private.upload_picture_path(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- The owner (or an admin) adds an email file: the row, before its files
-- are written. The same request key gives back the same upload (a lost
-- answer, a second click) when it is the same file; another file is
-- refused (PT409, hint upload_request_used). Returns {id, state}.
create or replace function public.add_email_upload(t uuid, request uuid, name text, design text,
  file_kind text, byte_size integer, sha256 text, pictures jsonb default '[]'::jsonb,
  missing jsonb default '[]'::jsonb)
returns table (id uuid, state text)
language plpgsql security definer set search_path = '' as $$
declare u public.email_uploads; p jsonb; i integer := 0; total bigint := 0;
begin
  perform private.require_upload_manager(t);
  select * into u from public.email_uploads x where x.tenant_id = t and x.request_key = request;
  if found then
    if u.sha256 is distinct from add_email_upload.sha256 or u.design is distinct from add_email_upload.design then
      raise exception 'This form was used for another file' using errcode = 'PT409', hint = 'upload_request_used';
    end if;
    return query select u.id, u.state;
    return;
  end if;
  if (select count(*) from public.email_uploads x where x.tenant_id = t) >= 100 then
    raise exception 'Upload limit reached' using errcode = 'PT409', hint = 'upload_limit';
  end if;
  if (select count(*) from public.email_uploads x where x.tenant_id = t and x.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many uploads this hour' using errcode = 'PT409', hint = 'upload_hourly_limit';
  end if;
  if pictures is null or jsonb_typeof(pictures) <> 'array' or jsonb_array_length(pictures) > 40
     or missing is null or jsonb_typeof(missing) <> 'array' or jsonb_array_length(missing) > 20 then
    raise exception 'Invalid pictures' using errcode = '22023';
  end if;
  if design = 'other' and jsonb_array_length(pictures) > 0 then
    -- Another brand's pictures are never kept (rule 8).
    raise exception 'Another brand''s pictures are not kept' using errcode = '22023';
  end if;
  for p in select * from jsonb_array_elements(pictures) loop
    if jsonb_typeof(p) <> 'object'
       or (p->>'index') is distinct from i::text
       or p->>'type' is null or p->>'type' not in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
       or (p->>'width') !~ '^[0-9]{1,5}$' or (p->>'height') !~ '^[0-9]{1,5}$'
       or (p->>'width')::integer < 1 or (p->>'height')::integer < 1
       or (p->>'bytes') !~ '^[0-9]{1,8}$' or (p->>'bytes')::integer not between 1 and 3145728
       or p->>'from' is null or p->>'from' not in ('file', 'web') then
      raise exception 'Invalid picture' using errcode = '22023';
    end if;
    total := total + (p->>'bytes')::bigint;
    i := i + 1;
  end loop;
  if total > 25165824 then
    raise exception 'Pictures too large' using errcode = '22023';
  end if;
  insert into public.email_uploads (tenant_id, request_key, name, design, file_kind, byte_size, sha256,
      pictures, missing, created_by)
    values (t, request, add_email_upload.name, add_email_upload.design, add_email_upload.file_kind,
      add_email_upload.byte_size, add_email_upload.sha256, add_email_upload.pictures,
      add_email_upload.missing, auth.uid())
    returning * into u;
  return query select u.id, u.state;
end $$;
revoke all on function public.add_email_upload(uuid, uuid, text, text, text, integer, text, jsonb, jsonb) from public, anon;
grant execute on function public.add_email_upload(uuid, uuid, text, text, text, integer, text, jsonb, jsonb) to authenticated;

-- Once its files are stored: every file the upload names must be in the
-- bucket at its own path (the original, the prepared HTML and each
-- picture, whose tag and size are pinned); then it is queued to be
-- measured. Again after that: its state.
create or replace function public.finish_email_upload(t uuid, upload uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare u public.email_uploads; p jsonb; o storage.objects; pinned jsonb := '[]'::jsonb;
  base text;
begin
  perform private.require_upload_manager(t);
  select * into u from public.email_uploads x where x.tenant_id = t and x.id = upload for update;
  if not found then
    raise exception 'The upload is gone' using errcode = 'PT409', hint = 'upload_gone';
  end if;
  if u.state <> 'saving' then return u.state; end if;
  base := u.tenant_id || '/' || u.id || '/';
  if not exists (select 1 from storage.objects s where s.bucket_id = 'email-uploads'
                   and s.name = base || 'original.' || u.file_kind)
     or not exists (select 1 from storage.objects s where s.bucket_id = 'email-uploads'
                   and s.name = base || 'email.html') then
    raise exception 'The upload''s files are not stored' using errcode = 'PT409', hint = 'upload_files_missing';
  end if;
  for p in select * from jsonb_array_elements(u.pictures) loop
    select * into o from storage.objects s where s.bucket_id = 'email-uploads'
      and s.name = private.upload_picture_path(u.tenant_id, u.id, p);
    if not found or coalesce(o.metadata->>'eTag', '') = ''
       or coalesce((o.metadata->>'size')::bigint, -1) <> (p->>'bytes')::bigint then
      raise exception 'A picture is not stored' using errcode = 'PT409', hint = 'upload_files_missing';
    end if;
    pinned := pinned || jsonb_build_array(p || jsonb_build_object('etag', o.metadata->>'eTag'));
  end loop;
  update public.email_uploads x set state = 'measuring', pictures = pinned, updated_at = now()
    where x.id = u.id;
  insert into public.platform_jobs (kind, subject_key, idempotency_key)
    values ('design.upload', u.id::text, 'design.upload:' || u.id)
    on conflict do nothing;
  return 'measuring';
end $$;
revoke all on function public.finish_email_upload(uuid, uuid) from public, anon;
grant execute on function public.finish_email_upload(uuid, uuid) to authenticated;

-- The owner (or an admin) deletes an upload: its row goes now (the server
-- removes its files after). Returns the folder to remove.
create or replace function public.delete_email_upload(t uuid, upload uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare u public.email_uploads;
begin
  perform private.require_upload_manager(t);
  delete from public.email_uploads x where x.tenant_id = t and x.id = upload returning * into u;
  if not found then
    raise exception 'The upload is gone' using errcode = 'PT409', hint = 'upload_gone';
  end if;
  -- Its measuring job, if still waiting, has nothing left to do.
  update public.platform_jobs j set status = 'succeeded', lease_token = null, lease_expires_at = null,
      result = jsonb_build_object('state', 'gone'), finished_at = now(), updated_at = now()
    where j.kind = 'design.upload' and j.subject_key = u.id::text and j.status in ('queued', 'retry_wait');
  return u.tenant_id || '/' || u.id || '/';
end $$;
revoke all on function public.delete_email_upload(uuid, uuid) from public, anon;
grant execute on function public.delete_email_upload(uuid, uuid) to authenticated;

-- The browser job's claim: one upload of an active workspace waiting to be
-- measured, leased for 5 minutes. A job whose upload is gone or no longer
-- waits is finished; one of a paused or closed workspace waits an hour
-- and its try is given back.
create or replace function public.claim_email_upload()
returns table (id uuid, subject_key text, lease_token uuid, attempt integer, tenant_id uuid, design text,
  pictures integer)
language plpgsql security definer set search_path = '' as $$
declare j record; u public.email_uploads; active boolean;
begin
  perform private.upload_job_role();
  for i in 1..10 loop
    select c.id, c.subject_key, c.lease_token, c.attempt into j
      from public.claim_platform_job(array['design.upload']) c;
    if j.id is null then return; end if;
    u := null;
    if j.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into u from public.email_uploads x where x.id = j.subject_key::uuid;
    end if;
    if u.id is null or u.state <> 'measuring' then
      update public.platform_jobs p set status = 'succeeded', lease_token = null, lease_expires_at = null,
          result = jsonb_build_object('state', 'gone'), finished_at = now(), updated_at = now()
        where p.id = j.id;
      continue;
    end if;
    select coalesce(w.status = 'active', false) into active from public.tenants w where w.id = u.tenant_id;
    if active then
      update public.platform_jobs p set lease_expires_at = now() + interval '5 minutes', updated_at = now()
        where p.id = j.id and p.lease_token = j.lease_token;
      return query select j.id, j.subject_key, j.lease_token, j.attempt, u.tenant_id, u.design,
        jsonb_array_length(u.pictures);
      return;
    end if;
    update public.platform_jobs p
      set status = 'retry_wait', lease_token = null, lease_expires_at = null,
          attempt = greatest(0, p.attempt - 1), last_error_code = 'workspace_inactive',
          available_at = now() + interval '1 hour', updated_at = now()
      where p.id = j.id;
  end loop;
end $$;
revoke all on function public.claim_email_upload() from public, anon, authenticated;
grant execute on function public.claim_email_upload() to service_role;

-- The browser job's result: the blueprint, or why the upload can never be
-- measured. Once per upload; finishes the job.
create or replace function public.record_email_upload(job uuid, lease uuid, blueprint jsonb default null,
  failure text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs; t uuid; u public.email_uploads;
begin
  perform private.upload_job_role();
  -- Tenant first, then the job and the upload.
  select x.tenant_id into t from public.platform_jobs p join public.email_uploads x
    on p.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and x.id = p.subject_key::uuid
    where p.id = job and p.kind = 'design.upload';
  if t is not null then perform 1 from public.tenants where id = t for share; end if;
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.upload' then raise exception 'Not an upload job' using errcode = '23514'; end if;
  if (blueprint is null) = (failure is null) then
    raise exception 'Give a blueprint or a failure' using errcode = '23514';
  end if;
  if failure is not null and failure !~ '^[a-z0-9_]{1,60}$' then
    raise exception 'Invalid failure' using errcode = '23514';
  end if;
  if blueprint is not null and (jsonb_typeof(blueprint) <> 'object' or octet_length(blueprint::text) > 600000) then
    raise exception 'Invalid blueprint' using errcode = '23514';
  end if;
  select * into u from public.email_uploads x where x.id = j.subject_key::uuid for update;
  if not found then
    -- Deleted while it was measured: nothing to keep.
    update public.platform_jobs set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', 'gone'), finished_at = now(), updated_at = now()
      where id = j.id;
    return 'gone';
  end if;
  if u.design = 'other' and blueprint is not null and not private.blueprint_is_bare(blueprint) then
    raise exception 'Another brand''s blueprint keeps a picture or link' using errcode = '23514';
  end if;
  update public.email_uploads x
    set state = case when record_email_upload.blueprint is null then 'failed' else 'ready' end,
        blueprint = record_email_upload.blueprint, failure = record_email_upload.failure, updated_at = now()
    where x.id = u.id and x.state = 'measuring';
  update public.platform_jobs
    set status = 'succeeded', lease_token = null, lease_expires_at = null,
        result = jsonb_build_object('state', case when record_email_upload.blueprint is null then 'failed' else 'ready' end),
        finished_at = now(), updated_at = now()
    where id = j.id;
  return (select x.state from public.email_uploads x where x.id = u.id);
end $$;
revoke all on function public.record_email_upload(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_email_upload(uuid, uuid, jsonb, text) to service_role;

-- A browser job on another engine version hands its job back: it waits 10
-- minutes, no try is counted and nothing is recorded.
create or replace function public.release_email_upload(job uuid, lease uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare j public.platform_jobs;
begin
  perform private.upload_job_role();
  j := private.platform_lease(job, lease);
  if j.kind <> 'design.upload' then raise exception 'Not an upload job' using errcode = '23514'; end if;
  update public.platform_jobs
    set status = 'retry_wait', lease_token = null, lease_expires_at = null,
        attempt = greatest(0, j.attempt - 1), last_error_code = 'version_skew',
        available_at = now() + interval '10 minutes', updated_at = now()
    where id = j.id;
end $$;
revoke all on function public.release_email_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_email_upload(uuid, uuid) to service_role;

-- A job that failed four times (its tries, or its leases running out)
-- leaves its upload failed. A job whose key is no upload's is left alone:
-- this runs inside every job claim's lease recovery, which must never stop.
create or replace function private.fail_email_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'design.upload' and new.status = 'failed' and old.status is distinct from 'failed'
     and new.subject_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    update public.email_uploads set state = 'failed', failure = 'measure_job_failed', updated_at = now()
      where id = new.subject_key::uuid and state = 'measuring';
  end if;
  return null;
end $$;
revoke all on function private.fail_email_upload() from public, anon, authenticated, service_role;
create trigger fail_email_upload after update of status on public.platform_jobs
  for each row when (new.kind = 'design.upload' and new.status = 'failed')
  execute function private.fail_email_upload();
