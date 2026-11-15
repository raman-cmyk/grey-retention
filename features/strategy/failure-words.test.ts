import { describe, expect, it } from 'vitest'
import {
  buildCode,
  buildFailureWords,
  buildReason
} from '@/features/email-build/failure-words'
import { planCode, planFailureWords, planReason } from './failure-words'

// Every code the jobs can write today (REL-084). A new code must get its
// own words here, or it shows the plain fallback.
const buildCodes = [
  'planned_email_invalid',
  'slot_time_invalid',
  'offers_unreadable',
  'copy_failed',
  'render_failed',
  'built_email_invalid',
  'email_too_large',
  'step_output_invalid',
  'step_progress_invalid',
  'step_unknown',
  'store_changed',
  'store_data_invalid',
  'day_passed',
  'step_timed_out',
  'step_error',
  'klaviyo_auth',
  'klaviyo_rejected',
  'klaviyo_rate_limited',
  'klaviyo_unavailable'
]
const planCodes = [
  'out_of_date',
  'step_timed_out',
  'step_error',
  'store_data_invalid',
  'store_wrong_days',
  'stored_pulse_invalid',
  'stored_pick_invalid',
  'pick_not_in_pulse',
  'plan_offer_unusable',
  'offers_unreadable'
]

describe('plain words for every failure', () => {
  it('has its own words for every code the build and plan jobs write', () => {
    expect(Object.keys(buildFailureWords).sort()).toEqual(
      [...buildCodes].sort()
    )
    expect(Object.keys(planFailureWords).sort()).toEqual([...planCodes].sort())
    for (const words of [
      ...Object.values(buildFailureWords),
      ...Object.values(planFailureWords)
    ]) {
      // A short plain sentence, never a code.
      expect(words).toMatch(/^[A-Z].{8,120}\.$/)
      expect(words).not.toMatch(/_/)
    }
  })

  it('never says nothing: an unknown or missing code gets a plain sentence', () => {
    for (const code of [null, '', 'something_new', 'toString', '__proto__']) {
      expect(buildReason(code)).toBe(
        'Something went wrong while it was being made. Try again.'
      )
      expect(planReason(code)).toBe(
        'Something went wrong while planning. Try again.'
      )
    }
    expect(buildReason('day_passed')).toBe(
      'Its day passed before it was ready.'
    )
  })

  it('stores only codes with words: anything else becomes step_error', () => {
    expect(buildCode('bug')).toBe('step_error')
    expect(buildCode('copy_failed')).toBe('copy_failed')
    expect(planCode('focus_unavailable')).toBe('step_error')
    expect(planCode('out_of_date')).toBe('out_of_date')
  })
})
