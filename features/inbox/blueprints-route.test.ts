// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ENGINE_VERSION } from '@/features/design-engine/stored'
import { blueprint } from '@/features/design-engine/fixtures'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)

import { GET, POST } from '@/app/api/internal/inbox/blueprints/route'

const secret = 'synthetic-blueprint-cron-secret-32-characters'
const url = 'http://127.0.0.1:3100/api/internal/inbox/blueprints'
const job = '00000000-0000-4000-8000-0000000000a1'
const lease = '00000000-0000-4000-8000-0000000000b1'

const post = (body: string, authorization = `Bearer ${secret}`) =>
  new NextRequest(url, {
    method: 'POST',
    body,
    headers: { authorization, 'content-type': 'application/json' }
  })

/** A database whose record call answers `error` (or succeeds). */
function db(error: { code: string } | null = null) {
  const rpc = vi.fn(async (fn: string) =>
    fn === 'record_inbox_blueprint'
      ? { data: error ? null : 'ready', error }
      : { data: null, error: null }
  )
  return { rpc }
}

describe('/api/internal/inbox/blueprints', () => {
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

  it('refuses a body that is too large before reading it', async () => {
    service.createServiceClient.mockReturnValue(db())
    const big = 'x'.repeat(600_001)
    expect((await POST(post(big))).status).toBe(413)
  })

  it('refuses JSON that does not parse or is not a result', async () => {
    const client = db()
    service.createServiceClient.mockReturnValue(client)
    expect((await POST(post('{not json'))).status).toBe(400)
    expect(
      (await POST(post(JSON.stringify({ job, lease, failure: 'nope' })))).status
    ).toBe(400)
    expect((await POST(post(JSON.stringify({ job: 'x', lease })))).status).toBe(
      400
    )
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('answers 409 for a stale lease, and 200 for a recorded blueprint', async () => {
    const body = JSON.stringify({
      job,
      lease,
      engine: ENGINE_VERSION,
      blueprint: blueprint()
    })
    service.createServiceClient.mockReturnValue(db({ code: 'PT409' }))
    const stale = await POST(post(body))
    expect(stale.status).toBe(409)
    service.createServiceClient.mockReturnValue(db())
    const ok = await POST(post(body))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, state: 'ready' })
    expect(ok.headers.get('cache-control')).toBe('no-store')
  })
})
