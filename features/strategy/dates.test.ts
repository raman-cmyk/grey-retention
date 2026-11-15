// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fallbackEntry } from '@/features/fallback/entry'
import type { PlannedSlot } from './plan'
import {
  inPlanWindow,
  outsideWindowEntry,
  outsideWindowNote,
  slotsInWindow
} from './dates'

const slot = (date: string): PlannedSlot => ({
  date,
  time: '10:00',
  emailType: 'story',
  angle: 'From the store, in its own words',
  products: [],
  offer: null,
  audience: { id: 'engaged', label: 'Engaged subscribers' },
  why: 'A note.',
  evidence: []
})

describe('a plan’s 15 days (REL-DAT)', () => {
  it('hold its first day to its fifteenth, and nothing else', () => {
    expect(inPlanWindow('2026-11-16', '2026-11-16')).toBe(true)
    expect(inPlanWindow('2026-11-30', '2026-11-16')).toBe(true)
    expect(inPlanWindow('2026-12-01', '2026-11-16')).toBe(false)
    expect(inPlanWindow('2026-11-15', '2026-11-16')).toBe(false)
    expect(inPlanWindow('soon', '2026-11-16')).toBe(false)
  })

  it('leave an email outside them out of the plan, noted and logged by count', () => {
    const slots = [slot('2026-11-15'), slot('2026-11-20'), slot('2026-12-03')]
    const { slots: kept, dropped } = slotsInWindow(slots, '2026-11-16')
    expect(kept).toEqual([slots[1]])
    expect(dropped).toEqual([slots[0], slots[2]])
    expect(outsideWindowNote(dropped)).toBe(
      '2 emails were left out: their days were not in these 15 days.'
    )
    expect(outsideWindowNote(dropped.slice(0, 1))).toBe(
      'One email was left out: its day was not in these 15 days.'
    )
    expect(outsideWindowNote([])).toBeNull()
    expect(
      fallbackEntry.parse(
        outsideWindowEntry({
          tenantId: '00000000-0000-4000-8000-000000000101',
          runId: 'run-1',
          dropped
        })
      )
    ).toMatchObject({
      agent: 'plan-dates',
      reasonCode: 'slot_outside_plan',
      detail: { count: 2 }
    })
  })
})
