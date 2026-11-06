SET local check_function_bodies = off;

CREATE TABLE "private"."reference_import_requests" (
  "tenant_id"    uuid                     NOT NULL,
  "created_by"   uuid                     NOT NULL,
  "request_key"  uuid                     NOT NULL,
  "payload_hash" text                     NOT NULL,
  "reference_id" uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reference_import_requests_pkey" PRIMARY KEY (tenant_id, created_by, request_key)
);

ALTER TABLE "private"."reference_import_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reference_imports" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          uuid                     NOT NULL,
  "created_by"         uuid                     NOT NULL,
  "origin"             text                     NOT NULL DEFAULT 'owner_import'::text,
  "subject"            text                     NOT NULL,
  "original_body"      text                     NOT NULL,
  "readable_text"      text                     NOT NULL,
  "source_description" text                     NOT NULL DEFAULT ''::text,
  "source_url"         text,
  "structure"          jsonb                    NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reference_imports_origin_check" CHECK ((origin = 'owner_import'::text)),
  CONSTRAINT "reference_imports_original_body_check" CHECK (((length(original_body) >= 1) AND (length(original_body) <= 100000))),
  CONSTRAINT "reference_imports_pkey" PRIMARY KEY (id),
  CONSTRAINT "reference_imports_readable_text_check" CHECK (((length(readable_text) >= 1) AND (length(readable_text) <= 20000))),
  CONSTRAINT "reference_imports_source_description_check" CHECK ((length(source_description) <= 300)),
  CONSTRAINT "reference_imports_source_url_check" CHECK (((source_url IS NULL) OR ((length(source_url) <= 2000) AND (source_url ~ '^https?://[^\s/?#@]+([/?#]\S*)?$'::text)))),
  CONSTRAINT "reference_imports_structure_check"
    CHECK (((jsonb_typeof(structure) = 'array'::text) AND ((jsonb_array_length(structure) >= 1) AND (jsonb_array_length(structure) <= 3)))),
  CONSTRAINT "reference_imports_subject_check" CHECK ((((length(subject) >= 1) AND (length(subject) <= 200)) AND (subject = btrim(subject)))),
  CONSTRAINT "reference_imports_tenant_id_id_key" UNIQUE (tenant_id, id)
);

ALTER TABLE "public"."reference_imports"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_first_draft (
  t           uuid,
  request_key uuid,
  source      text,
  input       jsonb,
  source_id   uuid  DEFAULT NULL::uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  receipt private.first_draft_requests;
  imported public.reference_imports;
  fingerprint text;
  campaign uuid;
begin
  perform private.require_member(t, true);
  perform 1 from public.tenants where id = t for update;
  perform private.require_member(t, true);
  if request_key is null or source is null or source not in ('original', 'reference_structure', 'imported_reference')
    or (source = 'original' and source_id is not null)
    or (source <> 'original' and source_id is null)
    or input is null or jsonb_typeof(input) <> 'object'
    or (input - array['title','goal','channel','planned_at','audience_id','product_id','offer_id','reference_notes']) <> '{}'::jsonb
    or coalesce(length(trim(input->>'title')), 0) not between 2 and 200
    or coalesce(length(trim(input->>'goal')), 0) not between 5 and 5000
    or coalesce(input->>'channel', '') not in ('email_design','email_text')
    or nullif(input->>'planned_at', '') is null then
    raise exception 'Valid draft inputs required' using errcode = '23514';
  end if;
  fingerprint := encode(extensions.digest(jsonb_build_object('source', source, 'sourceId', source_id, 'input', input)::text, 'sha256'), 'hex');
  select * into receipt from private.first_draft_requests r
    where r.tenant_id = t and r.created_by = auth.uid() and r.request_key = create_first_draft.request_key;
  if found then
    if receipt.payload_hash <> fingerprint then
      raise exception 'Request key already used with different inputs' using errcode = 'PT409';
    end if;
    return receipt.campaign_id;
  end if;
  if not isfinite((input->>'planned_at')::timestamptz) or (input->>'planned_at')::timestamptz <= now() then
    raise exception 'Future date required' using errcode = '23514';
  end if;
  if source = 'reference_structure' then
    -- capture_access alone permits another tenant belonging to the same actor: require THIS tenant.
    if not exists (select 1 from public.competitor_emails e
      join public.competitor_subscriptions s on s.capture_id = e.capture_id
      where e.id = source_id and s.tenant_id = t and s.active) then
      raise exception 'Source unavailable in this workspace' using errcode = '42501';
    end if;
    campaign := public.draft_from_structure(t, source, source_id, input);
  elsif source = 'imported_reference' then
    select * into imported from public.reference_imports i where i.id = source_id and i.tenant_id = t;
    if not found then
      raise exception 'Source unavailable in this workspace' using errcode = '42501';
    end if;
    campaign := public.save_campaign(t, null, 0, input || jsonb_build_object('reference_notes',
      'Owner-imported reference: paragraph outline only. Wording, images, links and offers from the pasted email are not copied.'));
    update public.campaigns set lineage = lineage || jsonb_build_object(
      'structureSource', 'imported_reference', 'structureId', imported.id, 'structure', imported.structure,
      'origin', 'owner_import', 'importedAt', imported.created_at, 'analysis', 'none',
      'copyReusable', false, 'crossClientPublication', false)
      where id = campaign and tenant_id = t;
    insert into public.campaign_events(tenant_id, campaign_id, actor_id, action, detail)
      values (t, campaign, auth.uid(), 'imported_reference_draft_created',
        jsonb_build_object('source', source, 'sourceId', imported.id, 'origin', 'owner_import', 'approvalBypass', false));
  else
    campaign := public.save_campaign(t, null, 0, input);
  end if;
  insert into private.first_draft_requests(tenant_id, created_by, request_key, payload_hash, campaign_id)
    values(t, auth.uid(), request_key, fingerprint, campaign);
  return campaign;
end;
$function$;

CREATE OR REPLACE FUNCTION public.import_pasted_reference (
  t           uuid,
  request_key uuid,
  input       jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  receipt private.reference_import_requests;
  fingerprint text;
  readable text;
  paragraphs integer;
  outline jsonb;
  result uuid;
begin
  -- Locks the tenant and rechecks owner membership after the lock.
  perform private.require_member(t, true);
  if request_key is null or input is null or jsonb_typeof(input) <> 'object'
    or (input - array['subject','body','readable_text','source_description','source_url']) <> '{}'::jsonb
    or jsonb_typeof(input->'subject') is distinct from 'string'
    or jsonb_typeof(input->'body') is distinct from 'string'
    or jsonb_typeof(input->'readable_text') is distinct from 'string'
    or jsonb_typeof(coalesce(input->'source_description', '""')) <> 'string'
    or jsonb_typeof(coalesce(input->'source_url', '""')) <> 'string'
    or length(btrim(input->>'subject')) not between 1 and 200
    or length(input->>'body') not between 1 and 100000
    or length(btrim(input->>'readable_text')) < 1
    or length(input->>'readable_text') > 20000
    or length(coalesce(input->>'source_description', '')) > 300
    or (coalesce(input->>'source_url', '') <> ''
      and (length(input->>'source_url') > 2000 or input->>'source_url' !~ '^https?://[^\s/?#@]+([/?#]\S*)?$')) then
    raise exception 'Valid pasted reference required' using errcode = '23514';
  end if;
  fingerprint := encode(extensions.digest(input::text, 'sha256'), 'hex');
  select * into receipt from private.reference_import_requests r
    where r.tenant_id = t and r.created_by = auth.uid() and r.request_key = import_pasted_reference.request_key;
  if found then
    if receipt.payload_hash <> fingerprint then
      raise exception 'Request key already used with different inputs' using errcode = 'PT409';
    end if;
    return receipt.reference_id;
  end if;
  if (select count(*) from public.reference_imports i where i.tenant_id = t) >= 500 then
    raise exception 'Imported reference limit reached' using errcode = '23514';
  end if;
  -- Stored exactly as sent: a preview cut at the bound keeps its full length.
  readable := input->>'readable_text';
  -- The reusable outline is derived here from paragraph breaks, never supplied by the caller.
  select count(*) into paragraphs from regexp_split_to_table(btrim(readable), '\n\s*\n') p where btrim(p) <> '';
  outline := jsonb_build_array('Opening')
    || case when paragraphs >= 3 then '["Body"]'::jsonb else '[]'::jsonb end
    || case when paragraphs >= 2 then '["Closing"]'::jsonb else '[]'::jsonb end;
  insert into public.reference_imports(tenant_id, created_by, subject, original_body, readable_text, source_description, source_url, structure)
    values (t, auth.uid(), btrim(input->>'subject'), input->>'body', readable,
      btrim(coalesce(input->>'source_description', '')), nullif(input->>'source_url', ''), outline)
    returning id into result;
  insert into private.reference_import_requests(tenant_id, created_by, request_key, payload_hash, reference_id)
    values (t, auth.uid(), request_key, fingerprint, result);
  return result;
end;
$function$;

ALTER TABLE "private"."reference_import_requests"
  ADD CONSTRAINT "reference_import_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."reference_imports"
  ADD CONSTRAINT "reference_imports_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."reference_imports"
  ADD CONSTRAINT "reference_imports_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "private"."reference_import_requests"
  ADD CONSTRAINT "reference_import_requests_reference_fkey" FOREIGN KEY (tenant_id, reference_id) REFERENCES public.reference_imports(tenant_id, id) ON DELETE CASCADE;

CREATE INDEX reference_import_requests_actor_idx ON private.reference_import_requests USING btree (created_by);

CREATE INDEX reference_import_requests_reference_idx ON private.reference_import_requests USING btree (tenant_id, reference_id);

CREATE INDEX reference_imports_created_by_idx ON public.reference_imports USING btree (created_by);

CREATE INDEX reference_imports_tenant_created_idx ON public.reference_imports USING btree (tenant_id, created_at DESC, id);

CREATE POLICY "tenant_read" ON "public"."reference_imports"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id));

REVOKE ALL ON FUNCTION "public"."import_pasted_reference"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."import_pasted_reference"(uuid, uuid, jsonb) TO "authenticated", "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."reference_import_requests" TO "postgres";

REVOKE ALL ON TABLE "public"."reference_imports" FROM "authenticated";

GRANT SELECT ON TABLE "public"."reference_imports" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reference_imports" TO "postgres";


-- Explicit ACLs also override platform default privileges on a fresh database.
REVOKE ALL ON FUNCTION public.import_pasted_reference(uuid,uuid,jsonb) FROM anon, service_role;
REVOKE ALL ON public.reference_imports FROM public, anon, service_role;
REVOKE ALL ON private.reference_import_requests FROM public, anon, authenticated, service_role;
