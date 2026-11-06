import { describe, expect, it } from 'vitest'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import {
  campaignWords,
  flowSteps,
  liveEmailsLine,
  optInWords,
  percent,
  triggerWords,
  waitWords
} from './words'

const snapshot = sampleKlaviyoSnapshot({
  now: new Date('2026-11-06T12:00:00Z'),
  timezone: 'UTC'
})
const flow = (id: string) => snapshot.flows.find((f) => f.id === id)!

describe('detail page words', () => {
  it('names the sign-up method without raw values', () => {
    expect(optInWords('single').label).toBe('Single opt-in')
    expect(optInWords('double').line).toMatch(/confirm by email/)
  })

  it('describes waits in plain words', () => {
    expect(waitWords(45 * 60)).toBe('45 minutes · any day')
    expect(waitWords(86400 + 3600)).toBe('1 day 1 hour · any day')
    expect(waitWords(0)).toBe('no time · any day')
    // Rounded to whole minutes first: never "60 minutes" or "23 hours 60 minutes".
    expect(waitWords(3599)).toBe('1 hour · any day')
    expect(waitWords(86399)).toBe('1 day · any day')
    expect(waitWords(20)).toBe('less than a minute · any day')
    expect(waitWords(7200, ['monday', 'friday'])).toBe(
      '2 hours · only on Monday, Friday'
    )
  })

  it('builds the action sequence with a wait before delayed emails', () => {
    const steps = flowSteps(flow('FLWwel001'))
    expect(steps.map((s) => s.kind)).toEqual([
      'email',
      'wait',
      'email',
      'wait',
      'email'
    ])
  })

  it('warns when a live flow has emails that are off', () => {
    expect(liveEmailsLine(flow('FLWpst004'))).toBe('1 of 2 emails is not live.')
    expect(liveEmailsLine(flow('FLWwel001'))).toBeNull()
    expect(liveEmailsLine(flow('FLWwbk005'))).toBeNull()
  })

  it('names the trigger and computes rates safely', () => {
    expect(triggerWords(flow('FLWabc002')).label).toBe(
      'Metric: Started Checkout'
    )
    expect(triggerWords(flow('FLWwel001')).label).toBe(
      'Added to list: Newsletter'
    )
    expect(percent(41, 100)).toBe('41.0%')
    expect(percent(1, 0)).toBe('—')
  })

  it('never says a draft or cancelled campaign was sent', () => {
    expect(campaignWords('sent', true).what).toBe('What was sent')
    expect(campaignWords('scheduled', true).who).toBe('Who will get this')
    expect(campaignWords('cancelled', true).whoLine).toMatch(
      /^Cancelled before it was sent/
    )
    expect(campaignWords('draft', false).timeLabel).toBeNull()
    for (const status of ['scheduled', 'cancelled', 'draft'] as const)
      expect(JSON.stringify(campaignWords(status, true))).not.toMatch(
        /was sent to|What was sent/
      )
  })
})
