import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const scheduler = vi.hoisted(() => ({
  runScheduledJobs: vi.fn(),
  scheduleLimits: { budgetMs: 40_000 }
}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/features/cron/scheduler', () => scheduler)
vi.mock('@/lib/supabase/service', () => service)
vi.mock('@/features/integrations/worker', () => ({ runFixtureJobs: vi.fn() }))
const inbox = vi.hoisted(() => ({ runInboxStep: vi.fn() }))
vi.mock('@/features/inbox/step', () => inbox)

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
    inbox.runInboxStep.mockResolvedValue({
      transport: 'fake',
      ready: true,
      synthetic: true,
      run: {
        state: 'done',
        recorded: 1,
        duplicates: 0,
        unassigned: 2,
        skipped: 0,
        more: false
      }
    })
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
    expect(inbox.runInboxStep).not.toHaveBeenCalled()
  })

  it('fails closed when the server has no secret configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(401)
    expect((await GET(request('Bearer '))).status).toBe(401)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('checks the secret before revealing anything about configuration', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('reads the inbox but runs no workspace job when live providers are configured', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(503)
    expect((await response.json()).inbox.ready).toBe(true)
    expect(inbox.runInboxStep).toHaveBeenCalledOnce()
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
  })

  it('reports unavailable server configuration', async () => {
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503)
    expect(scheduler.runScheduledJobs).not.toHaveBeenCalled()
    expect(inbox.runInboxStep).not.toHaveBeenCalled()
  })

  it('gives the workspace jobs only what the inbox left of the budget', async () => {
    let t = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    inbox.runInboxStep.mockImplementation(async () => {
      t += 15_000
      return {
        transport: 'fake',
        ready: true,
        synthetic: true,
        run: { state: 'busy' }
      }
    })
    await GET(request(`Bearer ${secret}`))
    expect(scheduler.runScheduledJobs).toHaveBeenCalledWith(
      {},
      { limits: { budgetMs: 25_000 } }
    )
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
      rounds: 1,
      inbox: {
        transport: 'fake',
        ready: true,
        synthetic: true,
        run: {
          state: 'done',
          recorded: 1,
          duplicates: 0,
          unassigned: 2,
          skipped: 0,
          more: false
        }
      }
    })
    expect(scheduler.runScheduledJobs).toHaveBeenCalledOnce()
    // The inbox is read first, then the workspace jobs.
    expect(inbox.runInboxStep.mock.invocationCallOrder[0]).toBeLessThan(
      scheduler.runScheduledJobs.mock.invocationCallOrder[0]!
    )
  })

  it('still runs the workspace jobs when the inbox is not set up', async () => {
    inbox.runInboxStep.mockResolvedValue({
      transport: 'gmail_imap',
      ready: false,
      reason: 'INBOX_IMAP_USER must be the Gmail address of the inbox.'
    })
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect((await response.json()).inbox.ready).toBe(false)
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
