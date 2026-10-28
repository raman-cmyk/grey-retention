create or replace function private.render_inputs_current(t uuid,inputs jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.brand_profiles b where b.tenant_id=t and b.revision=(inputs->>'brand')::integer and b.approved_revision=b.revision)
 and ((inputs->>'channel')='email_text' or exists(select 1 from public.brand_kits k where k.tenant_id=t and k.revision=(inputs->>'kit')::integer and k.approved_by is not null))
 and not exists(select 1 from jsonb_each(coalesce(inputs->'assets','{}')) x where not exists(select 1 from public.assets a where a.id=x.key::uuid and a.tenant_id=t and a.revision=x.value::text::integer and a.category is not null and a.category<>'unusable' and exists(select 1 from storage.objects o where o.bucket_id='brand-assets' and o.name=a.storage_path)));
$$;
create or replace function public.enqueue_render(t uuid,campaign uuid,expected_copy integer,expected_design integer,source text default 'fixture_structure',source_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;b public.brand_profiles;k public.brand_kits;assets jsonb;input jsonb;j uuid;prior public.design_renders;feedback public.render_reviews;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into c from public.campaigns where id=campaign and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501';end if;
 if c.copy_revision is distinct from expected_copy or c.design_revision is distinct from expected_design then raise exception 'Stale render inputs' using errcode='40001';end if;
 if c.calendar_state<>'approved' or c.copy_state<>'approved' or c.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Current copy approval required or delivery active' using errcode='23514';end if;
 if exists(select 1 from public.designer_assignments where campaign_id=c.id and state<>'cancelled') then raise exception 'Human assignment active; admin must cancel it before changing paths' using errcode='23514';end if;
 perform private.assert_campaign_guards(c);
 if source not in ('fixture_structure','own_template','reference_structure') or (source='own_template' and not exists(select 1 from public.own_templates x where x.id=source_id and x.tenant_id=t)) or (source='reference_structure' and not exists(select 1 from public.competitor_emails e where e.id=source_id and private.capture_access(e.capture_id))) then raise exception 'Authorized structure required' using errcode='42501';end if;
 select * into b from public.brand_profiles where tenant_id=t;
 select * into k from public.brand_kits where tenant_id=t;
 if c.channel='email_design' and (k.approved_by is null or cardinality(k.colors)=0 or cardinality(k.fonts)=0) then raise exception 'Approve brand kit before image rendering' using errcode='23514';end if;
 select coalesce(jsonb_object_agg(a.id::text,a.revision),'{}') into assets from (select * from public.assets where tenant_id=t and category in ('logo','product','lifestyle','proof') and (product_id is null or product_id=c.product_id) order by case when category='logo' then 0 else 1 end,id limit 3) a;
 if c.channel='email_design' and assets='{}' then raise exception 'Usable approved-input assets required' using errcode='23514';end if;
 select * into prior from public.design_renders where campaign_id=c.id and revision=c.design_revision;
 if c.design_state='revisions_requested' then select * into feedback from public.render_reviews where render_id=prior.id and decision='revision' order by created_at desc limit 1;end if;
 input:=jsonb_build_object('brand',b.revision,'kit',k.revision,'assets',case when c.channel='email_text' then '{}'::jsonb else assets end,'channel',c.channel,'calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision,'source',source,'sourceId',source_id,'structure',case when source='reference_structure' then (select micro->'strips' from public.competitor_emails where id=source_id) when source='own_template' then (select skeleton->'sections' from public.own_templates where id=source_id and tenant_id=t) else jsonb_build_array('Hero','Copy','CTA') end,'baseRenderId',prior.id,'section',feedback.section,'feedback',feedback.feedback);
 if not private.render_inputs_current(t,input) then raise exception 'Current private assets and approved kit required' using errcode='23514';end if;
 insert into public.job_runs(tenant_id,campaign_id,kind,idempotency_key,input,created_by) values(t,c.id,'design.render','render:'||c.id||':'||c.copy_revision||':'||c.design_revision||':'||encode(extensions.digest(input::text,'sha256'),'hex'),input,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create or replace function public.record_render_upload(job uuid,lease uuid,path text,section text,hash text,byte_size integer) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 j:=private.onboarding_lease(job,lease);
 if j.kind<>'design.render' or path !~ ('^'||j.tenant_id::text||'/'||j.id::text||'/[a-f0-9]{64}\.svg$') or not exists(select 1 from storage.objects o where o.bucket_id='email-artifacts' and o.name=path) then raise exception 'Stored render artifact unavailable' using errcode='23514';end if;
 insert into public.verified_render_uploads(storage_path,tenant_id,job_id,section,sha256,byte_size) values(path,j.tenant_id,j.id,section,hash,byte_size) on conflict(storage_path) do nothing;
end $$;
revoke all on function public.record_render_upload(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_render_upload(uuid,uuid,text,text,text,integer) to service_role;
create or replace function public.finish_render_job(job uuid,lease uuid,output jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare j public.job_runs;c public.campaigns;prior public.design_renders;x jsonb;result uuid;v public.campaign_content;
begin
 j:=private.onboarding_lease(job,lease);perform 1 from public.tenants where id=j.tenant_id for update;
 select * into c from public.campaigns where id=j.campaign_id and tenant_id=j.tenant_id for update;
 if j.kind<>'design.render' or (output->>'synthetic')::boolean is distinct from true or jsonb_typeof(output->'strips') is distinct from 'array' then raise exception 'Invalid render output' using errcode='23514';end if;
 if c.copy_state<>'approved' or c.calendar_state<>'approved' or c.copy_revision is distinct from (j.input->>'copy')::integer or c.design_revision is distinct from (j.input->>'design')::integer or c.calendar_revision is distinct from (j.input->>'calendar')::integer or not private.render_inputs_current(c.tenant_id,j.input) then raise exception 'Render context changed' using errcode='40001';end if;
 perform private.assert_campaign_guards(c);
 select * into prior from public.design_renders where id=nullif(j.input->>'baseRenderId','')::uuid and campaign_id=c.id and copy_revision=c.copy_revision;
 if c.channel='email_text' and jsonb_array_length(output->'strips')<>0 then raise exception 'Text emails do not require image strips' using errcode='23514';end if;
 if c.channel='email_design' then
  if jsonb_array_length(output->'strips')<>3 or (select count(distinct value->>'section') from jsonb_array_elements(output->'strips'))<>3 then raise exception 'Hero, copy and CTA strips required' using errcode='23514';end if;
  for x in select value from jsonb_array_elements(output->'strips') loop
   if x->>'section' not in ('hero','copy','cta') or not exists(select 1 from public.verified_render_uploads u where u.storage_path=x->>'path' and u.tenant_id=c.tenant_id and u.section=x->>'section' and (u.job_id=j.id or (private.render_inputs_current(c.tenant_id,prior.input_revisions) and exists(select 1 from jsonb_array_elements(prior.strips) s where s->>'path'=u.storage_path and s->>'section'=u.section)))) then raise exception 'Verified scoped strip artifacts required' using errcode='23514';end if;
  end loop;
 end if;
 insert into public.design_renders(tenant_id,campaign_id,revision,copy_revision,strips,input_revisions,source,source_id,created_by) values(c.tenant_id,c.id,c.design_revision+1,c.copy_revision,output->'strips',j.input,j.input->>'source',nullif(j.input->>'sourceId','')::uuid,j.created_by) returning id into result;
 update public.campaigns set design_revision=design_revision+1,design_state='submitted',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 update public.job_runs set status='succeeded',checkpoint=jsonb_build_object('renderId',result,'synthetic',true),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,j.created_by,'fixture_design_submitted',jsonb_build_object('renderId',result,'revision',c.design_revision+1));
 perform private.notify_owners(c.tenant_id,'design_review',c.id,'An original synthetic render is ready. Owner review of the exact final version is required.');return result;
end $$;
create or replace function public.review_render(t uuid,render uuid,expected_revision integer,decision text,section text,feedback text) returns void language plpgsql security definer set search_path='' as $$
declare r public.design_renders;c public.campaigns;
begin
 perform private.require_member(t,true);perform 1 from public.tenants where id=t for update;
 select * into r from public.design_renders where id=render and tenant_id=t;
 select * into c from public.campaigns where id=r.campaign_id and tenant_id=t for update;
 if r.id is null then raise exception 'Render unavailable' using errcode='42501';end if;
 if c.design_revision is distinct from expected_revision or r.revision<>c.design_revision or r.copy_revision<>c.copy_revision or c.copy_state<>'approved' or c.design_state<>'submitted' or not private.render_inputs_current(t,r.input_revisions) then raise exception 'Stale design version or inputs' using errcode='40001';end if;
 if decision not in ('revision','approved') or section not in ('hero','copy','cta','whole_design') or length(feedback)>5000 or (decision='revision' and (length(feedback)<5 or section='whole_design')) then raise exception 'Explicit section feedback required' using errcode='23514';end if;
 insert into public.render_reviews(tenant_id,render_id,decision,section,feedback,actor_id) values(t,r.id,decision,section,feedback,auth.uid());
 if decision='approved' then
  insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,c.id,'design',c.design_revision,auth.uid()) on conflict do nothing;
  update public.campaigns set design_state='owner_approved',updated_at=now() where id=c.id;
 else update public.campaigns set design_state='revisions_requested',updated_at=now() where id=c.id;end if;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'fixture_design_'||decision,jsonb_build_object('renderId',r.id,'section',section,'feedback',feedback));
end $$;
create or replace function private.assert_render_ready(c public.campaigns) returns void language plpgsql security definer set search_path='' as $$
declare r public.design_renders;
begin
 select * into r from public.design_renders where campaign_id=c.id and revision=c.design_revision and copy_revision=c.copy_revision;
 if r.id is not null then
  if c.design_state<>'owner_approved' or not private.render_inputs_current(c.tenant_id,r.input_revisions) or not exists(select 1 from public.render_reviews v where v.render_id=r.id and v.decision='approved') or exists(select 1 from jsonb_array_elements(r.strips) x where not exists(select 1 from storage.objects o where o.bucket_id='email-artifacts' and o.name=x->>'path')) then raise exception 'Current owner-approved render and assets required' using errcode='23514';end if;
 end if;
end $$;
create or replace function public.save_own_template(t uuid,delivery uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.fixture_deliveries;c public.campaigns;result uuid;
begin
 perform private.require_member(t,true);
 select * into d from public.fixture_deliveries where id=delivery and tenant_id=t and state='sent';
 if not found then raise exception 'Confirmed simulated send required' using errcode='23514';end if;
 select campaign.* into c from public.campaigns campaign join public.delivery_packages p on p.campaign_id=campaign.id where p.id=d.package_id and p.tenant_id=t;
 insert into public.own_templates(tenant_id,name,skeleton,campaign_id,delivery_id,created_by) values(t,left(c.title,180)||' · own skeleton',jsonb_build_object('sections',jsonb_build_array('hero','copy','cta'),'source','own_confirmed_send','synthetic',true,'copyReusable',false),c.id,d.id,auth.uid()) on conflict(delivery_id) do update set delivery_id=excluded.delivery_id returning id into result;return result;
end $$;
revoke all on function private.render_inputs_current(uuid,jsonb),private.assert_render_ready(public.campaigns) from public,anon,authenticated;
do $$declare f text;begin foreach f in array array['public.enqueue_render(uuid,uuid,integer,integer,text,uuid)','public.finish_render_job(uuid,uuid,jsonb)','public.review_render(uuid,uuid,integer,text,text,text)','public.save_own_template(uuid,uuid)'] loop execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;

create or replace function public.create_delivery_package(t uuid,campaign uuid,expected_revision integer,settings jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.campaigns;v public.campaign_content;s public.designer_submissions;a public.designer_assignments;b public.brand_profiles;aud public.audiences;
 r public.design_renders;paths jsonb;primary_link text;
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
 select * into r from public.design_renders where campaign_id=c.id and revision=c.design_revision and copy_revision=c.copy_revision;
 if r.id is not null then perform private.assert_render_ready(c);paths:=(select coalesce(jsonb_agg(x->>'path'),'[]') from jsonb_array_elements(r.strips) x);
 else
  if s.id is null or not exists(select 1 from storage.objects o where o.bucket_id='designer-submissions' and o.name=s.storage_path) then raise exception 'Current approved artifact unavailable' using errcode='23514';end if;paths:=jsonb_build_array(s.storage_path);
 end if;
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
 if position('#' in v.primary_url)>0 or v.primary_url ~ '[?&]utm_(source|medium|campaign)=' or v.primary_url !~ ('^https://' || replace(b.domain,'.','\.') || '(/|$)') or (settings->>'unsubscribeUrl') !~ ('^https://' || replace(b.domain,'.','\.') || '(/|$)') or (settings->>'privacyUrl') !~ ('^https://' || replace(b.domain,'.','\.') || '(/|$)') then raise exception 'Fixture link validation requires approved brand-domain destinations' using errcode='23514';end if;
 if c.product_id is not null and v.primary_url is distinct from (select url from public.products where id=c.product_id and tenant_id=t) then raise exception 'Product CTA must map to the verified catalog URL' using errcode='23514';end if;
 primary_link:=v.primary_url||case when position('?' in v.primary_url)>0 then '&' else '?' end||'utm_source=grey_retention_fixture&utm_medium=email&utm_campaign='||c.id::text;
 package:=gen_random_uuid();new_revision:=c.delivery_revision+1;
 -- Render from approved sources inside the trusted transaction; never accept caller HTML.
 rendered:='<html><body><main><h1>'||private.escape_html(v.subject)||'</h1><p>'||private.escape_html(v.preheader)||'</p>'||case when c.channel='email_design' then case when r.id is not null then (select string_agg('<a href="'||private.escape_html(primary_link)||'"><img src="cid:'||private.escape_html(x->>'section')||'" width="600" style="max-width:100%;display:block" alt="Owner-approved '||private.escape_html(x->>'section')||' strip"></a>','' order by n) from jsonb_array_elements(r.strips) with ordinality as strips(x,n)) else '<img src="cid:design-artifact" width="600" alt="Owner-approved campaign design">' end else '' end||'<p style="white-space:pre-wrap">'||private.escape_html(v.body)||'</p><a href="'||private.escape_html(primary_link)||'">'||private.escape_html(v.cta)||'</a></main><footer><p>'||private.escape_html(settings->>'address')||'</p><a href="'||private.escape_html(settings->>'unsubscribeUrl')||'">Unsubscribe</a> · <a href="'||private.escape_html(settings->>'privacyUrl')||'">Privacy</a></footer></body></html>';
 snapshot:=jsonb_build_object('schemaVersion',1,'id',package,'tenantId',t,'campaignId',c.id,'revision',new_revision,'channel',c.channel,
 'subject',v.subject,'preheader',v.preheader,'text',v.body,'html',rendered,'assetPaths',paths,
 'links',jsonb_build_array(primary_link,settings->>'unsubscribeUrl',settings->>'privacyUrl'),'footer',jsonb_build_object('address',settings->>'address','unsubscribeUrl',settings->>'unsubscribeUrl','privacyUrl',settings->>'privacyUrl'),
 'audience',jsonb_build_object('accountId',aud.account_id,'includes',jsonb_build_array(aud.provider_id),'excludes',to_jsonb(aud.excluded_provider_ids)),
 'sender',jsonb_build_object('name',settings->>'senderName','email',settings->>'senderEmail'),'scheduledAt',to_char(c.planned_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timezone',c.timezone,
 'approvals',jsonb_build_object('calendar',calendar_approval,'copy',copy_approval,'design',design_approval),'sourceRevisions',jsonb_build_object('calendar',c.calendar_revision,'copy',c.copy_revision,'design',c.design_revision),
 'createdAt',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'synthetic',true);
 insert into public.delivery_packages(id,tenant_id,campaign_id,revision,snapshot,created_by) values(package,t,c.id,new_revision,snapshot,auth.uid());
 update public.campaigns set delivery_revision=new_revision,delivery_state='ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,c.id,auth.uid(),'package_validated_fixture',jsonb_build_object('packageId',package,'revision',new_revision));return package;
end $$;

create or replace function private.render_push_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 if new.state in ('prepared','scheduled') then select campaign.* into c from public.campaigns campaign join public.delivery_packages p on p.campaign_id=campaign.id where p.id=new.package_id and p.tenant_id=new.tenant_id;perform private.assert_render_ready(c);end if;return new;
end $$;
create trigger fixture_render_guard before insert or update on public.fixture_deliveries for each row execute function private.render_push_guard();
revoke all on function private.render_push_guard() from public,anon,authenticated;

create or replace function private.enrich_inspiration_pack() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 select * into c from public.campaigns where id=new.campaign_id;
 new.brief:=new.brief||jsonb_build_object('brandRevision',(select revision from public.brand_profiles where tenant_id=new.tenant_id),'kit',(select jsonb_build_object('revision',revision,'colors',colors,'fonts',fonts,'approved',approved_by is not null) from public.brand_kits where tenant_id=new.tenant_id),'assetIds',(select coalesce(jsonb_agg(id),'[]') from (select id from public.assets where tenant_id=new.tenant_id and category is not null and category<>'unusable' and (product_id is null or product_id=c.product_id) order by id limit 3) a),'assetPaths',(select coalesce(jsonb_agg(storage_path),'[]') from (select storage_path from public.assets where tenant_id=new.tenant_id and category is not null and category<>'unusable' and (product_id is null or product_id=c.product_id) order by id limit 3) a),'lineage',c.lineage,'sequenceBrief',(select brief from public.campaign_sequences where id=c.sequence_id));return new;
end $$;
create trigger inspiration_pack before insert on public.designer_assignments for each row execute function private.enrich_inspiration_pack();
create or replace function private.designer_asset_access(asset uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.designer_assignments a where private.assigned_designer(a.id) and a.brief->'assetIds' @> jsonb_build_array(asset::text));
$$;
create or replace function private.asset_object_access(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assets a where a.storage_path=path and (private.is_active_member(a.tenant_id) or private.designer_asset_access(a.id)));
$$;
revoke all on function private.enrich_inspiration_pack(),private.designer_asset_access(uuid) from public,anon;
grant execute on function private.designer_asset_access(uuid) to authenticated;
create policy assigned_pack_read on public.assets for select to authenticated using(private.designer_asset_access(id));
-- Corrected source assets/kit are material inputs. Cancel/reconcile accepted delivery before editing them.
create or replace function private.invalidate_render_asset() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 if new.revision=old.revision then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if exists(select 1 from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and r.input_revisions->'assets' ? new.id::text and campaign.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling')) then raise exception 'Cancel or reconcile delivery before changing a used asset' using errcode='23514';end if;
 for c in select campaign.* from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and r.input_revisions->'assets' ? new.id::text for update of campaign loop
 update public.campaigns set design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,coalesce(auth.uid(),c.created_by),'asset_design_invalidated',jsonb_build_object('assetId',new.id,'assetRevision',new.revision));
 end loop;return new;
end $$;
create trigger render_asset_invalidation before update on public.assets for each row execute function private.invalidate_render_asset();
create or replace function private.invalidate_render_kit() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.campaigns;
begin
 if new.revision=old.revision then return new;end if;
 perform 1 from public.tenants where id=new.tenant_id for update;
 if exists(select 1 from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and campaign.channel='email_design' and campaign.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling')) then raise exception 'Cancel or reconcile delivery before changing a used kit' using errcode='23514';end if;
 for c in select campaign.* from public.campaigns campaign join public.design_renders r on r.campaign_id=campaign.id and r.revision=campaign.design_revision where campaign.tenant_id=new.tenant_id and campaign.channel='email_design' for update of campaign loop
 update public.campaigns set design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where id=c.id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(c.tenant_id,c.id,coalesce(auth.uid(),c.created_by),'kit_design_invalidated',jsonb_build_object('kitRevision',new.revision));
 end loop;return new;
end $$;
create trigger render_kit_invalidation before update on public.brand_kits for each row execute function private.invalidate_render_kit();
revoke all on function private.invalidate_render_asset(),private.invalidate_render_kit() from public,anon,authenticated;
