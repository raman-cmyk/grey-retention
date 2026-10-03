create or replace function private.escape_html(value text) returns text language sql immutable set search_path='' as $$
 select replace(replace(replace(replace(coalesce(value,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;');
$$;
revoke all on function private.escape_html(text) from public,anon,authenticated;
create or replace function public.create_delivery_package(t uuid,campaign uuid,expected_revision integer,settings jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;s public.designer_submissions;a public.designer_assignments;b public.brand_profiles;aud public.audiences;
 package uuid;new_revision integer;calendar_approval uuid;copy_approval uuid;design_approval uuid;snapshot jsonb;rendered text;
begin
 perform private.require_member(t,true);
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.delivery_revision is distinct from expected_revision then raise exception 'Stale delivery revision' using errcode='40001';end if;
 if c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Delivery active' using errcode='23514';end if;
 if c.calendar_state<>'approved' or c.copy_state<>'approved' or c.design_state<>'owner_approved' then raise exception 'Owner approvals required' using errcode='23514';end if;
 if c.planned_at<=now() then raise exception 'Schedule is in the past' using errcode='23514';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
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
create or replace function public.enqueue_delivery(t uuid,package uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.delivery_packages;c public.campaigns;j uuid;
begin
 perform private.require_member(t,true);
 select * into p from public.delivery_packages where id=package and tenant_id=t;
 if not found then raise exception 'Package unavailable' using errcode='42501';end if;
 select * into c from public.campaigns where id=p.campaign_id for update;
 if c.delivery_revision is distinct from expected_revision or p.revision<>c.delivery_revision then raise exception 'Stale package' using errcode='40001';end if;
 if c.delivery_state in ('queued','scheduled') then
 select id into j from public.job_runs where tenant_id=t and idempotency_key='schedule:'||p.id;return j;end if;
 if c.delivery_state<>'ready' or c.calendar_state<>'approved' or c.copy_state<>'approved' or c.design_state<>'owner_approved' or c.planned_at<=now() then raise exception 'Package is not ready' using errcode='23514';end if;
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'delivery',p.revision,auth.uid()) on conflict do nothing;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'delivery.schedule','schedule:'||p.id,jsonb_build_object('packageId',p.id,'deliveryRevision',p.revision),auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;
 update public.campaigns set delivery_state='queued',updated_at=now() where id=c.id;return j;
end $$;
create or replace function public.enqueue_cancel(t uuid,campaign uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;f public.fixture_deliveries;j uuid;
begin
 perform private.require_member(t,true);
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.delivery_revision is distinct from expected_revision then raise exception 'Stale delivery version' using errcode='40001';end if;
 select remote.* into f from public.fixture_deliveries remote join public.delivery_packages p on p.id=remote.package_id where p.campaign_id=c.id and p.revision=c.delivery_revision;
 if f.id is null or f.state not in ('scheduled','cancelled') then raise exception 'Confirmed schedule required' using errcode='23514';end if;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'delivery.cancel','cancel:'||f.id,jsonb_build_object('packageId',f.package_id,'providerId',f.id,'deliveryRevision',c.delivery_revision),auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;
 return j;
end $$;
create or replace function public.fixture_delivery_command(job uuid,lease uuid,command text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.job_runs;p public.delivery_packages;c public.campaigns;f public.fixture_deliveries;
begin
 select * into j from public.job_runs where id=job for update;
 if not found or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() or j.kind not in ('delivery.schedule','delivery.cancel') then raise exception 'Lease unavailable' using errcode='40001';end if;
 select * into p from public.delivery_packages where id=(j.input->>'packageId')::uuid and tenant_id=j.tenant_id;
 select * into c from public.campaigns where id=j.campaign_id for update;
 if p.id is null or c.delivery_revision<>p.revision then raise exception 'Stale package' using errcode='40001';end if;
 select * into f from public.fixture_deliveries where package_id=p.id for update;
 if command='reconcile' then return case when f.id is null then jsonb_build_object('outcome','absent') else jsonb_build_object('outcome','found','identity',jsonb_build_object('id',f.id,'packageId',p.id,'state',f.state,'scheduledAt',f.scheduled_at)) end;end if;
 if command in ('prepare','schedule') then
 if j.kind<>'delivery.schedule' or c.calendar_state<>'approved' or c.copy_state<>'approved' or c.design_state<>'owner_approved' or c.planned_at<=now() then raise exception 'Current approvals and future schedule required' using errcode='23514';end if;
 if c.product_id is not null and not exists(select 1 from public.products x where x.id=c.product_id and x.stock>0 and x.stock_observed_at>now()-interval '24 hours') then raise exception 'Stock unavailable or stale' using errcode='23514';end if;
 if c.offer_id is not null and not exists(select 1 from public.offers o where o.id=c.offer_id and c.planned_at between o.starts_at and o.ends_at) then raise exception 'Offer expired' using errcode='23514';end if;
 if f.id is null then
 insert into public.fixture_deliveries(tenant_id,package_id,idempotency_key,snapshot,state) values(p.tenant_id,p.id,j.idempotency_key,p.snapshot,'prepared') returning * into f;
 end if;
 if f.state='cancelled' or f.state='sent' then raise exception 'Remote campaign is no longer schedulable' using errcode='23514';end if;
 if command='schedule' then update public.fixture_deliveries set state='scheduled',scheduled_at=(p.snapshot->>'scheduledAt')::timestamptz,updated_at=now() where id=f.id returning * into f;end if;
 elsif command='cancel' then
 if j.kind<>'delivery.cancel' or f.id is null or f.id::text is distinct from j.input->>'providerId' then raise exception 'Provider identity unavailable' using errcode='23514';end if;
 if f.state='sent' or (f.state='scheduled' and f.scheduled_at<=now()) then update public.fixture_deliveries set state='sent',updated_at=now() where id=f.id returning * into f;
 else update public.fixture_deliveries set state='cancelled',updated_at=now() where id=f.id returning * into f;end if;
 else raise exception 'Unsupported fixture command' using errcode='23514';end if;
 update public.job_runs set checkpoint=jsonb_build_object('providerId',f.id,'providerState',f.state),updated_at=now() where id=j.id;
 return jsonb_build_object('id',f.id,'packageId',f.package_id,'state',f.state,'scheduledAt',f.scheduled_at);
end $$;
create or replace function public.finish_delivery_job(job uuid,lease uuid) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;f public.fixture_deliveries;c public.campaigns;
begin
 select * into j from public.job_runs where id=job for update;
 if not found or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='40001';end if;
 select * into f from public.fixture_deliveries where tenant_id=j.tenant_id and package_id=(j.input->>'packageId')::uuid;
 if f.id is null or (j.kind='delivery.schedule' and f.state<>'scheduled') or (j.kind='delivery.cancel' and f.state not in ('cancelled','sent')) then raise exception 'Provider confirmation required' using errcode='23514';end if;
 select * into c from public.campaigns where id=j.campaign_id for update;
 if c.delivery_revision<>(j.input->>'deliveryRevision')::integer then raise exception 'Stale delivery version' using errcode='40001';end if;
 update public.campaigns set delivery_state=f.state,updated_at=now() where id=c.id;
 update public.job_runs set status='succeeded',lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,j.created_by,'fixture_provider_'||f.state,jsonb_build_object('providerId',f.id,'packageId',f.package_id));
 perform private.notify_owners(c.tenant_id,'delivery_status',c.id,'Fixture provider confirmed '||f.state||'. No real message was sent.');
end $$;
create or replace function public.fail_job(job uuid,lease uuid,failure text) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 select * into j from public.job_runs where id=job for update;
 if not found or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease then raise exception 'Lease unavailable' using errcode='40001';end if;
 if failure not in ('transient','rate_limit','unknown_outcome','auth','validation') then raise exception 'Invalid failure class' using errcode='23514';end if;
 update public.job_runs set status=case when failure in ('transient','rate_limit') and attempt<4 then 'retry_wait' else 'failed' end,failure_class=failure,error_code='fixture_operation_failed',available_at=now()+make_interval(secs=>least(300,5*power(2,j.attempt)::integer)),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 if j.kind like 'delivery.%' then update public.campaigns set delivery_state=case when failure='unknown_outcome' then 'reconciling' else 'failed' end,updated_at=now() where id=j.campaign_id and delivery_revision=(j.input->>'deliveryRevision')::integer;end if;
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_delivery_package','enqueue_delivery','enqueue_cancel','fixture_delivery_command','finish_delivery_job','fail_job') loop
 execute format('revoke all on function %s from public,anon',f.sig);execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
