import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const scheduler = vi.hoisted(() => ({ runScheduledJobs: vi.fn() }))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/features/cron/scheduler', () => scheduler)
vi.mock('@/lib/supabase/service', () => service)
vi.mock('@/features/integrations/worker', () => ({ runFixtureJobs: vi.fn() }))

import { GET } from '@/app/api/internal/jobs/route'

const secret = 'original-synthetic-cron-secret-32-characters'
const request = (authorization?: string) =>
  new NextRequest('http://127.0.0.1:3100/api/internal/jobs', {
    headers: authorization ? { authorization } : {}
  })

describe('GET /api/internal/jobs (scheduled sweep)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret)
    vi.stubEnv('ADAPTER_MODE', 'fake')
    service.createServiceClient.mockReturnValue({})
    scheduler.runScheduledJobs.mockResolvedValue({
      tenants: 2,
      processed: 3,
      failed: 0,
      deferred: 0,
      rounds: 1
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    scheduler.runScheduledJobs.mockReset()
  })

  it('refuses a missing, wrong or non-bearer secret without running anything', async () => {
    for (const header of [
      undefined,
      'Bearer wrong',
      `Basic ${secret}`,
      `Bearer ${secret}x`
    ]) {
      const response = await GET(request(header))
      expect(response.status).toBe(401)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('fails closed when the server has no secret configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(401)
    expect((await GET(request('Bearer '))).status).toBe(401)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('refuses to run when live providers are configured', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(503)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('reports unavailable server configuration', async () => {
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('runs the sweep and returns only counts', async () => {
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      live: false,
      tenants: 2,
      processed: 3,
      failed: 0,
      deferred: 0,
      rounds: 1
    })
    expect(scheduler.runScheduledJobs).toHaveBeenCalledOnce()
  })

  it('returns a safe error when the sweep cannot start', async () => {
    scheduler.runScheduledJobs.mockRejectedValue(
      Object.assign(new Error('relation secret detail'), { code: 'PGRST301' })
    )
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(500)
    const body = JSON.stringify(await response.json())
    expect(body).not.toContain('relation secret detail')
  })
})
