// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  canManageTeam,
  expiryText,
  initial,
  inviteSchema,
  isExpired,
  roleLabel
} from './rules'

const message = (email: string, role = 'staff') => {
  const parsed = inviteSchema.safeParse({ email, role })
  return parsed.success ? parsed.data : parsed.error.issues[0]?.message
}

describe('team rules', () => {
  it('calls the admin role Manager', () => {
    expect(roleLabel).toEqual({
      owner: 'Owner',
      admin: 'Manager',
      staff: 'Staff'
    })
  })

  it('lets owners and managers manage the team, not staff', () => {
    expect(canManageTeam('owner')).toBe(true)
    expect(canManageTeam('admin')).toBe(true)
    expect(canManageTeam('staff')).toBe(false)
  })

  it('checks invite emails like the database does', () => {
    expect(message('  New.Person@Example.com ')).toEqual({
      email: 'new.person@example.com',
      role: 'staff'
    })
    expect(message('')).toBe('Enter their email address.')
    expect(message('not-an-email')).toBe(
      'Enter an email address like name@company.com.'
    )
    expect(message('two words@example.com')).toBe(
      'Enter an email address like name@company.com.'
    )
    expect(message('a@b')).toBe('Enter an email address like name@company.com.')
    expect(message(`${'x'.repeat(250)}@b.co`)).toBe(
      'That email address is too long.'
    )
    expect(message('boss@example.com', 'owner')).toBe(
      'Choose Staff or Manager.'
    )
  })

  it('shows a letter for the avatar', () => {
    expect(initial({ name: 'ana', email: 'z@x.co' })).toBe('A')
    expect(initial({ name: ' ', email: 'zed@x.co' })).toBe('Z')
    expect(initial({ name: '', email: '' })).toBe('?')
  })

  it('says when an invite expires', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    expect(expiryText('2026-11-13T12:00:00Z', now)).toBe('Expires in 7 days')
    expect(expiryText('2026-11-07T13:00:00Z', now)).toBe('Expires in 1 day')
    expect(expiryText('2026-11-06T18:00:00Z', now)).toBe('Expires today')
    expect(expiryText('2026-11-06T11:00:00Z', now)).toBe('Expired')
    expect(isExpired('2026-11-06T11:00:00Z', now)).toBe(true)
    expect(isExpired('2026-11-06T13:00:00Z', now)).toBe(false)
  })
})
