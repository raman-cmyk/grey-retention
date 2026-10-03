create table public.brand_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),revision integer not null,
 action text not null,actor_id uuid references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.brand_events enable row level security;
create policy tenant_read on public.brand_events for select to authenticated using(private.is_active_member(tenant_id));
grant select on public.brand_events to authenticated;
create or replace function private.brand_revision_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.revision<>old.revision then
  perform 1 from public.campaigns where tenant_id=new.tenant_id for update;
  if exists(select 1 from public.campaigns where tenant_id=new.tenant_id and delivery_state in ('queued','preparing','prepared','scheduling','scheduled','reconciling')) then raise exception 'Cancel or reconcile active delivery before correcting brand facts' using errcode='23514';end if;
  update public.campaigns set calendar_revision=calendar_revision+1,calendar_state='proposed',copy_revision=copy_revision+1,copy_state='draft',design_revision=design_revision+1,design_state='unassigned',delivery_revision=delivery_revision+1,delivery_state='not_ready',updated_at=now() where tenant_id=new.tenant_id and delivery_state<>'sent';
  update public.designer_assignments set state='cancelled' where tenant_id=new.tenant_id and state in ('assigned','submitted','revisions_requested');
 end if;
 return new;
end $$;
create trigger brand_guard before update on public.brand_profiles for each row execute function private.brand_revision_guard();
create or replace function private.record_brand_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.brand_versions(tenant_id,revision,snapshot,recorded_by) values(new.tenant_id,new.revision,to_jsonb(new),auth.uid()) on conflict(tenant_id,revision) do nothing;
 insert into public.brand_events(tenant_id,revision,action,actor_id) values(new.tenant_id,new.revision,case when new.approved_revision=new.revision then 'owner_approved' else 'facts_corrected' end,auth.uid());
 return new;
end $$;
create trigger brand_history after insert or update on public.brand_profiles for each row execute function private.record_brand_revision();
revoke all on function private.brand_revision_guard(),private.record_brand_revision() from public,anon,authenticated;

create or replace function public.set_fixture_connection(t uuid,provider text,status text,folder text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 if provider not in ('klaviyo','shopify','drive') or status not in ('connected','disconnected','expired','error') or (provider='drive' and status='connected' and (folder is null or folder !~ '^fixture:[a-zA-Z0-9_-]{1,60}$')) then raise exception 'Invalid fixture connection' using errcode='23514';end if;
 insert into public.workspace_connections(tenant_id,provider,status,fixture_account,folder_id,last_error) values(t,provider,status,'fixture:'||t||':'||provider,case when provider='drive' then folder else null end,case when status in ('expired','error') then 'fixture_connection_unavailable' else null end)
 on conflict on constraint workspace_connections_pkey do update set status=excluded.status,folder_id=excluded.folder_id,revision=public.workspace_connections.revision+1,last_error=excluded.last_error,updated_at=now();
 if status in ('expired','error') then perform private.notify_owners(t,'connection_health',t,'A fixture connection needs attention. Inspect connection diagnostics; no live account is connected.');end if;
end $$;
create or replace function public.enqueue_onboarding_job(t uuid,kind text,input jsonb default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare j uuid;key text;connection public.workspace_connections;
begin
 perform private.require_member(t,true);
 if kind not in ('assets.classify','drive.sync','commerce.sync','brand.extract') then raise exception 'Unsupported onboarding job' using errcode='23514';end if;
 if kind in ('drive.sync','commerce.sync') then
  select * into connection from public.workspace_connections where tenant_id=t and provider=case when kind='drive.sync' then 'drive' else 'shopify' end;
  if not found or connection.status<>'connected' then raise exception 'Connect fixture source first' using errcode='23514';end if;
  input:=jsonb_build_object('connectionRevision',connection.revision,'folderId',connection.folder_id,'syncWindow',date_trunc('hour',now()));
 elsif kind='brand.extract' then
  if length(input->>'sourceText') not between 2 and 10000 then raise exception 'Brand kit text required' using errcode='23514';end if;
  input:=jsonb_build_object('sourceText',input->>'sourceText');
 else
  input:=jsonb_build_object('assetRevisions',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'revision',a.revision)),'[]'::jsonb) from public.assets a where a.tenant_id=t and a.category is null));
 end if;
 key:=kind||':'||encode(extensions.digest(input::text,'sha256'),'hex');
 insert into public.job_runs(tenant_id,kind,idempotency_key,input,created_by) values(t,kind,key,input,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into j;return j;
end $$;
create or replace function public.begin_asset_import(t uuid,key text,source text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform private.require_member(t);
 if key !~ '^[a-f0-9]{64}$' or source not in ('upload','zip') then raise exception 'Invalid import' using errcode='23514';end if;
 insert into public.asset_imports(tenant_id,idempotency_key,source,created_by) values(t,key,source,auth.uid()) on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into result;return result;
end $$;
create or replace function public.record_asset_upload(t uuid,actor uuid,path text,filename text,hash text,media_type text,byte_size integer,source text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.role()<>'service_role' or not exists(select 1 from public.tenant_memberships m join public.profiles p on p.id=m.profile_id and p.status='active' join public.tenants x on x.id=m.tenant_id and x.status='active' where m.tenant_id=t and m.profile_id=actor and m.status='active') then raise exception 'Access denied' using errcode='42501';end if;
 if path<>(t||'/'||hash||'.'||(case media_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else 'invalid' end)) or not exists(select 1 from storage.objects where bucket_id='brand-assets' and name=path) then raise exception 'Verified private upload required' using errcode='23514';end if;
 insert into public.assets(tenant_id,storage_path,filename,sha256,media_type,byte_size,source,uploaded_by,synthetic) values(t,path,filename,hash,media_type,byte_size,source,actor,source='drive_fixture') on conflict(tenant_id,sha256) do update set sha256=excluded.sha256 returning id into result;return result;
end $$;
create or replace function public.record_import_item(t uuid,import_id uuid,filename text,status text,asset uuid default null,error_code text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t);
 if not exists(select 1 from public.asset_imports i where i.tenant_id=t and i.id=import_id and i.created_by=auth.uid()) then raise exception 'Access denied' using errcode='42501';end if;
 if status not in ('stored','duplicate','failed') or (status='failed' and asset is not null) or (status<>'failed' and asset is null) or length(filename)>250 or error_code not in ('invalid_file','storage_unavailable','metadata_unavailable') then raise exception 'Invalid import outcome' using errcode='23514';end if;
 insert into public.asset_import_items(tenant_id,import_id,filename,asset_id,status,error_code) values(t,import_id,filename,asset,status,error_code) on conflict on constraint asset_import_items_import_id_filename_key do update set asset_id=excluded.asset_id,status=excluded.status,error_code=excluded.error_code;
end $$;
create or replace function public.complete_asset_import(t uuid,import_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t);
 update public.asset_imports i set state=case when not exists(select 1 from public.asset_import_items x where x.import_id=i.id and x.status<>'failed') then 'failed' when exists(select 1 from public.asset_import_items x where x.import_id=i.id and x.status='failed') then 'partial' else 'complete' end where i.id=import_id and i.tenant_id=t and i.created_by=auth.uid();
 if not found then raise exception 'Access denied' using errcode='42501';end if;
end $$;
create or replace function public.correct_asset(t uuid,asset uuid,expected_revision integer,category text,product uuid default null,variant uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare current public.assets;
begin
 perform private.require_member(t,true);
 select * into current from public.assets where id=asset and tenant_id=t for update;
 if not found or current.revision is distinct from expected_revision then raise exception 'Stale asset; refresh' using errcode='40001';end if;
 if category not in ('product','lifestyle','proof','logo','unusable') or (category<>'product' and (product is not null or variant is not null)) or (variant is not null and not exists(select 1 from public.product_variants v where v.tenant_id=t and v.id=variant and v.product_id=product)) then raise exception 'Invalid category or catalog match' using errcode='23514';end if;
 update public.assets set category=correct_asset.category,product_id=product,variant_id=variant,classification_source='owner',confidence=case when product is null then null else 1 end,revision=revision+1,updated_at=now() where id=asset;
 insert into public.asset_events(tenant_id,asset_id,actor_id,action,detail) values(t,asset,auth.uid(),'owner_corrected',jsonb_build_object('revision',expected_revision+1,'category',category,'productId',product,'variantId',variant));
end $$;
create or replace function private.onboarding_lease(job uuid,lease uuid) returns public.job_runs language plpgsql security definer set search_path='' as $$
declare j public.job_runs;
begin
 select * into j from public.job_runs where id=job for update;
 if not found or not private.worker_access(j.tenant_id) then raise exception 'Access denied' using errcode='42501';end if;
 if j.status<>'running' or j.lease_token is distinct from lease or j.lease_until<=now() then raise exception 'Lease unavailable' using errcode='40001';end if;return j;
end $$;
create or replace function public.finish_onboarding_job(job uuid,lease uuid,output jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.job_runs;x jsonb;item jsonb;connection public.workspace_connections;p uuid;
begin
 j:=private.onboarding_lease(job,lease);
 if jsonb_typeof(output)<>'object' or (output->>'synthetic')::boolean is distinct from true then raise exception 'Only fixture output enabled' using errcode='23514';end if;
 if j.kind='assets.classify' then
  if jsonb_typeof(output->'assets') is distinct from 'array' or jsonb_array_length(output->'assets')>1000 then raise exception 'Invalid classification output' using errcode='23514';end if;
  for item in select value from jsonb_array_elements(output->'assets') loop
   select value into x from jsonb_array_elements(j.input->'assetRevisions') where value->>'id'=item->>'id';
   if x is null or item->>'category' not in ('product','lifestyle','proof','logo','unusable') then raise exception 'Unexpected asset output' using errcode='23514';end if;
   update public.assets set category=item->>'category',classification_source='fixture',product_id=nullif(item->>'productId','')::uuid,variant_id=nullif(item->>'variantId','')::uuid,confidence=(item->>'confidence')::numeric,revision=revision+1,updated_at=now() where id=(item->>'id')::uuid and tenant_id=j.tenant_id and revision=(x->>'revision')::integer and category is null;
   if found then insert into public.asset_events(tenant_id,asset_id,action,detail) values(j.tenant_id,(item->>'id')::uuid,'fixture_classified',item);end if;
  end loop;
 elsif j.kind in ('drive.sync','commerce.sync') then
  select * into connection from public.workspace_connections where tenant_id=j.tenant_id and provider=case when j.kind='drive.sync' then 'drive' else 'shopify' end for update;
  if connection.status<>'connected' or connection.revision is distinct from (j.input->>'connectionRevision')::integer then raise exception 'Connection changed' using errcode='40001';end if;
  if j.kind='commerce.sync' then
   if jsonb_typeof(output->'products') is distinct from 'array' or jsonb_array_length(output->'products')>100 then raise exception 'Invalid catalog' using errcode='23514';end if;
   for item in select value from jsonb_array_elements(output->'products') loop
    if item->>'externalId' !~ '^fixture-[a-z0-9-]{1,60}$' or item->>'url' !~ '^https://' or (item->>'observedAt')::timestamptz<now()-interval '1 hour' then raise exception 'Invalid fixture catalog evidence' using errcode='23514';end if;
    select v.product_id into p from public.product_variants v where v.tenant_id=j.tenant_id and v.sku=item->>'externalId';
    if p is null then insert into public.products(tenant_id,title,url,stock,stock_observed_at,source,synthetic) values(j.tenant_id,item->>'title',item->>'url',(item->>'stock')::integer,(item->>'observedAt')::timestamptz,'fixture',true) returning id into p;
    else update public.products set title=item->>'title',url=item->>'url',stock=(item->>'stock')::integer,stock_observed_at=(item->>'observedAt')::timestamptz,updated_at=now() where id=p;end if;
    insert into public.product_variants(tenant_id,product_id,sku,title,stock,observed_at) values(j.tenant_id,p,item->>'externalId',item->>'title',(item->>'stock')::integer,(item->>'observedAt')::timestamptz) on conflict(tenant_id,sku) do update set stock=excluded.stock,observed_at=excluded.observed_at;
    p:=null;
   end loop;
  end if;
  update public.workspace_connections set last_sync_at=now(),last_error=null where tenant_id=j.tenant_id and provider=connection.provider;
 elsif j.kind='brand.extract' then
  if jsonb_typeof(output->'colors') is distinct from 'array' or jsonb_typeof(output->'fonts') is distinct from 'array' or jsonb_array_length(output->'colors')>10 or jsonb_array_length(output->'fonts')>10 then raise exception 'Invalid brand kit output' using errcode='23514';end if;
  if exists(select 1 from jsonb_array_elements_text(output->'colors') v where v!~ '^#[0-9a-fA-F]{6}$') or exists(select 1 from jsonb_array_elements_text(output->'fonts') v where length(v) not between 1 and 80) then raise exception 'Invalid brand kit values' using errcode='23514';end if;
  insert into public.brand_kits(tenant_id,colors,fonts,source_text) values(j.tenant_id,array(select jsonb_array_elements_text(output->'colors')),array(select jsonb_array_elements_text(output->'fonts')),j.input->>'sourceText') on conflict(tenant_id) do update set colors=excluded.colors,fonts=excluded.fonts,source_text=excluded.source_text,revision=public.brand_kits.revision+1,approved_by=null,updated_at=now();
 else raise exception 'Unsupported onboarding job' using errcode='23514';end if;
 update public.job_runs set status='succeeded',checkpoint=output,lease_token=null,lease_until=null,updated_at=now() where id=j.id;
end $$;
create or replace function public.approve_brand_kit(t uuid,expected_revision integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 update public.brand_kits set approved_by=auth.uid() where tenant_id=t and revision=expected_revision;
 if not found then raise exception 'Stale brand kit' using errcode='40001';end if;
end $$;
create or replace function public.refresh_catalog_stock(t uuid,product uuid,stock integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.require_member(t,true);
 update public.products set stock=refresh_catalog_stock.stock,stock_observed_at=now(),updated_at=now() where tenant_id=t and id=product;
 if not found then raise exception 'Product unavailable' using errcode='42501';end if;
end $$;
create or replace function private.asset_object_access(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.assets a where a.storage_path=path and private.is_active_member(a.tenant_id));
$$;
create policy scoped_asset_read on storage.objects for select to authenticated using(bucket_id='brand-assets' and private.asset_object_access(name));
revoke all on function private.onboarding_lease(uuid,uuid),private.asset_object_access(text) from public,anon,authenticated;
grant execute on function private.asset_object_access(text) to authenticated;
revoke all on function public.record_asset_upload(uuid,uuid,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.record_asset_upload(uuid,uuid,text,text,text,text,integer,text) to service_role;
do $$ declare f text; begin foreach f in array array[
'public.set_fixture_connection(uuid,text,text,text)','public.enqueue_onboarding_job(uuid,text,jsonb)','public.begin_asset_import(uuid,text,text)',
'public.record_import_item(uuid,uuid,text,text,uuid,text)','public.complete_asset_import(uuid,uuid)','public.correct_asset(uuid,uuid,integer,text,uuid,uuid)',
'public.finish_onboarding_job(uuid,uuid,jsonb)','public.approve_brand_kit(uuid,integer)','public.refresh_catalog_stock(uuid,uuid,integer)'] loop
 execute 'revoke all on function '||f||' from public,anon';execute 'grant execute on function '||f||' to authenticated';end loop;end $$;
