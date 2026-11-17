-- REL-ONB2 part d1: the Site reader keeps the founder's own note.
--
-- "Create email" may place a founder's note only word for word from the
-- store's own About page (the owner's rule of 16 November: from the
-- store's own sources only, nothing invented). The Site reader checks, on
-- the page itself, that the quote is whole sentences of the page in its
-- own letters, written in the first person by a founder the page names,
-- and marks the evidence so: `whole: true`.
--
-- * A new site topic, `founder` ({name, role?}: 1 to 60 characters each),
--   only from an About page, its note the evidence's quote (at most 300).
-- * The evidence of a site finding may carry `whole`, and only as `true`,
--   only on a founder finding from the About page; a founder finding
--   always carries it. The mark means one thing (code proved the quote is
--   whole sentences of that page), so every other combination is refused:
--   `whole: false` or on another topic or page would be a second way to
--   say "not checked", or a mark no check made.
--
-- Everything else as before (20260914090055, 20260914090062). Locks: the
-- tenant first, then the job (`private.onboarding_lease`). RLS unchanged.

alter table public.brand_findings drop constraint brand_findings_topic_check,
  add constraint brand_findings_topic_check check (topic in ('free_shipping','returns','guarantee','delivery_days','shipping',
    'locale','price_band','offering','audience','tone','claim','contact','review_platform','performance','promotion','angle',
    'creative','landing_page','review_theme','objection','customer_words','quotable_review','founder'));

-- The site's topics were an unnamed check (20260914090055): it is found by
-- what it says (exactly one, never the named one below) and replaced by a
-- named one with the founder.
do $$
declare c text; n integer := 0;
begin
  for c in select conname from pg_constraint
      where conrelid = 'public.brand_findings'::regclass and contype = 'c'
        and conname <> 'brand_findings_site_topics'
        and pg_get_constraintdef(oid) like '%source <> ''site''::text%'
  loop
    execute format('alter table public.brand_findings drop constraint %I', c);
    n := n + 1;
  end loop;
  if n <> 1 then raise exception 'Expected one site topics check, found %', n; end if;
end $$;
alter table public.brand_findings
  add constraint brand_findings_site_topics
    check (source <> 'site' or topic in ('free_shipping','returns','guarantee','delivery_days','shipping','locale','price_band',
      'offering','audience','tone','claim','contact','founder')),
  -- A founder's note is whole sentences of the About page, and only it is
  -- marked so. Never null: every branch is a plain true or false.
  add constraint brand_findings_founder_whole
    check (case when evidence ? 'whole'
      then topic = 'founder' and source = 'site' and evidence->'whole' = 'true'::jsonb
        and coalesce(evidence->>'page', '') = 'about'
      else topic <> 'founder' end);

-- The value each topic holds, as before (20260914090062), with the founder.
create or replace function private.finding_value_ok(topic text, v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  whole_days constant text := '^[0-9]{1,4}$';
  money constant text := '^[0-9]{1,7}(\.[0-9]{1,2})?$';
begin
  if jsonb_typeof(v) is distinct from 'object' or length(v::text) > 1000 then return false; end if;
  case topic
    when 'free_shipping' then
      if v->>'kind' in ('always','never') then return coalesce(v - 'kind' = '{}'::jsonb, false); end if;
      return coalesce(v->>'kind' = 'over' and jsonb_typeof(v->'amount') = 'number' and v->>'amount' ~ money
        and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$' and v - 'kind' - 'amount' - 'currency' = '{}'::jsonb, false);
    when 'returns', 'guarantee' then
      return coalesce(jsonb_typeof(v->'days') = 'number' and v->>'days' ~ whole_days and (v->>'days')::integer <= 3650
        and v - 'days' = '{}'::jsonb, false);
    when 'delivery_days' then
      if jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number'
        or v->>'min' !~ '^[0-9]{1,2}$' or v->>'max' !~ '^[0-9]{1,2}$' then return false; end if;
      return coalesce((v->>'min')::integer <= (v->>'max')::integer and (v->>'max')::integer <= 90
        and (not v ? 'region' or (jsonb_typeof(v->'region') = 'string' and length(v->>'region') between 2 and 60))
        and v - 'min' - 'max' - 'region' = '{}'::jsonb, false);
    when 'locale' then
      return coalesce(v->>'language', '') ~ '^[a-z]{2}$' and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$'
        and v - 'language' - 'currency' = '{}'::jsonb;
    when 'price_band' then
      if jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number'
        or v->>'min' !~ money or v->>'max' !~ money then return false; end if;
      return coalesce((v->>'min')::numeric <= (v->>'max')::numeric and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$'
        and v - 'min' - 'max' - 'currency' = '{}'::jsonb, false);
    when 'claim' then
      return coalesce(v->>'subject' in ('brand','product')
        and (not v ? 'productId' or (jsonb_typeof(v->'productId') = 'string' and length(v->>'productId') between 1 and 100))
        and v - 'subject' - 'productId' = '{}'::jsonb, false);
    when 'review_platform' then
      return coalesce(jsonb_typeof(v->'name') = 'string' and length(v->>'name') between 2 and 60
        and jsonb_typeof(v->'verified') = 'boolean'
        and (not v ? 'rating' or (jsonb_typeof(v->'rating') = 'number' and (v->>'rating')::numeric between 0 and 5))
        and (not v ? 'count' or (jsonb_typeof(v->'count') = 'number' and v->>'count' ~ '^[0-9]{1,9}$'))
        and v - 'name' - 'verified' - 'rating' - 'count' = '{}'::jsonb, false);
    when 'promotion' then
      if v->>'kind' in ('gift','bundle') then return coalesce(v - 'kind' = '{}'::jsonb, false); end if;
      if v->>'kind' = 'percent_off' then
        return coalesce(jsonb_typeof(v->'percent') = 'number' and v->>'percent' ~ '^[0-9]{1,2}$'
          and (v->>'percent')::integer between 1 and 90 and v - 'kind' - 'percent' = '{}'::jsonb, false);
      end if;
      return coalesce(v->>'kind' = 'amount_off' and jsonb_typeof(v->'amount') = 'number' and v->>'amount' ~ money
        and (v->>'amount')::numeric > 0
        and coalesce(v->>'currency', '') ~ '^[A-Z]{3}$' and v - 'kind' - 'amount' - 'currency' = '{}'::jsonb, false);
    when 'landing_page' then
      return coalesce(jsonb_typeof(v->'url') = 'string' and length(v->>'url') <= 500
        and private.https_host(v->>'url') is not null and v - 'url' = '{}'::jsonb, false);
    when 'quotable_review' then
      -- A day, when given, is a real one.
      if v ? 'date' then
        if jsonb_typeof(v->'date') is distinct from 'string' or v->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
        begin
          if to_char(to_date(v->>'date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v->>'date' then return false; end if;
        exception when others then
          return false;
        end;
      end if;
      return coalesce(jsonb_typeof(v->'author') = 'string' and v->>'author' ~ '[^[:space:]]' and length(v->>'author') <= 80
        and jsonb_typeof(v->'url') = 'string' and length(v->>'url') <= 500 and private.https_host(v->>'url') is not null
        and (not v ? 'rating' or (jsonb_typeof(v->'rating') = 'number' and v->>'rating' ~ '^[1-5]$'))
        and v - 'author' - 'url' - 'rating' - 'date' = '{}'::jsonb, false);
    when 'founder' then
      -- The founder's name and role as the page writes them; the note is the evidence's quote.
      return coalesce(jsonb_typeof(v->'name') = 'string' and v->>'name' ~ '[^[:space:]]' and length(v->>'name') <= 60
        and (not v ? 'role' or (jsonb_typeof(v->'role') = 'string' and v->>'role' ~ '[^[:space:]]' and length(v->>'role') <= 60))
        and v - 'name' - 'role' = '{}'::jsonb, false);
    when 'shipping', 'offering', 'audience', 'tone', 'contact', 'performance', 'angle', 'creative', 'review_theme', 'objection',
      'customer_words' then
      return coalesce(v = '{}'::jsonb, false);
    else
      return false;
  end case;
end $$;
revoke all on function private.finding_value_ok(text, jsonb) from public, anon, authenticated;

-- A run's findings, all at once, as before (20260914090055), with the
-- whole-sentence mark: a founder finding carries `whole: true` and cites
-- the About page; no other finding carries `whole`. Locks: the tenant
-- first, then the job.
create or replace function public.record_site_findings(job uuid, lease uuid, findings jsonb, pages jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; d text; f jsonb; n integer := 0; read_kinds text[]; newer boolean;
  kinds constant text[] := array['home','product','about','shipping','returns','faq'];
begin
  j := private.onboarding_lease(job, lease);
  if j.kind <> 'brand.read_site' then raise exception 'Not a site reading job' using errcode = '23514'; end if;
  d := private.site_domain(j.input->>'domain');
  if d is null then raise exception 'Invalid site reading' using errcode = '23514'; end if;
  if live is null or jsonb_typeof(findings) is distinct from 'array' or jsonb_array_length(findings) > 200
    or jsonb_typeof(pages) is distinct from 'array' or jsonb_array_length(pages) > 8
    or exists (select 1 from jsonb_array_elements(pages) p
      where jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'url') is distinct from 'string' or length(p->>'url') > 500
        or not private.on_site(coalesce(private.https_host(p->>'url'), ''), d)
        or not (coalesce(p->>'kind', '') = any(kinds)) or coalesce(p->>'state', '') not in ('read','skipped')
        or (p ? 'reason' and (jsonb_typeof(p->'reason') <> 'string' or p->>'reason' !~ '^[a-z_]{1,40}$'))
        or (p ? 'findings' and (jsonb_typeof(p->'findings') <> 'number' or p->>'findings' !~ '^[0-9]{1,3}$'))
        or p - 'url' - 'kind' - 'state' - 'reason' - 'findings' <> '{}'::jsonb) then
    raise exception 'Invalid site reading' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct p->>'kind'), '{}') into read_kinds
    from jsonb_array_elements(pages) p where p->>'state' = 'read';
  for f in select * from jsonb_array_elements(findings) loop
    if jsonb_typeof(f) <> 'object' or jsonb_typeof(f->'topic') is distinct from 'string'
      or jsonb_typeof(f->'statement') is distinct from 'string'
      or jsonb_typeof(f->'confidence') is distinct from 'number' or (f->>'confidence')::numeric not between 0 and 1
      or coalesce(f->>'pass', '') not in ('sample','model')
      or (f ? 'model' and jsonb_typeof(f->'model') not in ('string','null'))
      or f - 'topic' - 'statement' - 'value' - 'evidence' - 'confidence' - 'pass' - 'model' <> '{}'::jsonb
      or jsonb_typeof(f->'evidence') is distinct from 'object' then
      raise exception 'Invalid finding' using errcode = '23514';
    end if;
    if not private.on_site(coalesce(private.https_host(f->'evidence'->>'url'), ''), d)
      or jsonb_typeof(f->'evidence'->'quote') is distinct from 'string' or length(f->'evidence'->>'quote') not between 1 and 300
      or not (coalesce(f->'evidence'->>'page', '') = any(read_kinds))
      or (f->'evidence') - 'url' - 'quote' - 'page' - 'whole' <> '{}'::jsonb
      -- The whole-sentence mark: on a founder's note from the About page only, and always on one.
      or (f->'evidence' ? 'whole') <> (f->>'topic' = 'founder')
      or (f->'evidence' ? 'whole' and (f->'evidence'->'whole' <> 'true'::jsonb or coalesce(f->'evidence'->>'page', '') <> 'about')) then
      raise exception 'Invalid finding' using errcode = '23514';
    end if;
  end loop;
  -- A newer run of this site already replaced the findings: this one's are
  -- kept for the record, already replaced.
  newer := exists (select 1 from public.brand_findings b join public.job_runs r on r.tenant_id = b.tenant_id and r.id = b.run_id
    where b.tenant_id = j.tenant_id and b.source = 'site' and b.superseded_at is null and r.created_at > j.created_at);
  if cardinality(read_kinds) > 0 and not newer then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'site' and superseded_at is null
        and evidence->>'page' = any(read_kinds);
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'site', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when newer then now() end
    from jsonb_array_elements(findings) e;
  get diagnostics n = row_count;
  update public.job_runs
    set status = 'succeeded', lease_token = null, lease_until = null, error_code = null, updated_at = now(),
        checkpoint = jsonb_build_object('pages', pages, 'findings', n, 'live', live)
    where id = j.id;
  return jsonb_build_object('findings', n, 'pages', jsonb_array_length(pages));
end $$;
revoke all on function public.record_site_findings(uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_site_findings(uuid, uuid, jsonb, jsonb, boolean) to service_role;
