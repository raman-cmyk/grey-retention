SET local check_function_bodies = off;

ALTER TABLE "public"."ai_calls"
  DROP CONSTRAINT "ai_calls_provider_check";

ALTER TABLE "public"."job_runs"
  DROP CONSTRAINT "job_runs_kind_check";

CREATE TABLE "private"."email_dispatches" (
  "generation_id"  uuid                     NOT NULL,
  "attempt"        integer                  NOT NULL,
  "tenant_id"      uuid                     NOT NULL,
  "reservation_id" uuid                     NOT NULL,
  "estimate_micro" bigint                   NOT NULL,
  "state"          text                     NOT NULL DEFAULT 'sent'::text,
  "actual_micro"   bigint,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "settled_at"     timestamp with time zone,
  CONSTRAINT "email_dispatches_actual_micro_check" CHECK ((actual_micro >= 0)),
  CONSTRAINT "email_dispatches_attempt_check" CHECK (((attempt >= 1) AND (attempt <= 4))),
  CONSTRAINT "email_dispatches_estimate_micro_check" CHECK ((estimate_micro > 0)),
  CONSTRAINT "email_dispatches_pkey" PRIMARY KEY (generation_id, attempt),
  CONSTRAINT "email_dispatches_state_check" CHECK ((state = ANY (ARRAY['sent'::text, 'settled'::text, 'unknown'::text])))
);

ALTER TABLE "private"."email_dispatches"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."email_result_requests" (
  "tenant_id"    uuid                     NOT NULL,
  "created_by"   uuid                     NOT NULL,
  "request_key"  uuid                     NOT NULL,
  "payload_hash" text                     NOT NULL,
  "result_id"    uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_result_requests_pkey" PRIMARY KEY (tenant_id, created_by, request_key)
);

ALTER TABLE "private"."email_result_requests"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."email_generations" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       uuid                     NOT NULL,
  "result_id"       uuid                     NOT NULL,
  "job_id"          uuid                     NOT NULL,
  "request_key"     uuid                     NOT NULL,
  "created_by"      uuid                     NOT NULL,
  "source_sha256"   text                     NOT NULL,
  "brand_revision"  integer                  NOT NULL,
  "target_revision" integer                  NOT NULL,
  "options"         jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "prompt_version"  text                     NOT NULL,
  "provider"        text,
  "model"           text,
  "state"           text                     NOT NULL DEFAULT 'queued'::text,
  "failure_code"    text,
  "diagnostic"      text,
  "dispatches"      integer                  NOT NULL DEFAULT 0,
  "input_tokens"    bigint                   NOT NULL DEFAULT 0,
  "output_tokens"   bigint                   NOT NULL DEFAULT 0,
  "cost_micro"      bigint                   NOT NULL DEFAULT 0,
  "response_id"     text,
  "output_revision" integer,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_generations_cost_micro_check" CHECK ((cost_micro >= 0)),
  CONSTRAINT "email_generations_diagnostic_check" CHECK ((length(diagnostic) <= 200)),
  CONSTRAINT "email_generations_dispatches_check" CHECK (((dispatches >= 0) AND (dispatches <= 4))),
  CONSTRAINT "email_generations_failure_code_check" CHECK ((failure_code ~ '^[a-z_]{1,40}$'::text)),
  CONSTRAINT "email_generations_input_tokens_check" CHECK ((input_tokens >= 0)),
  CONSTRAINT "email_generations_job_id_key" UNIQUE (job_id),
  CONSTRAINT "email_generations_model_check" CHECK ((length(model) <= 80)),
  CONSTRAINT "email_generations_options_check" CHECK ((jsonb_typeof(options) = 'object'::text)),
  CONSTRAINT "email_generations_output_tokens_check" CHECK ((output_tokens >= 0)),
  CONSTRAINT "email_generations_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_generations_provider_check" CHECK ((provider = ANY (ARRAY['openai'::text, 'sample'::text]))),
  CONSTRAINT "email_generations_response_id_check" CHECK ((length(response_id) <= 120)),
  CONSTRAINT "email_generations_result_id_request_key_key" UNIQUE (result_id, request_key),
  CONSTRAINT "email_generations_state_check" CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'stale'::text]))),
  CONSTRAINT "email_generations_tenant_id_id_key" UNIQUE (tenant_id, id)
);

ALTER TABLE "public"."email_generations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."email_result_revisions" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"              uuid                     NOT NULL,
  "result_id"              uuid                     NOT NULL,
  "revision"               integer                  NOT NULL,
  "origin"                 text                     NOT NULL,
  "subject"                text                     NOT NULL,
  "subject_options"        text[]                   NOT NULL DEFAULT '{}'::text[],
  "preheader"              text                     NOT NULL DEFAULT ''::text,
  "body_text"              text                     NOT NULL DEFAULT ''::text,
  "cta_label"              text                     NOT NULL DEFAULT ''::text,
  "cta_url"                text                     NOT NULL DEFAULT ''::text,
  "html"                   text,
  "checks"                 jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  "generation_id"          uuid,
  "restored_from"          integer,
  "campaign_copy_revision" integer                  NOT NULL,
  "created_by"             uuid                     NOT NULL,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_result_revisions_body_text_check" CHECK ((length(body_text) <= 100000)),
  CONSTRAINT "email_result_revisions_checks_check" CHECK ((jsonb_typeof(checks) = 'array'::text)),
  CONSTRAINT "email_result_revisions_cta_label_check" CHECK ((length(cta_label) <= 200)),
  CONSTRAINT "email_result_revisions_cta_url_check" CHECK (((cta_url = ''::text) OR ((length(cta_url) <= 2000) AND (cta_url ~ '^https://[^\s/?#@]+([/?#]\S*)?$'::text)))),
  CONSTRAINT "email_result_revisions_html_check" CHECK (((html IS NULL) OR ((length(html) >= 1) AND (length(html) <= 300000)))),
  CONSTRAINT "email_result_revisions_origin_check"
    CHECK ((origin = ANY (ARRAY['exact_copy'::text, 'ai_rewrite'::text, 'sample_rewrite'::text, 'owner_edit'::text, 'restored'::text]))),
  CONSTRAINT "email_result_revisions_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_result_revisions_preheader_check" CHECK ((length(preheader) <= 300)),
  CONSTRAINT "email_result_revisions_result_id_revision_key" UNIQUE (result_id, revision),
  CONSTRAINT "email_result_revisions_revision_check" CHECK ((revision > 0)),
  CONSTRAINT "email_result_revisions_subject_check" CHECK (((length(subject) >= 1) AND (length(subject) <= 200))),
  CONSTRAINT "email_result_revisions_subject_options_check" CHECK ((cardinality(subject_options) <= 3)),
  CONSTRAINT "email_result_revisions_tenant_id_id_key" UNIQUE (tenant_id, id)
);

ALTER TABLE "public"."email_result_revisions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."email_results" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        uuid                     NOT NULL,
  "campaign_id"      uuid                     NOT NULL,
  "source_id"        uuid                     NOT NULL,
  "mode"             text                     NOT NULL,
  "current_revision" integer                  NOT NULL DEFAULT 0,
  "created_by"       uuid                     NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_results_campaign_id_key" UNIQUE (campaign_id),
  CONSTRAINT "email_results_current_revision_check" CHECK ((current_revision >= 0)),
  CONSTRAINT "email_results_mode_check" CHECK ((mode = ANY (ARRAY['rewrite'::text, 'copy'::text]))),
  CONSTRAINT "email_results_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_results_tenant_id_id_key" UNIQUE (tenant_id, id)
);

ALTER TABLE "public"."email_results"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."email_sources" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           uuid                     NOT NULL,
  "reference_import_id" uuid                     NOT NULL,
  "created_by"          uuid                     NOT NULL,
  "subject"             text                     NOT NULL,
  "format"              text                     NOT NULL,
  "original"            text                     NOT NULL,
  "original_sha256"     text                     NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_sources_format_check" CHECK ((format = ANY (ARRAY['html'::text, 'text'::text]))),
  CONSTRAINT "email_sources_original_check" CHECK (((length(original) >= 1) AND (length(original) <= 100000))),
  CONSTRAINT "email_sources_original_sha256_check" CHECK ((original_sha256 ~ '^[0-9a-f]{64}$'::text)),
  CONSTRAINT "email_sources_pkey" PRIMARY KEY (id),
  CONSTRAINT "email_sources_subject_check" CHECK (((length(subject) >= 1) AND (length(subject) <= 200))),
  CONSTRAINT "email_sources_tenant_id_id_key" UNIQUE (tenant_id, id),
  CONSTRAINT "email_sources_tenant_id_reference_import_id_key" UNIQUE (tenant_id, reference_import_id)
);

ALTER TABLE "public"."email_sources"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.add_email_revision (
  t          uuid,
  result     uuid,
  origin     text,
  input      jsonb,
  generation uuid,
  restored   integer,
  actor      uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r public.email_results;s public.email_sources;n integer;copy_revision integer;
begin
  select * into r from public.email_results where id=result and tenant_id=t for update;
  if not found then raise exception 'Email unavailable' using errcode='42501';end if;
  select * into s from public.email_sources where id=r.source_id and tenant_id=t;
  if input is null or jsonb_typeof(input)<>'object'
    or (input - array['subject','subjectOptions','preheader','body','cta','url','html','checks'])<>'{}'::jsonb
    or jsonb_typeof(input->'subject') is distinct from 'string' or length(btrim(input->>'subject')) not between 1 and 200
    or jsonb_typeof(coalesce(input->'subjectOptions','[]'))<>'array' or jsonb_array_length(coalesce(input->'subjectOptions','[]'))>3
    or exists(select 1 from jsonb_array_elements(coalesce(input->'subjectOptions','[]')) o where jsonb_typeof(o)<>'string' or length(o#>>'{}') not between 1 and 200)
    or jsonb_typeof(coalesce(input->'preheader','""')) <> 'string' or length(coalesce(input->>'preheader',''))>300
    or jsonb_typeof(coalesce(input->'body','""')) <> 'string' or length(coalesce(input->>'body',''))>100000
    or jsonb_typeof(coalesce(input->'cta','""')) <> 'string' or length(coalesce(input->>'cta',''))>200
    or jsonb_typeof(coalesce(input->'url','""')) <> 'string'
    or (coalesce(input->>'url','')<>'' and (length(input->>'url')>2000 or input->>'url' !~ '^https://[^\s/?#@]+([/?#]\S*)?$'))
    or jsonb_typeof(coalesce(input->'html','null')) not in ('string','null')
    or (input->>'html' is not null and (s.format<>'html' or length(input->>'html') not between 1 and 300000))
    or jsonb_typeof(coalesce(input->'checks','[]'))<>'array' or jsonb_array_length(coalesce(input->'checks','[]'))>8
    or (s.format='html' and origin in ('exact_copy','owner_edit','restored') and input->>'html' is null) then
    raise exception 'Valid email content required' using errcode='23514';
  end if;
  n:=r.current_revision+1;
  copy_revision:=private.sync_email_copy(t,r.campaign_id,actor,input,jsonb_build_object('resultId',r.id,'revision',n,'origin',origin));
  insert into public.email_result_revisions(tenant_id,result_id,revision,origin,subject,subject_options,preheader,body_text,cta_label,cta_url,html,checks,generation_id,restored_from,campaign_copy_revision,created_by)
    values(t,r.id,n,origin,btrim(input->>'subject'),array(select jsonb_array_elements_text(coalesce(input->'subjectOptions','[]'))),coalesce(input->>'preheader',''),
      coalesce(input->>'body',''),coalesce(input->>'cta',''),coalesce(input->>'url',''),input->>'html',coalesce(input->'checks','[]'),generation,restored,copy_revision,actor);
  update public.email_results set current_revision=n,updated_at=now() where id=r.id;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION private.email_job_generation (
  job   uuid,
  lease uuid
)
  RETURNS public.email_generations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare j public.job_runs;g public.email_generations;t uuid;
begin
  perform private.require_service();
  select tenant_id into t from public.job_runs where id=job;
  if t is null then raise exception 'Job unavailable' using errcode='42501';end if;
  perform 1 from public.tenants where id=t and status='active' for update;
  if not found then raise exception 'Workspace unavailable' using errcode='42501';end if;
  select * into j from public.job_runs where id=job for update;
  if j.kind<>'email.rewrite' then raise exception 'Not a rewrite job' using errcode='23514';end if;
  if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='PT409';end if;
  select * into g from public.email_generations where job_id=j.id for update;
  if not found or g.state<>'running' then raise exception 'Rewrite no longer running' using errcode='PT409';end if;
  return g;
end $function$;

CREATE OR REPLACE FUNCTION private.email_options_valid (
  t          uuid,
  options    jsonb,
  allow_text boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if options is null or jsonb_typeof(options)<>'object'
    or (options - array['productId','offerId','note','link','textVersion'])<>'{}'::jsonb
    or (not allow_text and options ? 'textVersion')
    or (options ? 'textVersion' and (jsonb_typeof(options->'textVersion')<>'string' or length(options->>'textVersion')>100000))
    or (options ? 'note' and (jsonb_typeof(options->'note')<>'string' or length(options->>'note')>500))
    or (options ? 'link' and (jsonb_typeof(options->'link')<>'string' or length(options->>'link')>2000 or options->>'link' !~ '^https://[^\s/?#@]+([/?#]\S*)?$'))
    or (options ? 'productId' and (jsonb_typeof(options->'productId')<>'string' or options->>'productId' !~ '^[0-9a-f-]{36}$'))
    or (options ? 'offerId' and (jsonb_typeof(options->'offerId')<>'string' or options->>'offerId' !~ '^[0-9a-f-]{36}$')) then
    return false;
  end if;
  if options ? 'productId' and not exists(select 1 from public.products p where p.id=(options->>'productId')::uuid and p.tenant_id=t) then
    raise exception 'Product unavailable in this workspace' using errcode='42501';
  end if;
  if options ? 'offerId' and not exists(select 1 from public.offers o where o.id=(options->>'offerId')::uuid and o.tenant_id=t and o.ends_at>now()) then
    raise exception 'Offer unavailable in this workspace' using errcode='42501';
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION private.enqueue_email_rewrite (
  t                 uuid,
  result            uuid,
  request_key       uuid,
  expected_revision integer,
  options           jsonb,
  actor             uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r public.email_results;s public.email_sources;b public.brand_profiles;g uuid;j uuid;existing uuid;
begin
  select * into r from public.email_results where id=result and tenant_id=t for update;
  if not found then raise exception 'Email unavailable' using errcode='42501';end if;
  select id into existing from public.email_generations where result_id=r.id and email_generations.request_key=enqueue_email_rewrite.request_key;
  if existing is not null then return existing;end if;
  if r.current_revision is distinct from expected_revision then raise exception 'This email changed; reload before rewriting' using errcode='PT409';end if;
  if exists(select 1 from public.email_generations where result_id=r.id and state in ('queued','running')) then
    raise exception 'A rewrite is already in progress' using errcode='PT409';
  end if;
  if (select count(*) from public.email_generations where tenant_id=t and created_at>now()-interval '1 hour')>=30 then
    raise exception 'Rewrite limit reached; try again later' using errcode='23514';
  end if;
  select * into b from public.brand_profiles where tenant_id=t;
  if not found then raise exception 'Brand basics required' using errcode='23514';end if;
  select * into s from public.email_sources where id=r.source_id and tenant_id=t;
  g:=gen_random_uuid();
  insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by)
    values(t,r.campaign_id,'email.rewrite','email-rewrite:'||g,jsonb_build_object('generationId',g,'resultId',r.id),actor) returning id into j;
  insert into public.email_generations(id,tenant_id,result_id,job_id,request_key,created_by,source_sha256,brand_revision,target_revision,options,prompt_version)
    values(g,t,r.id,j,request_key,actor,s.original_sha256,b.revision,r.current_revision,options,'email-rewrite-v1');
  return g;
end $function$;

CREATE OR REPLACE FUNCTION private.forbid_update()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  raise exception '% records are immutable', tg_table_name using errcode = '42501';
end $function$;

CREATE OR REPLACE FUNCTION private.is_active_owner (
  t     uuid,
  actor uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id and p.status='active'
    join public.tenants x on x.id=m.tenant_id and x.status='active'
    where m.tenant_id=t and m.profile_id=actor and m.role='owner' and m.status='active');
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
 if j.kind='email.rewrite' then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='PT409';end if;return j;
end $function$;

CREATE OR REPLACE FUNCTION private.require_service()
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server worker access only' using errcode='42501';end if;
end $function$;

CREATE OR REPLACE FUNCTION private.reserve_budget (
  t         uuid,
  operation text,
  feature   text,
  estimate  bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare c public.package_cycles;r public.usage_reservations;d date;daily bigint;alert text;live boolean;
begin
 if operation is null or length(operation) not between 1 and 200 or feature is null or feature not in ('copy','design','assets','playbook','calendar','gros','learning') or estimate is null or estimate<1 or estimate>1000000000 then raise exception 'Invalid usage request' using errcode='23514';end if;
 live:=operation like 'email-rewrite:%';
 c:=private.ensure_package_cycle(t);
 d:=(now() at time zone (select timezone from public.tenants where id=t))::date;
 select * into r from public.usage_reservations where tenant_id=t and operation_id=operation for update;
 if r.id is not null then
  if r.feature<>feature or r.estimate_micro<>estimate then raise exception 'Usage operation identity changed' using errcode='PT409';end if;
  if r.state in ('reserved','reconciled') then return r.id;end if;
 end if;
 select coalesce(sum(case when state='reserved' then estimate_micro when state='reconciled' then actual_micro else 0 end),0) into daily from public.usage_reservations where cycle_id=c.id and local_date=d;
 if c.used_micro+c.reserved_micro+estimate>c.allocation_micro or daily+estimate>c.daily_micro then
  raise exception '%',case when live then 'AI usage allowance reached; no AI request was sent' else 'Fixture AI budget exhausted; approved delivery remains available' end using errcode='23514';
 end if;
 insert into public.usage_reservations(tenant_id,cycle_id,operation_id,feature,estimate_micro,local_date) values(t,c.id,operation,feature,estimate,d) on conflict(tenant_id,operation_id) do update set cycle_id=excluded.cycle_id,state='reserved',actual_micro=null,local_date=excluded.local_date,expires_at=now()+interval '10 minutes' returning * into r;
 update public.package_cycles set reserved_micro=reserved_micro+estimate where id=c.id;
 foreach alert in array array[case when c.used_micro+c.reserved_micro+estimate>=c.allocation_micro*0.8 then 'cycle' end,case when daily+estimate>=c.daily_micro*0.8 then 'day:'||d end] loop
 if alert is not null then
 insert into public.budget_alerts(cycle_id,tenant_id,window_key) values(c.id,t,alert) on conflict do nothing;
 if found then perform private.notify_owners(t,'budget_soft_alert',c.id,case when live
   then 'AI usage reached 80% of the '||alert||' allowance, including real AI rewriting requests.'
   else 'Synthetic fixture usage reached 80% of '||alert||' allowance. No paid provider was called.' end);end if;
 end if;end loop;return r.id;
end $function$;

CREATE OR REPLACE FUNCTION private.settle_email_dispatch (
  d       private.email_dispatches,
  actual  bigint,
  unknown boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare spent bigint:=greatest(coalesce(actual,0),0);over bigint;
begin
  over:=greatest(spent-d.estimate_micro,0);
  perform private.reconcile_budget(d.tenant_id,d.reservation_id,spent-over);
  if over>0 then
    update public.package_cycles c set used_micro=c.used_micro+over from public.usage_reservations u where u.id=d.reservation_id and c.id=u.cycle_id;
    update public.usage_reservations set actual_micro=spent,state='reconciled' where id=d.reservation_id;
    update public.email_generations set diagnostic='actual cost exceeded reservation',updated_at=now() where id=d.generation_id;
  end if;
  update private.email_dispatches set state=case when unknown then 'unknown' else 'settled' end,actual_micro=spent,settled_at=now()
    where generation_id=d.generation_id and attempt=d.attempt;
end $function$;

CREATE OR REPLACE FUNCTION private.settle_stale_email_dispatches (
  t uuid
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare d private.email_dispatches;n integer:=0;
begin
  for d in select x.* from private.email_dispatches x join public.email_generations g on g.id=x.generation_id join public.job_runs j on j.id=g.job_id
    where x.tenant_id=t and x.state='sent' and not (j.status='running' and j.lease_until>now()) for update of x loop
    perform private.settle_email_dispatch(d,d.estimate_micro,true);
    update public.email_generations set cost_micro=cost_micro+d.estimate_micro,diagnostic='unknown provider outcome; charged at reservation',updated_at=now() where id=d.generation_id;
    n:=n+1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION private.sync_email_copy (
  t        uuid,
  campaign uuid,
  actor    uuid,
  input    jsonb,
  detail   jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare c public.campaigns;n integer;subjects text[];
begin
  select * into c from public.campaigns where id=campaign and tenant_id=t for update;
  if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
  if c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then
    raise exception 'Delivery active; cancel or reconcile before editing' using errcode='23514';
  end if;
  subjects:=array(select jsonb_array_elements_text(coalesce(input->'subjectOptions','[]'::jsonb)));
  if cardinality(subjects) not in (1,3) then subjects:=array[input->>'subject'];end if;
  n:=c.copy_revision+1;
  insert into public.campaign_content(tenant_id,campaign_id,revision,subject,subject_options,preheader,body,cta,primary_url,created_by)
    values(t,c.id,n,input->>'subject',subjects,coalesce(input->>'preheader',''),left(coalesce(input->>'body',''),20000),coalesce(input->>'cta',''),coalesce(input->>'url',''),actor);
  update public.campaigns set copy_revision=n,copy_state='pending_approval',design_revision=design_revision+1,design_state='unassigned',
    delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,actor,'email_result_revised',detail||jsonb_build_object('copyRevision',n));
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.begin_email_dispatch (
  job            uuid,
  lease          uuid,
  estimate       bigint,
  provider       text,
  model          text,
  prompt_version text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare g public.email_generations;r public.email_results;reservation uuid;
begin
  g:=private.email_job_generation(job,lease);
  if provider is null or provider not in ('openai','sample') or model is null or length(model) not between 1 and 80
    or prompt_version is distinct from g.prompt_version or estimate is null or estimate<1 then
    raise exception 'Valid dispatch required' using errcode='23514';
  end if;
  select * into r from public.email_results where id=g.result_id;
  -- Frozen inputs are rechecked before any money is committed.
  if not private.is_active_owner(g.tenant_id,g.created_by)
    or (select b.revision from public.brand_profiles b where b.tenant_id=g.tenant_id) is distinct from g.brand_revision
    or r.current_revision is distinct from g.target_revision
    or (select s.original_sha256 from public.email_sources s where s.id=r.source_id) is distinct from g.source_sha256 then
    raise exception 'Rewrite inputs changed' using errcode='PT409';
  end if;
  if exists(select 1 from private.email_dispatches d where d.generation_id=g.id and d.state in ('sent','unknown')) then
    raise exception 'A provider request is in flight or unresolved' using errcode='PT409';
  end if;
  if g.dispatches>=4 then raise exception 'Attempt limit reached' using errcode='23514';end if;
  if exists(select 1 from public.usage_reservations u where u.tenant_id=g.tenant_id and u.operation_id='email-rewrite:'||g.id||':'||(g.dispatches+1)) then
    raise exception 'Reservation identity already used' using errcode='23514';
  end if;
  reservation:=private.reserve_budget(g.tenant_id,'email-rewrite:'||g.id||':'||(g.dispatches+1),'copy',estimate);
  -- Settled only by this workflow, so an unobserved outcome is never released as free.
  update public.usage_reservations set expires_at='infinity' where id=reservation;
  insert into private.email_dispatches(generation_id,attempt,tenant_id,reservation_id,estimate_micro) values(g.id,g.dispatches+1,g.tenant_id,reservation,estimate);
  update public.email_generations set dispatches=dispatches+1,provider=begin_email_dispatch.provider,model=begin_email_dispatch.model,updated_at=now() where id=g.id;
  return reservation;
end $function$;

CREATE OR REPLACE FUNCTION public.claim_email_generation (
  t          uuid,
  generation uuid
)
  RETURNS TABLE (
    job_id         uuid,
    lease_token    uuid,
    attempt        integer,
    generation_id  uuid,
    result_id      uuid,
    source_id      uuid,
    brand_revision integer,
    options        jsonb,
    actor          uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare g public.email_generations;j public.job_runs;r public.email_results;
begin
  perform private.require_service();
  perform 1 from public.tenants where tenants.id=t and tenants.status='active' for update;
  if not found then raise exception 'Workspace unavailable' using errcode='42501';end if;
  perform private.settle_stale_email_dispatches(t);
  select * into g from public.email_generations x where x.id=generation and x.tenant_id=t for update;
  if not found then raise exception 'Rewrite unavailable' using errcode='42501';end if;
  if g.state not in ('queued','running') then return;end if;
  select * into j from public.job_runs x where x.id=g.job_id for update;
  if j.status in ('leased','running') and j.lease_until<now() then
    update public.job_runs x set status=case when x.attempt>=4 then 'failed' else 'retry_wait' end,lease_token=null,lease_until=null,
      available_at=now(),error_code='stale_lease',updated_at=now() where x.id=j.id returning * into j;
  end if;
  -- An unobserved provider request is never repeated automatically; the owner decides.
  if exists(select 1 from private.email_dispatches d where d.generation_id=g.id and d.state='unknown') then
    update public.job_runs x set status='failed',error_code='unknown_outcome',lease_token=null,lease_until=null,updated_at=now() where x.id=j.id;
    update public.email_generations x set state='failed',failure_code='unknown_outcome',updated_at=now() where x.id=g.id;
    return;
  end if;
  if j.status='failed' or j.attempt>=4 or g.dispatches>=4 then
    update public.job_runs x set status='failed',lease_token=null,lease_until=null,updated_at=now() where x.id=j.id;
    update public.email_generations x set state='failed',failure_code=coalesce(x.failure_code,'attempts_exhausted'),updated_at=now() where x.id=g.id;
    return;
  end if;
  if j.status not in ('queued','retry_wait') or j.available_at>now() then return;end if;
  if not private.is_active_owner(t,g.created_by) then
    update public.job_runs x set status='failed',error_code='actor_inactive',lease_token=null,lease_until=null,updated_at=now() where x.id=j.id;
    update public.email_generations x set state='failed',failure_code='actor_inactive',updated_at=now() where x.id=g.id;
    return;
  end if;
  update public.job_runs x set status='running',attempt=x.attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '180 seconds',updated_at=now()
    where x.id=j.id returning * into j;
  update public.email_generations x set state='running',updated_at=now() where x.id=g.id;
  select * into r from public.email_results x where x.id=g.result_id;
  return query select j.id,j.lease_token,j.attempt,g.id,g.result_id,r.source_id,g.brand_revision,g.options,g.created_by;
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
 update public.job_runs set status=case when attempt>=4 then 'failed' else 'retry_wait' end,lease_token=null,lease_until=null,available_at=now(),error_code='stale_lease' where tenant_id=t and status in ('leased','running') and lease_until<now() and kind<>'email.rewrite';
 select * into j from public.job_runs where tenant_id=t and status in ('queued','retry_wait') and attempt<4 and available_at<=now() and kind<>'email.rewrite' order by available_at,created_at for update skip locked limit 1;
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
  fmt:=case when imp.original_body ~* '<\/?[a-z!][^<>]*>' then 'html' else 'text' end;
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

CREATE OR REPLACE FUNCTION public.fail_email_generation (
  job     uuid,
  lease   uuid,
  failure jsonb
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare g public.email_generations;d private.email_dispatches;j public.job_runs;code text;billing text;actual bigint;retry boolean;wait integer;
begin
  g:=private.email_job_generation(job,lease);
  select * into j from public.job_runs where id=g.job_id;
  code:=failure->>'code';billing:=failure->>'billing';
  if failure is null or jsonb_typeof(failure)<>'object'
    or code is null or code not in ('setup_required','provider_account','rate_limited','unavailable','timeout','refused','incomplete','invalid_output','rejected_request','budget_exhausted','stale_inputs','inputs_unavailable','internal')
    or billing is null or billing not in ('none','usage','unknown')
    or jsonb_typeof(failure->'retryable') is distinct from 'boolean'
    or (failure ? 'costMicro' and (jsonb_typeof(failure->'costMicro')<>'number' or (failure->>'costMicro')::numeric not between 0 and 1000000000))
    or (failure ? 'retryAfter' and (jsonb_typeof(failure->'retryAfter')<>'number' or (failure->>'retryAfter')::numeric not between 0 and 300))
    or (failure ? 'diagnostic' and (jsonb_typeof(failure->'diagnostic')<>'string' or failure->>'diagnostic' !~ '^[A-Za-z0-9 :_./-]{0,200}$')) then
    raise exception 'Valid failure required' using errcode='23514';
  end if;
  if (failure ? 'inputTokens' and (jsonb_typeof(failure->'inputTokens')<>'number' or (failure->>'inputTokens')::numeric not between 0 and 10000000))
    or (failure ? 'outputTokens' and (jsonb_typeof(failure->'outputTokens')<>'number' or (failure->>'outputTokens')::numeric not between 0 and 10000000)) then
    raise exception 'Valid failure required' using errcode='23514';
  end if;
  select * into d from private.email_dispatches x where x.generation_id=g.id and x.state='sent' for update;
  if found then
    actual:=case billing when 'none' then 0 when 'usage' then coalesce((failure->>'costMicro')::bigint,0) else d.estimate_micro end;
    perform private.settle_email_dispatch(d,actual,billing='unknown');
    update public.email_generations set cost_micro=cost_micro+actual,input_tokens=input_tokens+coalesce((failure->>'inputTokens')::bigint,0),
      output_tokens=output_tokens+coalesce((failure->>'outputTokens')::bigint,0),updated_at=now() where id=g.id;
  elsif billing<>'none' then
    raise exception 'A billed failure needs a provider request' using errcode='23514';
  end if;
  -- Automatic retries only when the provider is known not to have charged, plus
  -- one repair attempt after a known-billed malformed output. Unknown outcomes stop.
  retry:=(failure->>'retryable')::boolean and j.attempt<4 and g.dispatches<4
    and ((billing='none' and code in ('rate_limited','unavailable','internal')) or (billing='usage' and code='invalid_output' and j.attempt<2));
  wait:=greatest(coalesce((failure->>'retryAfter')::integer,0),least(120,5*power(2,j.attempt)::integer));
  update public.job_runs set status=case when retry then 'retry_wait' else 'failed' end,
    failure_class=case code when 'rate_limited' then 'rate_limit' when 'timeout' then 'unknown_outcome' when 'unavailable' then 'transient' when 'internal' then 'transient' when 'setup_required' then 'auth' when 'provider_account' then 'auth' else 'validation' end,
    error_code=code,available_at=now()+make_interval(secs=>wait),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
  update public.email_generations set state=case when retry then 'queued' else 'failed' end,failure_code=code,diagnostic=nullif(failure->>'diagnostic',''),updated_at=now() where id=g.id;
  if not retry and g.dispatches>0 then
    select * into g from public.email_generations where id=g.id;
    insert into public.ai_calls(tenant_id,job_id,feature,prompt_version,provider,status,input_tokens,output_tokens,cost_micro_usd,input_revisions)
      values(g.tenant_id,g.job_id,'copy',g.prompt_version,coalesce(g.provider,'openai'),'failed',least(g.input_tokens,2147483647),least(g.output_tokens,2147483647),g.cost_micro,
        jsonb_build_object('brand',g.brand_revision,'source',g.source_sha256,'failure',code)) on conflict(job_id) do nothing;
  end if;
  return case when retry then 'retrying' else 'failed' end;
end $function$;

CREATE OR REPLACE FUNCTION public.finish_email_generation (
  job    uuid,
  lease  uuid,
  output jsonb,
  usage  jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare g public.email_generations;d private.email_dispatches;r public.email_results;cost bigint;inputs bigint;outputs bigint;n integer;stale boolean;
begin
  g:=private.email_job_generation(job,lease);
  if usage is null or jsonb_typeof(usage)<>'object'
    or jsonb_typeof(usage->'inputTokens') is distinct from 'number' or jsonb_typeof(usage->'outputTokens') is distinct from 'number'
    or jsonb_typeof(usage->'costMicro') is distinct from 'number'
    or (usage->>'inputTokens')::numeric not between 0 and 10000000 or (usage->>'outputTokens')::numeric not between 0 and 10000000
    or (usage->>'costMicro')::numeric not between 0 and 1000000000
    or length(coalesce(usage->>'responseId',''))>120 then
    raise exception 'Valid usage required' using errcode='23514';
  end if;
  cost:=(usage->>'costMicro')::bigint;inputs:=(usage->>'inputTokens')::bigint;outputs:=(usage->>'outputTokens')::bigint;
  select * into d from private.email_dispatches x where x.generation_id=g.id and x.state='sent' for update;
  if not found then raise exception 'No provider request in flight' using errcode='23514';end if;
  perform private.settle_email_dispatch(d,cost,false);
  update public.email_generations set input_tokens=input_tokens+inputs,output_tokens=output_tokens+outputs,cost_micro=cost_micro+cost,
    response_id=nullif(usage->>'responseId',''),updated_at=now() where id=g.id;
  select * into r from public.email_results where id=g.result_id for update;
  stale:=not private.is_active_owner(g.tenant_id,g.created_by)
    or (select b.revision from public.brand_profiles b where b.tenant_id=g.tenant_id) is distinct from g.brand_revision
    or r.current_revision is distinct from g.target_revision
    or (select s.original_sha256 from public.email_sources s where s.id=r.source_id) is distinct from g.source_sha256
    or exists(select 1 from public.campaigns c where c.id=r.campaign_id and c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling'));
  if stale then
    update public.email_generations set state='stale',failure_code='stale_inputs',updated_at=now() where id=g.id;
    update public.job_runs set status='failed',error_code='stale_inputs',lease_token=null,lease_until=null,updated_at=now() where id=g.job_id;
    insert into public.ai_calls(tenant_id,job_id,feature,prompt_version,provider,status,input_tokens,output_tokens,cost_micro_usd,input_revisions)
      values(g.tenant_id,g.job_id,'copy',g.prompt_version,g.provider,'failed',least(g.input_tokens+inputs,2147483647),least(g.output_tokens+outputs,2147483647),g.cost_micro+cost,
        jsonb_build_object('brand',g.brand_revision,'source',g.source_sha256,'targetRevision',g.target_revision,'stale',true)) on conflict(job_id) do nothing;
    return null;
  end if;
  n:=private.add_email_revision(g.tenant_id,r.id,case g.provider when 'sample' then 'sample_rewrite' else 'ai_rewrite' end,output,g.id,null,g.created_by);
  update public.email_generations set state='succeeded',output_revision=n,failure_code=null,updated_at=now() where id=g.id;
  update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('resultRevision',n),lease_token=null,lease_until=null,updated_at=now() where id=g.job_id;
  insert into public.ai_calls(tenant_id,job_id,feature,prompt_version,provider,status,input_tokens,output_tokens,cost_micro_usd,input_revisions)
    values(g.tenant_id,g.job_id,'copy',g.prompt_version,g.provider,'succeeded',least(g.input_tokens+inputs,2147483647),least(g.output_tokens+outputs,2147483647),g.cost_micro+cost,
      jsonb_build_object('brand',g.brand_revision,'source',g.source_sha256,'targetRevision',g.target_revision)) on conflict(job_id) do nothing;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.reconcile_fixture_usage (
  t           uuid,
  reservation uuid,
  actual      bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 if exists(select 1 from public.usage_reservations u where u.id=reservation and u.operation_id like 'email-rewrite:%')
   or exists(select 1 from private.email_dispatches d where d.reservation_id=reservation) then
   raise exception 'Access denied' using errcode='42501';
 end if;
 perform private.reconcile_budget(t,reservation,actual);
end $function$;

CREATE OR REPLACE FUNCTION public.request_email_rewrite (
  t                 uuid,
  result            uuid,
  request_key       uuid,
  expected_revision integer,
  options           jsonb   DEFAULT '{}'::jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  perform private.require_member(t,true);
  if request_key is null or result is null or expected_revision is null or not private.email_options_valid(t,options,false) then
    raise exception 'Valid rewrite request required' using errcode='23514';
  end if;
  perform private.settle_stale_email_dispatches(t);
  return private.enqueue_email_rewrite(t,result,request_key,expected_revision,options,auth.uid());
end $function$;

CREATE OR REPLACE FUNCTION public.reserve_fixture_usage (
  t         uuid,
  operation text,
  feature   text,
  estimate  bigint
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 if operation like 'email-rewrite:%' then raise exception 'Access denied' using errcode='42501';end if;
 return private.reserve_budget(t,operation,feature,estimate);
end $function$;

CREATE OR REPLACE FUNCTION public.restore_email_revision (
  t                 uuid,
  result            uuid,
  expected_revision integer,
  from_revision     integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r public.email_results;v public.email_result_revisions;
begin
  perform private.require_member(t,true);
  select * into r from public.email_results where id=result and tenant_id=t for update;
  if not found then raise exception 'Email unavailable' using errcode='42501';end if;
  if r.current_revision is distinct from expected_revision then raise exception 'This email changed; reload before restoring' using errcode='PT409';end if;
  select * into v from public.email_result_revisions where result_id=r.id and tenant_id=t and revision=from_revision;
  if not found or from_revision=r.current_revision then raise exception 'Version unavailable' using errcode='23514';end if;
  return private.add_email_revision(t,r.id,'restored',jsonb_build_object('subject',v.subject,'subjectOptions',to_jsonb(v.subject_options),
    'preheader',v.preheader,'body',v.body_text,'cta',v.cta_label,'url',v.cta_url,'html',v.html,'checks',v.checks),null,v.revision,auth.uid());
end $function$;

CREATE OR REPLACE FUNCTION public.save_email_revision (
  t                 uuid,
  result            uuid,
  expected_revision integer,
  input             jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare r public.email_results;
begin
  perform private.require_member(t,true);
  select * into r from public.email_results where id=result and tenant_id=t for update;
  if not found then raise exception 'Email unavailable' using errcode='42501';end if;
  if r.current_revision is distinct from expected_revision then raise exception 'This email changed; reload before saving' using errcode='PT409';end if;
  if input is null or jsonb_typeof(input)<>'object' or (input - array['subject','preheader','body','cta','url','html'])<>'{}'::jsonb then
    raise exception 'Valid email content required' using errcode='23514';
  end if;
  return private.add_email_revision(t,r.id,'owner_edit',input,null,null,auth.uid());
end $function$;

ALTER TABLE "private"."email_dispatches"
  ADD CONSTRAINT "email_dispatches_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES public.usage_reservations(id);

ALTER TABLE "private"."email_result_requests"
  ADD CONSTRAINT "email_result_requests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "private"."email_result_requests"
  ADD CONSTRAINT "email_result_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_calls"
  ADD CONSTRAINT "ai_calls_provider_check" CHECK ((provider = ANY (ARRAY['fixture'::text, 'openai'::text, 'sample'::text])));

ALTER TABLE "public"."email_generations"
  ADD CONSTRAINT "email_generations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "private"."email_dispatches"
  ADD CONSTRAINT "email_dispatches_tenant_id_generation_id_fkey" FOREIGN KEY (tenant_id, generation_id) REFERENCES public.email_generations(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."email_generations"
  ADD CONSTRAINT "email_generations_tenant_id_job_id_fkey" FOREIGN KEY (tenant_id, job_id) REFERENCES public.job_runs(tenant_id, id);

ALTER TABLE "public"."email_result_revisions"
  ADD CONSTRAINT "email_result_revisions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."email_result_revisions"
  ADD CONSTRAINT "email_revision_generation" FOREIGN KEY (tenant_id, generation_id) REFERENCES public.email_generations(tenant_id, id);

ALTER TABLE "public"."email_results"
  ADD CONSTRAINT "email_results_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."email_results"
  ADD CONSTRAINT "email_results_tenant_id_campaign_id_fkey" FOREIGN KEY (tenant_id, campaign_id) REFERENCES public.campaigns(tenant_id, id);

ALTER TABLE "public"."email_results"
  ADD CONSTRAINT "email_results_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "private"."email_result_requests"
  ADD CONSTRAINT "email_result_requests_tenant_id_result_id_fkey" FOREIGN KEY (tenant_id, result_id) REFERENCES public.email_results(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE "public"."email_generations"
  ADD CONSTRAINT "email_generations_tenant_id_result_id_fkey" FOREIGN KEY (tenant_id, result_id) REFERENCES public.email_results(tenant_id, id);

ALTER TABLE "public"."email_result_revisions"
  ADD CONSTRAINT "email_result_revisions_tenant_id_result_id_fkey" FOREIGN KEY (tenant_id, result_id) REFERENCES public.email_results(tenant_id, id);

ALTER TABLE "public"."email_sources"
  ADD CONSTRAINT "email_sources_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."email_sources"
  ADD CONSTRAINT "email_sources_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."email_results"
  ADD CONSTRAINT "email_results_tenant_id_source_id_fkey" FOREIGN KEY (tenant_id, source_id) REFERENCES public.email_sources(tenant_id, id);

ALTER TABLE "public"."email_sources"
  ADD CONSTRAINT "email_sources_tenant_id_reference_import_id_fkey" FOREIGN KEY (tenant_id, reference_import_id) REFERENCES public.reference_imports(tenant_id, id)
    ON DELETE CASCADE;

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
    'ops.health'::text, 'results.pull'::text, 'reports.digest'::text, 'learning.synthesize'::text, 'optimizer.winback'::text, 'optimizer.suppress'::text, 'email.rewrite'::text])));

CREATE INDEX email_dispatches_generation_idx ON private.email_dispatches USING btree (tenant_id, generation_id);

CREATE INDEX email_dispatches_open_idx ON private.email_dispatches USING btree (tenant_id)
  WHERE (state = 'sent'::text);

CREATE INDEX email_dispatches_reservation_idx ON private.email_dispatches USING btree (reservation_id);

CREATE UNIQUE INDEX email_one_dispatch_in_flight ON private.email_dispatches USING btree (generation_id)
  WHERE (state = 'sent'::text);

CREATE INDEX email_result_requests_actor_idx ON private.email_result_requests USING btree (created_by);

CREATE INDEX email_result_requests_result_idx ON private.email_result_requests USING btree (tenant_id, result_id);

CREATE INDEX email_generations_created_by_idx ON public.email_generations USING btree (created_by);

CREATE INDEX email_generations_job_idx ON public.email_generations USING btree (tenant_id, job_id);

CREATE INDEX email_generations_result_idx ON public.email_generations USING btree (tenant_id, result_id, created_at DESC);

CREATE INDEX email_generations_tenant_idx ON public.email_generations USING btree (tenant_id, created_at);

CREATE INDEX email_results_campaign_idx ON public.email_results USING btree (tenant_id, campaign_id);

CREATE INDEX email_results_created_by_idx ON public.email_results USING btree (created_by);

CREATE INDEX email_results_source_idx ON public.email_results USING btree (tenant_id, source_id);

CREATE INDEX email_results_tenant_idx ON public.email_results USING btree (tenant_id, created_at DESC, id);

CREATE INDEX email_revisions_created_by_idx ON public.email_result_revisions USING btree (created_by);

CREATE INDEX email_revisions_generation_idx ON public.email_result_revisions USING btree (tenant_id, generation_id);

CREATE INDEX email_revisions_result_idx ON public.email_result_revisions USING btree (tenant_id, result_id, revision DESC);

CREATE INDEX email_sources_created_by_idx ON public.email_sources USING btree (created_by);

CREATE TRIGGER email_revisions_immutable
  BEFORE UPDATE ON public.email_result_revisions
  FOR EACH ROW
  EXECUTE FUNCTION private.forbid_update();

CREATE TRIGGER email_sources_immutable
  BEFORE UPDATE ON public.email_sources
  FOR EACH ROW
  EXECUTE FUNCTION private.forbid_update();

CREATE POLICY "usage_read" ON "public"."email_generations"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id, ARRAY['owner'::public.tenant_role, 'admin'::public.tenant_role]));

CREATE POLICY "tenant_read" ON "public"."email_result_revisions"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id));

CREATE POLICY "tenant_read" ON "public"."email_results"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id));

CREATE POLICY "tenant_read" ON "public"."email_sources"
  FOR SELECT
  TO "authenticated"
  USING (private.is_active_member(tenant_id));

REVOKE ALL ON FUNCTION "private"."add_email_revision"(uuid, uuid, text, jsonb, uuid, integer, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."add_email_revision"(uuid, uuid, text, jsonb, uuid, integer, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."email_job_generation"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_job_generation"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."email_options_valid"(uuid, jsonb, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."email_options_valid"(uuid, jsonb, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "private"."enqueue_email_rewrite"(uuid, uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."enqueue_email_rewrite"(uuid, uuid, uuid, integer, jsonb, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."forbid_update"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."forbid_update"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."is_active_owner"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_active_owner"(uuid, uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."require_service"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."require_service"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."settle_email_dispatch"(private.email_dispatches, bigint, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."settle_email_dispatch"(private.email_dispatches, bigint, boolean) TO "postgres";

REVOKE ALL ON FUNCTION "private"."settle_stale_email_dispatches"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."settle_stale_email_dispatches"(uuid) TO "postgres";

REVOKE ALL ON FUNCTION "private"."sync_email_copy"(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."sync_email_copy"(uuid, uuid, uuid, jsonb, jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."begin_email_dispatch"(uuid, uuid, bigint, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."begin_email_dispatch"(uuid, uuid, bigint, text, text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."claim_email_generation"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."claim_email_generation"(uuid, uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."create_email_result"(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_email_result"(uuid, uuid, uuid, text, jsonb) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."fail_email_generation"(uuid, uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."fail_email_generation"(uuid, uuid, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."finish_email_generation"(uuid, uuid, jsonb, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."finish_email_generation"(uuid, uuid, jsonb, jsonb) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."request_email_rewrite"(uuid, uuid, uuid, integer, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."request_email_rewrite"(uuid, uuid, uuid, integer, jsonb) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."restore_email_revision"(uuid, uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."restore_email_revision"(uuid, uuid, integer, integer) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."save_email_revision"(uuid, uuid, integer, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."save_email_revision"(uuid, uuid, integer, jsonb) TO "authenticated", "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."email_dispatches" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."email_result_requests" TO "postgres";

REVOKE ALL ON TABLE "public"."email_generations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."email_generations" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_generations" TO "postgres";

REVOKE ALL ON TABLE "public"."email_result_revisions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."email_result_revisions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_result_revisions" TO "postgres";

REVOKE ALL ON TABLE "public"."email_results" FROM "authenticated";

GRANT SELECT ON TABLE "public"."email_results" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_results" TO "postgres";

REVOKE ALL ON TABLE "public"."email_sources" FROM "authenticated";

GRANT SELECT ON TABLE "public"."email_sources" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."email_sources" TO "postgres";


-- Explicit ACLs also override platform default privileges on a fresh database.
-- Paid-provider leases, reservations and settlement are server-only (service_role);
-- signed-in users keep only their owner commands and tenant reads. Legacy fixture
-- helpers (onboarding_lease, claim_job, fixture usage wrappers) refuse rewrite work.
REVOKE ALL ON public.email_sources, public.email_results, public.email_result_revisions, public.email_generations FROM public, anon, service_role;
REVOKE ALL ON private.email_result_requests, private.email_dispatches FROM public, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_email_result(uuid,uuid,uuid,text,jsonb), public.request_email_rewrite(uuid,uuid,uuid,integer,jsonb),
  public.save_email_revision(uuid,uuid,integer,jsonb), public.restore_email_revision(uuid,uuid,integer,integer) FROM anon, service_role;
REVOKE ALL ON FUNCTION public.claim_email_generation(uuid,uuid), public.begin_email_dispatch(uuid,uuid,bigint,text,text,text),
  public.finish_email_generation(uuid,uuid,jsonb,jsonb), public.fail_email_generation(uuid,uuid,jsonb) FROM anon, authenticated;
REVOKE ALL ON FUNCTION private.require_service(), private.forbid_update(), private.is_active_owner(uuid,uuid), private.sync_email_copy(uuid,uuid,uuid,jsonb,jsonb),
  private.add_email_revision(uuid,uuid,text,jsonb,uuid,integer,uuid), private.settle_email_dispatch(private.email_dispatches,bigint,boolean),
  private.settle_stale_email_dispatches(uuid), private.email_options_valid(uuid,jsonb,boolean),
  private.enqueue_email_rewrite(uuid,uuid,uuid,integer,jsonb,uuid), private.email_job_generation(uuid,uuid) FROM anon, authenticated, service_role;
