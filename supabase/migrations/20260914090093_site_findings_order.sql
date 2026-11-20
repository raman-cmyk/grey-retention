-- ONB-SITEb: an older site read that finishes late never replaces a newer
-- read's findings, and loses nothing the newer read did not read.
--
-- A site read replaces the current site findings from the kinds of page
-- it read (20260914090055). Reads can finish out of order: a read started
-- earlier may finish after a newer one (a retry, a slow page). Until now
-- such a late read stored all its findings already replaced as soon as
-- any newer read had current findings, even for kinds of page the newer
-- read never read: those facts waited for the next read.
--
-- The rule now, for each kind of page the late read read:
--
-- * a newer read (started later, of the same workspace) that has
--   finished and read that kind of page wins: the late read's findings
--   from it are kept for the record, already replaced, and it replaces
--   nothing of that kind;
-- * no newer read read it: the late read's findings from it are current,
--   and replace the earlier ones of that kind, as an in-order read would.
--
-- "Read" is what each finished read recorded on its job (its `pages`, the
-- ones marked `read`), so a newer read that read a page and found nothing
-- there still wins over an older read's findings from it, as it would
-- have had the older one finished first. The outcome is the same in any
-- order the reads finish: for each kind of page, the newest read of it.
--
-- Only this rule changes; everything else as before (20260914090089).
-- Locks: the tenant first, then the job (`private.onboarding_lease`, which
-- also refuses a lost lease with PT409). RLS unchanged.

-- A run's findings, all at once, as before (20260914090089), with the
-- order rule above. Locks: the tenant first, then the job.
create or replace function public.record_site_findings(job uuid, lease uuid, findings jsonb, pages jsonb, live boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.job_runs; d text; f jsonb; n integer := 0; read_kinds text[]; taken text[]; fresh text[];
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
  -- The kinds of page a newer read of the site has already read (the pages
  -- it recorded as read when it finished): this run's findings from them
  -- are kept for the record, already replaced. The tenant lock (taken by
  -- the lease) keeps another read from recording meanwhile.
  select coalesce(array_agg(distinct p->>'kind'), '{}') into taken
    from public.job_runs r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.checkpoint->'pages') = 'array'
        then r.checkpoint->'pages' else '[]'::jsonb end) p
    where r.tenant_id = j.tenant_id and r.kind = 'brand.read_site' and r.status = 'succeeded'
      and r.created_at > j.created_at and jsonb_typeof(p) = 'object' and p->>'state' = 'read';
  -- The kinds only this run read since: it replaces the earlier findings from them.
  select coalesce(array_agg(k), '{}') into fresh from unnest(read_kinds) k where not (k = any(taken));
  if cardinality(fresh) > 0 then
    update public.brand_findings set superseded_at = now()
      where tenant_id = j.tenant_id and source = 'site' and superseded_at is null
        and evidence->>'page' = any(fresh);
  end if;
  insert into public.brand_findings(tenant_id, run_id, source, topic, statement, value, evidence, confidence, pass, model,
      superseded_at)
    select j.tenant_id, j.id, 'site', e->>'topic', e->>'statement', coalesce(e->'value', '{}'::jsonb), e->'evidence',
      round((e->>'confidence')::numeric, 2), e->>'pass', left(nullif(btrim(coalesce(e->>'model', '')), ''), 100),
      case when e->'evidence'->>'page' = any(taken) then now() end
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
