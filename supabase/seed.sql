-- Local/test fixtures only. Never run `db push --include-seed` in production.
-- Auth rows intentionally have no encrypted password; use Studio or the Auth Admin API
-- to make a login-capable local user without committing demo credentials.

insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000000001', 'owner@grey-retention.test', '{"full_name":"Demo Owner"}'),
  ('00000000-0000-4000-8000-000000000002', 'admin@grey-retention.test', '{"full_name":"Demo Platform Admin"}'),
  ('00000000-0000-4000-8000-000000000003', 'designer@grey-retention.test', '{"full_name":"Demo Designer"}'),
  ('00000000-0000-4000-8000-000000000004', 'other-owner@grey-retention.test', '{"full_name":"Isolation Owner"}')
on conflict (id) do nothing;

insert into public.tenants (id, slug, name, status, timezone, onboarding_state)
values
  ('00000000-0000-4000-8000-000000000101', 'grey-retention-demo', 'Grey Retention Demo', 'active', 'Asia/Kathmandu', 'complete'),
  ('00000000-0000-4000-8000-000000000102', 'isolation-fixture', 'Isolation Fixture', 'active', 'Australia/Melbourne', 'complete')
on conflict (id) do nothing;

insert into public.tenant_memberships (tenant_id, profile_id, role, status, accepted_at)
values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000004', 'owner', 'active', now())
on conflict (tenant_id, profile_id) do nothing;

insert into public.platform_admins (profile_id, role, active, accepted_at)
values ('00000000-0000-4000-8000-000000000002', 'super_admin', true, now())
on conflict (profile_id) do nothing;

insert into public.designers (id, profile_id, status, activated_at)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000003', 'active', now())
on conflict (profile_id) do nothing;

insert into public.designer_tenant_access (designer_id, tenant_id)
values ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101')
on conflict (designer_id, tenant_id) do nothing;

-- Additional deterministic, fictional tenant roles and catalog. No customer imports.
insert into auth.users(id,email,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000005','staff@grey-retention.test','{"full_name":"Synthetic Staff"}'),
('00000000-0000-4000-8000-000000000006','team-admin@grey-retention.test','{"full_name":"Synthetic Team Admin"}') on conflict do nothing;
insert into public.tenant_memberships(tenant_id,profile_id,role,status,accepted_at) values
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000005','staff','active',now()),
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000006','admin','active',now()) on conflict do nothing;
insert into public.brand_profiles(tenant_id,brand_name,domain,positioning,voice,prohibitions,approved_revision,approved_by,approved_at,synthetic) values
('00000000-0000-4000-8000-000000000101','Cedar Lane — synthetic demo','cedar-lane.example','Everyday layers for quiet weekends. Fictional brand.','Calm, practical and specific.','No invented proof, urgency or medical claims.',1,'00000000-0000-4000-8000-000000000001',now(),true),
('00000000-0000-4000-8000-000000000102','North Studio — synthetic demo','north-studio.example','Fictional home accessories.','Simple, warm and helpful.','No unverified claims.',1,'00000000-0000-4000-8000-000000000004',now(),true) on conflict do nothing;
insert into public.products(id,tenant_id,title,url,price_minor,stock,stock_observed_at,source,synthetic) values
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000101','Field overshirt (synthetic)','https://cedar-lane.example/products/overshirt',6800,20,now(),'fixture',true),
('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000102','Studio vase (synthetic)','https://north-studio.example/products/vase',3400,12,now(),'fixture',true) on conflict do nothing;
insert into public.offers(id,tenant_id,label,kind,depth_percent,conditions,starts_at,ends_at,approved_by,synthetic) values
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000101','Evergreen: explore the collection','evergreen',0,'No discount. Use verified catalog facts only.',now()-interval '1 day',now()+interval '1 year','00000000-0000-4000-8000-000000000001',true) on conflict do nothing;
insert into public.audiences(id,tenant_id,label,account_id,canonical_key,provider_id,excluded_provider_ids,synthetic) values
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000101','G | Engaged (fixture definition)','fixture-cedar','engaged','fixture-cedar-engaged',array['fixture-cedar-suppressed'],true),
('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000102','G | Engaged (fixture definition)','fixture-north','engaged','fixture-north-engaged',array['fixture-north-suppressed'],true) on conflict do nothing;
insert into public.campaigns(id,tenant_id,title,goal,channel,planned_at,timezone,audience_id,product_id,offer_id,created_by,synthetic,lineage) values
('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000101','Autumn field notes','Introduce the field overshirt using verified facts.','email_design',now()+interval '7 days','Asia/Kathmandu','00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001',true,'{"source":"synthetic fixture","brandRevision":1}'),
('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000102','A considered corner','Introduce the synthetic vase.','email_text',now()+interval '8 days','Australia/Melbourne','00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000302',null,'00000000-0000-4000-8000-000000000004',true,'{"source":"synthetic fixture","brandRevision":1}') on conflict do nothing;
insert into public.campaign_content(tenant_id,campaign_id,revision,created_by) select tenant_id,id,copy_revision,created_by from public.campaigns on conflict do nothing;

-- Normalize only deterministic synthetic identities for local Auth Admin tooling.
update auth.users set instance_id='00000000-0000-0000-0000-000000000000',aud='authenticated',role='authenticated',
 confirmation_token='',recovery_token='',email_change_token_new='',email_change='',email_change_token_current='',reauthentication_token='',
 created_at=coalesce(created_at,now()),updated_at=coalesce(updated_at,now()),raw_app_meta_data=jsonb_build_object('provider','email','providers',jsonb_build_array('email'))
where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006');
insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
select id::text,id,jsonb_build_object('sub',id,'email',email),'email',now(),now() from auth.users
where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006')
on conflict(provider_id,provider) do nothing;
update auth.identities set created_at=coalesce(created_at,now()),updated_at=coalesce(updated_at,now())
where user_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006');
