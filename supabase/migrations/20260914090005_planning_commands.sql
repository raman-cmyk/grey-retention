alter table public.calendar_plans add constraint calendar_plan_tenant_id unique(tenant_id,id);
alter table public.campaign_sequences add constraint sequence_plan_tenant foreign key(tenant_id,plan_id) references public.calendar_plans(tenant_id,id);
alter table public.campaigns add constraint campaign_sequence_tenant foreign key(tenant_id,sequence_id) references public.campaign_sequences(tenant_id,id),add constraint campaign_superseded_tenant foreign key(tenant_id,superseded_by_plan) references public.calendar_plans(tenant_id,id);
alter table public.campaign_rejections add constraint rejection_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
alter table public.owner_rules add constraint rule_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id),add constraint rule_sequence_tenant foreign key(tenant_id,sequence_id) references public.campaign_sequences(tenant_id,id),add constraint rule_audience_tenant foreign key(tenant_id,audience_id) references public.audiences(tenant_id,id);
create or replace function private.learning_ready(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.brand_profiles b where b.tenant_id=t and b.approved_revision=b.revision)
 and exists(select 1 from public.workspace_connections c where c.tenant_id=t and c.provider='klaviyo' and c.status='connected')
 and exists(select 1 from public.offers o where o.tenant_id=t and o.starts_at<=now() and o.ends_at>now())
 and (select count(*) from public.assets a where a.tenant_id=t and a.category is not null and a.category<>'unusable')>=20
 and (select count(*) from public.competitor_subscriptions s join public.competitor_captures c on c.id=s.capture_id where s.tenant_id=t and s.active and c.status='live' and (select count(*) from public.competitor_emails e where e.capture_id=c.id)>=10)>=3;
$$;
create or replace function private.assert_campaign_guards(c public.campaigns,include_plan uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare p public.planning_preferences;o public.offers;total integer;discounted integer;
begin
 if c.superseded_by_plan is not null then raise exception 'Superseded plan entry' using errcode='23514';end if;
 if c.planned_at<=now() or c.audience_id is null or not exists(select 1 from public.audiences a where a.id=c.audience_id and a.tenant_id=c.tenant_id and cardinality(a.excluded_provider_ids)>0) then raise exception 'Future date and authorized audience with exclusions required' using errcode='23514';end if;
 if not exists(select 1 from public.brand_profiles b where b.tenant_id=c.tenant_id and b.approved_revision=b.revision) then raise exception 'Approve current brand context' using errcode='23514';end if;
 if c.lineage->>'source'='rolling_fixture' and not private.learning_ready(c.tenant_id) then raise exception 'Complete fixture readiness before generated-entry approval' using errcode='23514';end if;
 if c.product_id is not null and not exists(select 1 from public.products x where x.id=c.product_id and x.tenant_id=c.tenant_id and x.stock>0 and x.stock_observed_at>=now()-interval '24 hours') then raise exception 'Fresh in-stock product evidence required' using errcode='23514';end if;
 if c.offer_id is not null then select * into o from public.offers where id=c.offer_id and tenant_id=c.tenant_id;
  if not found or o.starts_at>c.planned_at or o.ends_at<=c.planned_at then raise exception 'Offer invalid at send time' using errcode='23514';end if;
 end if;
 select * into p from public.planning_preferences where tenant_id=c.tenant_id;
 select count(*)+1,count(*) filter(where coalesce(off.depth_percent,0)>0)+case when coalesce(o.depth_percent,0)>0 then 1 else 0 end into total,discounted
 from public.campaigns other left join public.offers off on off.id=other.offer_id
 where other.tenant_id=c.tenant_id and other.id<>c.id and other.superseded_by_plan is null and other.calendar_state<>'rejected'
 and (other.calendar_state='approved' or other.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') or (include_plan is not null and other.lineage->>'planId'=include_plan::text))
 and other.audience_id=c.audience_id and date_trunc('week',other.planned_at at time zone c.timezone)=date_trunc('week',c.planned_at at time zone c.timezone);
 if total>coalesce(p.weekly_cap,5) then raise exception 'Weekly cadence cap exceeded' using errcode='23514';end if;
 if discounted*100>total*coalesce(p.discount_cap,40) then raise exception 'Discounted-send share exceeds policy' using errcode='23514';end if;
 if o.kind='sitewide' and exists(select 1 from public.campaigns other join public.offers off on off.id=other.offer_id where other.tenant_id=c.tenant_id and other.id<>c.id and off.kind='sitewide' and other.calendar_state<>'rejected' and other.superseded_by_plan is null and (other.calendar_state='approved' or (include_plan is not null and other.lineage->>'planId'=include_plan::text)) and abs(extract(epoch from other.planned_at-c.planned_at))<coalesce(p.sitewide_gap,7)*86400) then raise exception 'Distinct sitewide campaigns need at least seven days spacing' using errcode='23514';end if;
 if exists(select 1 from public.owner_rules r where r.tenant_id=c.tenant_id and r.active and ((r.scope='single' and r.campaign_id=c.id) or (r.scope='sequence' and r.sequence_id=c.sequence_id) or (r.scope='audience' and r.audience_id=c.audience_id)) and position(lower(r.forbidden_phrase) in lower(c.title||' '||c.goal))>0) then raise exception 'Owner standing prohibition blocks this entry' using errcode='23514';end if;
end $$;
create or replace function private.current_copy_errors(c public.campaigns,v public.campaign_content) returns text[] language plpgsql security definer set search_path='' as $$
declare errors text[]:='{}';text text;b public.brand_profiles;o public.offers;matches text[];r record;
begin
 if v.id is null or coalesce(length(trim(v.body)),0)<1 or coalesce(length(trim(v.subject)),0)<1 or coalesce(length(trim(v.cta)),0)<1 or v.primary_url !~ '^https://' then return array['copy_or_https_missing'];end if;
 select * into b from public.brand_profiles where tenant_id=c.tenant_id;
 if b.approved_revision is distinct from b.revision then errors:=array_append(errors,'brand_unapproved');end if;
 if c.calendar_state<>'approved' then errors:=array_append(errors,'calendar_unapproved');end if;
 if c.offer_id is not null then select * into o from public.offers where id=c.offer_id and tenant_id=c.tenant_id;end if;
 text:=v.subject||' '||v.preheader||' '||v.body||' '||v.cta;
 for matches in select regexp_matches(text,'([0-9]+(?:\.[0-9]+)?)\s*%','g') loop
  if o.id is null or (matches[1])::numeric>o.depth_percent or o.starts_at>c.planned_at or o.ends_at<=c.planned_at then errors:=array_append(errors,'unverified_discount');end if;
 end loop;
 for matches in select regexp_matches(text,'([0-9]{4}-[0-9]{2}-[0-9]{2})','g') loop
  if o.id is null or matches[1]<>to_char(o.ends_at at time zone c.timezone,'YYYY-MM-DD') then errors:=array_append(errors,'unverified_deadline');end if;
 end loop;
 if text ~* '\m(cure|guaranteed results|clinically proven)\M' then errors:=array_append(errors,'unsupported_claim');end if;
 for r in select forbidden_phrase from public.owner_rules where tenant_id=c.tenant_id and active and ((scope='single' and campaign_id=c.id) or (scope='sequence' and sequence_id=c.sequence_id) or (scope='audience' and audience_id=c.audience_id)) loop
  if position(lower(r.forbidden_phrase) in lower(text))>0 then errors:=array_append(errors,'owner_prohibition');end if;
 end loop;
 if cardinality(v.subject_options) not in (1,3) then errors:=array_append(errors,'subject_options_invalid');end if;
 return array(select distinct unnest(errors));
end $$;
create or replace function private.validate_copy_version() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;b public.brand_profiles;
begin
 select * into c from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id;
 select * into b from public.brand_profiles where tenant_id=new.tenant_id;
 new.input_revisions:=jsonb_build_object('brand',b.revision,'calendar',c.calendar_revision,'offer',(select revision from public.offers where id=c.offer_id),'stockObservedAt',(select stock_observed_at from public.products where id=c.product_id));
 new.verified_claims:=jsonb_build_array(jsonb_build_object('kind','brand_name','value',b.brand_name,'brandRevision',b.revision));
 if new.body='' and new.subject='' then new.validation_state:='pending';new.validation_errors:='{}';
 else new.validation_errors:=private.current_copy_errors(c,new);new.validation_state:=case when cardinality(new.validation_errors)=0 then 'passed' else 'blocked' end;end if;
 return new;
end $$;
create trigger copy_validation before insert on public.campaign_content for each row execute function private.validate_copy_version();
-- Existing fixture content is evaluated from the same immutable rows at approval; this migration does not rewrite history.
create or replace function public.approve_calendar(t uuid,target_id uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=target_id and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.calendar_revision is distinct from expected_revision then raise exception 'Stale calendar revision' using errcode='40001';end if;
 perform private.assert_campaign_guards(c);
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'calendar',c.calendar_revision,auth.uid()) on conflict do nothing;
 update public.campaigns set calendar_state='approved',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'calendar_approved',jsonb_build_object('revision',c.calendar_revision));
end $$;
create or replace function public.approve_copy(t uuid,campaign uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;errors text[];
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_revision then raise exception 'Stale copy revision' using errcode='40001';end if;
 if c.copy_state not in ('pending_approval','approved') then raise exception 'Copy not ready' using errcode='23514';end if;
 perform private.assert_campaign_guards(c);
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 errors:=private.current_copy_errors(c,v);
 if cardinality(errors)>0 or (v.input_revisions->>'brand')::integer is distinct from (select revision from public.brand_profiles where tenant_id=t) then raise exception 'Copy validation blocked: %',array_to_string(errors,', ') using errcode='23514';end if;
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'copy',expected_revision,auth.uid()) on conflict do nothing;
 update public.campaigns set copy_state='approved',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'copy_approved',jsonb_build_object('revision',expected_revision));
end $$;
create or replace function public.set_planning_preferences(t uuid,expected_revision integer,weekly integer,discounted integer,gap integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if not exists(select 1 from public.planning_preferences where tenant_id=t) and expected_revision is distinct from 1 then raise exception 'Stale planning policy' using errcode='40001';end if;
 if exists(select 1 from public.campaigns where tenant_id=t and delivery_state in ('queued','preparing','prepared','scheduling','scheduled','reconciling')) then raise exception 'Cancel or reconcile active delivery before changing policy' using errcode='23514';end if;
 insert into public.planning_preferences(tenant_id,revision,weekly_cap,discount_cap,sitewide_gap,updated_by) values(t,1,weekly,discounted,gap,auth.uid()) on conflict(tenant_id) do update set revision=public.planning_preferences.revision+1,weekly_cap=excluded.weekly_cap,discount_cap=excluded.discount_cap,sitewide_gap=excluded.sitewide_gap,updated_by=excluded.updated_by,updated_at=now() where public.planning_preferences.revision=expected_revision;
 if not found then raise exception 'Stale planning policy' using errcode='40001';end if;
end $$;
create or replace function public.enqueue_plan(t uuid,starts_at timestamptz,audience uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.brand_profiles;p public.playbooks;pref public.planning_preferences;j uuid;input jsonb;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if not private.learning_ready(t) then raise exception 'Complete fixture readiness before rolling planning' using errcode='23514';end if;
 if starts_at<=now() or starts_at>now()+interval '31 days' or not exists(select 1 from public.audiences where tenant_id=t and id=audience) then raise exception 'Valid near-term range and authorized audience required' using errcode='23514';end if;
 select * into b from public.brand_profiles where tenant_id=t;
 select * into p from public.playbooks where tenant_id=t and brand_revision=b.revision order by revision desc limit 1;
 if not found then raise exception 'Current evidence-linked playbook required' using errcode='23514';end if;
 if exists(select 1 from jsonb_each(p.subscription_revisions) r where not exists(select 1 from public.competitor_subscriptions s where s.id=r.key::uuid and s.tenant_id=t and s.active and s.revision=r.value::text::integer)) then raise exception 'Playbook subscription context changed; synthesize again' using errcode='23514';end if;
 select id into j from public.job_runs where tenant_id=t and kind='calendar.plan' and status in ('queued','running','leased','retry_wait') limit 1;
 if j is not null then
 if not exists(select 1 from public.job_runs queued where queued.id=j and (queued.input->>'startsAt')::timestamptz=starts_at and queued.input->>'audienceId'=audience::text) then raise exception 'Another plan range is already queued' using errcode='23514';end if;return j;end if;
 insert into public.planning_preferences(tenant_id,updated_by) values(t,auth.uid()) on conflict(tenant_id) do nothing;
 update public.planning_preferences set generation=generation+1 where tenant_id=t returning * into pref;
 input:=jsonb_build_object('startsAt',starts_at,'audienceId',audience,'brandRevision',b.revision,'playbookId',p.id,'preferenceRevision',pref.revision,'generation',pref.generation,'ruleVersions',(select coalesce(jsonb_object_agg(id::text,revision),'{}') from public.owner_rules where tenant_id=t and active));
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'calendar.plan','plan:'||pref.generation,input,auth.uid()) returning id into j;return j;
end $$;
create or replace function public.finish_plan_job(job uuid,lease uuid,output jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.job_runs;pref public.planning_preferences;b public.brand_profiles;p public.playbooks;plan uuid;x jsonb;c public.campaigns;sequence uuid;entry_ids uuid[]:='{}';
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 if j.kind<>'calendar.plan' or (output->>'synthetic')::boolean is distinct from true or jsonb_typeof(output->'entries') is distinct from 'array' or jsonb_array_length(output->'entries')>30 then raise exception 'Invalid structured plan' using errcode='23514';end if;
 select * into pref from public.planning_preferences where tenant_id=j.tenant_id;
 select * into b from public.brand_profiles where tenant_id=j.tenant_id;
 select * into p from public.playbooks where id=(j.input->>'playbookId')::uuid and tenant_id=j.tenant_id;
 if not private.learning_ready(j.tenant_id) or b.revision is distinct from (j.input->>'brandRevision')::integer or pref.revision is distinct from (j.input->>'preferenceRevision')::integer or pref.generation is distinct from (j.input->>'generation')::integer or p.brand_revision is distinct from b.revision then raise exception 'Planning inputs changed' using errcode='40001';end if;
 if j.input->'ruleVersions' is distinct from (select coalesce(jsonb_object_agg(id::text,revision),'{}') from public.owner_rules where tenant_id=j.tenant_id and active) then raise exception 'Owner rules changed' using errcode='40001';end if;
 insert into public.calendar_plans(tenant_id,starts_at,input_revisions,lineage,synthetic,created_by) values(j.tenant_id,(j.input->>'startsAt')::timestamptz,j.input,jsonb_build_object('source','rolling_fixture','playbookId',p.id,'evidenceIds',to_jsonb(p.evidence_ids)),true,j.created_by) returning id into plan;
 -- Preserve approved entries and all prior rows/history; only supersede previous unapproved rolling drafts in range.
 update public.campaigns set superseded_by_plan=plan,calendar_state='rejected',updated_at=now() where tenant_id=j.tenant_id and lineage->>'source'='rolling_fixture' and calendar_state='proposed' and superseded_by_plan is null and planned_at>=(j.input->>'startsAt')::timestamptz and planned_at<(j.input->>'startsAt')::timestamptz+interval '30 days';
 for x in select value from jsonb_array_elements(output->'entries') loop
  if (x->>'plannedAt')::timestamptz<(j.input->>'startsAt')::timestamptz or (x->>'plannedAt')::timestamptz>=(j.input->>'startsAt')::timestamptz+interval '30 days' or (x->>'audienceId')::uuid is distinct from (j.input->>'audienceId')::uuid then raise exception 'Entry outside planned range/audience' using errcode='23514';end if;
  sequence:=null;
  if nullif(x->>'sequenceKey','') is not null then
   insert into public.campaign_sequences(tenant_id,plan_id,key,brief) values(j.tenant_id,plan,x->>'sequenceKey','Original educational sequence: opening then detail. No implied discount, deadline or borrowed creative.') on conflict(plan_id,key) do update set key=excluded.key returning id into sequence;
  end if;
  insert into public.campaigns(tenant_id,title,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,reference_notes,sequence_id,sequence_position,created_by,synthetic,lineage)
  values(j.tenant_id,x->>'title',x->>'goal',x->>'channel',(x->>'plannedAt')::timestamptz,(select timezone from public.tenants where id=j.tenant_id),(x->>'audienceId')::uuid,nullif(x->>'productId','')::uuid,nullif(x->>'offerId','')::uuid,x->>'referenceNotes',sequence,nullif(x->>'sequencePosition','')::integer,j.created_by,true,jsonb_build_object('source','rolling_fixture','planId',plan,'brandRevision',b.revision,'playbookId',p.id,'evidenceIds',to_jsonb(p.evidence_ids),'ruleVersions',j.input->'ruleVersions','productIds',case when nullif(x->>'productId','') is null then '[]'::jsonb else jsonb_build_array(x->>'productId') end,'offerRevision',(select revision from public.offers where id=nullif(x->>'offerId','')::uuid))) returning * into c;
  entry_ids:=array_append(entry_ids,c.id);
  insert into public.campaign_content(tenant_id,campaign_id,revision,created_by) values(j.tenant_id,c.id,1,j.created_by);
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(j.tenant_id,c.id,j.created_by,'fixture_plan_proposed',jsonb_build_object('planId',plan));
 end loop;
 for c in select * from public.campaigns where id=any(entry_ids) loop perform private.assert_campaign_guards(c,plan);end loop;
 update public.calendar_plans set lineage=lineage||jsonb_build_object('entryRevisions',(select jsonb_agg(jsonb_build_object('campaignId',id,'calendarRevision',calendar_revision)) from public.campaigns where id=any(entry_ids))) where id=plan;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('planId',plan,'entries',cardinality(entry_ids),'synthetic',true),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 perform private.notify_owners(j.tenant_id,'calendar_review',plan,'A guarded synthetic rolling plan is ready. Review exact entries before owner approval.');return plan;
end $$;
create or replace function public.approve_plan(t uuid,plan uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;p public.calendar_plans;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into p from public.calendar_plans where tenant_id=t and id=plan;
 if not exists(select 1 from public.calendar_plans where tenant_id=t and id=plan) then raise exception 'Plan unavailable' using errcode='42501';end if;
 for c in select * from public.campaigns where tenant_id=t and lineage->>'planId'=plan::text and superseded_by_plan is null and calendar_state='proposed' order by id for update loop
  if not exists(select 1 from jsonb_array_elements(p.lineage->'entryRevisions') x where x->>'campaignId'=c.id::text and (x->>'calendarRevision')::integer=c.calendar_revision) then raise exception 'Plan review stale; approve edited entries individually' using errcode='40001';end if;
  perform private.assert_campaign_guards(c,plan);
  insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'calendar',c.calendar_revision,auth.uid()) on conflict do nothing;
  update public.campaigns set calendar_state='approved',updated_at=now() where id=c.id;
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'calendar_approved',jsonb_build_object('revision',c.calendar_revision,'planId',plan));
 end loop;
end $$;
create or replace function public.queue_weekly_copy(t uuid,week date) returns integer language plpgsql security definer set search_path='' as $$
declare c public.campaigns;total integer:=0;tz text;
begin
 perform private.require_member(t,true);select timezone into tz from public.tenants where id=t;
 for c in select * from public.campaigns where tenant_id=t and calendar_state='approved' and superseded_by_plan is null and copy_state in ('draft','rejected') and date_trunc('week',planned_at at time zone tz)::date=date_trunc('week',week)::date loop
  perform public.enqueue_copy(t,c.id,c.copy_revision);total:=total+1;
 end loop;return total;
end $$;
create or replace function public.prepare_copy_review(t uuid,week date) returns uuid language plpgsql security definer set search_path='' as $$
declare revisions jsonb;tz text;result uuid;
begin
 perform private.require_member(t,true);select timezone into tz from public.tenants where id=t;
 select coalesce(jsonb_agg(jsonb_build_object('campaignId',c.id,'calendarRevision',c.calendar_revision,'copyRevision',c.copy_revision,'contentId',v.id) order by c.planned_at),'[]') into revisions from public.campaigns c join public.campaign_content v on v.campaign_id=c.id and v.revision=c.copy_revision where c.tenant_id=t and c.calendar_state='approved' and c.copy_state='pending_approval' and c.superseded_by_plan is null and date_trunc('week',c.planned_at at time zone tz)::date=date_trunc('week',week)::date;
 if jsonb_array_length(revisions)=0 then raise exception 'No pending copy versions in this week' using errcode='23514';end if;
 insert into public.copy_review_batches(tenant_id,week_start,timezone,revisions,created_by) values(t,date_trunc('week',week)::date,tz,revisions,auth.uid()) returning id into result;return result;
end $$;
create or replace function public.approve_copy_batch(t uuid,batch uuid) returns integer language plpgsql security definer set search_path='' as $$
declare b public.copy_review_batches;x jsonb;c public.campaigns;total integer:=0;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into b from public.copy_review_batches where id=batch and tenant_id=t and created_by=auth.uid() for update;
 if not found then raise exception 'Review batch unavailable' using errcode='42501';end if;
 if b.status='approved' then return jsonb_array_length(b.revisions);end if;
 if b.expires_at<=now() then raise exception 'Review batch expired; review current versions again' using errcode='40001';end if;
 for x in select value from jsonb_array_elements(b.revisions) order by value->>'campaignId' loop
  select * into c from public.campaigns where id=(x->>'campaignId')::uuid and tenant_id=t for update;
  if not found or c.calendar_revision is distinct from (x->>'calendarRevision')::integer or c.copy_revision is distinct from (x->>'copyRevision')::integer or c.copy_state<>'pending_approval' or not exists(select 1 from public.campaign_content where id=(x->>'contentId')::uuid and campaign_id=c.id and revision=c.copy_revision) then raise exception 'Batch stale; no unseen version was approved' using errcode='40001';end if;
  perform public.approve_copy(t,c.id,c.copy_revision);total:=total+1;
 end loop;
 update public.copy_review_batches set status='approved',approved_at=now() where id=b.id;return total;
end $$;
create or replace function public.reject_campaign_version(t uuid,campaign uuid,kind text,expected_revision integer,reason text,scope text,forbidden_phrase text default '') returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if kind not in ('calendar','copy') or scope not in ('single','sequence','audience') or length(reason) not between 5 and 5000 or length(forbidden_phrase)>200 or (scope='sequence' and c.sequence_id is null) or (scope='audience' and c.audience_id is null) then raise exception 'Valid rejection and explicit scope required' using errcode='23514';end if;
 if expected_revision is distinct from (case when kind='calendar' then c.calendar_revision else c.copy_revision end) then raise exception 'Stale rejected version' using errcode='40001';end if;
 if c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Cancel or reconcile delivery before rejection' using errcode='23514';end if;
 insert into public.campaign_rejections(tenant_id,campaign_id,kind,revision,reason,scope,actor_id) values(t,c.id,kind,expected_revision,reason,scope,auth.uid());
 if forbidden_phrase<>'' then insert into public.owner_rules(tenant_id,campaign_id,sequence_id,audience_id,scope,forbidden_phrase,created_by) values(t,case when scope='single' then c.id end,case when scope='sequence' then c.sequence_id end,case when scope='audience' then c.audience_id end,scope,forbidden_phrase,auth.uid());end if;
 update public.campaigns set calendar_state=case when kind='calendar' then 'rejected' else calendar_state end,copy_state='rejected',design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 update public.designer_assignments set state='cancelled' where campaign_id=c.id and state in ('assigned','submitted','revisions_requested');
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'owner_rejected',jsonb_build_object('kind',kind,'revision',expected_revision,'scope',scope));
end $$;
create or replace function public.enqueue_review_reminders(t uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid;input jsonb;
begin
 perform private.require_member(t,true);
 select jsonb_build_object('versions',coalesce(jsonb_agg(jsonb_build_object('campaignId',c.id,'copyRevision',c.copy_revision)),'[]')) into input from public.campaigns c join public.campaign_content v on v.campaign_id=c.id and v.revision=c.copy_revision where c.tenant_id=t and c.copy_state='pending_approval' and v.created_at<=now()-interval '24 hours';
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'reviews.remind','reminders:'||encode(extensions.digest(input::text,'sha256'),'hex'),input,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create or replace function public.finish_reminder_job(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;x jsonb;
begin
 j:=private.onboarding_lease(job,lease);if j.kind<>'reviews.remind' then raise exception 'Wrong reminder job' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(j.input->'versions') loop
 if exists(select 1 from public.campaigns where id=(x->>'campaignId')::uuid and tenant_id=j.tenant_id and copy_revision=(x->>'copyRevision')::integer and copy_state='pending_approval') then perform private.notify_owners(j.tenant_id,'copy_reminder',(x->>'campaignId')::uuid,'An exact copy version is awaiting owner review. Reminder email is simulated; silence does not approve designs.');end if;
 end loop;
 update public.job_runs set status='succeeded',lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
revoke all on function private.learning_ready(uuid),private.assert_campaign_guards(public.campaigns,uuid),private.current_copy_errors(public.campaigns,public.campaign_content),private.validate_copy_version() from public,anon,authenticated;
do $$ declare f text; begin foreach f in array array['public.set_planning_preferences(uuid,integer,integer,integer,integer)','public.enqueue_plan(uuid,timestamptz,uuid)','public.finish_plan_job(uuid,uuid,jsonb)','public.approve_plan(uuid,uuid)','public.queue_weekly_copy(uuid,date)','public.prepare_copy_review(uuid,date)','public.approve_copy_batch(uuid,uuid)','public.reject_campaign_version(uuid,uuid,text,integer,text,text,text)','public.enqueue_review_reminders(uuid)','public.finish_reminder_job(uuid,uuid)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;

create or replace function public.create_delivery_package(t uuid,campaign uuid,expected_revision integer,settings jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;s public.designer_submissions;a public.designer_assignments;b public.brand_profiles;aud public.audiences;
 package uuid;new_revision integer;calendar_approval uuid;copy_approval uuid;design_approval uuid;snapshot jsonb;rendered text;
begin
 perform private.require_member(t,true);
 perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 perform private.assert_campaign_guards(c);
 if c.delivery_revision is distinct from expected_revision then raise exception 'Stale delivery revision' using errcode='40001';end if;
 if c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Delivery active' using errcode='23514';end if;
 if c.calendar_state<>'approved' or c.copy_state<>'approved' or c.design_state<>'owner_approved' then raise exception 'Owner approvals required' using errcode='23514';end if;
 if c.planned_at<=now() then raise exception 'Schedule is in the past' using errcode='23514';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 if cardinality(private.current_copy_errors(c,v))>0 then raise exception 'Copy validation blocked' using errcode='23514';end if;
 select * into a from public.designer_assignments where campaign_id=c.id and state='approved';
 select * into s from public.designer_submissions where assignment_id=a.id and revision=c.design_revision and copy_revision=c.copy_revision;
 if s.id is null or not exists(select 1 from storage.objects o where o.bucket_id='designer-submissions' and o.name=s.storage_path) then raise exception 'Current approved artifact unavailable' using errcode='23514';end if;
 select * into b from public.brand_profiles where tenant_id=t;
 if b.approved_revision is distinct from b.revision then raise exception 'Brand context requires approval' using errcode='23514';end if;
 if c.product_id is not null and not exists(select 1 from public.products p where p.id=c.product_id and p.stock>0 and p.stock_observed_at>now()-interval '24 hours') then raise exception 'Stock unavailable or stale' using errcode='23514';end if;
 if c.offer_id is not null and not exists(select 1 from public.offers o where o.id=c.offer_id and c.planned_at between o.starts_at and o.ends_at) then raise exception 'Offer expired' using errcode='23514';end if;
 select * into aud from public.audiences where id=c.audience_id and tenant_id=t;
 if aud.id is null or cardinality(aud.excluded_provider_ids)=0 then raise exception 'Audience and exclusions required' using errcode='23514';end if;
 if v.primary_url !~ '^https://' or char_length(coalesce(settings->>'address',''))<5 or coalesce(settings->>'unsubscribeUrl','') !~ '^https://' or coalesce(settings->>'privacyUrl','') !~ '^https://' or char_length(coalesce(settings->>'senderName',''))<1 or coalesce(settings->>'senderEmail','') !~ '^[^@ ]+@[^@ ]+\.[^@ ]+$' then raise exception 'Footer, HTTPS links and sender required' using errcode='23514';end if;
 select id into calendar_approval from public.campaign_approvals where campaign_id=c.id and kind='calendar' and revision=c.calendar_revision;
 select id into copy_approval from public.campaign_approvals where campaign_id=c.id and kind='copy' and revision=c.copy_revision;
 select id into design_approval from public.campaign_approvals where campaign_id=c.id and kind='design' and revision=c.design_revision;
 if calendar_approval is null or copy_approval is null or design_approval is null then raise exception 'Current approval records required' using errcode='23514';end if;
 package:=gen_random_uuid();new_revision:=c.delivery_revision+1;
 -- Render from approved sources inside the trusted transaction; never accept caller HTML.
 rendered:='<html><body><main><h1>'||private.escape_html(v.subject)||'</h1><p>'||private.escape_html(v.preheader)||'</p>'||case when c.channel='email_design' then '<img src="cid:design-artifact" width="600" alt="Owner-approved campaign design">' else '' end||'<p style="white-space:pre-wrap">'||private.escape_html(v.body)||'</p><a href="'||private.escape_html(v.primary_url)||'">'||private.escape_html(v.cta)||'</a></main><footer><p>'||private.escape_html(settings->>'address')||'</p><a href="'||private.escape_html(settings->>'unsubscribeUrl')||'">Unsubscribe</a> · <a href="'||private.escape_html(settings->>'privacyUrl')||'">Privacy</a></footer></body></html>';
 snapshot:=jsonb_build_object('schemaVersion',1,'id',package,'tenantId',t,'campaignId',c.id,'revision',new_revision,'channel',c.channel,
 'subject',v.subject,'preheader',v.preheader,'text',v.body,'html',rendered,'assetPaths',jsonb_build_array(s.storage_path),
 'links',jsonb_build_array(v.primary_url,settings->>'unsubscribeUrl',settings->>'privacyUrl'),'footer',jsonb_build_object('address',settings->>'address','unsubscribeUrl',settings->>'unsubscribeUrl','privacyUrl',settings->>'privacyUrl'),
 'audience',jsonb_build_object('accountId',aud.account_id,'includes',jsonb_build_array(aud.provider_id),'excludes',to_jsonb(aud.excluded_provider_ids)),
 'sender',jsonb_build_object('name',settings->>'senderName','email',settings->>'senderEmail'),'scheduledAt',to_char(c.planned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timezone',c.timezone,
 'approvals',jsonb_build_object('calendar',calendar_approval,'copy',copy_approval,'design',design_approval),'sourceRevisions',jsonb_build_object('calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision),
 'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'synthetic',true);
 insert into public.delivery_packages(id,tenant_id,campaign_id,revision,snapshot,created_by) values(package,t,c.id,new_revision,snapshot,auth.uid());
 update public.campaigns set delivery_revision=new_revision,delivery_state='ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'package_validated_fixture',jsonb_build_object('packageId',package,'revision',new_revision));return package;
end $$;
create or replace function private.push_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;
begin
 if new.state in ('prepared','scheduled') and (tg_op='INSERT' or old.state is distinct from new.state or old.scheduled_at is distinct from new.scheduled_at) then
  select campaign.* into c from public.campaigns campaign join public.delivery_packages p on p.campaign_id=campaign.id where p.id=new.package_id and p.tenant_id=new.tenant_id for update of campaign;
  perform private.assert_campaign_guards(c);
  select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
  if c.copy_state<>'approved' or c.design_state<>'owner_approved' or cardinality(private.current_copy_errors(c,v))>0 then raise exception 'Current owner approvals and copy validation required at push' using errcode='23514';end if;
 end if;return new;
end $$;
create trigger fixture_push_guard before insert or update on public.fixture_deliveries for each row execute function private.push_guard();
revoke all on function private.push_guard() from public,anon,authenticated;
