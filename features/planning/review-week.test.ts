import { expect, it } from 'vitest'
import { reviewWeek } from './review-week'

it('falls back to the current tenant-local week for impossible dates and malformed query values', () => {
  const now = '2026-10-04T21:00:00Z'
  for (const value of [
    '2026-02-30',
    '2026-13-04',
    '2026-10-99',
    '0000-01-01',
    '',
    undefined,
    ['2026-10-04']
  ])
    expect(reviewWeek(value, 'Asia/Kathmandu', now)).toBe('2026-10-05')
  expect(reviewWeek('2026-02-29', 'UTC', now)).toBe('2026-09-28')
})

it('treats a valid chosen date as a tenant calendar date even at the extreme timezone boundary', () => {
  expect(reviewWeek('2026-10-04', 'Pacific/Kiritimati')).toBe('2026-09-28')
  expect(reviewWeek('2028-02-29', 'America/Los_Angeles')).toBe('2028-02-28')
  expect(reviewWeek('0001-01-01', 'UTC')).toBe('0001-01-01')
})
