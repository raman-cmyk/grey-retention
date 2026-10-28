create function private.optimizer_exclusion(p public.optimizer_profiles,as_of timestamptz) returns text language sql immutable set search_path='' set timezone='UTC' as $$
 select case when p.last_order_at>=as_of-interval '12 months' then 'protected_purchaser_12_months' when p.consent<>'subscribed' then 'consent_not_subscribed' when p.hard_bounce then 'hard_bounce' when p.spam then 'spam' when cardinality(p.suppression_reasons)>0 then 'already_suppressed' when p.last_engaged_at>as_of-interval '120 days' then 'recent_engagement' when p.last_order_at>as_of-interval '180 days' then 'recent_order' else 'eligible_nonengaged' end;
$$;
create function public.install_optimizer_fixture(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 -- Original fictional profiles only; repeated installation preserves edits and suppression history.
 for n in 1..8 loop
 insert into public.optimizer_profiles(tenant_id,external_id,email,consent,last_engaged_at,last_order_at,hard_bounce,spam,suppression_reasons,fixture_responds) values(t,'original-fixture-'||n,'person-'||n||'@fixture.example',case when n=4 then 'unsubscribed' when n=8 then 'pending' else 'subscribed' end,now()-case when n=7 then interval '20 days' else interval '200 days' end,case when n=3 then now()-interval '200 days' when n=1 then now()-interval '400 days' else null end,n=5,n=6,case when n=4 then array['consent'] when n=5 then array['hard_bounce'] when n=6 then array['spam'] else '{}'::text[] end,n=1) on conflict(tenant_id,external_id) do nothing;
 end loop;
end $$;
create function public.preview_optimizer(t uuid,observed_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare s uuid;p public.optimizer_profiles;reason text;snapshot jsonb;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if observed_at is null or observed_at<now()-interval '1 day' or observed_at>now()+interval '1 day' then raise exception 'First sweep preview uses the current bounded fixture clock' using errcode='23514';end if;
 if not exists(select 1 from public.optimizer_profiles where tenant_id=t) then raise exception 'Install original optimizer fixtures first' using errcode='23514';end if;
 select jsonb_agg(jsonb_build_object('profileId',op.id,'revision',op.revision,'reason',private.optimizer_exclusion(op,observed_at)) order by op.id) into snapshot from public.optimizer_profiles op where op.tenant_id=t;
 insert into public.optimizer_sweeps(tenant_id,observed_at,snapshot,pricing_snapshot,created_by) values(t,observed_at,snapshot,jsonb_build_object('source','fictional_fixture_rate','effectiveDate',current_date,'currency','USD','profileBandSize',1000,'monthlyBandPriceMinor',1000,'measuredSavings',false,'liveSuppression',false),auth.uid()) returning id into s;
 for p in select * from public.optimizer_profiles where tenant_id=t loop
 reason:=private.optimizer_exclusion(p,observed_at);
 insert into public.optimizer_candidates(sweep_id,tenant_id,profile_id,profile_revision,eligible,reason,state) values(s,t,p.id,p.revision,reason='eligible_nonengaged',reason,case when reason='eligible_nonengaged' then 'preview' else 'excluded' end);
 end loop;return s;
end $$;
create function public.approve_optimizer(t uuid,sweep uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare s public.optimizer_sweeps;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into s from public.optimizer_sweeps where id=sweep and tenant_id=t for update;
 if s.id is null then raise exception 'Sweep unavailable' using errcode='42501';end if;
 if s.revision is distinct from expected_revision then raise exception 'Stale sweep' using errcode='40001';end if;
 if s.state<>'preview' then return;end if;
 if exists(select 1 from public.optimizer_sweeps where tenant_id=t and id<>s.id and state in ('approved','winback_wait')) then raise exception 'Complete the active sweep before approving another' using errcode='23514';end if;
 if s.expires_at<=now() or exists(select 1 from public.optimizer_candidates c join public.optimizer_profiles p on p.id=c.profile_id where c.sweep_id=s.id and (c.profile_revision<>p.revision or private.optimizer_exclusion(p,s.observed_at)<>c.reason)) then raise exception 'Preview expired or profile evidence changed; preview again' using errcode='40001';end if;
 update public.optimizer_sweeps set state='approved',revision=revision+1,approved_by=auth.uid() where id=s.id;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,'optimizer.winback','optimizer:'||s.id||':1',jsonb_build_object('sweepId',s.id,'stage',1,'observedAt',s.observed_at),auth.uid()) on conflict(tenant_id,idempotency_key) do nothing;
 insert into public.workspace_events(tenant_id,actor_id,kind,entity_id,detail) values(t,auth.uid(),'optimizer_approved',s.id,jsonb_build_object('synthetic',true,'previewRevision',s.revision,'protectedPurchasersMonths',12));
end $$;
create function public.advance_optimizer_clock(t uuid,sweep uuid,observed_at timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare s public.optimizer_sweeps;n integer;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into s from public.optimizer_sweeps where id=sweep and tenant_id=t;
 if s.id is null or s.approved_by is null then raise exception 'Owner-approved sweep required' using errcode='42501';end if;
 if observed_at is null or observed_at<s.observed_at or observed_at>s.observed_at+interval '30 days' then raise exception 'Bounded explicit optimizer clock required' using errcode='23514';end if;
 update public.job_runs set available_at=now(),input=input||jsonb_build_object('observedAt',observed_at,'syntheticClock',true) where tenant_id=t and input->>'sweepId'=s.id::text and kind in ('optimizer.winback','optimizer.suppress') and status in ('queued','retry_wait') and (input->>'dueAt')::timestamptz<=observed_at;get diagnostics n=row_count;return n;
end $$;
create function public.fixture_optimizer_payload(job uuid,lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.job_runs;s public.optimizer_sweeps;c public.optimizer_candidates;p public.optimizer_profiles;items jsonb:='[]';reason text;outcome text;stage integer;clock timestamptz;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind not in ('optimizer.winback','optimizer.suppress') then raise exception 'Optimizer job required' using errcode='23514';end if;
 select * into s from public.optimizer_sweeps where id=(j.input->>'sweepId')::uuid and tenant_id=j.tenant_id;
 if s.approved_by is null or not exists(select 1 from public.tenant_memberships m join public.profiles profile on profile.id=m.profile_id and profile.status='active' where m.tenant_id=j.tenant_id and m.profile_id=s.approved_by and m.role='owner' and m.status='active') then raise exception 'Active approving owner required' using errcode='42501';end if;
 stage:=(j.input->>'stage')::integer;clock:=(j.input->>'observedAt')::timestamptz;
 if stage not in (1,2,3) or (stage=2 and clock<s.observed_at+interval '5 days') or (stage=3 and clock<s.observed_at+interval '10 days') then raise exception 'Winback/suppression window immature' using errcode='23514';end if;
 for c in select * from public.optimizer_candidates where sweep_id=s.id and eligible and state not in ('recovered','suppressed','skipped') order by profile_id loop
 select * into p from public.optimizer_profiles where id=c.profile_id and tenant_id=j.tenant_id;
 reason:=private.optimizer_exclusion(p,clock);
 if p.revision<>c.profile_revision or reason<>'eligible_nonengaged' then outcome:='skipped';reason:=case when p.revision<>c.profile_revision then 'profile_evidence_changed' else reason end;
 elsif stage=2 and p.fixture_responds then outcome:='recovered';reason:='synthetic_positive_engagement';
 elsif stage=3 then outcome:='suppressed';reason:='optimizer_nonresponse_after_ten_days';
 else outcome:='winback_'||stage;reason:='consented_fixture_winback';end if;
 items:=items||jsonb_build_array(jsonb_build_object('profileId',p.id,'revision',p.revision,'outcome',outcome,'reason',reason));
 end loop;
 return jsonb_build_object('sweepId',s.id,'stage',stage,'observedAt',clock,'source','fixture','synthetic',true,'items',items,'originalMessage',case when stage<3 then 'An original note from your fictional studio. Explore at your own pace; this message is only a local simulation.' else null end);
end $$;
create function public.finish_optimizer_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;s public.optimizer_sweeps;x jsonb;stage integer;due timestamptz;
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 if output is distinct from public.fixture_optimizer_payload(job,lease) then raise exception 'Fixture optimizer output changed or invalid' using errcode='40001';end if;
 select * into s from public.optimizer_sweeps where id=(j.input->>'sweepId')::uuid for update;stage:=(output->>'stage')::integer;
 for x in select value from jsonb_array_elements(output->'items') loop
 if x->>'outcome'='suppressed' then
 update public.optimizer_profiles set suppression_reasons=array_append(suppression_reasons,'optimizer'),revision=revision+1 where id=(x->>'profileId')::uuid and not ('optimizer'=any(suppression_reasons));
 elsif x->>'outcome'='recovered' then update public.optimizer_profiles set last_engaged_at=(output->>'observedAt')::timestamptz,revision=revision+1 where id=(x->>'profileId')::uuid;end if;
 update public.optimizer_candidates set state=x->>'outcome',reason=x->>'reason',profile_revision=(select revision from public.optimizer_profiles where id=(x->>'profileId')::uuid),updated_at=now() where sweep_id=s.id and profile_id=(x->>'profileId')::uuid;
 insert into public.optimizer_events(tenant_id,profile_id,sweep_id,kind,detail) values(j.tenant_id,(x->>'profileId')::uuid,s.id,x->>'outcome',x||jsonb_build_object('synthetic',true,'observedAt',output->'observedAt','originalMessage',output->'originalMessage','noRealMessage',true)) on conflict do nothing;
 end loop;
 if stage<3 then
 due:=s.observed_at+case when stage=1 then interval '5 days' else interval '10 days' end;
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,available_at,created_by) values(j.tenant_id,case when stage=1 then 'optimizer.winback' else 'optimizer.suppress' end,'optimizer:'||s.id||':'||(stage+1),jsonb_build_object('sweepId',s.id,'stage',stage+1,'observedAt',due,'dueAt',due),due,s.approved_by) on conflict(tenant_id,idempotency_key) do nothing;
 end if;
 update public.optimizer_sweeps set state=case when stage=3 then 'completed' else 'winback_wait' end,revision=revision+1 where id=s.id;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('stage',stage,'synthetic',true,'count',jsonb_array_length(output->'items')),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 if stage=3 then perform private.notify_owners(j.tenant_id,'optimizer_complete',s.id,'Fixture optimization completed. Suppression and pricing savings are simulated; no provider account or real recipient changed.');end if;
end $$;
create function public.reverse_fixture_suppression(t uuid,profile uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare p public.optimizer_profiles;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into p from public.optimizer_profiles where id=profile and tenant_id=t for update;
 if p.id is null then raise exception 'Fixture profile unavailable' using errcode='42501';end if;
 if p.revision is distinct from expected_revision then raise exception 'Stale profile' using errcode='40001';end if;
 if p.consent<>'subscribed' or p.hard_bounce or p.spam or cardinality(array_remove(p.suppression_reasons,'optimizer'))>0 then raise exception 'Consent, bounce, spam and non-optimizer reasons prevent reversal' using errcode='23514';end if;
 if not ('optimizer'=any(p.suppression_reasons)) then return;end if;
 update public.optimizer_profiles set suppression_reasons=array_remove(suppression_reasons,'optimizer'),revision=revision+1 where id=p.id;
 insert into public.optimizer_events(tenant_id,profile_id,kind,detail) values(t,p.id,'reversed',jsonb_build_object('synthetic',true,'removedReason','optimizer','actorId',auth.uid(),'previousRevision',p.revision));
end $$;
create function public.change_fixture_profile_evidence(t uuid,profile uuid,expected_revision integer,consent text,bounce boolean,spam boolean,recent_order boolean) returns void language plpgsql security definer set search_path='' as $$
declare p public.optimizer_profiles;reasons text[];
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;select * into p from public.optimizer_profiles where id=profile and tenant_id=t for update;
 if p.id is null then raise exception 'Fixture profile unavailable' using errcode='42501';end if;
 if p.revision is distinct from expected_revision then raise exception 'Stale profile evidence' using errcode='40001';end if;
 if consent is null or consent not in ('subscribed','unsubscribed','pending') or bounce is null or spam is null or recent_order is null then raise exception 'Explicit fixture evidence required' using errcode='23514';end if;
 reasons:=array_remove(array_remove(array_remove(p.suppression_reasons,'consent'),'hard_bounce'),'spam');
 if consent<>'subscribed' then reasons:=array_append(reasons,'consent');end if;if bounce then reasons:=array_append(reasons,'hard_bounce');end if;if spam then reasons:=array_append(reasons,'spam');end if;
 update public.optimizer_profiles set consent=change_fixture_profile_evidence.consent,hard_bounce=bounce,spam=change_fixture_profile_evidence.spam,last_order_at=case when recent_order then now() else last_order_at end,suppression_reasons=reasons,revision=revision+1 where id=p.id;
 insert into public.optimizer_events(tenant_id,profile_id,kind,detail) values(t,p.id,'profile_evidence_changed',jsonb_build_object('synthetic',true,'actorId',auth.uid(),'consent',consent,'hardBounce',bounce,'spam',spam,'recentOrder',recent_order));
end $$;
create function public.draft_from_structure(t uuid,source text,source_id uuid,input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare structure jsonb;c uuid;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if source='own_template' then select skeleton->'sections' into structure from public.own_templates where id=source_id and tenant_id=t;
 elsif source='reference_structure' then select micro->'strips' into structure from public.competitor_emails where id=source_id and private.capture_access(capture_id);
 else raise exception 'Authorized own template or subscribed structural reference required' using errcode='42501';end if;
 if structure is null then raise exception 'Structure unavailable in this tenant' using errcode='42501';end if;
 if (input->>'planned_at')::timestamptz<=now() then raise exception 'Future campaign date required' using errcode='23514';end if;
 c:=public.save_campaign(t,null,0,input||jsonb_build_object('reference_notes','Authorized structure only. Original brand facts/assets/copy; source executed creative is not reused.'));
 update public.campaigns set lineage=lineage||jsonb_build_object('structureSource',source,'structureId',source_id,'structure',structure,'copyReusable',false,'crossClientPublication',false,'synthetic',true),synthetic=true where id=c;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c,auth.uid(),'structural_draft_created',jsonb_build_object('source',source,'sourceId',source_id,'approvalBypass',false));return c;
end $$;
revoke all on function private.optimizer_exclusion(public.optimizer_profiles,timestamptz) from public,anon,authenticated;
do $$declare f text;begin foreach f in array array['public.install_optimizer_fixture(uuid)','public.preview_optimizer(uuid,timestamptz)','public.approve_optimizer(uuid,uuid,integer)','public.advance_optimizer_clock(uuid,uuid,timestamptz)','public.fixture_optimizer_payload(uuid,uuid)','public.finish_optimizer_job(uuid,uuid,jsonb)','public.reverse_fixture_suppression(uuid,uuid,integer)','public.change_fixture_profile_evidence(uuid,uuid,integer,text,boolean,boolean,boolean)','public.draft_from_structure(uuid,text,uuid,jsonb)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
grant execute on function public.fixture_optimizer_payload(uuid,uuid),public.finish_optimizer_job(uuid,uuid,jsonb) to service_role;
