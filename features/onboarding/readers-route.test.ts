// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
const readers = vi.hoisted(() => ({ runSourceReadings: vi.fn() }))
vi.mock('@/features/onboarding/readers', () => readers)

import { GET } from '@/app/api/internal/onboarding/readers/route'

const secret = 'synthetic-readers-cron-secret-32-characters'
const request = (authorization?: string, query = '') =>
  new NextRequest(
    `http://127.0.0.1:3100/api/internal/onboarding/readers${query}`,
    { headers: authorization ? { authorization } : {} }
  )

describe('GET /api/internal/onboarding/readers', () => {
  const rpc = vi.fn()
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret)
    service.createServiceClient.mockReturnValue({ rpc })
    rpc.mockResolvedValue({ data: 2, error: null })
    readers.runSourceReadings.mockResolvedValue({
      state: 'done',
      reads: 1,
      failed: 0
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
    expect(readers.runSourceReadings).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says how many reads are waiting, and nothing else, when asked to peek', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === 'source_readings_waiting' ? 2 : 0,
      error: null
    }))
    const response = await GET(request(`Bearer ${secret}`, '?peek=1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ waiting: 2 })
    expect(rpc).toHaveBeenCalledWith('source_readings_waiting')
    expect(readers.runSourceReadings).not.toHaveBeenCalled()
  })

  it('counts the Brand book rewrites waiting too (UI-BRAND-2)', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === 'source_readings_waiting' ? 0 : 1,
      error: null
    }))
    const response = await GET(request(`Bearer ${secret}`, '?peek=1'))
    expect(await response.json()).toEqual({ waiting: 1 })
    expect(rpc).toHaveBeenCalledWith('brand_book_writes_waiting')
    // A failed count is none: the reads still decide.
    rpc.mockImplementation(async (name: string) =>
      name === 'source_readings_waiting'
        ? { data: 3, error: null }
        : { data: null, error: { code: 'PGRST301' } }
    )
    expect(
      await (await GET(request(`Bearer ${secret}`, '?peek=1'))).json()
    ).toEqual({ waiting: 3 })
  })

  it('runs the waiting reads and answers with counts only, never cached', async () => {
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      state: 'done',
      reads: 1,
      failed: 0
    })
    readers.runSourceReadings.mockResolvedValue({
      state: 'failed',
      code: 'PGRST301'
    })
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(500)
  })

  it('says the server is not set up when there is no service client', async () => {
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503)
  })
})
