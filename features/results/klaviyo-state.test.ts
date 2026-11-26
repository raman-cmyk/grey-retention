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
  it('says when Klaviyo will send it, in the store’s time zone, with the year when it is not this year', () => {
    const jan = Date.parse('2027-01-02T12:00:00Z')
    const s = state({
      status: 'scheduled',
      scheduledFor: '2027-01-14T14:00:00Z',
      sendStrategy: 'static'
    })
    expect(stateLine(s, 'America/New_York', jan)).toBe(
      'Scheduled in Klaviyo for 14 Jan, 9:00 (store time)'
    )
    expect(stateLine(s, 'Asia/Kathmandu', jan)).toBe(
      'Scheduled in Klaviyo for 14 Jan, 19:45 (store time)'
    )
    expect(
      stateLine(s, 'America/New_York', Date.parse('2026-11-26T12:00:00Z'))
    ).toBe('Scheduled in Klaviyo for 14 Jan 2027, 9:00 (store time)')
    expect(
      stateLine({ ...s, sendStrategy: 'smart_send_time' }, 'UTC', jan)
    ).toBe(
      'Scheduled in Klaviyo from 14 Jan, 14:00 (store time; Klaviyo picks each person’s time)'
    )
    expect(stateLine({ ...s, scheduledFor: null }, 'UTC', jan)).toBe(
      'Scheduled in Klaviyo'
    )
  })

  it('a send at each person’s local time is wall-clock: never moved to the store’s zone, whatever the variant', () => {
    const jan = Date.parse('2027-01-02T12:00:00Z')
    // 23:30 local on the 14th: in New York's zone it would read the 14th
    // at 18:30, in Kathmandu the 15th.
    for (const sendStrategy of [
      'local_timezone',
      'content_variation_local_timezone'
    ])
      for (const zone of ['America/New_York', 'Asia/Kathmandu'])
        expect(
          stateLine(
            state({
              status: 'scheduled',
              scheduledFor: '2027-01-14T23:30:00Z',
              sendStrategy
            }),
            zone,
            jan
          )
        ).toBe(
          'Scheduled in Klaviyo for 14 Jan, 23:30, in each person’s own time zone'
        )
  })

  it('names every state, and an edit apart (never on a deleted draft)', () => {
    const words = (over: Partial<KlaviyoState>) =>
      stateParts(
        state(over),
        'Europe/London',
        Date.parse('2026-11-26T12:00:00Z')
      )
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
