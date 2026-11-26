import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  stateLine,
  stateNote,
  stateParts,
  statePill,
  storeTime,
  type KlaviyoState
} from './klaviyo-state'
import { refusalFor } from './never-overwrite'

const state = (over: Partial<KlaviyoState> = {}): KlaviyoState => ({
  status: 'draft',
  edited: false,
  scheduledFor: null,
  sendStrategy: null,
  sentAt: null,
  checkedAt: null,
  ...over
})

describe('a draft’s state in Klaviyo, in plain words (PICK-99)', () => {
  it('says when Klaviyo will send it, in the store’s time zone', () => {
    const s = state({
      status: 'scheduled',
      scheduledFor: '2027-01-14T14:00:00Z',
      sendStrategy: 'static'
    })
    expect(stateLine(s, 'America/New_York')).toBe(
      'Scheduled in Klaviyo for 14 Jan, 9:00 (store time)'
    )
    expect(stateLine(s, 'Asia/Kathmandu')).toBe(
      'Scheduled in Klaviyo for 14 Jan, 19:45 (store time)'
    )
    expect(stateLine({ ...s, sendStrategy: 'local_timezone' }, 'UTC')).toBe(
      'Scheduled in Klaviyo for 14 Jan, at each person’s own local time'
    )
    expect(stateLine({ ...s, sendStrategy: 'smart_send_time' }, 'UTC')).toBe(
      'Scheduled in Klaviyo from 14 Jan, 14:00 (store time; Klaviyo picks each person’s time)'
    )
    expect(stateLine({ ...s, scheduledFor: null }, 'UTC')).toBe(
      'Scheduled in Klaviyo'
    )
  })

  it('names every state, and an edit apart (never on a deleted draft)', () => {
    const words = (over: Partial<KlaviyoState>) =>
      stateParts(state(over), 'Europe/London')
    expect(words({})).toEqual(['Draft in Klaviyo'])
    expect(words({ edited: true })).toEqual([
      'Draft in Klaviyo',
      'Edited in Klaviyo'
    ])
    expect(words({ status: 'sending' })).toEqual(['Sending from Klaviyo'])
    expect(
      words({ status: 'sent', sentAt: '2026-11-20T18:00:00Z', edited: true })
    ).toEqual(['Sent on 20 Nov, 18:00 (store time)', 'Edited in Klaviyo'])
    expect(words({ status: 'cancelled' })).toEqual(['Cancelled in Klaviyo'])
    expect(words({ status: 'deleted', edited: true })).toEqual([
      'Deleted in Klaviyo'
    ])
    expect(words({ status: 'stale' })).toEqual(['Not sent: its day has passed'])
  })

  it('maps onto BRAND.md’s four statuses only: In Klaviyo, or none', () => {
    for (const status of [
      'draft',
      'scheduled',
      'sending',
      'sent',
      'cancelled'
    ] as const)
      expect(statePill(state({ status, edited: true }))).toBe('in_klaviyo')
    expect(statePill(state({ status: 'deleted' }))).toBeNull()
    expect(statePill(state({ status: 'stale' }))).toBeNull()
  })

  it('tells the owner GROS leaves his changes, and that a deleted draft is no send', () => {
    expect(stateNote(state({ status: 'deleted' }))).toMatch(
      /does not count in Results\. GROS will not put it back\./
    )
    expect(stateNote(state({ edited: true }))).toMatch(
      /GROS will not replace your changes/
    )
    expect(stateNote(state({ status: 'sent', edited: true }))).toMatch(
      /not as GROS’s own words/
    )
    expect(stateNote(state())).toBeNull()
  })

  it('no time, or a time zone the runtime does not know, says no time', () => {
    expect(storeTime(null, 'UTC')).toBeNull()
    expect(storeTime('not a time', 'UTC')).toBeNull()
    expect(storeTime('2027-01-14T14:00:00Z', 'Not/AZone')).toBeNull()
  })
})

describe('never overwrite what the owner did in Klaviyo (PICK-99)', () => {
  const seen = (status: string, changed = false, design_changed = false) => ({
    status,
    changed,
    design_changed
  })
  it('refuses for a sent, scheduled, deleted, cancelled or edited draft, the strongest first', () => {
    expect(refusalFor([seen('sent')])).toBe('sent_in_klaviyo')
    expect(refusalFor([seen('sending')])).toBe('sent_in_klaviyo')
    expect(refusalFor([seen('scheduled', true)])).toBe('scheduled_in_klaviyo')
    expect(refusalFor([seen('deleted', true)])).toBe('deleted_in_klaviyo')
    expect(refusalFor([seen('cancelled')])).toBe('cancelled_in_klaviyo')
    expect(refusalFor([seen('draft', true)])).toBe('edited_in_klaviyo')
    expect(refusalFor([seen('draft', false, true)])).toBe('edited_in_klaviyo')
    expect(refusalFor([seen('draft'), seen('scheduled')])).toBe(
      'scheduled_in_klaviyo'
    )
  })
  it('lets a draft as GROS left it be updated (or none read yet)', () => {
    expect(refusalFor([])).toBeNull()
    expect(refusalFor([seen('draft')])).toBeNull()
    expect(refusalFor([seen('stale')])).toBeNull()
  })
})
