alter table public.job_runs add constraint job_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
alter table public.delivery_packages add constraint package_campaign_tenant foreign key(tenant_id,campaign_id) references public.campaigns(tenant_id,id);
alter table public.ai_calls add constraint ai_job foreign key(job_id) references public.job_runs(id);
create or replace function private.is_operator() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins a join public.profiles p on p.id=a.profile_id where a.profile_id=auth.uid() and a.active and p.status='active');
$$;
create or replace function private.worker_access(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active_member(t,array['owner']::public.tenant_role[]) or private.is_operator() or auth.role()='service_role';
$$;
revoke all on function private.is_operator(),private.worker_access(uuid) from public,anon,authenticated;
create or replace function private.notify_review(t uuid,recipient uuid,event_kind text,entity uuid,message text) returns void language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
 insert into public.notifications(tenant_id,recipient_id,kind,entity_id,message) values(t,recipient,event_kind,entity,message) returning id into n;
 insert into public.notification_deliveries(notification_id,tenant_id,channel,state,provider) values(n,t,'email','simulated','fixture');
end $$;
create or replace function private.notify_owners(t uuid,event_kind text,entity uuid,message text) returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select m.profile_id from public.tenant_memberships m join public.profiles p on p.id=m.profile_id where m.tenant_id=t and m.role='owner' and m.status='active' and p.status='active' loop
 perform private.notify_review(t,r.profile_id,event_kind,entity,message);
 end loop;
end $$;
revoke all on function private.notify_review(uuid,uuid,text,uuid,text),private.notify_owners(uuid,text,uuid,text) from public,anon,authenticated;

create or replace function public.enqueue_copy(t uuid,campaign uuid,expected_revision integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;j uuid;
begin
 perform private.require_member(t,true);
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501'; end if;
 if c.calendar_state<>'approved' or c.copy_revision is distinct from expected_revision then raise exception 'Approve current calendar first' using errcode='23514'; end if;
 if c.copy_state='approved' or c.delivery_state not in ('not_ready','ready','failed','cancelled') then raise exception 'Approved copy or delivery active; revise first' using errcode='23514'; end if;
 if not exists(select 1 from public.brand_profiles b where b.tenant_id=t and b.approved_revision=b.revision) then raise exception 'Brand approval required' using errcode='23514'; end if;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by)
 values(t,campaign,'copy.generate','copy:'||campaign||':'||expected_revision,jsonb_build_object('copyRevision',expected_revision,'calendarRevision',c.calendar_revision),auth.uid())
 on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create or replace function public.claim_job(t uuid) returns setof public.job_runs language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 if not private.worker_access(t) then raise exception 'Access denied' using errcode='42501'; end if;
 update public.job_runs set status=case when attempt>=4 then 'failed' else 'retry_wait' end,lease_token=null,lease_until=null,available_at=now(),error_code='stale_lease' where tenant_id=t and status in ('leased','running') and lease_until<now();
 select * into j from public.job_runs where tenant_id=t and status in ('queued','retry_wait') and attempt<4 and available_at<=now() order by available_at,created_at for update skip locked limit 1;
 if not found then return;end if;
 return query update public.job_runs set status='running',attempt=attempt+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning *;
end $$;
create or replace function public.finish_copy_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;c public.campaigns;new_revision integer;b public.brand_profiles;
begin
 select * into j from public.job_runs where id=job for update;
 if not found or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501'; end if;
 if j.kind<>'copy.generate' or j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='40001';end if;
 select * into c from public.campaigns where id=j.campaign_id for update;
 if c.calendar_state<>'approved' or c.copy_state='approved' or c.copy_revision<>(j.input->>'copyRevision')::integer or c.calendar_revision<>(j.input->>'calendarRevision')::integer then raise exception 'Stale copy job' using errcode='40001';end if;
 select * into b from public.brand_profiles where tenant_id=j.tenant_id;
 if b.approved_revision is distinct from b.revision or (output->>'brandRevision')::integer is distinct from b.revision or (output->>'synthetic') is distinct from 'true' then raise exception 'Unapproved inputs' using errcode='23514';end if;
 new_revision:=c.copy_revision+1;
 insert into public.campaign_content(tenant_id,campaign_id,revision,subject,subject_options,preheader,body,cta,primary_url,created_by)
 values(c.tenant_id,c.id,new_revision,output->>'subject',array(select jsonb_array_elements_text(output->'subjects')),output->>'preheader',output->>'body',output->>'cta',output->>'url',j.created_by);
 update public.campaigns set copy_revision=new_revision,copy_state='pending_approval',design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.ai_calls(tenant_id,job_id,feature,prompt_version,provider,status,input_tokens,output_tokens,input_revisions) values(c.tenant_id,j.id,'copy','cleanroom-copy-v1','fixture','succeeded',0,0,jsonb_build_object('brand',b.revision,'calendar',c.calendar_revision));
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('copyRevision',new_revision),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,j.created_by,'fixture_copy_generated',jsonb_build_object('revision',new_revision,'jobId',j.id));
 perform private.notify_owners(c.tenant_id,'copy_review',c.id,'Synthetic copy is ready for exact-version owner review.');
end $$;
create or replace function public.save_copy(t uuid,campaign uuid,expected_revision integer,input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 perform private.require_member(t);
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_revision then raise exception 'Stale copy revision' using errcode='40001';end if;
 if c.calendar_state<>'approved' or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Calendar approval required or delivery active' using errcode='23514';end if;
 if c.copy_state='approved' and not private.is_active_member(t,array['owner']::public.tenant_role[]) then raise exception 'Owner required to revise approved copy' using errcode='42501';end if;
 insert into public.campaign_content(tenant_id,campaign_id,revision,subject,subject_options,preheader,body,cta,primary_url,created_by) values(t,c.id,c.copy_revision+1,input->>'subject',array[input->>'subject'],input->>'preheader',input->>'body',input->>'cta',input->>'url',auth.uid());
 update public.campaigns set copy_revision=copy_revision+1,copy_state='pending_approval',design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'copy_revised',jsonb_build_object('revision',c.copy_revision+1));
end $$;
create or replace function public.approve_copy(t uuid,campaign uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;
begin
 perform private.require_member(t,true);
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_revision then raise exception 'Stale copy revision' using errcode='40001';end if;
 if c.calendar_state<>'approved' or c.copy_state not in ('pending_approval','approved') then raise exception 'Copy not ready for review' using errcode='23514';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 if char_length(btrim(v.body))<1 or char_length(btrim(v.subject))<1 or v.primary_url !~ '^https://' then raise exception 'Copy and HTTPS destination required' using errcode='23514';end if;
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'copy',expected_revision,auth.uid()) on conflict do nothing;
 update public.campaigns set copy_state='approved',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'copy_approved',jsonb_build_object('revision',expected_revision));
end $$;
create or replace function public.design_operations() returns table(campaign_id uuid,tenant_id uuid,title text,copy_revision integer,design_state text,assignment_id uuid,designer_id uuid,due_at timestamptz) language sql stable security definer set search_path='' as $$
 select c.id,c.tenant_id,c.title,c.copy_revision,c.design_state,a.id,a.designer_id,a.due_at from public.campaigns c left join public.designer_assignments a on a.campaign_id=c.id and a.state<>'cancelled' where private.is_operator() and c.copy_state='approved' order by c.planned_at;
$$;
create or replace function public.assignable_designers(t uuid) returns table(id uuid,name text) language sql stable security definer set search_path='' as $$
 select d.id,p.full_name from public.designers d join public.profiles p on p.id=d.profile_id join public.designer_tenant_access a on a.designer_id=d.id where private.is_operator() and a.tenant_id=t and d.status='active' and p.status='active';
$$;
create or replace function public.assign_campaign(t uuid,campaign uuid,designer uuid,expected_copy integer) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;a uuid;b public.brand_profiles;recipient uuid;
begin
 if not private.is_operator() then raise exception 'Platform assignment permission required' using errcode='42501';end if;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_state<>'approved' or c.copy_revision is distinct from expected_copy or c.calendar_state<>'approved' then raise exception 'Approved current brief required' using errcode='40001';end if;
 if c.design_state='owner_approved' or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Owner review or active delivery prevents reassignment' using errcode='23514';end if;
 select d.profile_id into recipient from public.designers d join public.designer_tenant_access x on x.designer_id=d.id join public.profiles p on p.id=d.profile_id where d.id=designer and d.status='active' and p.status='active' and x.tenant_id=t;
 if not found then raise exception 'Designer access required' using errcode='42501';end if;
 select * into v from public.campaign_content where campaign_id=c.id and revision=c.copy_revision;
 select * into b from public.brand_profiles where tenant_id=t;
 update public.designer_assignments set state='cancelled',updated_at=now() where campaign_id=c.id and state<>'cancelled';
 insert into public.designer_assignments(tenant_id,campaign_id,designer_id,copy_revision,brief,due_at,assigned_by)
 values(t,c.id,designer,c.copy_revision,jsonb_build_object('title',c.title,'subject',v.subject,'preheader',v.preheader,'body',v.body,'cta',v.cta,'url',v.primary_url,'brandName',b.brand_name,'voice',b.voice,'prohibitions',b.prohibitions,'referenceStructure',c.reference_notes,'copyRevision',c.copy_revision,'assetPaths',jsonb_build_array()),now()+interval '24 hours',auth.uid()) returning id into a;
 update public.campaigns set design_state='assigned',design_revision=design_revision+1,delivery_state='not_ready',delivery_revision=delivery_revision+1,updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'designer_assigned',jsonb_build_object('assignmentId',a,'copyRevision',c.copy_revision));
 perform private.notify_review(t,recipient,'assignment',c.id,'Approved brief assigned. A 24-hour synthetic workflow SLA applies.');return a;
end $$;
create or replace function public.assignment_brief(assignment uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.designer_assignments;c public.campaigns;
begin
 select * into a from public.designer_assignments where id=assignment;
 if not found or not private.assigned_designer(a.id) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 select * into c from public.campaigns where id=a.campaign_id;
 return jsonb_build_object('brief',a.brief,'tenantId',a.tenant_id,'campaignId',a.campaign_id,'assignmentId',a.id,'state',a.state,'dueAt',a.due_at,'designRevision',c.design_revision,'stale',a.copy_revision<>c.copy_revision or c.copy_state<>'approved');
end $$;
create or replace function public.record_design_upload(assignment uuid,actor uuid,path text,hash text,media_type text,byte_size integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.designer_assignments;
begin
 select * into a from public.designer_assignments where id=assignment;
 if not found or a.state not in ('assigned','revisions_requested') or not exists(select 1 from public.designers d join public.profiles p on p.id=d.profile_id join public.designer_tenant_access x on x.designer_id=d.id where d.id=a.designer_id and d.profile_id=actor and d.status='active' and p.status='active' and x.tenant_id=a.tenant_id) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 if split_part(path,'/',1)<>a.tenant_id::text or split_part(path,'/',2)<>a.id::text or not exists(select 1 from storage.objects o where o.bucket_id='designer-submissions' and o.name=path) then raise exception 'Stored artifact unavailable' using errcode='23514';end if;
 insert into public.verified_design_uploads(storage_path,tenant_id,assignment_id,uploaded_by,sha256,media_type,byte_size) values(path,a.tenant_id,a.id,actor,hash,media_type,byte_size);
end $$;
revoke all on function public.record_design_upload(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_design_upload(uuid,uuid,text,text,text,integer) to service_role;
create or replace function public.submit_design(assignment uuid,expected_revision integer,path text,notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.designer_assignments;c public.campaigns;s uuid;
begin
 select * into a from public.designer_assignments where id=assignment for update;
 if not found or not private.assigned_designer(a.id) then raise exception 'Assignment unavailable' using errcode='42501';end if;
 select * into c from public.campaigns where id=a.campaign_id for update;
 if c.design_revision is distinct from expected_revision or c.copy_revision<>a.copy_revision or c.copy_state<>'approved' then raise exception 'Stale design brief' using errcode='40001';end if;
 if a.state not in ('assigned','revisions_requested') then raise exception 'Submission not currently permitted' using errcode='23514';end if;
 if not exists(select 1 from public.verified_design_uploads u where u.storage_path=path and u.assignment_id=a.id and u.uploaded_by=auth.uid() and u.tenant_id=a.tenant_id) then raise exception 'Validated upload required' using errcode='23514';end if;
 insert into public.designer_submissions(tenant_id,assignment_id,revision,copy_revision,storage_path,notes,submitted_by) values(a.tenant_id,a.id,c.design_revision+1,c.copy_revision,path,notes,auth.uid()) returning id into s;
 update public.designer_assignments set state='submitted',updated_at=now() where id=a.id;
 update public.campaigns set design_revision=design_revision+1,design_state='submitted',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(a.tenant_id,c.id,auth.uid(),'design_submitted',jsonb_build_object('submissionId',s,'revision',c.design_revision+1));
 perform private.notify_owners(a.tenant_id,'design_review',c.id,'A new design version is ready for owner review.');return s;
end $$;
create or replace function public.review_design(t uuid,submission uuid,expected_revision integer,decision text,section text,feedback text) returns void language plpgsql security definer set search_path='' as $$
declare s public.designer_submissions;a public.designer_assignments;c public.campaigns;recipient uuid;
begin
 perform private.require_member(t,true);
 select * into s from public.designer_submissions where id=submission and tenant_id=t;
 if not found then raise exception 'Submission unavailable' using errcode='42501';end if;
 select * into a from public.designer_assignments where id=s.assignment_id for update;
 select * into c from public.campaigns where id=a.campaign_id for update;
 if c.design_revision is distinct from expected_revision or s.revision<>c.design_revision or s.copy_revision<>c.copy_revision or c.copy_state<>'approved' or a.state='cancelled' then raise exception 'Stale design version' using errcode='40001';end if;
 if c.design_state not in ('submitted','owner_approved') or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Design unavailable for review' using errcode='23514';end if;
 if decision='revision' and char_length(btrim(feedback))<5 then raise exception 'Section feedback required' using errcode='23514';end if;
 if decision not in ('revision','approved') then raise exception 'Invalid review decision' using errcode='23514';end if;
 insert into public.designer_reviews(tenant_id,assignment_id,submission_id,decision,section,feedback,actor_id) values(t,a.id,s.id,decision,section,feedback,auth.uid());
 update public.designer_assignments set state=case when decision='approved' then 'approved' else 'revisions_requested' end,updated_at=now() where id=a.id;
 update public.campaigns set design_state=case when decision='approved' then 'owner_approved' else 'revisions_requested' end,delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 if decision='approved' then
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'design',s.revision,auth.uid()) on conflict do nothing;
 else
 select profile_id into recipient from public.designers where id=a.designer_id;
 perform private.notify_review(t,recipient,'revision',c.id,'Owner requested section-specific revisions. Review feedback on the assignment.');
 end if;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),case when decision='approved' then 'design_owner_approved' else 'design_revision_requested' end,jsonb_build_object('submissionId',s.id,'revision',s.revision));
end $$;
-- No ambient/public access to domain commands.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enqueue_copy','claim_job','finish_copy_job','save_copy','approve_copy','design_operations','assignable_designers','assign_campaign','assignment_brief','submit_design','review_design') loop
 execute format('revoke all on function %s from public,anon',f.sig);
 execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
