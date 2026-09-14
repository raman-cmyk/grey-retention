begin;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'owner-a@example.test', '{"full_name":"Owner A"}'),
  ('10000000-0000-0000-0000-000000000002', 'staff-a@example.test', '{"full_name":"Staff A"}'),
  ('10000000-0000-0000-0000-000000000003', 'owner-b@example.test', '{"full_name":"Owner B"}'),
  ('10000000-0000-0000-0000-000000000004', 'designer@example.test', '{"full_name":"Designer"}'),
  ('10000000-0000-0000-0000-000000000005', 'platform@example.test', '{"full_name":"Platform"}'),
  ('10000000-0000-0000-0000-000000000006', 'inactive@example.test', '{"full_name":"Inactive"}'),
  ('10000000-0000-0000-0000-000000000007', 'new-owner@example.test', '{"full_name":"New Owner"}');

insert into public.tenants (id, slug, name, status, timezone)
values
  ('20000000-0000-0000-0000-000000000001', 'tenant-a', 'Tenant A', 'active', 'Asia/Kathmandu'),
  ('20000000-0000-0000-0000-000000000002', 'tenant-b', 'Tenant B', 'active', 'Australia/Melbourne');

insert into public.tenant_memberships (tenant_id, profile_id, role, status, accepted_at)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner', 'active', now()),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'staff', 'active', now()),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'owner', 'active', now()),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000006', 'staff', 'inactive', now());

insert into public.designers (id, profile_id, status, activated_at)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'active', now());

insert into public.designer_tenant_access (designer_id, tenant_id)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

insert into public.platform_admins (profile_id, role, active, accepted_at)
values ('10000000-0000-0000-0000-000000000005', 'super_admin', true, now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.tenants order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid) $$,
  'tenant owner sees only their tenant'
);

select results_eq(
  $$ select tenant_id from public.resolve_client_context(null) $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid) $$,
  'client context resolves an active membership'
);

select is_empty(
  $$ select * from public.resolve_client_context('20000000-0000-0000-0000-000000000002') $$,
  'an untrusted tenant hint cannot select another tenant'
);

select results_eq(
  $$ select count(*)::bigint from public.tenant_memberships $$,
  $$ values (2::bigint) $$,
  'tenant owner sees only memberships in their tenant'
);

select throws_ok(
  $$ delete from public.tenant_memberships where profile_id = '10000000-0000-0000-0000-000000000001' $$,
  '23514',
  'tenant requires at least one active owner',
  'the last active owner cannot be removed'
);

select results_eq(
  $$ select count(*)::bigint from public.profiles $$,
  $$ values (2::bigint) $$,
  'tenant owner sees only self and active teammates'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select results_eq(
  $$ update public.tenants set name = 'Forbidden change' returning id $$,
  $$ select null::uuid where false $$,
  'staff cannot update tenant settings'
);

select results_eq(
  $$ select count(*)::bigint from public.tenant_invites $$,
  $$ values (0::bigint) $$,
  'staff cannot enumerate tenant invites'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.tenants order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000002'::uuid) $$,
  'second tenant owner cannot see first tenant'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

select results_eq(
  $$ select id from public.tenants order by id $$,
  $$ values ('20000000-0000-0000-0000-000000000001'::uuid) $$,
  'designer sees only explicitly granted tenant'
);

select results_eq(
  $$ select designer_id from public.resolve_designer_context() $$,
  $$ values ('30000000-0000-0000-0000-000000000001'::uuid) $$,
  'designer context resolves only an active designer'
);

select is_empty(
  $$ select * from public.resolve_client_context(null) $$,
  'designer identity does not inherit client context'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

select results_eq(
  $$ select admin_role::text from public.resolve_admin_context() $$,
  $$ values ('super_admin'::text) $$,
  'platform context resolves only an active platform admin'
);

select is_empty(
  $$ select * from public.resolve_client_context(null) $$,
  'platform admin has no implicit tenant membership'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}', true);

select is_empty(
  $$ select * from public.resolve_client_context(null) $$,
  'inactive membership cannot resolve client context'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000007","role":"authenticated"}', true);

select ok(
  public.create_tenant_workspace('New Workspace', 'new-workspace', 'UTC') is not null,
  'an active confirmed profile can create its first workspace'
);

select results_eq(
  $$ select tenant_role::text from public.resolve_client_context(null) $$,
  $$ values ('owner'::text) $$,
  'workspace creator becomes its active owner'
);

select results_eq(
  $$ select count(*)::bigint from public.tenants $$,
  $$ values (1::bigint) $$,
  'new owner still sees only the newly created tenant'
);

select * from finish();
rollback;
