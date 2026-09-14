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
