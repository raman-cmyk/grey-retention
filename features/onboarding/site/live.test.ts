// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { classifyFailure } from '@/features/integrations/failures'
import { sampleAsk, TagError } from '@/features/intelligence/passes'
import { cappedEnv, jobFailure, siteAsk, siteCallTimeoutMs } from './live'

describe('jobFailure', () => {
  it('lets the job runner try an AI outage or a rate limit again, and stop on a spent budget', () => {
    const classes = [
      'rate_limited',
      'cap_reached',
      'timeout',
      'unavailable',
      'rejected_request'
    ].map((code) => classifyFailure(jobFailure(new TagError(code))))
    // A spent budget stops: trying again would only be refused again.
    expect(classes).toEqual([
      'rate_limit',
      'validation',
      'transient',
      'transient',
      'validation'
    ])
    const other = new Error('x')
    expect(jobFailure(other)).toBe(other)
  })
})

describe('cappedEnv and siteAsk', () => {
  const env = (values: Record<string, string>) =>
    values as unknown as NodeJS.ProcessEnv
  it('caps every model call of the readers run, keeping a shorter one', () => {
    expect(
      cappedEnv(env({ GEMINI_TIMEOUT_MS: '60000' })).GEMINI_TIMEOUT_MS
    ).toBe(String(siteCallTimeoutMs))
    expect(
      cappedEnv(env({ GEMINI_TIMEOUT_MS: '6000' })).GEMINI_TIMEOUT_MS
    ).toBe('6000')
    // A value the AI setup cannot take (it would fall back to 60 s) is capped.
    for (const odd of ['4000', '7.5', 'soon'])
      expect(cappedEnv(env({ GEMINI_TIMEOUT_MS: odd })).GEMINI_TIMEOUT_MS).toBe(
        String(siteCallTimeoutMs)
      )
    expect(cappedEnv(env({})).GEMINI_TIMEOUT_MS).toBe(String(siteCallTimeoutMs))
  })

  it('uses the sample rules for the sample site, a model for a live one only when set up', () => {
    const db = {} as Parameters<typeof siteAsk>[0]
    const fake = siteAsk(db, 't1', env({ AI_DEFAULT_PROVIDER: 'fake' }))
    expect(fake(false)).toBe(sampleAsk)
    expect(fake(true)).toBeNull()
    const gemini = siteAsk(
      db,
      't1',
      env({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_API_KEY: 'synthetic' })
    )
    expect(gemini(false)).toBe(sampleAsk)
    expect(gemini(true)).not.toBeNull()
    expect(gemini(true)).not.toBe(sampleAsk)
  })
})
