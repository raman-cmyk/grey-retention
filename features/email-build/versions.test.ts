import { describe, expect, it } from 'vitest'
import { maxEmailBytes } from './step-names'
import {
  howText,
  restoreWords,
  usableVersion,
  versionTime,
  versionsKept,
  versionsView,
  type VersionRow
} from './versions'

const email = (over: Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Bestseller: Cedar candle',
  subject: 'Our cedar candle is back',
  preheader: 'Warm nights start here.',
  html: '<p>B</p>',
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-11-20T18:00:00Z',
  audienceId: 'a1',
  productIds: ['p1'],
  code: null,
  changes: [],
  ...over
})

// 27 Nov 2026, 15:00 in London (UTC in winter).
const now = Date.parse('2026-11-27T15:00:00Z')
const row = (number: number, over: Partial<VersionRow> = {}): VersionRow => ({
  number,
  how: 'scratch',
  restoredFrom: null,
  subject: `Subject ${number}`,
  createdAt: '2026-11-27T10:40:00Z',
  ...over
})

describe('an email’s versions (PICK-106)', () => {
  it('lists them newest first, in the owner’s words, the newest current', () => {
    const view = versionsView(
      [
        row(1, { createdAt: '2026-11-26T09:05:00Z' }),
        row(3, { how: 'restore', restoredFrom: 1 }),
        row(2, { how: 'try_again', createdAt: '2026-11-20T08:00:00Z' })
      ],
      { timezone: 'Europe/London', now }
    )
    expect(view?.newest).toBe(3)
    expect(view?.lines.map((l) => l.label)).toEqual([
      'Version 3 · Today 10:40 · Version 1 brought back',
      'Version 2 · 20 Nov, 8:00 · Made again with Try again',
      'Version 1 · Yesterday 9:05 · Made from scratch'
    ])
    expect(view?.lines.map((l) => l.current)).toEqual([true, false, false])
    // None asked for: the newest is shown.
    expect(view?.lines.map((l) => l.shown)).toEqual([true, false, false])
    expect(view?.full).toBe(false)
  })

  it('shows the one asked for, and the newest when it is not kept', () => {
    const rows = [row(1), row(2)]
    expect(
      versionsView(rows, { timezone: 'UTC', shown: 1, now })?.lines.find(
        (l) => l.shown
      )?.number
    ).toBe(1)
    expect(
      versionsView(rows, { timezone: 'UTC', shown: 9, now })?.lines.find(
        (l) => l.shown
      )?.number
    ).toBe(2)
  })

  it('has no list for an email made before version history', () => {
    expect(versionsView([], { timezone: 'UTC', now })).toBeNull()
  })

  it('says when the limit is reached', () => {
    const rows = Array.from({ length: versionsKept }, (_, i) => row(i + 5))
    expect(versionsView(rows, { timezone: 'UTC', now })?.full).toBe(true)
    expect(versionsKept).toBe(20)
  })

  it('names how each was made', () => {
    expect(howText('scratch', null)).toBe('Made from scratch')
    expect(howText('library_copy', null)).toBe('Copied from an email you chose')
    expect(howText('upload_copy', null)).toBe('Copied from your own email')
    expect(howText('remix', null)).toBe('Remixed from an email you chose')
    expect(howText('try_again', null)).toBe('Made again with Try again')
    expect(howText('restore', 4)).toBe('Version 4 brought back')
    expect(howText('something new', null)).toBe('Made by GROS')
  })

  it('says times in store time, and nothing for a time it cannot read', () => {
    // In Tokyo it is already 28 Nov: the 27th there is yesterday.
    expect(versionTime('2026-11-27T00:30:00Z', 'Asia/Tokyo', now)).toBe(
      'Yesterday 9:30'
    )
    expect(versionTime('2026-11-25T23:30:00Z', 'Asia/Tokyo', now)).toBe(
      '26 Nov, 8:30'
    )
    expect(versionTime('2026-11-27T14:00:00Z', 'America/New_York', now)).toBe(
      'Today 9:00'
    )
    expect(versionTime('2025-01-02T10:00:00Z', 'UTC', now)).toBe(
      '2 Jan 2025, 10:00'
    )
    expect(versionTime('nope', 'UTC', now)).toBeNull()
  })

  it('uses again only a version of today’s shape and size', () => {
    expect(usableVersion(email())?.subject).toBe('Our cedar candle is back')
    expect(usableVersion({ html: '<p>old</p>' })).toBeNull()
    expect(usableVersion(email({ html: 'x'.repeat(maxEmailBytes) }))).toBeNull()
  })

  it('has plain words for every refusal of the command', () => {
    for (const hint of [
      'version_busy',
      'version_not_drafted',
      'version_stale',
      'version_unknown',
      'version_current',
      'version_sent',
      'version_scheduled',
      'version_gone',
      'version_edited',
      'version_day_passed'
    ])
      expect(restoreWords[hint]).toMatch(/^[A-Z].+\.$/)
  })
})
