import { describe, expect, it } from 'vitest'
import {
  authLanding,
  canGrantOwnerRole,
  canManagePlatformAdmins,
  canManageTenantMembers
} from './authorization'

describe('authorization policy', () => {
  it('keeps tenant administration explicit', () => {
    expect(canManageTenantMembers('owner')).toBe(true)
    expect(canManageTenantMembers('admin')).toBe(true)
    expect(canManageTenantMembers('staff')).toBe(false)
    expect(canGrantOwnerRole('admin')).toBe(false)
    expect(canGrantOwnerRole('owner')).toBe(true)
  })

  it('reserves platform-admin management for super admins', () => {
    expect(canManagePlatformAdmins('super_admin')).toBe(true)
    expect(canManagePlatformAdmins('admin')).toBe(false)
  })

  it('lands each identity in its own surface', () => {
    expect(authLanding('client')).toBe('/dashboard')
    expect(authLanding('admin')).toBe('/admin/dashboard')
    expect(authLanding('designer')).toBe('/designer/dashboard')
  })
})
