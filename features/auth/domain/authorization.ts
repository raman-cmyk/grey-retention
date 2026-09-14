import type { AdminRole, AuthSurface, TenantRole } from './types'

export function canManageTenantMembers(role: TenantRole) {
  return role === 'owner' || role === 'admin'
}

export function canGrantOwnerRole(role: TenantRole) {
  return role === 'owner'
}

export function canManagePlatformAdmins(role: AdminRole) {
  return role === 'super_admin'
}

export function authLanding(surface: AuthSurface) {
  if (surface === 'admin') return '/admin/dashboard' as const
  if (surface === 'designer') return '/designer/dashboard' as const
  return '/dashboard' as const
}
