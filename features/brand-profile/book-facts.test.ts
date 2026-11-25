import { describe, expect, it } from 'vitest'
import { factValue } from '@/features/onboarding/brand-book-corrections'
import { factInput, factKeys, factText } from './book-facts'
import { rewriteState, rewriteSteps, stuckAfterMs } from './rewrite-view'

/**
 * UI-BRAND-2: the owner writes the four facts in his own words; the page
 * sends the checked values the database takes (`private.brand_fact_ok`).
 */
describe('factInput', () => {
  it('reads free shipping as every order, never or an amount', () => {
    for (const [typed, value] of [
      ['always', 'always'],
      ['Every order', 'always'],
      ['on every  order', 'always'],
      ['never', 'never'],
      ['No', 'never'],
      ['75', 'over 75'],
      ['over 75', 'over 75'],
      ['Over 49.90', 'over 49.9'],
      ['0', 'over 0']
    ])
      expect(factInput('freeShipping', typed), typed).toEqual({ value })
    for (const typed of ['over $75', 'sometimes', '75.123', '12345678'])
      expect('error' in factInput('freeShipping', typed), typed).toBe(true)
  })

  it('reads days from 0 to 3650, 0 meaning none', () => {
    expect(factInput('returnDays', '30')).toEqual({ value: '30' })
    expect(factInput('returnDays', '30 days')).toEqual({ value: '30' })
    expect(factInput('guaranteeDays', '0')).toEqual({ value: '0' })
    expect(factInput('guaranteeDays', '007')).toEqual({ value: '7' })
    for (const typed of ['two weeks', '3651', '-1', '1.5'])
      expect('error' in factInput('returnDays', typed), typed).toBe(true)
  })

  it('reads delivery as a window of days, at most 90', () => {
    for (const [typed, value] of [
      ['3 to 7', '3-7'],
      ['3-7', '3-7'],
      ['3 - 7 days', '3-7'],
      ['5', '5-5'],
      ['0 to 2', '0-2']
    ])
      expect(factInput('deliveryDays', typed), typed).toEqual({ value })
    for (const typed of ['7 to 3', '3 to 95', '0', 'a week'])
      expect('error' in factInput('deliveryDays', typed), typed).toBe(true)
  })

  it('makes an empty field unknown', () => {
    for (const key of factKeys)
      expect(factInput(key, '   ')).toEqual({ value: null })
  })

  it('always gives a value the Brand book reads back the same way', () => {
    for (const [key, typed] of [
      ['freeShipping', 'over 75'],
      ['freeShipping', 'every order'],
      ['returnDays', '14'],
      ['deliveryDays', '3 to 7']
    ] as const) {
      const sent = factInput(key, typed)
      if (!('value' in sent) || sent.value === null) throw new Error(typed)
      // What the writer stores, shown back in the form as he wrote it.
      expect(factInput(key, factText(key, factValue(key, sent.value)))).toEqual(
        sent
      )
    }
  })
})

describe('factText', () => {
  it('shows a stored fact in the owner’s words, empty when unknown', () => {
    expect(factText('freeShipping', 'always')).toBe('every order')
    expect(factText('freeShipping', { over: 75 })).toBe('over 75')
    expect(factText('freeShipping', null)).toBe('')
    expect(factText('deliveryDays', { min: 3, max: 7 })).toBe('3 to 7')
    expect(factText('deliveryDays', { min: 5, max: 5 })).toBe('5')
    expect(factText('returnDays', 0)).toBe('0')
    expect(factText('guaranteeDays', 'thirty')).toBe('')
  })
})

describe('rewriteState', () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  const at = (ms: number) => new Date(now + ms).toISOString()

  it('says where the newest rewrite stands, null once it is done', () => {
    expect(rewriteState(null, now)).toBeNull()
    expect(
      rewriteState(
        { status: 'queued', updated_at: at(-1000), lease_until: null },
        now
      )
    ).toBe('waiting')
    expect(
      rewriteState(
        { status: 'running', updated_at: at(-1000), lease_until: at(30_000) },
        now
      )
    ).toBe('writing')
    for (const status of ['retry_wait', 'failed'])
      expect(
        rewriteState({ status, updated_at: at(-1000), lease_until: null }, now)
      ).toBe('failed')
    for (const status of ['succeeded', 'cancelled'])
      expect(
        rewriteState({ status, updated_at: at(-1000), lease_until: null }, now)
      ).toBeNull()
  })

  it('says a rewrite that never started or lost its lease is stuck', () => {
    expect(
      rewriteState(
        {
          status: 'queued',
          updated_at: at(-stuckAfterMs - 1),
          lease_until: null
        },
        now
      )
    ).toBe('stuck')
    expect(
      rewriteState(
        { status: 'running', updated_at: at(-1000), lease_until: at(-1) },
        now
      )
    ).toBe('stuck')
  })

  it('gives the Progress card the real steps', () => {
    expect(rewriteSteps('waiting').map((s) => s.state)).toEqual(['now', 'next'])
    expect(rewriteSteps('writing').map((s) => s.state)).toEqual(['done', 'now'])
    expect(rewriteSteps('failed')[0]).toMatchObject({
      state: 'failed',
      text: 'The Brand book was not rewritten',
      reason: 'Your brand and its corrections are saved. Try again.'
    })
    expect(
      (rewriteSteps('stuck', false)[0] as { reason?: string }).reason
    ).toBe(
      'Your brand and its corrections are saved. Ask the owner to try again.'
    )
  })
})
