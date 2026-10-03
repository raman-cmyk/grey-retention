import { describe, expect, it } from 'vitest'
import type { RequestContext } from '@/features/auth/domain/types'
import {
  can,
  canConfirmProposal,
  canReadConversation,
  developmentPolicy,
  retryDecision,
  revise
} from './policy'
const owner: RequestContext = {
  kind: 'client',
  userId: 'owner',
  tenantId: 'a',
  tenantRole: 'owner',
  tenantName: 'A',
  tenantSlug: 'a',
  timezone: 'UTC'
}
const chat = {
  tenantId: 'a',
  creatorId: 'owner',
  visibility: 'private' as const
}
describe('V2 owner and visibility contracts', () => {
  it('denies staff and platform creative approval, cross-tenant reads, and designers', () => {
    expect(can(owner, 'approve', 'a')).toBe(true)
    expect(can({ ...owner, tenantRole: 'staff' }, 'approve', 'a')).toBe(false)
    expect(
      can(
        { kind: 'admin', userId: 'admin', adminRole: 'super_admin' },
        'approve',
        'a'
      )
    ).toBe(false)
    expect(can(owner, 'read', 'b')).toBe(false)
    expect(
      can({ kind: 'designer', userId: 'd', designerId: 'd' }, 'chat', 'a')
    ).toBe(false)
  })
  it('keeps private creator scope and shared proposal actor/version/expiry scope', () => {
    const teammate = { ...owner, userId: 'staff', tenantRole: 'staff' as const }
    expect(canReadConversation(teammate, chat)).toBe(false)
    expect(
      canReadConversation(teammate, { ...chat, visibility: 'shared' })
    ).toBe(true)
    expect(
      canConfirmProposal(
        teammate,
        { ...chat, visibility: 'shared' },
        'owner',
        1,
        1,
        '2026-10-05',
        '2026-10-04'
      )
    ).toBe(false)
    expect(
      canConfirmProposal(owner, chat, 'owner', 1, 2, '2026-10-05', '2026-10-04')
    ).toBe(false)
    expect(
      canConfirmProposal(owner, chat, 'owner', 1, 1, '2026-10-03', '2026-10-04')
    ).toBe(false)
  })
  it('invalidates dependent approvals without conflating job failure', () => {
    expect(
      revise({ calendar: 1, copy: 2, design: 3, delivery: 4 }, 'copy')
    ).toEqual({ calendar: 1, copy: 3, design: 4, delivery: 5 })
    expect(
      revise({ calendar: 1, copy: 2, design: 3, delivery: 4 }, 'schedule')
    ).toEqual({ calendar: 2, copy: 2, design: 3, delivery: 5 })
  })
  it('reconciles unknown side effects and bounds attempts', () => {
    expect(retryDecision('unknown_outcome', 1, 'unknown')).toBe('reconcile')
    expect(retryDecision('unknown_outcome', 1, 'found')).toBe('resume_existing')
    expect(retryDecision('unknown_outcome', 1, 'absent')).toBe('retry')
    expect(retryDecision('auth', 1)).toBe('stop')
    expect(retryDecision('transient', 4)).toBe('stop')
    expect(developmentPolicy.productionL2).toBe(false)
    expect(developmentPolicy.designDelegation).toBe(false)
  })
})
