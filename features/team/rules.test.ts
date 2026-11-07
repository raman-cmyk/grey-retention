// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  canManageTeam,
  eventText,
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

  it('explains team changes in plain sentences', () => {
    const say = (kind: string, detail: Record<string, unknown>) =>
      eventText(kind, detail, 'Sam', 'new@example.com')
    expect(say('membership_insert', {})).toBe('Sam joined the team')
    expect(
      say('membership_update', {
        beforeStatus: 'active',
        afterStatus: 'inactive'
      })
    ).toBe('Sam was deactivated')
    expect(
      say('membership_update', {
        beforeStatus: 'inactive',
        afterStatus: 'active'
      })
    ).toBe('Sam was reactivated')
    expect(
      say('membership_update', {
        beforeStatus: 'invited',
        afterStatus: 'active'
      })
    ).toBe('Sam joined the team')
    expect(
      say('membership_update', {
        beforeStatus: 'active',
        afterStatus: 'active',
        beforeRole: 'staff',
        afterRole: 'admin'
      })
    ).toBe('Sam is now a Manager')
    expect(
      say('membership_update', {
        beforeStatus: 'active',
        afterStatus: 'active',
        beforeRole: 'staff',
        afterRole: 'staff'
      })
    ).toBeNull()
    expect(say('invitation_simulated', { role: 'admin' })).toBe(
      'Invite saved for new@example.com as Manager'
    )
    expect(say('invitation_resent', {})).toBe(
      'Invite to new@example.com renewed'
    )
    expect(say('invitation_revoked', {})).toBe(
      'Invite to new@example.com cancelled'
    )
    expect(say('invitation_revoked', { reason: 'expired' })).toBe(
      'Expired invite to new@example.com cancelled'
    )
    expect(say('support_opened', {})).toBeNull()
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
