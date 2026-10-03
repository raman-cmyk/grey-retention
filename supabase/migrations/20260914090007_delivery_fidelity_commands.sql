alter table public.fixture_fault_controls add constraint fault_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
create or replace function private.ensure_fixture_registry(t uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.audiences;
begin
 for a in select * from public.audiences where tenant_id=t and synthetic loop
  insert into public.segment_registry(tenant_id,account_id,canonical_key,provider_id,definition) values(t,a.account_id,a.canonical_key,a.provider_id,'Synthetic canonical '||a.canonical_key||' audience; provider acceptance and real membership are unverified.') on conflict do nothing;
  insert into public.segment_registry(tenant_id,account_id,canonical_key,provider_id,definition) values(t,a.account_id,'suppressed',a.excluded_provider_ids[1],'Synthetic suppressed/spam/hard-bounce exclusion; no real recipient was queried.') on conflict do nothing;
  insert into public.segment_registry(tenant_id,account_id,canonical_key,provider_id,definition) values(t,a.account_id,'purchasers',a.account_id||'-purchasers','Synthetic purchasers within twelve months; not a live provider segment.') on conflict do nothing;
 end loop;
end $$;
create or replace function private.assert_package_push(p public.delivery_packages,c public.campaigns) returns void language plpgsql security definer set search_path='' as $$
declare a public.audiences;policy public.delivery_policies;
begin
 perform private.assert_campaign_guards(c);perform private.assert_render_ready(c);perform private.ensure_fixture_registry(c.tenant_id);
 select * into a from public.audiences where id=c.audience_id and tenant_id=c.tenant_id;
 if c.delivery_revision<>p.revision or c.copy_revision is distinct from (p.snapshot->'sourceRevisions'->>'copy')::integer or c.design_revision is distinct from (p.snapshot->'sourceRevisions'->>'design')::integer or c.calendar_revision is distinct from (p.snapshot->'sourceRevisions'->>'calendar')::integer or c.copy_state<>'approved' or c.design_state<>'owner_approved' or c.calendar_state<>'approved' then raise exception 'Current exact package approvals required' using errcode='23514';end if;
 if p.snapshot->'audience'->>'accountId' is distinct from a.account_id or p.snapshot->'audience'->'includes' is distinct from jsonb_build_array(a.provider_id) or p.snapshot->'audience'->'excludes' is distinct from to_jsonb(a.excluded_provider_ids) or not exists(select 1 from public.segment_registry r where r.tenant_id=c.tenant_id and r.account_id=a.account_id and r.canonical_key=a.canonical_key and r.provider_id=a.provider_id) or not exists(select 1 from public.segment_registry r where r.tenant_id=c.tenant_id and r.account_id=a.account_id and r.canonical_key='suppressed' and r.provider_id=any(a.excluded_provider_ids)) then raise exception 'Account-scoped mapping and required excludes do not match package' using errcode='23514';end if;
 if (p.snapshot->>'scheduledAt')::timestamptz is distinct from date_trunc('milliseconds',c.planned_at) or p.snapshot->>'timezone' is distinct from c.timezone then raise exception 'Schedule/timezone mismatch' using errcode='23514';end if;
 if not exists(select 1 from public.campaign_approvals ap where ap.id=(p.snapshot->'approvals'->>'calendar')::uuid and ap.campaign_id=c.id and ap.kind='calendar' and ap.revision=c.calendar_revision) or not exists(select 1 from public.campaign_approvals ap where ap.id=(p.snapshot->'approvals'->>'copy')::uuid and ap.campaign_id=c.id and ap.kind='copy' and ap.revision=c.copy_revision) or not exists(select 1 from public.campaign_approvals ap where ap.id=(p.snapshot->'approvals'->>'design')::uuid and ap.campaign_id=c.id and ap.kind='design' and ap.revision=c.design_revision) then raise exception 'Exact immutable approval identities required' using errcode='23514';end if;
end $$;
create or replace function public.save_delivery_policy(t uuid,expected_revision integer,level text,enabled boolean,defaults jsonb) returns void language plpgsql security definer set search_path='' as $$
declare b public.brand_profiles;p public.delivery_policies;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into b from public.brand_profiles where tenant_id=t;
 if b.tenant_id is null or level is null or level not in ('L0','L1') or enabled is null or (level='L0' and enabled) or jsonb_typeof(defaults) is distinct from 'object' or length(coalesce(defaults->>'senderName','')) not between 1 and 200 or length(coalesce(defaults->>'address','')) not between 5 and 1000 or coalesce(defaults->>'senderEmail','') !~ ('^[^@ ]+@'||replace(b.domain,'.','\.')||'$') or coalesce(defaults->>'unsubscribeUrl','') !~ ('^https://'||replace(b.domain,'.','\.')||'/') or coalesce(defaults->>'privacyUrl','') !~ ('^https://'||replace(b.domain,'.','\.')||'/') then raise exception 'Validated brand-domain sender/footer defaults required' using errcode='23514';end if;
 if not exists(select 1 from public.delivery_policies where tenant_id=t) and expected_revision is distinct from 0 then raise exception 'Stale delivery policy' using errcode='40001';end if;
 insert into public.delivery_policies(tenant_id,level,enabled,defaults,approved_by) values(t,level,enabled,defaults,auth.uid()) on conflict(tenant_id) do update set revision=public.delivery_policies.revision+1,level=excluded.level,enabled=excluded.enabled,defaults=excluded.defaults,approved_by=auth.uid(),updated_at=now() where public.delivery_policies.revision=expected_revision returning * into p;
 if not found then raise exception 'Stale delivery policy' using errcode='40001';end if;
 insert into public.delivery_policy_events(tenant_id,revision,snapshot,actor_id) values(t,p.revision,to_jsonb(p),auth.uid());perform private.ensure_fixture_registry(t);
end $$;
create or replace function public.enqueue_l1_delivery(t uuid,package uuid,expected_revision integer,policy_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.delivery_packages;c public.campaigns;policy public.delivery_policies;j uuid;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 perform 1 from public.tenants where id=t for update;
 select * into policy from public.delivery_policies where tenant_id=t and level='L1' and enabled and revision=policy_revision;
 if not found or not exists(select 1 from public.tenant_memberships m join public.profiles profile on profile.id=m.profile_id where m.tenant_id=t and m.profile_id=policy.approved_by and m.role='owner' and m.status='active' and profile.status='active') then raise exception 'Active owner-approved L1 standing policy required' using errcode='23514';end if;
 select * into p from public.delivery_packages where id=package and tenant_id=t;
 select * into c from public.campaigns where id=p.campaign_id and tenant_id=t for update;
 if p.id is null or c.delivery_revision is distinct from expected_revision or p.revision<>c.delivery_revision then raise exception 'Stale standing-policy package' using errcode='40001';end if;
 perform private.assert_package_push(p,c);
 if c.delivery_state not in ('ready','queued','scheduled') then raise exception 'Package is not ready for standing policy' using errcode='23514';end if;
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'delivery',p.revision,policy.approved_by) on conflict do nothing;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'delivery.schedule','schedule:'||p.id,jsonb_build_object('packageId',p.id,'deliveryRevision',p.revision,'standingPolicyRevision',policy.revision),policy.approved_by) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;
 update public.campaigns set delivery_state=case when delivery_state='scheduled' then 'scheduled' else 'queued' end,updated_at=now() where id=c.id;
 return j;
end $$;
create or replace function public.queue_ready_l1(t uuid) returns integer language plpgsql security definer set search_path='' as $$
declare c public.campaigns;p public.delivery_packages;policy public.delivery_policies;total integer:=0;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501';end if;
 select * into policy from public.delivery_policies where tenant_id=t and enabled and level='L1';if not found then return 0;end if;
 for c in select * from public.campaigns where tenant_id=t and delivery_state='ready' order by planned_at limit 4 loop
 select * into p from public.delivery_packages where campaign_id=c.id and revision=c.delivery_revision;
 begin perform public.enqueue_l1_delivery(t,p.id,p.revision,policy.revision);total:=total+1;
 exception when check_violation or serialization_failure then perform private.notify_owners(t,'delivery_blocked',c.id,'A ready fixture package no longer passes L1 guards. Inspect current inputs; no provider request was made.');end;
 end loop;return total;
end $$;
create or replace function public.set_fixture_fault(t uuid,campaign uuid,scenario text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 if not exists(select 1 from public.campaigns where tenant_id=t and id=campaign) or scenario is null or scenario not in ('none','transient_once','rate_limit_once','auth_permanent','validation_permanent','timeout_after_success','unknown_reconcile','cancel_rejected') then raise exception 'Authorized fixture scenario required' using errcode='23514';end if;
 if exists(select 1 from public.job_runs where campaign_id=campaign and status='running') then raise exception 'Wait for fixture lease before changing faults' using errcode='23514';end if;
 insert into public.fixture_fault_controls(tenant_id,campaign_id,scenario,updated_by) values(t,campaign,scenario,auth.uid()) on conflict(tenant_id,campaign_id) do update set scenario=excluded.scenario,consumed=false,revision=public.fixture_fault_controls.revision+1,updated_by=auth.uid(),updated_at=now();
end $$;
create or replace function public.fixture_fault_probe(job uuid,lease uuid,stage text) returns text language plpgsql security definer set search_path='' as $$
declare j public.job_runs;fault public.fixture_fault_controls;result text:='none';
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind not in ('delivery.schedule','delivery.cancel','delivery.reschedule') or stage not in ('before','after_schedule') then raise exception 'Invalid fault stage' using errcode='23514';end if;
 select * into fault from public.fixture_fault_controls where tenant_id=j.tenant_id and campaign_id=j.campaign_id for update;
 if not found then return result;end if;
 if fault.scenario='unknown_reconcile' then return 'unknown_outcome';end if;
 if fault.scenario='auth_permanent' then return 'auth';end if;
 if fault.scenario='validation_permanent' then return 'validation';end if;
 if fault.scenario='cancel_rejected' and j.kind='delivery.cancel' then return 'validation';end if;
 if not fault.consumed and ((stage='before' and fault.scenario in ('transient_once','rate_limit_once')) or (stage='after_schedule' and fault.scenario='timeout_after_success')) then
 result:=case fault.scenario when 'transient_once' then 'transient' when 'rate_limit_once' then 'rate_limit' else 'unknown_outcome' end;
 update public.fixture_fault_controls set consumed=true where tenant_id=j.tenant_id and campaign_id=j.campaign_id;
 end if;return result;
end $$;
create or replace function public.request_reschedule(t uuid,campaign uuid,expected_revision integer,scheduled_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;f public.fixture_deliveries;old_package public.delivery_packages;p uuid;approval uuid;snapshot jsonb;j uuid;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.delivery_revision is distinct from expected_revision then raise exception 'Stale delivery revision' using errcode='40001';end if;
 select remote.* into f from public.fixture_deliveries remote join public.delivery_packages package on package.id=remote.package_id where package.campaign_id=c.id and remote.state='scheduled' order by remote.updated_at desc limit 1 for update of remote;
 if c.delivery_state<>'scheduled' or f.id is null or f.scheduled_at<=now() or scheduled_at is null or scheduled_at<=now() then raise exception 'Future confirmed schedule required for rescheduling' using errcode='23514';end if;
 select * into old_package from public.delivery_packages where id=f.package_id and tenant_id=t;
 perform private.assert_package_push(old_package,c);
 update public.campaigns set planned_at=scheduled_at,calendar_revision=calendar_revision+1,calendar_state='proposed',delivery_revision=delivery_revision+1,delivery_state='scheduling',updated_at=now() where id=c.id returning * into c;
 perform public.approve_calendar(t,c.id,c.calendar_revision);
 select * into c from public.campaigns where id=c.id;
 select id into approval from public.campaign_approvals where campaign_id=c.id and kind='calendar' and revision=c.calendar_revision;
 p:=gen_random_uuid();snapshot:=old_package.snapshot||jsonb_build_object('id',p,'revision',c.delivery_revision,'scheduledAt',to_char(scheduled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'approvals',(old_package.snapshot->'approvals')||jsonb_build_object('calendar',approval),'sourceRevisions',(old_package.snapshot->'sourceRevisions')||jsonb_build_object('calendar',c.calendar_revision));
 insert into public.delivery_packages(id,tenant_id,campaign_id,revision,snapshot,created_by) values(p,t,c.id,c.delivery_revision,snapshot,auth.uid());
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'delivery',c.delivery_revision,auth.uid());
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'delivery.reschedule','reschedule:'||f.id||':'||p,jsonb_build_object('packageId',p,'providerId',f.id,'deliveryRevision',c.delivery_revision),auth.uid()) returning id into j;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'reschedule_owner_confirmed',jsonb_build_object('fromPackage',old_package.id,'toPackage',p,'providerId',f.id));return j;
end $$;
create or replace function public.enqueue_cancel(t uuid,campaign uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;f public.fixture_deliveries;j uuid;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.delivery_revision is distinct from expected_revision then raise exception 'Stale delivery version' using errcode='40001';end if;
 if exists(select 1 from public.job_runs where campaign_id=c.id and kind in ('delivery.schedule','delivery.reschedule') and status='running') then raise exception 'Reconcile active provider lease before cancellation' using errcode='23514';end if;
 select remote.* into f from public.fixture_deliveries remote join public.delivery_packages package on package.id=remote.package_id where package.campaign_id=c.id order by case when remote.state in ('scheduled','prepared','sent') then 0 else 1 end,remote.updated_at desc limit 1;
 if f.id is null then
  if c.delivery_state not in ('queued','reconciling','failed') or not exists(select 1 from public.job_runs where campaign_id=c.id and kind='delivery.schedule' and status in ('queued','retry_wait','failed')) then raise exception 'Scheduled or queued intent required' using errcode='23514';end if;
  update public.job_runs set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where campaign_id=c.id and kind='delivery.schedule' and status in ('queued','retry_wait','failed');
  update public.campaigns set delivery_state='cancelled',updated_at=now() where id=c.id;
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'queued_intent_cancelled',jsonb_build_object('providerContacted',false));return c.id;
 end if;
 if f.state='sent' then raise exception 'Already sent; recall unavailable' using errcode='23514';end if;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'delivery.cancel','cancel:'||f.id||':'||c.delivery_revision,jsonb_build_object('packageId',f.package_id,'providerId',f.id,'deliveryRevision',c.delivery_revision),auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;
 return j;
end $$;
create or replace function public.fixture_delivery_command(job uuid,lease uuid,command text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.job_runs;p public.delivery_packages;c public.campaigns;f public.fixture_deliveries;policy public.delivery_policies;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind not in ('delivery.schedule','delivery.reschedule','delivery.cancel') then raise exception 'Invalid delivery job' using errcode='23514';end if;
 select * into p from public.delivery_packages where id=(j.input->>'packageId')::uuid and tenant_id=j.tenant_id;
 select * into c from public.campaigns where id=j.campaign_id and tenant_id=j.tenant_id for update;
 if p.id is null or p.campaign_id is distinct from c.id or c.delivery_revision is distinct from (j.input->>'deliveryRevision')::integer then raise exception 'Stale package' using errcode='40001';end if;
 if j.kind='delivery.schedule' then select * into f from public.fixture_deliveries where package_id=p.id and tenant_id=j.tenant_id for update;
 else select remote.* into f from public.fixture_deliveries remote join public.delivery_packages older on older.id=remote.package_id where remote.id=nullif(j.input->>'providerId','')::uuid and remote.tenant_id=j.tenant_id and older.campaign_id=c.id for update of remote;end if;
 if command='reconcile' then
  if exists(select 1 from public.fixture_fault_controls where tenant_id=j.tenant_id and campaign_id=c.id and scenario='unknown_reconcile') then return jsonb_build_object('outcome','unknown');end if;
  update public.job_runs set checkpoint=checkpoint||jsonb_build_object('reconciled',true,'providerId',f.id,'providerState',f.state),updated_at=now() where id=j.id;
  return case when f.id is null then jsonb_build_object('outcome','absent') else jsonb_build_object('outcome','found','identity',jsonb_build_object('id',f.id,'packageId',f.package_id,'state',f.state,'scheduledAt',f.scheduled_at)) end;
 end if;
 if command in ('prepare','schedule','reschedule','cancel') and (coalesce(j.checkpoint->>'reconciled','false')<>'true' or exists(select 1 from public.fixture_fault_controls where tenant_id=j.tenant_id and campaign_id=c.id and scenario='unknown_reconcile')) then raise exception 'Conclusive reconciliation required before provider mutation' using errcode='23514';end if;
 if command in ('prepare','schedule','reschedule') then
  if (command='reschedule' and j.kind<>'delivery.reschedule') or (command in ('prepare','schedule') and j.kind<>'delivery.schedule') then raise exception 'Wrong delivery command' using errcode='23514';end if;
  perform private.assert_package_push(p,c);
  if j.input ? 'standingPolicyRevision' and not exists(select 1 from public.delivery_policies where tenant_id=j.tenant_id and enabled and level='L1' and revision=(j.input->>'standingPolicyRevision')::integer) then raise exception 'Standing policy changed; review ready package again' using errcode='23514';end if;
  if command='prepare' and f.id is null then
   insert into public.fixture_deliveries(tenant_id,package_id,idempotency_key,snapshot,state) values(p.tenant_id,p.id,j.idempotency_key,p.snapshot,'prepared') returning * into f;
  end if;
  if f.id is null or f.state in ('cancelled','sent') then raise exception 'Remote campaign is no longer schedulable' using errcode='23514';end if;
  if command='schedule' then update public.fixture_deliveries set state='scheduled',scheduled_at=(p.snapshot->>'scheduledAt')::timestamptz,updated_at=now() where id=f.id returning * into f;
  elsif command='reschedule' then update public.fixture_deliveries set package_id=p.id,snapshot=p.snapshot,state='scheduled',scheduled_at=(p.snapshot->>'scheduledAt')::timestamptz,updated_at=now() where id=f.id returning * into f;end if;
 elsif command='cancel' then
  if j.kind<>'delivery.cancel' or f.id is null then raise exception 'Provider identity unavailable' using errcode='23514';end if;
  if exists(select 1 from public.fixture_fault_controls where tenant_id=j.tenant_id and campaign_id=c.id and scenario='cancel_rejected') then raise exception 'Fixture provider rejected cancellation' using errcode='23514';end if;
  if f.state='sent' or (f.state='scheduled' and f.scheduled_at<=now()) then update public.fixture_deliveries set state='sent',sent_at=coalesce(sent_at,scheduled_at),updated_at=now() where id=f.id returning * into f;
  else update public.fixture_deliveries set state='cancelled',updated_at=now() where id=f.id returning * into f;end if;
 else raise exception 'Unsupported fixture command' using errcode='23514';end if;
 update public.job_runs set checkpoint=jsonb_build_object('providerId',f.id,'providerState',f.state,'reconciled',true),updated_at=now() where id=j.id;
 return jsonb_build_object('id',f.id,'packageId',f.package_id,'state',f.state,'scheduledAt',f.scheduled_at);
end $$;
create or replace function public.finish_delivery_job(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;f public.fixture_deliveries;c public.campaigns;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind not in ('delivery.schedule','delivery.reschedule','delivery.cancel') or exists(select 1 from public.fixture_fault_controls where tenant_id=j.tenant_id and campaign_id=j.campaign_id and scenario='unknown_reconcile') then raise exception 'Conclusive provider confirmation required' using errcode='23514';end if;
 select * into f from public.fixture_deliveries where tenant_id=j.tenant_id and package_id=(j.input->>'packageId')::uuid;
 if f.id is null or (j.kind in ('delivery.schedule','delivery.reschedule') and f.state not in ('scheduled','sent')) or (j.kind='delivery.cancel' and f.state not in ('cancelled','sent')) or j.checkpoint->>'providerId' is distinct from f.id::text then raise exception 'Provider confirmation required' using errcode='23514';end if;
 select * into c from public.campaigns where id=j.campaign_id for update;
 if c.delivery_revision is distinct from (j.input->>'deliveryRevision')::integer then raise exception 'Stale delivery version' using errcode='40001';end if;
 update public.campaigns set delivery_state=f.state,updated_at=now() where id=c.id;
 update public.job_runs set status='succeeded',lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,j.created_by,'fixture_provider_'||f.state,jsonb_build_object('providerId',f.id,'packageId',f.package_id));
 perform private.notify_owners(c.tenant_id,'delivery_status',c.id,'Fixture provider confirmed '||f.state||'. No real message was sent.');
end $$;
create or replace function public.fail_job(job uuid,lease uuid,failure text) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;provider_state text;next_status text;
begin
 j:=private.onboarding_lease(job,lease);
 if failure is null or failure not in ('transient','rate_limit','unknown_outcome','auth','validation') then raise exception 'Invalid failure class' using errcode='23514';end if;
 next_status:=case when failure in ('transient','rate_limit','unknown_outcome') and j.attempt<4 then 'retry_wait' else 'failed' end;
 update public.job_runs set status=next_status,failure_class=failure,error_code='fixture_'||failure,available_at=now()+make_interval(secs=>least(300,5*power(2,j.attempt)::integer)),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 if j.kind like 'delivery.%' then
  select remote.state into provider_state from public.fixture_deliveries remote join public.delivery_packages p on p.id=remote.package_id where p.campaign_id=j.campaign_id order by remote.updated_at desc limit 1;
  update public.campaigns set delivery_state=case when failure='unknown_outcome' or j.kind='delivery.reschedule' then 'reconciling' when j.kind='delivery.cancel' and provider_state in ('scheduled','sent','cancelled') then provider_state when next_status='retry_wait' then 'queued' else 'failed' end,updated_at=now() where id=j.campaign_id and delivery_revision=(j.input->>'deliveryRevision')::integer;
  perform private.notify_owners(j.tenant_id,'delivery_issue',j.campaign_id,'Fixture delivery issue: '||failure||'. Inspect retry/provider confirmation. Existing provider state is retained.');
 end if;
end $$;
create or replace function public.retry_fixture_job(t uuid,job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into j from public.job_runs where tenant_id=t and id=job for update;
 if not found or j.status not in ('failed','retry_wait') or j.kind not like 'delivery.%' then raise exception 'Failed fixture delivery unavailable' using errcode='23514';end if;
 if j.attempt>=4 then raise exception 'Retry limit reached; operator must inspect and reconcile known provider state' using errcode='23514';end if;
 if exists(select 1 from public.fixture_fault_controls where tenant_id=t and campaign_id=j.campaign_id and scenario in ('unknown_reconcile','auth_permanent','validation_permanent','cancel_rejected')) then raise exception 'Resolve the explicit fixture fault before retry' using errcode='23514';end if;
 update public.job_runs set status='queued',available_at=now(),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
create or replace function private.fixture_history_and_send() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.delivery_packages;c public.campaigns;actor uuid;
begin
 if tg_op='INSERT' or old.state is distinct from new.state or old.package_id is distinct from new.package_id or old.scheduled_at is distinct from new.scheduled_at then
  insert into public.fixture_delivery_history(tenant_id,delivery_id,package_id,state,snapshot,scheduled_at) values(new.tenant_id,new.id,new.package_id,new.state,new.snapshot,new.scheduled_at);
 end if;
 if new.state='sent' and (tg_op='INSERT' or old.state is distinct from 'sent') then
  select * into p from public.delivery_packages where id=new.package_id and tenant_id=new.tenant_id;
  select * into c from public.campaigns where id=p.campaign_id;
  select actor_id into actor from public.campaign_approvals where id=(p.snapshot->'approvals'->>'design')::uuid;
  update public.campaigns set delivery_state='sent',updated_at=now() where id=c.id;
  insert into public.own_templates(tenant_id,name,skeleton,campaign_id,delivery_id,created_by) values(c.tenant_id,left(c.title,180)||' · own skeleton',jsonb_build_object('sections',jsonb_build_array('hero','copy','cta'),'source','own_confirmed_send','synthetic',true,'copyReusable',false,'sourcePackageId',p.id),c.id,new.id,coalesce(actor,c.created_by)) on conflict(delivery_id) do nothing;
  insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,coalesce(actor,c.created_by),'fixture_send_confirmed',jsonb_build_object('providerId',new.id,'packageId',p.id,'sentAt',new.sent_at,'synthetic',true));
  perform private.notify_owners(c.tenant_id,'fixture_sent',c.id,'Synthetic send confirmed. No real recipients contacted; an own-tenant structural template was saved.');
 end if;return new;
end $$;
create trigger fixture_state_history after insert or update on public.fixture_deliveries for each row execute function private.fixture_history_and_send();
create or replace function public.confirm_fixture_sent(t uuid,delivery uuid,observed_at timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare f public.fixture_deliveries;p public.delivery_packages;c public.campaigns;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into f from public.fixture_deliveries where id=delivery and tenant_id=t for update;
 if not found then raise exception 'Fixture delivery unavailable' using errcode='42501';end if;
 if f.state='sent' then return;end if;
 if f.state<>'scheduled' or observed_at is null or observed_at<f.scheduled_at or observed_at>f.scheduled_at+interval '14 days' then raise exception 'Explicit simulated clock at or after schedule required' using errcode='23514';end if;
 select * into p from public.delivery_packages where id=f.package_id;
 select * into c from public.campaigns where id=p.campaign_id for update;
 perform private.assert_package_push(p,c);
 update public.fixture_deliveries set state='sent',sent_at=observed_at,updated_at=now() where id=f.id;
end $$;
-- Resolve an observed terminal provider state after the retry budget without performing another side effect.
create or replace function public.resolve_fixture_outcome(t uuid,job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;f public.fixture_deliveries;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into j from public.job_runs where id=job and tenant_id=t and kind like 'delivery.%' and status in ('failed','retry_wait') for update;
 if not found then raise exception 'Unresolved delivery unavailable' using errcode='23514';end if;
 if exists(select 1 from public.fixture_fault_controls where tenant_id=t and campaign_id=j.campaign_id and scenario='unknown_reconcile') then raise exception 'Reconciliation remains inconclusive' using errcode='23514';end if;
 select * into f from public.fixture_deliveries where tenant_id=t and package_id=(j.input->>'packageId')::uuid;
 if f.id is null or (j.kind in ('delivery.schedule','delivery.reschedule') and f.state not in ('scheduled','sent')) or (j.kind='delivery.cancel' and f.state not in ('cancelled','sent')) then raise exception 'No conclusive terminal provider state; no retry performed' using errcode='23514';end if;
 if not exists(select 1 from public.campaigns where id=j.campaign_id and tenant_id=t and delivery_revision=(j.input->>'deliveryRevision')::integer) then raise exception 'Stale delivery version' using errcode='40001';end if;
 update public.campaigns set delivery_state=f.state,updated_at=now() where id=j.campaign_id;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('providerId',f.id,'providerState',f.state,'reconciled',true,'manualReadOnlyResolution',true),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,j.campaign_id,auth.uid(),'fixture_outcome_reconciled',jsonb_build_object('providerId',f.id,'jobId',j.id));
end $$;
revoke all on function private.ensure_fixture_registry(uuid),private.assert_package_push(public.delivery_packages,public.campaigns),private.fixture_history_and_send() from public,anon,authenticated;
do $$declare f text;begin foreach f in array array['public.save_delivery_policy(uuid,integer,text,boolean,jsonb)','public.enqueue_l1_delivery(uuid,uuid,integer,integer)','public.queue_ready_l1(uuid)','public.set_fixture_fault(uuid,uuid,text)','public.fixture_fault_probe(uuid,uuid,text)','public.request_reschedule(uuid,uuid,integer,timestamptz)','public.retry_fixture_job(uuid,uuid)','public.confirm_fixture_sent(uuid,uuid,timestamptz)','public.resolve_fixture_outcome(uuid,uuid)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
-- Service dispatch is deliberately narrow. Domain authorization still applies in every RPC.
grant execute on function public.claim_job(uuid),public.fixture_delivery_command(uuid,uuid,text),public.finish_delivery_job(uuid,uuid),public.fail_job(uuid,uuid,text),public.queue_ready_l1(uuid),public.fixture_fault_probe(uuid,uuid,text),public.enqueue_l1_delivery(uuid,uuid,integer,integer) to service_role;

-- Preserve sent snapshots when source assets are later corrected.
create or replace function private.invalidate_render_asset() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 if new.revision=old.revision then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if exists(select 1 from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and r.input_revisions->'assets' ? new.id::text and campaign.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','reconciling')) then raise exception 'Cancel or reconcile delivery before changing a used asset' using errcode='23514';end if;
 for c in select campaign.* from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and r.input_revisions->'assets' ? new.id::text and campaign.delivery_state<>'sent' for update of campaign loop
 update public.campaigns set design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,coalesce(auth.uid(),c.created_by),'asset_design_invalidated',jsonb_build_object('assetId',new.id,'assetRevision',new.revision));
 end loop;return new;
end $$;

create or replace function private.invalidate_render_kit() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 if new.revision=old.revision then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if exists(select 1 from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and campaign.channel='email_design' and campaign.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','reconciling')) then raise exception 'Cancel or reconcile delivery before changing a used kit' using errcode='23514';end if;
 for c in select campaign.* from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and campaign.channel='email_design' and campaign.delivery_state<>'sent' for update of campaign loop
 update public.campaigns set design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,coalesce(auth.uid(),c.created_by),'kit_design_invalidated',jsonb_build_object('kitRevision',new.revision));
 end loop;return new;
end $$;

revoke all on function private.invalidate_render_asset(),private.invalidate_render_kit() from public,anon,authenticated;
