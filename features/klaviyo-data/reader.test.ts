import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// The real helper parses the environment once per process.
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: () => ({
    ADAPTER_MODE: process.env.ADAPTER_MODE === 'real' ? 'real' : 'fake'
  })
}))
const rows = vi.hoisted(() => ({
  value: null as null | { provider: string; status: string }[],
  error: null as null | Error
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    rows.value === null && rows.error === null
      ? null
      : {
          from: () => ({
            select: () => ({
              eq: async () => ({ data: rows.value, error: rows.error })
            })
          })
        }
}))

const { klaviyoData } = await import('./reader')
const now = Date.parse('2026-11-06T12:00:00Z')

afterEach(() => {
  vi.unstubAllEnvs()
  rows.value = null
  rows.error = null
})

describe('Klaviyo reader', () => {
  it('shows labelled sample data when the workspace connection is on', async () => {
    vi.stubEnv('ADAPTER_MODE', 'fake')
    rows.value = [
      { provider: 'klaviyo', status: 'connected' },
      { provider: 'shopify', status: 'disconnected' }
    ]
    const data = await klaviyoData('t1', 'UTC', now)
    expect(data).toMatchObject({ state: 'sample', shopify: 'disconnected' })
  })

  it('says not connected, with the reason, instead of showing numbers', async () => {
    vi.stubEnv('ADAPTER_MODE', 'fake')
    rows.value = [{ provider: 'klaviyo', status: 'expired' }]
    expect(await klaviyoData('t2', 'UTC', now)).toEqual({
      state: 'not_connected',
      reason: 'expired'
    })
    rows.value = []
    expect(await klaviyoData('t3', 'UTC', now)).toEqual({
      state: 'not_connected',
      reason: 'missing'
    })
    rows.value = null
    rows.error = new Error('down')
    expect(await klaviyoData('t4', 'UTC', now)).toEqual({
      state: 'not_connected',
      reason: 'unknown'
    })
  })

  it('uses sample data without a database (demo sign-in)', async () => {
    vi.stubEnv('ADAPTER_MODE', 'fake')
    expect((await klaviyoData('t5', 'UTC', now)).state).toBe('sample')
  })

  it('never tells a real-mode owner they are disconnected', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    rows.value = [{ provider: 'klaviyo', status: 'connected' }]
    expect(await klaviyoData('t6', 'UTC', now)).toEqual({
      state: 'unavailable'
    })
  })
})
