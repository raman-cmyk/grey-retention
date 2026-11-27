// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }))
import { statusOf } from './data'

describe('statusOf (GROS-INS-002)', () => {
  it('keeps the sample capture statuses', () => {
    expect(statusOf('live', 3)).toBe('live')
    expect(statusOf('pending', 0)).toBe('pending')
    expect(statusOf('error', 2)).toBe('error')
  })

  it('shows a real brand requested only while its request is pending', () => {
    expect(statusOf(undefined, 0, { subscription: 'pending' })).toBe(
      'requested'
    )
    expect(statusOf(undefined, 0, { subscription: 'subscribed' })).toBe(
      'subscribed'
    )
    // Observer collects it, but none of its emails is rated Exemplary now.
    expect(statusOf(undefined, 0, { subscription: 'not_subscribed' })).toBe(
      'subscribed'
    )
    expect(statusOf('pending', 4, { subscription: 'pending' })).toBe('live')
  })
})
