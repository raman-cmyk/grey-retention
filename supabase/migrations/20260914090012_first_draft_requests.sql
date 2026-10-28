SET local check_function_bodies = off;

CREATE TABLE "private"."first_draft_requests" (
  "tenant_id"    uuid                     NOT NULL,
  "created_by"   uuid                     NOT NULL,
  "request_key"  uuid                     NOT NULL,
  "payload_hash" text                     NOT NULL,
  "campaign_id"  uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "first_draft_requests_pkey" PRIMARY KEY (tenant_id, created_by, request_key)
);

ALTER TABLE "private"."first_draft_requests"
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
  fingerprint text;
  campaign uuid;
begin
  perform private.require_member(t, true);
  perform 1 from public.tenants where id = t for update;
  perform private.require_member(t, true);
  if request_key is null or source is null or source not in ('original', 'reference_structure')
    or (source = 'original' and source_id is not null)
    or (source = 'reference_structure' and source_id is null)
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
  else
    campaign := public.save_campaign(t, null, 0, input);
  end if;
  insert into private.first_draft_requests(tenant_id, created_by, request_key, payload_hash, campaign_id)
    values(t, auth.uid(), request_key, fingerprint, campaign);
  return campaign;
end;
$function$;

ALTER TABLE "private"."first_draft_requests"
  ADD CONSTRAINT "first_draft_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."first_draft_requests"
  ADD CONSTRAINT "first_draft_requests_tenant_id_campaign_id_fkey" FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE "private"."first_draft_requests"
  ADD CONSTRAINT "first_draft_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX first_draft_requests_actor_idx ON private.first_draft_requests USING btree (created_by);

CREATE INDEX first_draft_requests_campaign_idx ON private.first_draft_requests USING btree (tenant_id, campaign_id);

REVOKE ALL ON FUNCTION "public"."create_first_draft"(uuid, uuid, text, jsonb, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_first_draft"(uuid, uuid, text, jsonb, uuid) TO "authenticated", "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."first_draft_requests" TO "postgres";


-- Explicit ACLs also override platform default privileges on a fresh database.
REVOKE ALL ON FUNCTION public.create_first_draft(uuid,uuid,text,jsonb,uuid) FROM anon, service_role;
REVOKE ALL ON private.first_draft_requests FROM public, anon, authenticated, service_role;
