create or replace function private.require_member(t uuid, owner_only boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_active_member(t, case when owner_only then array['owner']::public.tenant_role[] else null end) then
 raise exception 'Access denied' using errcode='42501'; end if;
end $$;
revoke all on function private.require_member(uuid,boolean) from public,anon,authenticated;

create or replace function public.save_brand(t uuid, expected_revision integer, brand_name text, domain text, positioning text, voice text, prohibitions text)
returns void language plpgsql security definer set search_path='' as $$
declare current public.brand_profiles;
begin
 perform private.require_member(t,true);
 perform 1 from public.tenants where id=t for update;
 select * into current from public.brand_profiles where tenant_id=t for update;
 if found and current.revision is distinct from expected_revision then raise exception 'Stale brand revision' using errcode='40001'; end if;
 if not found and expected_revision<>0 then raise exception 'Stale brand revision' using errcode='40001'; end if;
 insert into public.brand_profiles(tenant_id,brand_name,domain,positioning,voice,prohibitions,corrections,revision)
 values(t,brand_name,domain,positioning,voice,prohibitions,jsonb_build_object('positioning',positioning,'voice',voice,'prohibitions',prohibitions),1)
 on conflict(tenant_id) do update set brand_name=excluded.brand_name,domain=excluded.domain,positioning=excluded.positioning,voice=excluded.voice,prohibitions=excluded.prohibitions,
 corrections=excluded.corrections,revision=public.brand_profiles.revision+1,approved_revision=null,approved_by=null,approved_at=null,updated_at=now();
end $$;
create or replace function public.approve_brand(t uuid, expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 update public.brand_profiles set approved_revision=revision,approved_by=auth.uid(),approved_at=now() where tenant_id=t and revision=expected_revision;
 if not found then raise exception 'Stale brand revision' using errcode='40001'; end if;
end $$;
create or replace function public.create_product(t uuid,title text,url text,price_minor integer,stock integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform private.require_member(t,true);
 insert into public.products(tenant_id,title,url,price_minor,stock,stock_observed_at,source) values(t,title,url,price_minor,stock,now(),'manual') returning id into result; return result;
end $$;
create or replace function public.create_offer(t uuid,label text,kind text,depth_percent integer,conditions text,starts_at timestamptz,ends_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform private.require_member(t,true);
 insert into public.offers(tenant_id,label,kind,depth_percent,conditions,starts_at,ends_at,approved_by) values(t,label,kind,depth_percent,conditions,starts_at,ends_at,auth.uid()) returning id into result; return result;
end $$;
create or replace function public.save_campaign(t uuid, target_id uuid default null, expected_revision integer default 0, input jsonb default '{}')
returns uuid language plpgsql security definer set search_path='' as $$
declare current public.campaigns; result uuid; tz text; new_copy integer; material boolean;
begin
 perform private.require_member(t);
 select timezone into tz from public.tenants where id=t;
 if target_id is not null then
 select * into current from public.campaigns where id=target_id and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501'; end if;
 if current.calendar_revision is distinct from expected_revision then raise exception 'Stale campaign revision; refresh before saving' using errcode='40001'; end if;
 if current.delivery_state in ('queued','preparing','prepared','scheduling','scheduled','sent','reconciling') then raise exception 'Delivery active; reconcile or cancel before editing' using errcode='23514'; end if;
 if current.calendar_state='approved' and not private.is_active_member(t,array['owner']::public.tenant_role[]) then raise exception 'Only owner may revise approved entry' using errcode='42501'; end if;
 material := (current.title,current.goal,current.channel,current.product_id,current.offer_id,current.reference_notes) is distinct from (input->>'title',input->>'goal',input->>'channel',nullif(input->>'product_id','')::uuid,nullif(input->>'offer_id','')::uuid,coalesce(input->>'reference_notes',''));
 update public.campaigns set title=input->>'title',goal=input->>'goal',channel=input->>'channel',planned_at=(input->>'planned_at')::timestamptz,
 audience_id=nullif(input->>'audience_id','')::uuid,product_id=nullif(input->>'product_id','')::uuid,offer_id=nullif(input->>'offer_id','')::uuid,reference_notes=coalesce(input->>'reference_notes',''),
 calendar_revision=calendar_revision+1,calendar_state='proposed',copy_revision=copy_revision+case when material then 1 else 0 end,copy_state=case when material then 'draft' else copy_state end,design_revision=design_revision+case when material then 1 else 0 end,design_state=case when material then 'unassigned' else design_state end,delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now()
 where id=target_id returning id,copy_revision into result,new_copy;
 else
 if expected_revision<>0 then raise exception 'Invalid initial revision' using errcode='40001'; end if;
 insert into public.campaigns(tenant_id,title,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,reference_notes,created_by,lineage)
 values(t,input->>'title',input->>'goal',input->>'channel',(input->>'planned_at')::timestamptz,tz,nullif(input->>'audience_id','')::uuid,nullif(input->>'product_id','')::uuid,nullif(input->>'offer_id','')::uuid,coalesce(input->>'reference_notes',''),auth.uid(),jsonb_build_object('source','manual','brandRevision',(select revision from public.brand_profiles where tenant_id=t)))
 returning id,copy_revision into result,new_copy;
 end if;
 insert into public.campaign_content(tenant_id,campaign_id,revision,created_by) values(t,result,new_copy,auth.uid()) on conflict(campaign_id,revision) do nothing;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,result,auth.uid(),case when target_id is null then 'created' else 'calendar_revised' end,jsonb_build_object('calendarRevision',expected_revision+1));
 return result;
end $$;
create or replace function public.approve_calendar(t uuid,target_id uuid,expected_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare current public.campaigns;
begin
 perform private.require_member(t,true);
 select * into current from public.campaigns where id=target_id and tenant_id=t for update;
 if not found then raise exception 'Campaign unavailable' using errcode='42501'; end if;
 if current.calendar_revision is distinct from expected_revision then raise exception 'Stale calendar revision' using errcode='40001'; end if;
 if current.audience_id is null then raise exception 'Select an audience first' using errcode='23514'; end if;
 if current.planned_at<=now() then raise exception 'Choose a future schedule' using errcode='23514'; end if;
 if not exists(select 1 from public.brand_profiles b where b.tenant_id=t and b.approved_revision=b.revision) then raise exception 'Approve brand context first' using errcode='23514'; end if;
 if current.offer_id is not null and not exists(select 1 from public.offers o where o.id=current.offer_id and current.planned_at between o.starts_at and o.ends_at) then raise exception 'Offer is not valid at schedule' using errcode='23514'; end if;
 if current.product_id is not null and not exists(select 1 from public.products p where p.id=current.product_id and p.stock>0 and p.stock_observed_at>now()-interval '24 hours') then raise exception 'Product stock missing or stale' using errcode='23514'; end if;
 insert into public.campaign_approvals(tenant_id,campaign_id,kind,revision,actor_id) values(t,target_id,'calendar',expected_revision,auth.uid()) on conflict do nothing;
 update public.campaigns set calendar_state='approved',updated_at=now() where id=target_id;
 insert into public.campaign_events(tenant_id,campaign_id,actor_id,action,detail) values(t,target_id,auth.uid(),'calendar_approved',jsonb_build_object('revision',expected_revision));
end $$;
create or replace function public.add_campaign_note(t uuid,target_id uuid,body text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t);
 if not exists(select 1 from public.campaigns c where c.id=target_id and c.tenant_id=t) then raise exception 'Campaign unavailable' using errcode='42501'; end if;
 insert into public.campaign_comments(tenant_id,campaign_id,actor_id,body) values(t,target_id,auth.uid(),body);
end $$;
-- Lock every exposed command to authenticated callers. Definers derive actor from auth.uid().
revoke all on function public.save_brand(uuid,integer,text,text,text,text,text),public.approve_brand(uuid,integer),public.create_product(uuid,text,text,integer,integer),public.create_offer(uuid,text,text,integer,text,timestamptz,timestamptz),public.save_campaign(uuid,uuid,integer,jsonb),public.approve_calendar(uuid,uuid,integer),public.add_campaign_note(uuid,uuid,text) from public,anon;
grant execute on function public.save_brand(uuid,integer,text,text,text,text,text),public.approve_brand(uuid,integer),public.create_product(uuid,text,text,integer,integer),public.create_offer(uuid,text,text,integer,text,timestamptz,timestamptz),public.save_campaign(uuid,uuid,integer,jsonb),public.approve_calendar(uuid,uuid,integer),public.add_campaign_note(uuid,uuid,text) to authenticated;
