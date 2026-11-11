// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { classifyFailure } from '@/features/integrations/failures'
import { TagError } from '@/features/intelligence/passes'
import { jobFailure } from './live'

describe('jobFailure', () => {
  it('lets the workspace jobs try an AI outage again and wait out a rate limit or a spent budget', () => {
    const classes = [
      'rate_limited',
      'cap_reached',
      'timeout',
      'unavailable',
      'rejected_request'
    ].map((code) => classifyFailure(jobFailure(new TagError(code))))
    expect(classes).toEqual([
      'rate_limit',
      'rate_limit',
      'transient',
      'transient',
      'validation'
    ])
    const other = new Error('x')
    expect(jobFailure(other)).toBe(other)
  })
})
