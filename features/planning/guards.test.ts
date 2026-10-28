import { describe, it, expect } from 'vitest'
import { generateRollingFixture } from './fixture-planner'
import {
  planningViolations,
  copyClaimErrors,
  silenceDecision,
  localWeek
} from './guards'
describe('independent planning guards', () => {
  it('representative fixture months respect local weekly cadence and discount spacing', () => {
    for (const timezone of [
      'Asia/Kathmandu',
      'Australia/Melbourne',
      'America/New_York'
    ])
      for (const weeklyCap of [1, 3, 5]) {
        const plan = generateRollingFixture({
          start: '2027-03-04T10:00:00Z',
          timezone,
          audienceId: '00000000-0000-4000-8000-000000000501',
          brandName: 'Synthetic',
          existing: [],
          evergreenOffer: null,
          policy: { weeklyCap, discountCap: 40, sitewideGap: 7 }
        })
        const rows = plan.entries.map((e, i) => ({
          id: String(i),
          audienceId: e.audienceId,
          plannedAt: e.plannedAt,
          discounted: false,
          sitewide: false,
          offerId: e.offerId
        }))
        for (const row of rows)
          expect(
            planningViolations(row, rows, timezone, {
              weeklyCap,
              discountCap: 40,
              sitewideGap: 7
            })
          ).toEqual([])
        expect(rows.length).toBeGreaterThan(0)
        expect(localWeek(rows[0]!.plannedAt, timezone)).toMatch(
          /^\d{4}-\d{2}-\d{2}$/
        )
      }
  })
  it('rejects excess discounts, distinct sitewide adjacency and unverifiable claims', () => {
    const c = {
      id: 'a',
      audienceId: 'one',
      plannedAt: '2027-03-08T10:00:00Z',
      discounted: true,
      sitewide: true,
      offerId: 'o'
    }
    expect(
      planningViolations(
        c,
        [{ ...c, id: 'b', plannedAt: '2027-03-09T10:00:00Z' }],
        'UTC'
      )
    ).toEqual(['discount_share', 'sitewide_spacing'])
    expect(
      copyClaimErrors({
        text: 'Clinically proven: 50% through 2027-03-11. Never phrase.',
        allowedDiscount: 10,
        deadline: '2027-03-10',
        forbiddenPhrases: ['never phrase']
      })
    ).toEqual([
      'unverified_discount',
      'unverified_deadline',
      'owner_prohibition',
      'unsupported_claim'
    ])
  })
  it('frozen silence requires explicit policy, eligibility, exact revision and approved design', () => {
    const input = {
      now: '2027-03-04T00:00:00Z',
      createdAt: '2027-03-01T00:00:00Z',
      seenRevision: 2,
      currentRevision: 2,
      conditionalPolicy: true,
      eligible: true,
      rejected: false,
      designApproved: false
    }
    expect(silenceDecision(input)).toEqual({
      approveCopy: true,
      schedule: false,
      productionEnabled: false
    })
    for (const patch of [
      { now: '2027-03-03T23:59:59Z' },
      { rejected: true },
      { currentRevision: 3 },
      { eligible: false },
      { conditionalPolicy: false }
    ])
      expect(silenceDecision({ ...input, ...patch }).approveCopy).toBe(false)
    expect(silenceDecision({ ...input, designApproved: true }).schedule).toBe(
      true
    )
  })
})
it('retains owner event provenance without inventing an offer or weakening cadence', () => {
  const id = '00000000-0000-4000-8000-000000000555'
  const plan = generateRollingFixture({
    start: '2027-03-04T10:00:00Z',
    timezone: 'Asia/Kathmandu',
    audienceId: '00000000-0000-4000-8000-000000000501',
    brandName: 'Synthetic',
    existing: [],
    evergreenOffer: null,
    holidays: [
      {
        id,
        name: 'Original studio day',
        date: '2027-03-04',
        notes: 'Owner supplied'
      }
    ],
    policy: { weeklyCap: 5, discountCap: 40, sitewideGap: 7 }
  })
  const event = plan.entries.find((e) => e.holidayId === id)
  expect(event?.title).toContain('Original studio day')
  expect(event?.offerId).toBeNull()
  expect(event?.goal).toContain('no offer or deadline implied')
})
