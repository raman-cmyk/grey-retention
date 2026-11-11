import { describe, expect, it } from 'vitest'
import { parseCode, parseExpiry, parsePercent } from './fields'

describe('offer fields', () => {
  it('accepts codes the way the database does', () => {
    expect(parseCode('  WELCOME15 ')).toBe('WELCOME15')
    expect(parseCode('spring_sale-20')).toBe('spring_sale-20')
    for (const bad of ['AB', 'BAD CODE', 'x'.repeat(41), 'NO%', null])
      expect(parseCode(bad)).toBeNull()
  })

  it('takes whole percents only, with the right lower limit', () => {
    expect(parsePercent('0', 0)).toBe(0)
    expect(parsePercent('0', 1)).toBeNull()
    expect(parsePercent(' 15 ', 1)).toBe(15)
    expect(parsePercent('100', 1)).toBe(100)
    for (const bad of ['101', '12.5', '-5', '', 'ten', null])
      expect(parsePercent(bad, 0)).toBeNull()
  })

  it('ends a code at the end of that day in the brand timezone', () => {
    expect(parseExpiry('2026-12-31', 'UTC')).toBe('2026-12-31T23:59:59.000Z')
    // Kathmandu is UTC+5:45.
    expect(parseExpiry('2026-12-31', 'Asia/Kathmandu')).toBe(
      '2026-12-31T18:14:59.000Z'
    )
    // New York is UTC-5 in December and UTC-4 in July.
    expect(parseExpiry('2026-12-31', 'America/New_York')).toBe(
      '2027-01-01T04:59:59.000Z'
    )
    expect(parseExpiry('2026-07-04', 'America/New_York')).toBe(
      '2026-07-05T03:59:59.000Z'
    )
  })

  it('treats an empty date as no end date and rejects nonsense', () => {
    expect(parseExpiry('', 'UTC')).toBeNull()
    expect(parseExpiry(null, 'UTC')).toBeNull()
    for (const bad of ['2026-02-30', '31/12/2026', 'soon'])
      expect(parseExpiry(bad, 'UTC')).toBeUndefined()
    expect(parseExpiry('2026-12-31', 'Not/AZone')).toBeUndefined()
  })
})
