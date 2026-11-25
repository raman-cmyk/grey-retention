// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ENGINE_VERSION } from '@/features/design-engine/stored'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
vi.mock('@/features/klaviyo-push/live', () => ({
  draftPusherFor: () => ({ createDraft: vi.fn() })
}))
vi.mock('./worker', () => ({ runEmailBuilds: vi.fn(async () => ({ ran: 0 })) }))

const { GET, POST } = await import('@/app/api/internal/design/copies/route')

const secret = 'synthetic-copy-cron-secret-of-32-characters'
const url = 'http://127.0.0.1:3100/api/internal/design/copies'
const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'

const post = (body: string, authorization = `Bearer ${secret}`) =>
  new NextRequest(url, {
    method: 'POST',
    body,
    headers: { authorization, 'content-type': 'application/json' }
  })

function db(error: { code: string } | null = null) {
  const rpc = vi.fn(async (fn: string) =>
    fn === 'record_email_copy'
      ? { data: error ? null : 'failed', error }
      : { data: null, error: null }
  )
  return { rpc }
}

describe('/api/internal/design/copies (DES-ENGINE-002b2)', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', secret))
  afterEach(() => {
    vi.unstubAllEnvs()
    service.createServiceClient.mockReset()
  })

  it('refuses a missing or wrong secret, touching nothing', async () => {
    const client = db()
    service.createServiceClient.mockReturnValue(client)
    for (const header of [undefined, 'Bearer wrong', secret]) {
      const get = await GET(
        new NextRequest(url, {
          headers: header ? { authorization: header } : {}
        })
      )
      expect(get.status).toBe(401)
      expect((await POST(post('{}', header ?? ''))).status).toBe(401)
    }
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('hands nothing to a browser on another engine version, claiming nothing', async () => {
    const client = db()
    service.createServiceClient.mockReturnValue(client)
    for (const query of ['', '?engine=older']) {
      const got = await GET(
        new NextRequest(`${url}${query}`, {
          headers: { authorization: `Bearer ${secret}` }
        })
      )
      expect(got.status).toBe(200)
      expect(await got.json()).toEqual({ jobs: [], skew: true })
    }
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('carries nothing on with the switch off', async () => {
    service.createServiceClient.mockReturnValue(db())
    const got = await GET(
      new NextRequest(`${url}?carry=1`, {
        headers: { authorization: `Bearer ${secret}` }
      })
    )
    expect(await got.json()).toEqual({ off: true, builds: 0, ran: 0 })
  })

  it('refuses a body too large (413), not JSON or of the wrong shape (400)', async () => {
    const client = db()
    service.createServiceClient.mockReturnValue(client)
    expect((await POST(post('x'.repeat(460_000)))).status).toBe(413)
    expect((await POST(post('not json'))).status).toBe(400)
    expect(
      (
        await POST(
          post(
            JSON.stringify({
              job,
              lease,
              engine: ENGINE_VERSION,
              failure: 'leaked'
            })
          )
        )
      ).status
    ).toBe(400)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('records a final failure; a lost lease is 409, a refused copy 422', async () => {
    const body = JSON.stringify({
      job,
      lease,
      engine: ENGINE_VERSION,
      failure: 'copy_failed'
    })
    service.createServiceClient.mockReturnValue(db())
    const ok = await POST(post(body))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, state: 'failed' })
    service.createServiceClient.mockReturnValue(db({ code: 'PT409' }))
    expect((await POST(post(body))).status).toBe(409)
    service.createServiceClient.mockReturnValue(db({ code: '23514' }))
    expect((await POST(post(body))).status).toBe(422)
  })
})
