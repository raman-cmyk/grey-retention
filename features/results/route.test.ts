// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
const sync = vi.hoisted(() => ({ runResultsSync: vi.fn() }))
vi.mock('@/features/results/live', () => sync)

import { GET } from '@/app/api/internal/klaviyo/results/route'

const secret = 'synthetic-results-cron-secret-32-characters'
const request = (authorization?: string, query = '') =>
  new NextRequest(
    `http://127.0.0.1:3100/api/internal/klaviyo/results${query}`,
    {
      headers: authorization ? { authorization } : {}
    }
  )

describe('GET /api/internal/klaviyo/results', () => {
  const rpc = vi.fn()
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    service.createServiceClient.mockReturnValue({ rpc })
    rpc.mockResolvedValue({ data: 3, error: null })
    sync.runResultsSync.mockResolvedValue({
      state: 'done',
      checked: 2,
      pulled: 1,
      paused: 0,
      deferred: 0
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rpc.mockReset()
  })

  it('refuses a missing or wrong secret without reading anything', async () => {
    for (const header of [undefined, 'Bearer wrong', `Basic ${secret}`])
      expect((await GET(request(header))).status).toBe(401)
    expect(sync.runResultsSync).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says how many checks are due, and nothing else, when asked to peek', async () => {
    const response = await GET(request(`Bearer ${secret}`, '?peek=1'))
    expect(await response.json()).toEqual({ waiting: 3 })
    expect(rpc).toHaveBeenCalledWith('klaviyo_results_waiting')
    expect(sync.runResultsSync).not.toHaveBeenCalled()
  })

  it('runs the due checks and answers with counts only, never cached', async () => {
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      state: 'done',
      checked: 2,
      pulled: 1,
      paused: 0,
      deferred: 0
    })
  })

  it('answers a failed run with a code, never its details', async () => {
    sync.runResultsSync.mockRejectedValue(
      Object.assign(new Error('relation does not exist: secret detail'), {
        code: '42P01'
      })
    )
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      state: 'failed',
      code: 'results_error'
    })
  })

  it('says the server is not set up when there is no service client', async () => {
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503)
  })
})
