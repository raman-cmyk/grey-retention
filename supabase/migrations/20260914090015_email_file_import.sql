SET local check_function_bodies = off;

ALTER TABLE "public"."job_runs"
  DROP CONSTRAINT "job_runs_kind_check";

CREATE TABLE "private"."email_file_import_requests" (
  "tenant_id"    uuid                     NOT NULL,
  "created_by"   uuid                     NOT NULL,
  "request_key"  uuid                     NOT NULL,
  "payload_hash" text                     NOT NULL,
  "import_id"    uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_file_import_requests_pkey" PRIMARY KEY (tenant_id, created_by, request_key)
);

ALTER TABLE "private"."email_file_import_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."email_file_imports" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           uuid                     NOT NULL,
  "created_by"          uuid                     NOT NULL,
  "state"               text                     NOT NULL DEFAULT 'uploading'::text,
  "file_name"           text                     NOT NULL,
  "file_kind"           text                     NOT NULL,
  "media_type"          text                     NOT NULL,
  "byte_size"           integer                  NOT NULL,
  "sha256"              text                     NOT NULL,
  "storage_path"        text                     NOT NULL,
  "title"               text                     NOT NULL DEFAULT ''::text,
  "upload_expires_at"   timestamp with time zone NOT NULL DEFAULT (now() + '00:10:00'::interval),
  "job_id"              uuid,
  "retries"             integer                  NOT NULL DEFAULT 0,
  "reference_import_id" uuid,
  "header_subject"      text,
  "header_from"         text,
  "header_date"         timestamp with time zone,
  "content_format"      text,
  "attachment_count"    integer,
  "notes"               text[]                   NOT NULL DEFAULT '{}'::text[],
  "failure_code"        text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_file_imports_attachment_count_check" CHECK (((attachment_count >= 0) AND (attachment_count <= 10000))),
  CONSTRAINT "email_file_imports_byte_size_check" CHECK (((byte_size >= 1) AND (byte_size <= 4194304))),
  CONSTRAINT "email_file_imports_content_format_check" CHECK (((content_format = ANY (ARRAY['html'::text, 'text'::text])) AND ((file_kind = 'eml'::text) OR (content_format =
CASE file_kind
    WHEN 'html'::text THEN 'html'::text
    ELSE 'text'::text
END)))),
  CONSTRAINT "email_file_imports_failure_code_check" CHECK ((failure_code ~ '^[a-z_]{1,40}$'::text)),
  CONSTRAINT "email_file_imports_file_kind_check" CHECK ((file_kind = ANY (ARRAY['html'::text, 'text'::text, 'eml'::text]))),
  CONSTRAINT "email_file_imports_file_name_check" CHECK ((((length(file_name) >= 1) AND (length(file_name) <= 200)) AND (file_name !~ '[[:cntrl:]/\\]'::text))),
  CONSTRAINT "email_file_imports_header_from_check" CHECK ((length(header_from) <= 400)),
  CONSTRAINT "email_file_imports_header_subject_check" CHECK ((length(header_subject) <= 2000)),
  CONSTRAINT "email_file_imports_job_check" CHECK (((state = ANY (ARRAY['uploading'::text, 'failed'::text])) OR (job_id IS NOT NULL))),
  CONSTRAINT "email_file_imports_job_id_key" UNIQUE (job_id),
  CONSTRAINT "email_file_imports_media_type_check" CHECK ((media_type =
CASE file_kind
    WHEN 'html'::text THEN 'text/html'::text
    WHEN 'text'::text THEN 'text/plain'::text
    ELSE 'message/rfc822'::text
END)),
  CONSTRAINT "email_file_imports_notes_check" CHECK ((cardinality(notes) <= 8)),
  CONSTRAINT "email_file_imports_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_file_imports_result_check" CHECK (((state = 'succeeded'::text) = (reference_import_id IS NOT NULL))),
  CONSTRAINT "email_file_imports_retries_check" CHECK (((retries >= 0) AND (retries <= 3))),
  CONSTRAINT "email_file_imports_sha256_check" CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_file_imports_state_check" CHECK ((state = ANY (ARRAY['uploading'::text, 'queued'::text, 'processing'::text, 'succeeded'::text, 'failed'::text]))),
  CONSTRAINT "email_file_imports_storage_path_check" CHECK ((storage_path = (((((tenant_id)::text || '/'::text) || sha256) || '.'::text) ||
CASE file_kind
    WHEN 'html'::text THEN 'html'::text
    WHEN 'text'::text THEN 'txt'::text
    ELSE 'eml'::text
END))),
  CONSTRAINT "email_file_imports_tenant_id_id_key" UNIQUE (tenant_id, id),
  CONSTRAINT "email_file_imports_title_check" CHECK (((length(title) <= 200) AND (title = btrim(title))))
);

ALTER TABLE "public"."email_file_imports"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."reference_imports"
  ADD COLUMN "source_kind" text NOT NULL DEFAULT 'paste'::text;

ALTER TABLE "public"."reference_imports"
  ADD COLUMN "file_import_id" uuid;

ALTER TABLE "public"."reference_imports"
  ADD COLUMN "content_format" text;

CREATE OR REPLACE FUNCTION private.email_file_import_frozen()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id or new.created_by is distinct from old.created_by
    or new.file_name is distinct from old.file_name or new.file_kind is distinct from old.file_kind or new.media_type is distinct from old.media_type
    or new.byte_size is distinct from old.byte_size or new.sha256 is distinct from old.sha256 or new.storage_path is distinct from old.storage_path
    or new.title is distinct from old.title or new.created_at is distinct from old.created_at
    or (old.job_id is not null and new.job_id is distinct from old.job_id)
    or old.state = 'succeeded' then
    raise exception 'email_file_imports records are immutable' using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.email_import_lease (
  job   uuid,
  lease uuid
)
  RETURNS public.email_file_imports
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j public.job_runs; i public.email_file_imports; t uuid;
begin
  perform private.require_service();
  select tenant_id into t from public.job_runs where id = job;
  if t is null then raise exception 'Job unavailable' using errcode = '42501'; end if;
  perform 1 from public.tenants where id = t and status = 'active' for update;
  if not found then raise exception 'Workspace unavailable' using errcode = '42501'; end if;
  select * into j from public.job_runs where id = job for update;
  if j.kind <> 'email.import' then raise exception 'Not a file import job' using errcode = '23514'; end if;
  if j.status <> 'running' or j.lease_token is distinct from lease or j.lease_until <= now() then
    raise exception 'Lease unavailable' using errcode = 'PT409';
  end if;
  select * into i from public.email_file_imports where job_id = j.id for update;
  if not found or i.state <> 'processing' then raise exception 'File import no longer running' using errcode = 'PT409'; end if;
  return i;
end $function$;

CREATE OR REPLACE FUNCTION private.email_import_object_access (
  path text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists(select 1 from public.email_file_imports i where i.storage_path = path
    and private.is_active_member(i.tenant_id, array['owner','admin']::public.tenant_role[]));
$function$;

CREATE OR REPLACE FUNCTION private.email_import_object_size (
  path text
)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select (o.metadata->>'size')::bigint from storage.objects o where o.bucket_id = 'email-imports' and o.name = path;
$function$;

CREATE OR REPLACE FUNCTION private.email_import_reserved_bytes (
  t         uuid,
  excluding uuid
)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select coalesce(sum(x.byte_size), 0)::bigint from (
    select distinct on (i.storage_path) i.byte_size from public.email_file_imports i
    where i.tenant_id = t and i.id is distinct from excluding
      and (private.email_import_object_size(i.storage_path) is not null or (i.state = 'uploading' and i.upload_expires_at > now()))
    order by i.storage_path) x;
$function$;

CREATE OR REPLACE FUNCTION private.onboarding_lease (
  job   uuid,
  lease uuid
)
  RETURNS public.job_runs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j public.job_runs;t uuid;
begin
 select tenant_id into t from public.job_runs where id=job;
 if t is null or not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 select * into j from public.job_runs where id=job for update;
 if j.kind in ('email.rewrite','email.import') then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='PT409';end if;return j;
end $function$;

CREATE OR REPLACE FUNCTION public.admit_email_file_upload (
  t           uuid,
  request_key uuid,
  input       jsonb
)
  RETURNS TABLE (
    import_id    uuid,
    state        text,
    storage_path text,
    needs_upload boolean
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare receipt private.email_file_import_requests; fingerprint text; i public.email_file_imports; kind text; sha text; size bigint; path text; found_existing boolean := false;
begin
  -- Locks the tenant and rechecks active owner membership after the lock.
  perform private.require_member(t, true);
  if request_key is null or input is null or jsonb_typeof(input) <> 'object'
    or (input - array['sha256','byteSize','kind','fileName','title']) <> '{}'::jsonb
    or jsonb_typeof(input->'sha256') is distinct from 'string' or input->>'sha256' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(input->'byteSize') is distinct from 'number' or (input->>'byteSize')::numeric not between 1 and 4194304
    or (input->>'byteSize')::numeric <> trunc((input->>'byteSize')::numeric)
    or jsonb_typeof(input->'kind') is distinct from 'string' or input->>'kind' not in ('html','text','eml')
    or jsonb_typeof(input->'fileName') is distinct from 'string' or length(input->>'fileName') not between 1 and 200
    or input->>'fileName' ~ '[[:cntrl:]/\\]'
    or jsonb_typeof(coalesce(input->'title','""')) <> 'string' or length(coalesce(input->>'title','')) > 200
    or coalesce(input->>'title','') <> btrim(coalesce(input->>'title','')) then
    raise exception 'Valid file upload required' using errcode = '23514';
  end if;
  fingerprint := encode(extensions.digest(jsonb_build_object('sha256', input->'sha256', 'byteSize', input->'byteSize', 'kind', input->'kind',
    'fileName', input->'fileName', 'title', coalesce(input->'title','""'))::text, 'sha256'), 'hex');
  kind := input->>'kind'; sha := input->>'sha256'; size := (input->>'byteSize')::bigint;
  path := t::text || '/' || sha || '.' || case kind when 'html' then 'html' when 'text' then 'txt' else 'eml' end;
  select * into receipt from private.email_file_import_requests r
    where r.tenant_id = t and r.created_by = auth.uid() and r.request_key = admit_email_file_upload.request_key;
  if found then
    if receipt.payload_hash <> fingerprint then
      raise exception 'Request key already used with different inputs' using errcode = 'PT409';
    end if;
    select * into i from public.email_file_imports x where x.id = receipt.import_id for update;
    if i.state = 'uploading' and private.email_import_object_size(i.storage_path) is null and i.upload_expires_at <= now() then
      -- Resuming an abandoned upload needs capacity again, checked under the lock.
      if private.email_import_reserved_bytes(t, i.id) + i.byte_size > 104857600 then
        raise exception 'File storage limit reached' using errcode = '23514';
      end if;
      update public.email_file_imports x set upload_expires_at = now() + interval '10 minutes', updated_at = now() where x.id = i.id returning * into i;
    end if;
    return query select i.id, i.state, i.storage_path, i.state = 'uploading' and private.email_import_object_size(i.storage_path) is null;
    return;
  end if;
  -- The same bytes already admitted (and not failed) are reused, never stored twice.
  select * into i from public.email_file_imports x
    where x.tenant_id = t and x.sha256 = sha and x.file_kind = kind and x.byte_size = size
      and (x.state in ('queued','processing','succeeded') or (x.state = 'uploading' and (x.upload_expires_at > now() or private.email_import_object_size(x.storage_path) is not null)))
    order by x.created_at desc limit 1 for update;
  found_existing := found;
  if not found_existing then
    if (select count(*) from public.email_file_imports x where x.tenant_id = t and x.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'File upload limit reached; try again later' using errcode = '23514';
    end if;
    if (select count(*) from public.email_file_imports x where x.tenant_id = t
          and (x.state in ('queued','processing','succeeded') or (x.state = 'uploading' and x.upload_expires_at > now()))) >= 200
      or (select count(*) from public.reference_imports r where r.tenant_id = t) >= 500 then
      raise exception 'Imported reference limit reached' using errcode = '23514';
    end if;
    if private.email_import_object_size(path) is null and private.email_import_reserved_bytes(t, null) + size > 104857600 then
      raise exception 'File storage limit reached' using errcode = '23514';
    end if;
    insert into public.email_file_imports(tenant_id, created_by, file_name, file_kind, media_type, byte_size, sha256, storage_path, title)
      values (t, auth.uid(), input->>'fileName', kind, case kind when 'html' then 'text/html' when 'text' then 'text/plain' else 'message/rfc822' end,
        size, sha, path, coalesce(input->>'title','')) returning * into i;
  end if;
  insert into private.email_file_import_requests(tenant_id, created_by, request_key, payload_hash, import_id)
    values (t, auth.uid(), request_key, fingerprint, i.id);
  return query select i.id, i.state, i.storage_path, i.state = 'uploading' and private.email_import_object_size(i.storage_path) is null;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_email_file_import (
  t      uuid,
  import uuid
)
  RETURNS TABLE (
    job_id       uuid,
    lease_token  uuid,
    attempt      integer,
    storage_path text,
    sha256       text,
    byte_size    integer,
    file_kind    text,
    file_name    text,
    title        text,
    actor        uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i public.email_file_imports; j public.job_runs;
begin
  perform private.require_service();
  perform 1 from public.tenants where tenants.id = t and tenants.status = 'active' for update;
  if not found then raise exception 'Workspace unavailable' using errcode = '42501'; end if;
  select * into i from public.email_file_imports x where x.id = import and x.tenant_id = t for update;
  if not found then raise exception 'File unavailable' using errcode = '42501'; end if;
  if i.state not in ('queued','processing') then return; end if;
  select * into j from public.job_runs x where x.id = i.job_id for update;
  if j.status in ('leased','running') and j.lease_until < now() then
    update public.job_runs x set status = case when x.attempt >= 3 then 'failed' else 'retry_wait' end, lease_token = null, lease_until = null,
      available_at = now(), error_code = 'stale_lease', updated_at = now() where x.id = j.id returning * into j;
    update public.email_file_imports x set state = 'queued', updated_at = now() where x.id = i.id;
  end if;
  if j.status = 'failed' or j.attempt >= 3 then
    update public.job_runs x set status = 'failed', lease_token = null, lease_until = null, updated_at = now() where x.id = j.id;
    update public.email_file_imports x set state = 'failed', failure_code = coalesce(x.failure_code, 'attempts_exhausted'), updated_at = now() where x.id = i.id;
    return;
  end if;
  if j.status not in ('queued','retry_wait') or j.available_at > now() then return; end if;
  if not private.is_active_owner(t, i.created_by) then
    update public.job_runs x set status = 'failed', error_code = 'actor_inactive', lease_token = null, lease_until = null, updated_at = now() where x.id = j.id;
    update public.email_file_imports x set state = 'failed', failure_code = 'actor_inactive', updated_at = now() where x.id = i.id;
    return;
  end if;
  update public.job_runs x set status = 'running', attempt = x.attempt + 1, lease_token = gen_random_uuid(), lease_until = now() + interval '60 seconds', updated_at = now()
    where x.id = j.id returning * into j;
  update public.email_file_imports x set state = 'processing', updated_at = now() where x.id = i.id;
  return query select j.id, j.lease_token, j.attempt, i.storage_path, i.sha256, i.byte_size, i.file_kind, i.file_name, i.title, i.created_by;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_job (
  t uuid
)
  RETURNS SETOF public.job_runs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j public.job_runs;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.tenants where tenants.id=t for update;
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501'; end if;
 update public.job_runs set status=case when attempt>=4 then 'failed' else 'retry_wait' end,lease_token=null,lease_until=null,available_at=now(),error_code='stale_lease' where tenant_id=t and status in ('leased','running') and lease_until<now() and kind not in ('email.rewrite','email.import');
 select * into j from public.job_runs where tenant_id=t and status in ('queued','retry_wait') and attempt<4 and available_at<=now() and kind not in ('email.rewrite','email.import') order by available_at,created_at for update skip locked limit 1;
 if not found then return;end if;
 return query update public.job_runs set status='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning *;
end $function$;

CREATE OR REPLACE FUNCTION public.create_email_result (
  t           uuid,
  request_key uuid,
  import_id   uuid,
  mode        text,
  options     jsonb DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare receipt private.email_result_requests;imp public.reference_imports;src public.email_sources;fingerprint text;fmt text;tz text;
  planned timestamptz;o public.offers;campaign uuid;result uuid;
begin
  perform private.require_member(t,true);
  if request_key is null or import_id is null or mode is null or mode not in ('copy','rewrite')
    or not private.email_options_valid(t,options,mode='copy')
    or (mode='copy' and options ?| array['productId','offerId','note','link']) then
    raise exception 'Valid email request required' using errcode='23514';
  end if;
  fingerprint:=encode(extensions.digest(jsonb_build_object('import',import_id,'mode',mode,'options',options)::text,'sha256'),'hex');
  select * into receipt from private.email_result_requests x where x.tenant_id=t and x.created_by=auth.uid() and x.request_key=create_email_result.request_key;
  if found then
    if receipt.payload_hash<>fingerprint then raise exception 'Request key already used with different inputs' using errcode='PT409';end if;
    return receipt.result_id;
  end if;
  select * into imp from public.reference_imports i where i.id=import_id and i.tenant_id=t;
  if not found then raise exception 'Email unavailable in this workspace' using errcode='42501';end if;
  if mode='rewrite' and not exists(select 1 from public.brand_profiles where tenant_id=t) then
    raise exception 'Brand basics required' using errcode='23514';
  end if;
  if (select count(*) from public.email_results where tenant_id=t)>=1000 then raise exception 'Email limit reached' using errcode='23514';end if;
  perform private.settle_stale_email_dispatches(t);
  fmt:=coalesce(imp.content_format,case when imp.original_body ~* '<\/?[a-z!][^<>]*>' then 'html' else 'text' end);
  insert into public.email_sources(tenant_id,reference_import_id,created_by,subject,format,original,original_sha256)
    values(t,imp.id,auth.uid(),imp.subject,fmt,imp.original_body,encode(extensions.digest(convert_to(imp.original_body,'UTF8'),'sha256'),'hex'))
    on conflict(tenant_id,reference_import_id) do nothing;
  select * into src from public.email_sources where tenant_id=t and reference_import_id=imp.id;
  select timezone into tz from public.tenants where id=t;
  planned:=(date_trunc('day',now() at time zone tz)+interval '3 days 10 hours') at time zone tz;
  if options ? 'offerId' then
    select * into o from public.offers where id=(options->>'offerId')::uuid and tenant_id=t;
    if not (o.starts_at<=planned and o.ends_at>planned) then
      planned:=greatest(o.starts_at,now())+interval '1 hour';
      if planned>=o.ends_at then raise exception 'Offer ends too soon' using errcode='23514';end if;
    end if;
  end if;
  campaign:=public.save_campaign(t,null,0,jsonb_build_object(
    'title',left(case mode when 'copy' then 'Copy: ' else 'Rewrite: ' end||imp.subject,200),
    'goal',case mode when 'copy' then 'Exact copy of an email you added, ready to edit.' else 'Rewrite of an email you added, in your brand voice.' end,
    'channel',case src.format when 'html' then 'email_design' else 'email_text' end,
    'planned_at',planned,'audience_id','','product_id','','offer_id',coalesce(options->>'offerId',''),'reference_notes',''));
  update public.campaigns set lineage=lineage||jsonb_build_object('source','email_result','emailMode',mode,'emailSourceId',src.id,
    'structureSource','imported_reference','structureId',imp.id,'origin','owner_import','sourceSha256',src.original_sha256,
    'analysis',case mode when 'copy' then 'none' else 'ai_rewrite' end,'copyReusable',mode='copy','crossClientPublication',false)
    || case when imp.file_import_id is not null then jsonb_build_object('fileImportId',imp.file_import_id) else '{}'::jsonb end
    where id=campaign and tenant_id=t;
  insert into public.email_results(tenant_id,campaign_id,source_id,mode,created_by) values(t,campaign,src.id,mode,auth.uid()) returning id into result;
  if mode='copy' then
    perform private.add_email_revision(t,result,'exact_copy',jsonb_build_object('subject',src.subject,'preheader','',
      'body',case src.format when 'html' then coalesce(options->>'textVersion','') else src.original end,'cta','','url','',
      'html',case src.format when 'html' then src.original end),null,null,auth.uid());
  else
    perform private.enqueue_email_rewrite(t,result,request_key,0,options,auth.uid());
  end if;
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail)
    values(t,campaign,auth.uid(),'email_result_created',jsonb_build_object('resultId',result,'mode',mode,'sourceId',src.id,'approvalBypass',false));
  insert into private.email_result_requests(tenant_id,created_by,request_key,payload_hash,result_id) values(t,auth.uid(),request_key,fingerprint,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.fail_email_file_import (
  job     uuid,
  lease   uuid,
  failure jsonb
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i public.email_file_imports; j public.job_runs; code text; retry boolean;
begin
  i := private.email_import_lease(job, lease);
  select * into j from public.job_runs where id = i.job_id;
  code := failure->>'code';
  if failure is null or jsonb_typeof(failure) <> 'object' or (failure - array['code']) <> '{}'::jsonb
    or code is null or code not in ('unsupported_type','not_an_email','mbox_unsupported','malformed','too_large','content_too_large','unsupported_charset',
      'ambiguous_encoding','no_content','limits_exceeded','hash_mismatch','source_missing','setup_required','storage_unavailable','internal') then
    raise exception 'Valid failure required' using errcode = '23514';
  end if;
  -- Only transient storage/server failures repeat automatically, a bounded number of times.
  retry := code in ('storage_unavailable','internal') and j.attempt < 3;
  update public.job_runs set status = case when retry then 'retry_wait' else 'failed' end,
    failure_class = case when retry then 'transient' when code = 'setup_required' then 'auth' else 'validation' end,
    error_code = code, available_at = now() + make_interval(secs => 2 * power(2, j.attempt)::integer), lease_token = null, lease_until = null, updated_at = now()
    where id = j.id;
  update public.email_file_imports set state = case when retry then 'queued' else 'failed' end, failure_code = code, updated_at = now() where id = i.id;
  return case when retry then 'retrying' else 'failed' end;
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_email_file_upload (
  t      uuid,
  import uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i public.email_file_imports; job uuid;
begin
  perform private.require_member(t, true);
  if not exists(select 1 from private.email_file_import_requests r where r.tenant_id = t and r.created_by = auth.uid() and r.import_id = import) then
    raise exception 'File unavailable' using errcode = '42501';
  end if;
  select * into i from public.email_file_imports x where x.id = import and x.tenant_id = t for update;
  if not found then raise exception 'File unavailable' using errcode = '42501'; end if;
  if i.state <> 'uploading' then return i.state; end if;
  if private.email_import_object_size(i.storage_path) is distinct from i.byte_size::bigint then
    raise exception 'Upload incomplete' using errcode = '23514';
  end if;
  insert into public.job_runs(tenant_id, kind, idempotency_key, input, created_by)
    values (t, 'email.import', 'email-import:' || i.id, jsonb_build_object('importId', i.id), i.created_by) returning id into job;
  update public.email_file_imports set state = 'queued', job_id = job, updated_at = now() where id = i.id;
  return 'queued';
end $function$;

CREATE OR REPLACE FUNCTION public.finish_email_file_import (
  job    uuid,
  lease  uuid,
  output jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i public.email_file_imports; readable text; paragraphs integer; outline jsonb; reference uuid; note_codes text[]; fmt text;
begin
  i := private.email_import_lease(job, lease);
  fmt := output->>'format';
  if output is null or jsonb_typeof(output) <> 'object'
    or (output - array['sha256','subject','body','readableText','format','headerSubject','headerFrom','headerDate','attachmentCount','notes']) <> '{}'::jsonb
    or jsonb_typeof(output->'subject') is distinct from 'string' or length(btrim(output->>'subject')) not between 1 and 200
    or output->>'subject' <> btrim(output->>'subject')
    or jsonb_typeof(output->'body') is distinct from 'string' or length(output->>'body') not between 1 and 100000
    or jsonb_typeof(output->'readableText') is distinct from 'string' or length(btrim(output->>'readableText')) < 1 or length(output->>'readableText') > 20000
    or jsonb_typeof(output->'format') is distinct from 'string' or fmt not in ('html','text')
    or (i.file_kind = 'html' and fmt <> 'html') or (i.file_kind = 'text' and fmt <> 'text')
    or jsonb_typeof(coalesce(output->'headerSubject','null')) not in ('string','null') or length(output->>'headerSubject') > 2000
    or jsonb_typeof(coalesce(output->'headerFrom','null')) not in ('string','null') or length(output->>'headerFrom') > 400
    or jsonb_typeof(coalesce(output->'headerDate','null')) not in ('string','null')
    or (output->>'headerDate' is not null and output->>'headerDate' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$')
    or jsonb_typeof(output->'attachmentCount') is distinct from 'number' or (output->>'attachmentCount')::numeric not between 0 and 10000
    or jsonb_typeof(coalesce(output->'notes','[]')) <> 'array' or jsonb_array_length(coalesce(output->'notes','[]')) > 8
    or exists(select 1 from jsonb_array_elements(coalesce(output->'notes','[]')) n where jsonb_typeof(n) <> 'string' or n#>>'{}' !~ '^[a-z_]{1,40}$') then
    raise exception 'Valid parsed file required' using errcode = '23514';
  end if;
  -- Parsed output is accepted only for the exact frozen file still in private Storage.
  if output->>'sha256' is distinct from i.sha256 then
    raise exception 'Parsed file does not match the uploaded file' using errcode = '23514';
  end if;
  if private.email_import_object_size(i.storage_path) is distinct from i.byte_size::bigint then
    raise exception 'Stored file unavailable' using errcode = '23514';
  end if;
  if not private.is_active_owner(i.tenant_id, i.created_by) then
    update public.job_runs set status = 'failed', error_code = 'actor_inactive', lease_token = null, lease_until = null, updated_at = now() where id = i.job_id;
    update public.email_file_imports set state = 'failed', failure_code = 'actor_inactive', updated_at = now() where id = i.id;
    return null;
  end if;
  if (select count(*) from public.reference_imports r where r.tenant_id = i.tenant_id) >= 500 then
    update public.job_runs set status = 'failed', error_code = 'limit_reached', lease_token = null, lease_until = null, updated_at = now() where id = i.job_id;
    update public.email_file_imports set state = 'failed', failure_code = 'limit_reached', updated_at = now() where id = i.id;
    return null;
  end if;
  readable := output->>'readableText';
  select count(*) into paragraphs from regexp_split_to_table(btrim(readable), '\n\s*\n') p where btrim(p) <> '';
  outline := jsonb_build_array('Opening')
    || case when paragraphs >= 3 then '["Body"]'::jsonb else '[]'::jsonb end
    || case when paragraphs >= 2 then '["Closing"]'::jsonb else '[]'::jsonb end;
  insert into public.reference_imports(tenant_id, created_by, subject, original_body, readable_text, source_description, source_url, structure, source_kind, file_import_id, content_format)
    values (i.tenant_id, i.created_by, output->>'subject', output->>'body', readable, '', null, outline, 'file', i.id, fmt)
    returning id into reference;
  note_codes := array(select jsonb_array_elements_text(coalesce(output->'notes','[]')));
  update public.email_file_imports set state = 'succeeded', reference_import_id = reference, failure_code = null,
    header_subject = output->>'headerSubject', header_from = output->>'headerFrom', header_date = (output->>'headerDate')::timestamptz,
    content_format = fmt, attachment_count = (output->>'attachmentCount')::integer, notes = note_codes, updated_at = now()
    where id = i.id;
  update public.job_runs set status = 'succeeded', checkpoint = jsonb_build_object('referenceImportId', reference), lease_token = null, lease_until = null, updated_at = now()
    where id = i.job_id;
  return reference;
end $function$;

CREATE OR REPLACE FUNCTION public.retry_email_file_import (
  t      uuid,
  import uuid
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare i public.email_file_imports;
begin
  perform private.require_member(t, true);
  select * into i from public.email_file_imports x where x.id = import and x.tenant_id = t for update;
  if not found then raise exception 'File unavailable' using errcode = '42501'; end if;
  if i.state <> 'failed' or i.job_id is null or i.failure_code not in ('storage_unavailable','internal','attempts_exhausted','setup_required') then
    raise exception 'This file cannot be retried' using errcode = '23514';
  end if;
  if i.retries >= 3 then raise exception 'Retry limit reached' using errcode = '23514'; end if;
  if not private.is_active_owner(t, i.created_by) then raise exception 'Uploader no longer an active owner' using errcode = '42501'; end if;
  if private.email_import_object_size(i.storage_path) is distinct from i.byte_size::bigint then
    update public.email_file_imports set failure_code = 'source_missing', updated_at = now() where id = i.id;
    return 'failed';
  end if;
  update public.job_runs set status = 'queued', attempt = 0, lease_token = null, lease_until = null, available_at = now(),
    error_code = null, failure_class = null, updated_at = now() where id = i.job_id and tenant_id = t;
  update public.email_file_imports set state = 'queued', failure_code = null, retries = retries + 1, updated_at = now() where id = i.id;
  return 'queued';
end $function$;

ALTER TABLE "private"."email_file_import_requests"
  ADD CONSTRAINT "email_file_import_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."email_file_imports"
  ADD CONSTRAINT "email_file_imports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."email_file_imports"
  ADD CONSTRAINT "email_file_imports_reference_fkey" FOREIGN KEY (tenant_id, reference_import_id) REFERENCES public.reference_imports(tenant_id, id);

ALTER TABLE "public"."email_file_imports"
  ADD CONSTRAINT "email_file_imports_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "private"."email_file_import_requests"
  ADD CONSTRAINT "email_file_import_requests_import_fkey" FOREIGN KEY (tenant_id, import_id) REFERENCES public.email_file_imports(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."email_file_imports"
  ADD CONSTRAINT "email_file_imports_tenant_id_job_id_fkey" FOREIGN KEY (tenant_id, job_id) REFERENCES public.job_runs(tenant_id, id);

ALTER TABLE "public"."job_runs"
  ADD CONSTRAINT "job_runs_kind_check"
    CHECK
    ((kind = ANY (ARRAY['copy.generate'::text, 'delivery.schedule'::text, 'delivery.cancel'::text, 'delivery.reschedule'::text, 'assets.classify'::text, 'drive.sync'::text,
    'commerce.sync'::text,
    'brand.extract'::text,
    'competitors.capture'::text,
    'playbook.synthesize'::text,
    'calendar.plan'::text,
    'reviews.remind'::text,
    'design.render'::text,
    'ops.health'::text,
    'results.pull'::text,
    'reports.digest'::text, 'learning.synthesize'::text, 'optimizer.winback'::text, 'optimizer.suppress'::text, 'email.rewrite'::text, 'email.import'::text])));

ALTER TABLE "public"."reference_imports"
  ADD CONSTRAINT "reference_imports_file_import_fkey" FOREIGN KEY (tenant_id, file_import_id) REFERENCES public.email_file_imports(tenant_id, id);

ALTER TABLE "public"."reference_imports"
  ADD CONSTRAINT "reference_imports_file_import_id_key" UNIQUE (file_import_id);

ALTER TABLE "public"."reference_imports"
  ADD CONSTRAINT "reference_imports_source_kind_check" CHECK (((source_kind = ANY (ARRAY['paste'::text, 'file'::text])) AND ((source_kind = 'file'::text) = (file_import_id IS
    NOT NULL)) AND ((source_kind = 'file'::text) = (content_format IS NOT NULL)) AND ((content_format IS NULL) OR (content_format = ANY (ARRAY['html'::text, 'text'::text])))));

CREATE INDEX email_file_import_requests_actor_idx ON private.email_file_import_requests USING btree (created_by);

CREATE INDEX email_file_import_requests_import_idx ON private.email_file_import_requests USING btree (tenant_id, import_id);

CREATE INDEX email_file_imports_created_by_idx ON public.email_file_imports USING btree (created_by);

CREATE INDEX email_file_imports_job_idx ON public.email_file_imports USING btree (tenant_id, job_id);

CREATE INDEX email_file_imports_path_idx ON public.email_file_imports USING btree (storage_path);

CREATE INDEX email_file_imports_reference_idx ON public.email_file_imports USING btree (tenant_id, reference_import_id);

CREATE INDEX email_file_imports_tenant_created_idx ON public.email_file_imports USING btree (tenant_id, created_at DESC, id);

CREATE INDEX email_file_imports_tenant_sha_idx ON public.email_file_imports USING btree (tenant_id, sha256, file_kind);

CREATE INDEX reference_imports_file_import_idx ON public.reference_imports USING btree (tenant_id, file_import_id);

CREATE TRIGGER email_file_imports_frozen
  BEFORE UPDATE ON public.email_file_imports
  FOR EACH ROW
  EXECUTE FUNCTION private.email_file_import_frozen();

CREATE POLICY "tenant_read" ON "public"."email_file_imports"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id));

REVOKE ALL ON FUNCTION "private"."email_file_import_frozen"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_file_import_frozen"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."email_import_lease"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_import_lease"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."email_import_object_access"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_import_object_access"(text) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."email_import_object_size"(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_import_object_size"(text) TO "postgres";

REVOKE ALL ON FUNCTION "private"."email_import_reserved_bytes"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_import_reserved_bytes"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "public"."admit_email_file_upload"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."admit_email_file_upload"(uuid, uuid, jsonb) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."claim_email_file_import"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."claim_email_file_import"(uuid, uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."fail_email_file_import"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."fail_email_file_import"(uuid, uuid, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_email_file_upload"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."finalize_email_file_upload"(uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."finish_email_file_import"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."finish_email_file_import"(uuid, uuid, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."retry_email_file_import"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."retry_email_file_import"(uuid, uuid) TO "authenticated", "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."email_file_import_requests" TO "postgres";

REVOKE ALL ON TABLE "public"."email_file_imports" FROM "authenticated";

GRANT SELECT ON TABLE "public"."email_file_imports" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_file_imports" TO "postgres";

-- Raw originals live in a tenant-private bucket (not captured by the public/private
-- schema diff). Only the server (service role) writes, after durable admission; nothing
-- deletes objects. Owners/admins may read objects a recorded import references.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('email-imports', 'email-imports', false, 4194304, array['text/html','text/plain','message/rfc822'])
  on conflict (id) do nothing;

create policy email_import_original_read on storage.objects for select to authenticated
  using (bucket_id = 'email-imports' and private.email_import_object_access(name));

-- Explicit ACLs also override platform default privileges on a fresh database.
-- Owners admit, finalize and retry uploads; only the server worker (service_role)
-- leases, finishes or fails them. Legacy fixture helpers refuse email.import jobs.
revoke all on public.email_file_imports from public, anon, authenticated, service_role;
grant select on public.email_file_imports to authenticated;
revoke all on private.email_file_import_requests from public, anon, authenticated, service_role;
revoke all on function public.admit_email_file_upload(uuid,uuid,jsonb), public.finalize_email_file_upload(uuid,uuid),
  public.retry_email_file_import(uuid,uuid) from public, anon, service_role;
grant execute on function public.admit_email_file_upload(uuid,uuid,jsonb), public.finalize_email_file_upload(uuid,uuid),
  public.retry_email_file_import(uuid,uuid) to authenticated;
revoke all on function public.claim_email_file_import(uuid,uuid), public.finish_email_file_import(uuid,uuid,jsonb),
  public.fail_email_file_import(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_email_file_import(uuid,uuid), public.finish_email_file_import(uuid,uuid,jsonb),
  public.fail_email_file_import(uuid,uuid,jsonb) to service_role;
revoke all on function private.email_import_lease(uuid,uuid), private.email_import_object_size(text),
  private.email_import_reserved_bytes(uuid,uuid), private.email_file_import_frozen() from public, anon, authenticated, service_role;
-- Evaluated by the Storage read policy as the signed-in user.
revoke all on function private.email_import_object_access(text) from public, anon, service_role;
grant execute on function private.email_import_object_access(text) to authenticated;
