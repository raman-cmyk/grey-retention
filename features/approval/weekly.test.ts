import { describe, expect, it } from 'vitest'
import type {
  ClientRequestContext,
  RequestContext
} from '@/features/auth/domain/types'
import {
  ApprovalRefused,
  approveAll,
  approvedWithoutEdits,
  backForApproval,
  maxChangeRounds,
  minimumLeadMinutes,
  requestChange,
  skipWords,
  waiting,
  type BatchItem
} from './weekly'

const now = new Date('2026-11-08T09:00:00Z')
const tenant = 'tenant-a'
const client = (over: Partial<ClientRequestContext> = {}): RequestContext => ({
  kind: 'client',
  userId: 'owner-1',
  tenantId: tenant,
  tenantRole: 'owner',
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'Europe/London',
  ...over
})
const owner = client()
const item = (id: string, over: Partial<BatchItem> = {}): BatchItem => ({
  campaignId: id,
  revision: 1,
  sendAt: '2026-11-10T08:00:00Z',
  subject: `Email ${id}`,
  offer: null,
  segment: 'Engaged 90 days',
  state: 'pending_approval',
  changeRounds: 0,
  edited: false,
  warnings: [],
  ...over
})
const shownOf = (items: BatchItem[]) =>
  items.map(({ campaignId, revision }) => ({ campaignId, revision }))

describe('Approve all', () => {
  it('approves every email shown, at the version shown, in one tap', () => {
    const batch = [
      item('tue'),
      item('thu', { sendAt: '2026-11-12T08:00:00Z' }),
      item('sun', { sendAt: '2026-11-15T08:00:00Z' })
    ]
    const result = approveAll(batch, shownOf(batch), owner, tenant, now)
    expect(result.approved.map((a) => a.campaignId)).toEqual([
      'tue',
      'thu',
      'sun'
    ])
    expect(result.items.every((i) => i.state === 'approved')).toBe(true)
    expect(result.skipped).toEqual([])
    expect(result).toMatchObject({
      approvedBy: 'owner-1',
      approvedAt: '2026-11-08T09:00:00.000Z'
    })
  })

  it('never approves a version the owner did not see', () => {
    // The owner looked at revision 1; the AI redo (revision 2) landed
    // before the tap reached the server.
    const shown = shownOf([item('thu')])
    const result = approveAll(
      [item('thu', { revision: 2 }), item('new')],
      shown,
      owner,
      tenant,
      now
    )
    expect(result.approved).toEqual([])
    expect(result.skipped).toEqual([
      { campaignId: 'thu', reason: 'changed_since_shown' },
      { campaignId: 'new', reason: 'not_shown' }
    ])
    expect(result.items.every((i) => i.state === 'pending_approval')).toBe(true)
  })

  it('leaves out emails being changed, with a person, too close or past their time, and says why', () => {
    const batch = [
      item('a'),
      item('b', { state: 'change_requested' }),
      item('c', { state: 'needs_human' }),
      item('d', { sendAt: '2026-11-08T08:59:00Z' }),
      item('e', { sendAt: '2026-11-08T09:59:00Z' }),
      item('f', { sendAt: 'not a date' }),
      item('g', { state: 'approved' })
    ]
    const result = approveAll(batch, shownOf(batch), owner, tenant, now)
    expect(result.approved.map((a) => a.campaignId)).toEqual(['a'])
    expect(result.skipped).toEqual([
      { campaignId: 'b', reason: 'being_changed' },
      { campaignId: 'c', reason: 'with_a_person' },
      { campaignId: 'd', reason: 'send_time_passed' },
      { campaignId: 'e', reason: 'too_close_to_send' },
      { campaignId: 'f', reason: 'send_time_passed' }
    ])
    expect(result.items.find((i) => i.campaignId === 'b')?.state).toBe(
      'change_requested'
    )
    for (const { reason } of result.skipped)
      expect(skipWords[reason]).toMatch(/\w/)
  })

  it('needs at least an hour before the send', () => {
    expect(minimumLeadMinutes).toBe(60)
    const just = item('a', { sendAt: '2026-11-08T10:00:00Z' })
    expect(
      approveAll([just], shownOf([just]), owner, tenant, now).approved
    ).toHaveLength(1)
  })

  it('is the workspace owner’s alone', () => {
    const batch = [item('a')]
    for (const context of [
      client({ tenantRole: 'admin' }),
      client({ tenantRole: 'staff' }),
      client({ tenantId: 'tenant-b' }),
      { kind: 'admin', userId: 'ops', adminRole: 'super_admin' } as const,
      { kind: 'designer', userId: 'd', designerId: 'd1' } as const
    ])
      expect(() =>
        approveAll(batch, shownOf(batch), context, tenant, now)
      ).toThrow(ApprovalRefused)
  })

  it('keeps product names out of what the owner reads', () => {
    expect(Object.values(skipWords).join(' ')).not.toMatch(/Grey Retention/)
  })
})

describe('Change', () => {
  it('sends a change to the AI twice, then to a person, who can finish it (VISION rule 13)', () => {
    let current = item('a')
    for (let round = 1; round <= maxChangeRounds; round++) {
      const change = requestChange(
        current,
        current.revision,
        'Make the subject warmer',
        owner,
        tenant,
        now
      )
      expect(change.next).toBe('ai_redo')
      expect(change.item).toMatchObject({
        state: 'change_requested',
        changeRounds: round,
        edited: true
      })
      current = backForApproval(change.item)
      expect(current).toMatchObject({
        state: 'pending_approval',
        revision: round + 1
      })
    }
    const third = requestChange(
      current,
      current.revision,
      'Still not right',
      owner,
      tenant,
      now
    )
    expect(third.next).toBe('person')
    expect(third.item.state).toBe('needs_human')
    const finished = backForApproval(third.item)
    expect(finished).toMatchObject({ state: 'pending_approval', revision: 4 })
  })

  it('keeps the owner’s line breaks', () => {
    const change = requestChange(
      item('a'),
      1,
      '  Line one \r\n\r\n\r\n\r\n  Line   two ',
      owner,
      tenant,
      now
    )
    expect(change.text).toBe('Line one\n\nLine two')
  })

  it('needs words, a waiting email at the version shown, time left and the owner', () => {
    const ask = (i: BatchItem, text = 'Change it', context = owner, rev = 1) =>
      requestChange(i, rev, text, context, tenant, now)
    expect(() => ask(item('a'), '  ')).toThrow(/Say what you want changed/)
    expect(() => ask(item('a'), 'x'.repeat(1001))).toThrow(/1,000/)
    for (const state of [
      'approved',
      'change_requested',
      'needs_human'
    ] as const)
      expect(() => ask(item('a', { state }))).toThrow(/not waiting/)
    expect(() => ask(item('a', { revision: 2 }))).toThrow(/changed since/)
    expect(() => ask(item('a', { sendAt: '2026-11-08T08:00:00Z' }))).toThrow(
      /send time has passed/
    )
    expect(() =>
      ask(item('a'), 'Change it', client({ tenantRole: 'staff' }))
    ).toThrow(ApprovalRefused)
    expect(() =>
      ask(item('a'), 'Change it', client({ tenantId: 'tenant-b' }))
    ).toThrow(ApprovalRefused)
  })

  it('only brings back emails that were being changed', () => {
    for (const state of ['pending_approval', 'approved'] as const) {
      const i = item('a', { state })
      expect(backForApproval(i)).toBe(i)
    }
  })
})

describe('the numbers the owner sees', () => {
  it('lists waiting emails soonest first', () => {
    const list = waiting([
      item('late', { sendAt: '2026-11-14T08:00:00Z' }),
      item('done', { state: 'approved' }),
      item('soon')
    ])
    expect(list.map((i) => i.campaignId)).toEqual(['soon', 'late'])
  })

  it('tracks the share approved without edits', () => {
    expect(
      approvedWithoutEdits([
        item('a', { state: 'approved' }),
        item('b', { state: 'approved' }),
        item('c', { state: 'approved', edited: true }),
        item('d', { state: 'approved' }),
        item('e')
      ])
    ).toEqual({ approved: 4, withoutEdits: 3, share: 0.75 })
    expect(approvedWithoutEdits([]).share).toBeNull()
  })
})
