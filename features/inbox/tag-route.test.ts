// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
const tagging = vi.hoisted(() => ({ runTagging: vi.fn() }))
vi.mock('@/features/inbox/tag-run', () => tagging)

import { GET } from '@/app/api/internal/inbox/tags/route'

const secret = 'synthetic-tagging-cron-secret-32-characters'
const request = (authorization?: string) =>
  new NextRequest('http://127.0.0.1:3100/api/internal/inbox/tags', {
    headers: authorization ? { authorization } : {}
  })
const counts = { emails: 3, sections: 12, untagged: 0, retried: 0, deferred: 1 }

describe('GET /api/internal/inbox/tags (tagging run)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret)
    service.createServiceClient.mockReturnValue({})
    tagging.runTagging.mockResolvedValue({
      state: 'done',
      live: false,
      ...counts
    })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    service.createServiceClient.mockReset()
    tagging.runTagging.mockReset()
  })

  it('refuses a missing, wrong or non-bearer secret without tagging', async () => {
    for (const header of [
      undefined,
      'Bearer wrong-secret-of-the-wrong-length',
      `Bearer ${secret}x`,
      secret,
      `Basic ${secret}`
    ]) {
      const response = await GET(request(header))
      expect(response.status).toBe(401)
    }
    expect(tagging.runTagging).not.toHaveBeenCalled()
  })

  it('refuses everything when the server secret is missing or too short', async () => {
    vi.stubEnv('CRON_SECRET', 'short')
    expect((await GET(request('Bearer short'))).status).toBe(401)
    expect(tagging.runTagging).not.toHaveBeenCalled()
  })

  it('says the server is not set up when there is no service client', async () => {
    service.createServiceClient.mockReturnValue(null)
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(503)
    expect(tagging.runTagging).not.toHaveBeenCalled()
  })

  it('answers with counts only, never cached', async () => {
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      state: 'done',
      live: false,
      ...counts
    })
  })

  it('reports a failed run as a server error with its code', async () => {
    tagging.runTagging.mockResolvedValue({ state: 'failed', code: 'PGRST301' })
    const response = await GET(request(`Bearer ${secret}`))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      state: 'failed',
      code: 'PGRST301'
    })
  })
})
