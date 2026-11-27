// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ENGINE_VERSION } from '@/features/design-engine/stored'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)

const { GET, POST } = await import('@/app/api/internal/design/uploads/route')

const secret = 'synthetic-upload-cron-secret-of-32-characters'
const url = 'http://127.0.0.1:3100/api/internal/design/uploads'
const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'

const post = (body: string, authorization = `Bearer ${secret}`) =>
  new NextRequest(url, {
    method: 'POST',
    body,
    headers: { authorization, 'content-type': 'application/json' }
  })

const client = () => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
  from: vi.fn()
})

describe('/api/internal/design/uploads (DES-ENGINE-003a)', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', secret))
  afterEach(() => {
    vi.unstubAllEnvs()
    service.createServiceClient.mockReset()
  })

  it('refuses a missing or wrong secret, touching nothing', async () => {
    const db = client()
    service.createServiceClient.mockReturnValue(db)
    for (const header of [undefined, 'Bearer wrong', secret]) {
      for (const query of ['', '?peek=1', '?sweep=1']) {
        const got = await GET(
          new NextRequest(`${url}${query}`, {
            headers: header ? { authorization: header } : {}
          })
        )
        expect(got.status).toBe(401)
      }
      expect((await POST(post('{}', header ?? ''))).status).toBe(401)
    }
    expect(db.rpc).not.toHaveBeenCalled()
    expect(db.from).not.toHaveBeenCalled()
  })

  it('refuses a report too large, and one that is not a result, recording nothing', async () => {
    const db = client()
    service.createServiceClient.mockReturnValue(db)
    const big = post(
      JSON.stringify({
        job,
        lease,
        engine: ENGINE_VERSION,
        blueprint: 'x'.repeat(2_000_001)
      })
    )
    expect((await POST(big)).status).toBe(413)
    const declared = new NextRequest(url, {
      method: 'POST',
      body: '{}',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-length': '3000000'
      }
    })
    expect((await POST(declared)).status).toBe(413)
    expect((await POST(post('not json'))).status).toBe(400)
    expect((await POST(post(JSON.stringify({ job, lease })))).status).toBe(400)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('hands nothing out with the owner’s switch off', async () => {
    const db = client()
    service.createServiceClient.mockReturnValue(db)
    const got = await GET(
      new NextRequest(`${url}?engine=${ENGINE_VERSION}`, {
        headers: { authorization: `Bearer ${secret}` }
      })
    )
    expect(await got.json()).toEqual({ jobs: [], skew: false, off: true })
    const peek = await GET(
      new NextRequest(`${url}?peek=1`, {
        headers: { authorization: `Bearer ${secret}` }
      })
    )
    expect(await peek.json()).toEqual({ waiting: 0 })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
