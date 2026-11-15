// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
import { GET, POST } from '@/app/api/internal/studio/renders/route'
import { renderJobs, requestSectionRender } from './render-jobs'
import { sectionDocument, type DesignedSection } from './section'

const job = '11111111-1111-4111-8111-111111111111'
const lease = '22222222-2222-4222-8222-222222222222'
const render = '33333333-3333-4333-8333-333333333333'
const photo = 'https://cdn.shop.example/images/tray.jpg'
const section: DesignedSection = {
  id: 's2',
  height: 320,
  html: `<img src="${photo}" alt=""><h1>Meet the cedar tray</h1>`,
  css: 'h1{color:#fff}'
}

function database(
  options: {
    jobs?: number
    row?: Record<string, unknown> | null
    uploadError?: boolean
    rpcError?: string
  } = {}
) {
  let left = options.jobs ?? 1
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const row =
    options.row === undefined
      ? {
          id: render,
          section,
          origins: ['https://cdn.shop.example'],
          state: 'queued'
        }
      : options.row
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job')
        return left-- > 0
          ? {
              data: [{ id: job, lease_token: lease, subject_key: render }],
              error: null
            }
          : { data: [], error: null }
      if (name === 'request_section_render')
        return { data: render, error: null }
      if (
        options.rpcError &&
        (name === 'record_section_render' || name === 'fail_section_render')
      )
        return { data: null, error: { code: options.rpcError, message: 'x' } }
      return { data: null, error: null }
    }),
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        lte: async () => ({ count: 3, error: null }),
        single: async () =>
          row
            ? { data: row, error: null }
            : { data: null, error: { code: 'PGRST116' } }
      }
      return query
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string) =>
          options.uploadError
            ? { data: null, error: { message: 'x' } }
            : {
                data: {
                  signedUrl: `https://db.test/upload/${bucket}/${path}?token=t`
                },
                error: null
              }
      })
    }
  }
}
type Fake = ReturnType<typeof database>
const db = (d: Fake) => d as unknown as Parameters<typeof renderJobs>[0]

describe('asking for a section to be drawn (DST-001b)', () => {
  it('queues a checked section under the build’s lease, with its https origins', async () => {
    const d = database()
    expect(
      await requestSectionRender(db(d), {
        build: job,
        lease,
        key: 's2-r1-ab12cd34',
        section,
        hosts: ['cdn.shop.example', 'cdn.shop.example']
      })
    ).toBe(render)
    expect(d.calls).toEqual([
      {
        name: 'request_section_render',
        args: {
          build: job,
          lease,
          section_key: 's2-r1-ab12cd34',
          section,
          origins: ['https://cdn.shop.example']
        }
      }
    ])
  })

  it('never queues a section the format refuses', async () => {
    const d = database()
    await expect(
      requestSectionRender(db(d), {
        build: job,
        lease,
        key: 's2-r1',
        section: { ...section, html: '<script>alert(1)</script>' },
        hosts: ['cdn.shop.example']
      })
    ).rejects.toThrow('never drawn')
    expect(d.calls).toEqual([])
  })
})

describe('handing out sections to draw (DST-001b)', () => {
  it('hands out one section at a time: its page, its height, its origins, its upload link', async () => {
    const d = database({ jobs: 2 })
    expect(await renderJobs(db(d))).toEqual([
      {
        job,
        lease,
        render,
        document: sectionDocument(section),
        height: 320,
        origins: ['https://cdn.shop.example'],
        upload: `https://db.test/upload/studio-renders/render/${render}.jpg?token=t`
      }
    ])
    expect(d.calls.filter((c) => c.name === 'claim_platform_job')).toEqual([
      { name: 'claim_platform_job', args: { kinds: ['studio.render'] } }
    ])
  })

  it('checks the section again, and fails one that no longer passes, never handing it out', async () => {
    const d = database({
      row: {
        id: render,
        section: {
          ...section,
          html: `<img src="https://evil.example/x.png" alt="">`
        },
        origins: ['https://cdn.shop.example'],
        state: 'queued'
      }
    })
    expect(await renderJobs(db(d))).toEqual([])
    expect(d.calls.at(-1)).toEqual({
      name: 'fail_section_render',
      args: { job, lease, failure: 'refused' }
    })
  })

  it('fails a job whose render is gone, or that cannot get its upload link', async () => {
    const gone = database({ row: null })
    expect(await renderJobs(db(gone))).toEqual([])
    expect(gone.calls.at(-1)).toEqual({
      name: 'fail_platform_job',
      args: { job, lease, failure: 'protocol', error_code: 'render_missing' }
    })
    const noLink = database({ uploadError: true })
    expect(await renderJobs(db(noLink))).toEqual([])
    expect(noLink.calls.at(-1)).toEqual({
      name: 'fail_section_render',
      args: { job, lease, failure: 'upload_failed' }
    })
  })
})

describe('the render route (DST-001b)', () => {
  const secret = 's'.repeat(40)
  const auth = { authorization: `Bearer ${secret}` }
  const req = (
    method: string,
    init: { url?: string; body?: string; headers?: Record<string, string> } = {}
  ) =>
    new NextRequest(
      init.url ?? 'https://app.test/api/internal/studio/renders',
      {
        method,
        body: init.body,
        headers: init.headers ?? auth
      }
    )
  beforeEach(() => vi.stubEnv('CRON_SECRET', secret))
  afterEach(() => {
    vi.unstubAllEnvs()
    service.createServiceClient.mockReset()
  })

  it('answers only the cron secret, and says when the server has no database', async () => {
    expect((await GET(req('GET', { headers: {} }))).status).toBe(401)
    expect(
      (
        await POST(
          req('POST', { headers: { authorization: 'Bearer x' }, body: '{}' })
        )
      ).status
    ).toBe(401)
    service.createServiceClient.mockReturnValue(null)
    expect((await GET(req('GET'))).status).toBe(503)
  })

  it('peeks without claiming, and hands out jobs', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const peek = await GET(
      req('GET', { url: 'https://app.test/api/internal/studio/renders?peek=1' })
    )
    expect(await peek.json()).toEqual({ waiting: 3 })
    expect(d.calls).toEqual([])
    const got = await GET(req('GET'))
    expect(got.headers.get('cache-control')).toBe('no-store')
    expect((await got.json()).jobs).toHaveLength(1)
  })

  it('records a drawn section or its failure, and refuses anything else', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const drawn = await POST(
      req('POST', {
        body: JSON.stringify({ job, lease, height: 640, bytes: 1000 })
      })
    )
    expect(await drawn.json()).toEqual({ ok: true })
    expect(d.calls.at(-1)).toEqual({
      name: 'record_section_render',
      args: { job, lease, height: 640, bytes: 1000 }
    })
    await POST(
      req('POST', { body: JSON.stringify({ job, lease, failure: 'timeout' }) })
    )
    expect(d.calls.at(-1)).toEqual({
      name: 'fail_section_render',
      args: { job, lease, failure: 'timeout' }
    })
    for (const body of [
      'not json',
      JSON.stringify({ job, lease, failure: 'gone' }),
      JSON.stringify({ job, lease, height: 640, bytes: 4_000_000 }),
      JSON.stringify({ job, lease, height: 640, bytes: 1000, extra: 1 }),
      'x'.repeat(2_001)
    ])
      expect((await POST(req('POST', { body }))).status).toBe(400)
  })

  it('says 409 when the lease or the render moved on', async () => {
    service.createServiceClient.mockReturnValue(database({ rpcError: 'PT409' }))
    const moved = await POST(
      req('POST', {
        body: JSON.stringify({ job, lease, height: 640, bytes: 1000 })
      })
    )
    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({
      error: 'Render not recorded',
      code: 'PT409'
    })
  })
})
