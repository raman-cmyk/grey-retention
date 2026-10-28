-- Send analysis is frozen before the first provider operation, not reconstructed from later edits.
create function private.capture_send_metadata() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;b public.brand_profiles;v public.campaign_content;key jsonb;
begin
 select * into c from public.campaigns where id=new.campaign_id and tenant_id=new.tenant_id;
 select * into b from public.brand_profiles where tenant_id=new.tenant_id;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 key:=jsonb_build_object('channel',c.channel,'audience',new.snapshot->'audience','brandRevision',b.revision,'productId',c.product_id,'offerKind',coalesce((select kind from public.offers where id=c.offer_id),'none'),'sequencePosition',c.sequence_position);
 insert into public.campaign_send_metadata(package_id,tenant_id,campaign_id,subject_group,comparison_key,snapshot) values(new.id,new.tenant_id,c.id,case when length(v.subject)<=40 then 'short' else 'detailed' end,key,jsonb_build_object('title',c.title,'goal',c.goal,'subject',v.subject,'contentId',v.id,'lineage',c.lineage,'copyInputs',v.input_revisions,'calendarRevision',c.calendar_revision,'copyRevision',c.copy_revision,'designRevision',c.design_revision,'deliveryRevision',new.revision,'designSource',coalesce((select source from public.design_renders where campaign_id=c.id and revision=c.design_revision),'human'),'plannedAt',c.planned_at,'timezone',c.timezone,'offerId',c.offer_id,'sequenceId',c.sequence_id,'sequencePosition',c.sequence_position,'approvals',new.snapshot->'approvals','synthetic',true));return new;
end $$;
create trigger send_metadata_before_provider after insert on public.delivery_packages for each row execute function private.capture_send_metadata();
-- Backfill only previously verified local packages; all future packages use the transactional trigger.
insert into public.campaign_send_metadata(package_id,tenant_id,campaign_id,subject_group,comparison_key,snapshot)
select p.id,p.tenant_id,p.campaign_id,case when length(p.snapshot->>'subject')<=40 then 'short' else 'detailed' end,jsonb_build_object('channel',p.snapshot->>'channel','audience',p.snapshot->'audience','historical',true),jsonb_build_object('title',c.title,'subject',p.snapshot->>'subject','approvals',p.snapshot->'approvals','synthetic',true,'historicalBackfill',true) from public.delivery_packages p join public.campaigns c on c.id=p.campaign_id on conflict do nothing;
create function private.sent_reporting_jobs() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.delivery_packages;w text;due timestamptz;
begin
 if new.state='sent' and (tg_op='INSERT' or old.state is distinct from 'sent') then
 select * into p from public.delivery_packages where id=new.package_id;
 if new.sent_at is null or not exists(select 1 from public.campaign_send_metadata where package_id=p.id) then raise exception 'Pre-send metadata and confirmed send time required' using errcode='23514';end if;
 insert into public.autopilot_streaks(tenant_id,consecutive_sends) values(new.tenant_id,1) on conflict(tenant_id) do update set consecutive_sends=public.autopilot_streaks.consecutive_sends+1,updated_at=now();
 foreach w in array array['48h','7d'] loop
 due:=new.sent_at+case when w='48h' then interval '48 hours' else interval '7 days' end;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,available_at,created_by) values(new.tenant_id,p.campaign_id,'results.pull','results:'||new.id||':'||w,jsonb_build_object('deliveryId',new.id,'window',w,'windowEnd',due,'collectedAt',due),due,p.created_by) on conflict(tenant_id,idempotency_key) do nothing;
 end loop;
 end if;return new;
end $$;
create trigger sent_result_jobs after insert or update on public.fixture_deliveries for each row execute function private.sent_reporting_jobs();
create function private.reset_autopilot_streak() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.autopilot_streaks(tenant_id,consecutive_sends,generation,last_rejection_at) values(new.tenant_id,0,2,now()) on conflict(tenant_id) do update set consecutive_sends=0,generation=public.autopilot_streaks.generation+1,last_rejection_at=now(),updated_at=now();return new;
end $$;
create trigger rejection_resets_streak after insert on public.campaign_rejections for each row execute function private.reset_autopilot_streak();
create function public.set_fixture_metrics(t uuid,delivery uuid,scenario text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if not exists(select 1 from public.fixture_deliveries where id=delivery and tenant_id=t and state='sent') then raise exception 'Confirmed fixture send required' using errcode='42501';end if;
 if exists(select 1 from public.campaign_results where delivery_id=delivery) then raise exception 'Collected windows are immutable; use another fixture send' using errcode='23514';end if;
 insert into public.fixture_metric_controls(delivery_id,tenant_id,scenario) values(delivery,t,scenario) on conflict(delivery_id) do update set scenario=excluded.scenario,updated_at=now();
end $$;
create function public.advance_results_clock(t uuid,observed_at timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;day date;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if observed_at is null or observed_at<now()-interval '1 day' or observed_at>now()+interval '3 years' then raise exception 'Explicit bounded synthetic clock required' using errcode='23514';end if;
 update public.job_runs set available_at=now(),input=input||jsonb_build_object('collectedAt',observed_at,'syntheticClock',true) where tenant_id=t and kind='results.pull' and status in ('queued','retry_wait') and (input->>'windowEnd')::timestamptz<=observed_at;get diagnostics n=row_count;
 day:=(observed_at at time zone (select timezone from public.tenants where id=t))::date;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'reports.digest','digest:'||day,jsonb_build_object('observedAt',observed_at,'localDate',day),auth.uid()) on conflict(tenant_id,idempotency_key) do nothing;return n;
end $$;
create function public.fixture_result_payload(job uuid,lease uuid,delivery uuid,window_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.job_runs;f public.fixture_deliveries;m public.campaign_send_metadata;scenario text;click_count integer;due timestamptz;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind<>'results.pull' or j.input->>'deliveryId' is distinct from delivery::text or j.input->>'window' is distinct from window_key then raise exception 'Result job identity mismatch' using errcode='40001';end if;
 select * into f from public.fixture_deliveries where id=delivery and tenant_id=j.tenant_id and state='sent';
 select * into m from public.campaign_send_metadata where package_id=f.package_id;
 if f.id is null or m.package_id is null then raise exception 'Confirmed send metadata unavailable' using errcode='23514';end if;
 due:=f.sent_at+case when window_key='48h' then interval '48 hours' else interval '7 days' end;
 if (j.input->>'collectedAt')::timestamptz<due or (j.available_at>now()) then raise exception 'Result window not mature' using errcode='23514';end if;
 select c.scenario into scenario from public.fixture_metric_controls c where c.delivery_id=f.id;scenario:=coalesce(scenario,'complete');
 click_count:=case when m.subject_group='short' then 50 else 30 end+get_byte(extensions.digest(f.id::text,'sha256'),0)%5;
 if window_key='48h' then click_count:=click_count/2;end if;
 return jsonb_build_object('deliveryId',f.id,'window',window_key,'source','fixture','windowStart',f.sent_at,'windowEnd',due,'collectedAt',(j.input->>'collectedAt')::timestamptz,'complete',scenario<>'partial','comparable',scenario<>'incomparable','recipients',1000,'clicks',click_count,'revenueMinor',click_count*400,'currency','USD','unsubscribes',2,'spam',0,'confounders',jsonb_build_array('Synthetic deterministic metrics; no measured recipients or revenue','Observational association; seasonality and selection remain uncontrolled',case when scenario='complete' then 'Fixture attribution: seven-day click revenue; unique click counts' else 'Explicit fixture '||scenario||' data' end));
end $$;
create function public.finish_result_job(job uuid,lease uuid,output jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.job_runs;expected jsonb;result uuid;
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 expected:=public.fixture_result_payload(job,lease,(j.input->>'deliveryId')::uuid,j.input->>'window');
 if output is distinct from expected then raise exception 'Fixture result payload does not match leased immutable provider context' using errcode='23514';end if;
 insert into public.campaign_results(tenant_id,delivery_id,package_id,window_key,source,window_start,window_end,collected_at,complete,comparable,recipients,clicks,revenue_minor,currency,unsubscribes,spam,confounders) select j.tenant_id,f.id,f.package_id,output->>'window','fixture',(output->>'windowStart')::timestamptz,(output->>'windowEnd')::timestamptz,(output->>'collectedAt')::timestamptz,(output->>'complete')::boolean,(output->>'comparable')::boolean,(output->>'recipients')::integer,(output->>'clicks')::integer,(output->>'revenueMinor')::bigint,'USD',(output->>'unsubscribes')::integer,(output->>'spam')::integer,output->'confounders' from public.fixture_deliveries f where f.id=(output->>'deliveryId')::uuid on conflict(delivery_id,window_key) do update set delivery_id=excluded.delivery_id returning id into result;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('resultId',result,'complete',output->'complete','source','fixture'),lease_token=null,lease_until=null,updated_at=now() where id=j.id;return result;
end $$;
create function public.finish_result_digest(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;snapshot jsonb;
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 if j.kind<>'reports.digest' then raise exception 'Digest job required' using errcode='23514';end if;
 snapshot:=jsonb_build_object('synthetic',true,'sentCount',(select count(*) from public.fixture_deliveries where tenant_id=j.tenant_id and state='sent' and sent_at<=(j.input->>'observedAt')::timestamptz),'completeSevenDayWindows',(select count(*) from public.campaign_results where tenant_id=j.tenant_id and window_key='7d' and complete and window_end<=(j.input->>'observedAt')::timestamptz),'incompleteWindows',(select count(*) from public.campaign_results where tenant_id=j.tenant_id and not complete),'syntheticRevenueMinor',(select coalesce(sum(revenue_minor),0) from public.campaign_results where tenant_id=j.tenant_id and window_key='7d' and complete and window_end<=(j.input->>'observedAt')::timestamptz),'currency','USD','attribution','Fixture seven-day click revenue; no measured sales','remainingPulls',(select count(*) from public.job_runs where tenant_id=j.tenant_id and kind='results.pull' and status<>'succeeded'));
 insert into public.result_digests(tenant_id,local_date,observed_at,snapshot) values(j.tenant_id,(j.input->>'localDate')::date,(j.input->>'observedAt')::timestamptz,snapshot) on conflict(tenant_id,local_date) do nothing;
 if found then perform private.notify_owners(j.tenant_id,'daily_results',null,'Synthetic daily digest: confirmed sends and complete/incomplete metric windows are available in Results & learning. No measured revenue or email delivery.');end if;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('synthetic',true,'localDate',j.input->>'localDate'),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
create function public.enqueue_learning(t uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid;fingerprint text;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select encode(extensions.digest(coalesce(string_agg(id::text,',' order by id),'none'),'sha256'),'hex') into fingerprint from public.campaign_results where tenant_id=t and window_key='7d';
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'learning.synthesize','learning:'||fingerprint,jsonb_build_object('source','fixture','minimumPerSide',5,'evidenceFingerprint',fingerprint),auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create function public.finish_learning_job(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;g record;evidence jsonb;preferred text;total integer:=0;hash text;
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 if j.kind<>'learning.synthesize' then raise exception 'Learning job required' using errcode='23514';end if;
 for g in
 with eligible as(select r.*,m.comparison_key,m.subject_group from public.campaign_results r join public.campaign_send_metadata m on m.package_id=r.package_id where r.tenant_id=j.tenant_id and r.window_key='7d' and r.complete and r.comparable and r.recipients>0), latest as(select comparison_key,max(window_start) as last_send from eligible group by comparison_key)
 select e.comparison_key,count(*) filter(where subject_group='short') as short_n,count(*) filter(where subject_group='detailed') as detailed_n,sum(clicks) filter(where subject_group='short')::numeric/nullif(sum(recipients) filter(where subject_group='short'),0) as short_rate,sum(clicks) filter(where subject_group='detailed')::numeric/nullif(sum(recipients) filter(where subject_group='detailed'),0) as detailed_rate,jsonb_agg(jsonb_build_object('resultId',e.id,'deliveryId',e.delivery_id,'windowStart',e.window_start,'windowEnd',e.window_end,'collectedAt',e.collected_at,'subjectGroup',e.subject_group,'recipients',e.recipients,'clicks',e.clicks,'source',e.source) order by e.id) as samples,min(e.window_start) as starts_at,max(e.window_start) as ends_at
 from eligible e join latest l using(comparison_key) where e.window_start>=l.last_send-interval '30 days' group by e.comparison_key having count(*) filter(where subject_group='short')>=5 and count(*) filter(where subject_group='detailed')>=5
 loop
 if g.short_rate=g.detailed_rate then continue;end if;
 preferred:=case when g.short_rate>g.detailed_rate then 'short' else 'detailed' end;
 evidence:=jsonb_build_object('minimumPerSide',5,'shortCount',g.short_n,'detailedCount',g.detailed_n,'shortClickRate',g.short_rate,'detailedClickRate',g.detailed_rate,'samples',g.samples,'window','7d','sendRangeStart',g.starts_at,'sendRangeEnd',g.ends_at,'source','fixture','confounders',jsonb_build_array('Deterministic synthetic rates are not measured performance','Association is not causal; uncontrolled seasonality and selection','Only same account/audience, channel, brand revision, product, offer kind and sequence position; sends within thirty days'));
 hash:=encode(extensions.digest((g.comparison_key::text||g.samples::text),'sha256'),'hex');
 insert into public.learned_rules(tenant_id,kind,preferred_group,comparison_key,evidence,evidence_hash,summary) values(j.tenant_id,'subject_length',preferred,g.comparison_key,evidence,hash,'Synthetic seven-day association favors '||preferred||' subjects. Owner may pin an advisory preference; explicit prohibitions and hard guards always win.') on conflict(tenant_id,kind,evidence_hash) do nothing;
 total:=total+1;
 end loop;
 insert into public.learning_runs(tenant_id,job_id,status,detail) values(j.tenant_id,j.id,case when total>0 then 'proposed' else 'insufficient' end,jsonb_build_object('eligibleComparisons',total,'minimumPerSide',5,'excludedIncomplete',(select count(*) from public.campaign_results where tenant_id=j.tenant_id and window_key='7d' and not complete),'excludedIncomparable',(select count(*) from public.campaign_results where tenant_id=j.tenant_id and window_key='7d' and not comparable),'explanation',case when total=0 then 'No comparison has five complete comparable campaigns per side within thirty days, or rates are tied.' else 'Existing dismissed rules remain dismissed; proposed rules have no influence until owner pins them.' end));
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('eligibleComparisons',total,'synthetic',true),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
create function public.review_learned_rule(t uuid,rule uuid,expected_revision integer,decision text) returns void language plpgsql security definer set search_path='' as $$
declare r public.learned_rules;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into r from public.learned_rules where tenant_id=t and id=rule for update;
 if r.id is null then raise exception 'Rule unavailable' using errcode='42501';end if;
 if r.revision is distinct from expected_revision then raise exception 'Stale learned rule' using errcode='40001';end if;
 if decision is null or decision not in ('pinned','dismissed') then raise exception 'Explicit rule decision required' using errcode='23514';end if;
 -- A deliberate owner re-pin is allowed; background synthesis never changes a decision.
 update public.learned_rules set status=decision,revision=revision+1,updated_at=now() where id=r.id;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'learning_'||decision,r.id,jsonb_build_object('revision',r.revision+1,'evidenceHash',r.evidence_hash));
end $$;
create function public.fixture_copy_preference(t uuid,campaign uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.campaigns;r public.learned_rules;a public.audiences;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 select * into c from public.campaigns where id=campaign and tenant_id=t;
 if c.id is null then raise exception 'Campaign unavailable' using errcode='42501';end if;
 select * into a from public.audiences where id=c.audience_id and tenant_id=t;
 select * into r from public.learned_rules where tenant_id=t and status='pinned' and comparison_key=jsonb_build_object('channel',c.channel,'audience',jsonb_build_object('accountId',a.account_id,'includes',jsonb_build_array(a.provider_id),'excludes',to_jsonb(a.excluded_provider_ids)),'brandRevision',(select revision from public.brand_profiles where tenant_id=t),'productId',c.product_id,'offerKind',coalesce((select kind from public.offers where id=c.offer_id),'none'),'sequencePosition',c.sequence_position) order by updated_at desc,id limit 1;
 return case when r.id is null then '{}'::jsonb else jsonb_build_object('ruleId',r.id,'preferredGroup',r.preferred_group,'evidenceHash',r.evidence_hash) end;
end $$;
-- Add immutable usage lineage without changing the original copy validation/approval guards.
alter function public.finish_copy_job(uuid,uuid,jsonb) set schema private;
alter function private.finish_copy_job(uuid,uuid,jsonb) rename to finish_copy_job_v1;
revoke all on function private.finish_copy_job_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.finish_copy_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;preference jsonb;
begin
 select * into j from public.job_runs where id=job;
 if j.id is null or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where id=j.tenant_id for update;
 if output ? 'learningPreference' then
 preference:=public.fixture_copy_preference(j.tenant_id,j.campaign_id);
 if output->'learningPreference' is distinct from preference then raise exception 'Pinned learning preference changed' using errcode='40001';end if;
 end if;
 perform private.finish_copy_job_v1(job,lease,output);
 if output ? 'learningPreference' then
 update public.campaign_content set input_revisions=input_revisions||jsonb_build_object('learningPreference',output->'learningPreference') where campaign_id=j.campaign_id and revision=(select copy_revision from public.campaigns where id=j.campaign_id);
 update public.ai_calls set input_revisions=input_revisions||jsonb_build_object('learningPreference',output->'learningPreference') where job_id=j.id;
 end if;
end $$;
-- Cite eligible pinned own evidence in future planning inputs; hard policy validation remains independent.
create function private.planning_learning_lineage() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='calendar.plan' then new.input:=new.input||jsonb_build_object('ownLearningRules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'evidenceHash',evidence_hash)) from public.learned_rules where tenant_id=new.tenant_id and status='pinned'),'[]'::jsonb));end if;return new;
end $$;
create trigger planning_own_evidence before insert on public.job_runs for each row execute function private.planning_learning_lineage();
create function public.save_l2_simulation_policy(t uuid,expected_revision integer,enabled boolean,required_sends integer default 10) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if expected_revision is distinct from coalesce((select revision from public.l2_simulation_policies where tenant_id=t),0) then raise exception 'Stale simulation policy' using errcode='40001';end if;
 if enabled is null or required_sends is null or required_sends not between 1 and 100 then raise exception 'Invalid fixture simulation policy' using errcode='23514';end if;
 insert into public.l2_simulation_policies(tenant_id,enabled,required_sends,approved_by) values(t,enabled,required_sends,auth.uid()) on conflict(tenant_id) do update set revision=public.l2_simulation_policies.revision+1,enabled=excluded.enabled,required_sends=excluded.required_sends,approved_by=auth.uid(),updated_at=now();
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'l2_simulation_policy',t,jsonb_build_object('enabled',enabled,'requiredSends',required_sends,'silenceHours',72,'productionEnabled',false,'designDelegation',false));
end $$;
create function public.prepare_l2_silence(t uuid,campaign uuid,expected_copy integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;p public.l2_simulation_policies;s public.autopilot_streaks;candidate_id uuid;b integer;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if c.id is null then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_copy then raise exception 'Stale copy' using errcode='40001';end if;
 select * into p from public.l2_simulation_policies where tenant_id=t;select * into s from public.autopilot_streaks where tenant_id=t;
 if p.enabled is distinct from true or coalesce(s.consecutive_sends,0)<p.required_sends or not private.is_active_member(t,array['owner']::public.tenant_role[]) then raise exception 'Enabled simulation and rejection-free send streak required' using errcode='23514';end if;
 if c.calendar_state<>'approved' or c.copy_state<>'pending_approval' or c.delivery_state<>'not_ready' then raise exception 'Approved calendar and pending exact copy required' using errcode='23514';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 select revision into b from public.brand_profiles where tenant_id=t and approved_revision=revision;
 if b is null or cardinality(private.current_copy_errors(c,v))>0 then raise exception 'Current validated copy and approved brand required' using errcode='23514';end if;
 insert into public.l2_silence_candidates(tenant_id,campaign_id,content_id,target_revisions,policy_revision,streak_generation,brand_revision,created_by,eligible_at) values(t,c.id,v.id,jsonb_build_object('calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision,'delivery',c.delivery_revision),p.revision,s.generation,b,auth.uid(),greatest(now(),v.created_at,p.updated_at)+interval '72 hours') on conflict(campaign_id,content_id,policy_revision,streak_generation) do update set content_id=excluded.content_id returning public.l2_silence_candidates.id into candidate_id;return candidate_id;
end $$;
create function public.simulate_l2_silence(t uuid,candidate uuid,observed_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare x public.l2_silence_candidates;c public.campaigns;p public.l2_simulation_policies;s public.autopilot_streaks;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into x from public.l2_silence_candidates where id=candidate and tenant_id=t for update;
 if x.id is null or x.created_by is distinct from auth.uid() then raise exception 'Owner simulation candidate unavailable' using errcode='42501';end if;
 select * into p from public.l2_simulation_policies where tenant_id=t;select * into s from public.autopilot_streaks where tenant_id=t;select * into c from public.campaigns where id=x.campaign_id for update;
 if p.enabled is distinct from true or p.revision is distinct from x.policy_revision or s.generation is distinct from x.streak_generation or s.consecutive_sends<p.required_sends or c.calendar_revision is distinct from (x.target_revisions->>'calendar')::integer or c.copy_revision is distinct from (x.target_revisions->>'copy')::integer or c.design_revision is distinct from (x.target_revisions->>'design')::integer or c.delivery_revision is distinct from (x.target_revisions->>'delivery')::integer or x.brand_revision is distinct from (select revision from public.brand_profiles where tenant_id=t) then raise exception 'Silence policy or exact inputs changed' using errcode='40001';end if;
 if observed_at is null or observed_at<x.eligible_at or observed_at>x.eligible_at+interval '30 days' then raise exception 'Frozen clock must reach the bounded 72-hour silence gate' using errcode='23514';end if;
 if x.status='approved' then return;end if;
 perform public.approve_copy(t,c.id,c.copy_revision);
 update public.l2_silence_candidates set status='approved',simulated_at=observed_at where id=x.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'l2_silence_simulated',jsonb_build_object('candidateId',x.id,'policyRevision',p.revision,'observedAt',observed_at,'synthetic',true,'designApprovalStillRequired',true));
end $$;
create function public.simulate_l2_schedule(t uuid,candidate uuid,package uuid,expected_delivery integer) returns uuid language plpgsql security definer set search_path='' as $$
declare x public.l2_silence_candidates;p public.l2_simulation_policies;s public.autopilot_streaks;pkg public.delivery_packages;c public.campaigns;j uuid;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into x from public.l2_silence_candidates where id=candidate and tenant_id=t and status='approved';select * into p from public.l2_simulation_policies where tenant_id=t;select * into s from public.autopilot_streaks where tenant_id=t;
 select * into pkg from public.delivery_packages where id=package and tenant_id=t;select * into c from public.campaigns where id=x.campaign_id for update;
 if x.id is null or x.created_by is distinct from auth.uid() or pkg.campaign_id is distinct from x.campaign_id then raise exception 'Approved owner simulation and same campaign package required' using errcode='42501';end if;
 if p.enabled is distinct from true or p.revision is distinct from x.policy_revision or s.generation is distinct from x.streak_generation or s.consecutive_sends<p.required_sends or c.calendar_revision is distinct from (x.target_revisions->>'calendar')::integer or c.copy_revision is distinct from (x.target_revisions->>'copy')::integer or x.brand_revision is distinct from (select revision from public.brand_profiles where tenant_id=t) then raise exception 'Simulation inputs or eligibility changed' using errcode='40001';end if;
 -- The normal domain command requires current owner design approval, package identity and all push guards.
 j:=public.enqueue_delivery(t,pkg.id,expected_delivery);
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'l2_schedule_simulated',jsonb_build_object('candidateId',x.id,'packageId',pkg.id,'jobId',j,'synthetic',true,'productionEnabled',false));return j;
end $$;
revoke all on function private.capture_send_metadata(),private.sent_reporting_jobs(),private.reset_autopilot_streak(),private.planning_learning_lineage() from public,anon,authenticated;
do $$declare f text;begin foreach f in array array['public.set_fixture_metrics(uuid,uuid,text)','public.advance_results_clock(uuid,timestamptz)','public.fixture_result_payload(uuid,uuid,uuid,text)','public.finish_result_job(uuid,uuid,jsonb)','public.finish_result_digest(uuid,uuid)','public.enqueue_learning(uuid)','public.finish_learning_job(uuid,uuid)','public.review_learned_rule(uuid,uuid,integer,text)','public.fixture_copy_preference(uuid,uuid)','public.finish_copy_job(uuid,uuid,jsonb)','public.save_l2_simulation_policy(uuid,integer,boolean,integer)','public.prepare_l2_silence(uuid,uuid,integer)','public.simulate_l2_silence(uuid,uuid,timestamptz)','public.simulate_l2_schedule(uuid,uuid,uuid,integer)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
grant execute on function public.fixture_result_payload(uuid,uuid,uuid,text),public.finish_result_job(uuid,uuid,jsonb),public.finish_result_digest(uuid,uuid),public.finish_learning_job(uuid,uuid) to service_role;
create function public.enqueue_daily_result_digest(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare day date;actor uuid;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 day:=(now() at time zone (select timezone from public.tenants where id=t))::date;
 select profile_id into actor from public.tenant_memberships where tenant_id=t and role='owner' and status='active' order by created_at limit 1;
 if actor is null then return;end if;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'reports.digest','digest:'||day,jsonb_build_object('observedAt',now(),'localDate',day),actor) on conflict(tenant_id,idempotency_key) do nothing;
end $$;
revoke all on function public.enqueue_daily_result_digest(uuid) from public,anon;
grant execute on function public.enqueue_daily_result_digest(uuid) to authenticated,service_role;
