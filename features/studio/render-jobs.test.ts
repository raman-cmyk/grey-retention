// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
import { GET, POST } from '@/app/api/internal/studio/renders/route'
import {
  maxRenderResultBytes,
  referenceLinkSeconds,
  renderJobs,
  requestSectionRender,
  SectionNotDrawable
} from './render-jobs'
import { sectionDocument, type DesignedSection } from './section'

const job = '11111111-1111-4111-8111-111111111111'
const lease = '22222222-2222-4222-8222-222222222222'
const render = '33333333-3333-4333-8333-333333333333'
const build = '44444444-4444-4444-8444-444444444444'
const photo = 'https://cdn.shop.example/images/tray.jpg'
const section: DesignedSection = {
  id: 's2',
  height: 320,
  html: `<img src="${photo}" alt=""><h1>Meet the cedar tray</h1>`,
  css: 'h1{color:#fff}'
}
const queued = {
  id: render,
  build_id: build,
  section,
  origins: ['https://cdn.shop.example'],
  state: 'queued'
}

type Row = Record<string, unknown> | null | 'error' | 'throw'
function database(
  options: {
    /** One render row per claim, in order; the claims end with the list. */
    rows?: Row[]
    buildState?: string
    uploadError?: boolean
    /** DST-004b2b: the reference crop's link cannot be made. */
    signError?: boolean
    rpcError?: Record<string, string>
  } = {}
) {
  const signed: { bucket: string; path: string; seconds: number }[] = []
  const rows = [...(options.rows ?? [queued])]
  let current: Row = null
  const calls: { name: string; args: Record<string, unknown> }[] = []
  return {
    calls,
    signed,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (options.rpcError?.[name])
        return {
          data: null,
          error: { code: options.rpcError[name], message: 'x' }
        }
      if (name === 'claim_platform_job') {
        if (!rows.length) return { data: [], error: null }
        current = rows.shift()!
        return {
          data: [{ id: job, lease_token: lease, subject_key: render }],
          error: null
        }
      }
      if (name === 'request_section_render')
        return { data: render, error: null }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: async () => ({ count: 3, error: null }),
        maybeSingle: async () => {
          if (table === 'email_builds')
            return {
              data: { state: options.buildState ?? 'build_queued' },
              error: null
            }
          if (current === 'throw') throw new Error('boom')
          if (current === 'error')
            return { data: null, error: { code: 'XX000' } }
          return { data: current, error: null }
        }
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
              },
        createSignedUrl: async (path: string, seconds: number) => {
          signed.push({ bucket, path, seconds })
          return options.signError
            ? { data: null, error: { message: 'x' } }
            : {
                data: {
                  signedUrl: `https://db.test/sign/${bucket}/${path}?token=r`
                },
                error: null
              }
        }
      })
    }
  }
}
type Fake = ReturnType<typeof database>
const db = (d: Fake) => d as unknown as Parameters<typeof renderJobs>[0]
const handed = {
  job,
  lease,
  render,
  document: sectionDocument(section),
  height: 320,
  origins: ['https://cdn.shop.example'],
  upload: `https://db.test/upload/studio-renders/render/${render}.jpg?token=t`
}
const last = (d: Fake, name: string) =>
  d.calls.filter((c) => c.name === name).at(-1)?.args

describe('asking for a section to be drawn (DST-001b)', () => {
  const ask = (
    d: Fake,
    change: Partial<DesignedSection> = {},
    hosts = ['cdn.shop.example']
  ) =>
    requestSectionRender(db(d), {
      build,
      lease,
      key: 's2-r1-ab12cd34',
      section: { ...section, ...change },
      hosts
    })

  it('queues a checked section under the build’s lease, with its https origins once each', async () => {
    const d = database()
    expect(
      await requestSectionRender(db(d), {
        build,
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
          build,
          lease,
          section_key: 's2-r1-ab12cd34',
          section,
          origins: ['https://cdn.shop.example']
        }
      }
    ])
  })

  it('never queues a section the format refuses, with no host or too many, or too large to store', async () => {
    for (const [change, hosts] of [
      [{ html: '<script>alert(1)</script>' }, ['cdn.shop.example']],
      [{ html: '<h1>Meet the cedar tray</h1>' }, []],
      [{}, Array.from({ length: 9 }, (_, i) => `h${i}.shop.example`)],
      [
        { html: `${section.html}<p>${'“'.repeat(40_000)}</p>` },
        ['cdn.shop.example']
      ]
    ] as const) {
      const d = database()
      await expect(ask(d, change, [...hosts])).rejects.toBeInstanceOf(
        SectionNotDrawable
      )
      expect(d.calls).toEqual([])
    }
  })

  it('passes on the command’s refusals (another section under the key, the wrong step)', async () => {
    const d = database({ rpcError: { request_section_render: 'PT409' } })
    await expect(ask(d)).rejects.toMatchObject({ code: 'PT409' })
  })
})

describe('handing out sections to draw (DST-001b)', () => {
  it('hands out one section: its page, its height, its origins, its upload link', async () => {
    const d = database({ rows: [queued, queued] })
    expect(await renderJobs(db(d))).toEqual([handed])
    expect(d.calls.filter((c) => c.name === 'claim_platform_job')).toEqual([
      { name: 'claim_platform_job', args: { kinds: ['studio.render'] } }
    ])
  })

  it('claims on past a render it cannot hand out, so one bad render never stops the run', async () => {
    const d = database({
      rows: [
        null,
        'error',
        { ...queued, state: 'drawn' },
        {
          ...queued,
          section: {
            ...section,
            html: `<img src="https://evil.example/x.png" alt="">`
          }
        },
        queued
      ]
    })
    expect(await renderJobs(db(d))).toEqual([handed])
    expect(
      d.calls.map((c) => [
        c.name,
        c.args.failure ?? c.args.error_code ?? c.args.outcome ?? ''
      ])
    ).toEqual([
      ['claim_platform_job', ''],
      ['finish_platform_job', { settled: 'gone' }],
      ['claim_platform_job', ''],
      ['fail_platform_job', 'unavailable'],
      ['claim_platform_job', ''],
      ['finish_platform_job', { settled: 'drawn' }],
      ['claim_platform_job', ''],
      ['fail_section_render', 'refused'],
      ['claim_platform_job', '']
    ])
  })

  it('closes the job of a render gone with its build, also between the two reads', async () => {
    const race = database({
      buildState: 'failed',
      rpcError: { fail_section_render: 'PT409' }
    })
    expect(await renderJobs(db(race))).toEqual([])
    expect(last(race, 'finish_platform_job')).toEqual({
      job,
      lease,
      outcome: { settled: 'gone' }
    })
  })

  it('stops after five claims, or when nothing is waiting', async () => {
    const d = database({ rows: Array(6).fill(null) })
    expect(await renderJobs(db(d))).toEqual([])
    expect(d.calls.filter((c) => c.name === 'claim_platform_job')).toHaveLength(
      5
    )
    expect(await renderJobs(db(database({ rows: [] })))).toEqual([])
  })

  it('never draws for a build that no longer wants the picture', async () => {
    const d = database({ buildState: 'failed' })
    expect(await renderJobs(db(d))).toEqual([])
    expect(last(d, 'fail_section_render')).toEqual({
      job,
      lease,
      failure: 'refused'
    })
  })

  it('fails a render whose upload link cannot be signed, or whose hand-out throws', async () => {
    const noLink = database({ uploadError: true })
    expect(await renderJobs(db(noLink))).toEqual([])
    expect(last(noLink, 'fail_section_render')).toEqual({
      job,
      lease,
      failure: 'upload_failed'
    })
    const boom = database({ rows: ['throw'] })
    expect(await renderJobs(db(boom))).toEqual([])
    expect(last(boom, 'fail_section_render')).toEqual({
      job,
      lease,
      failure: 'failed'
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
  const post = (body: unknown) =>
    POST(
      req('POST', {
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
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

  it('peeks without claiming, hands out jobs, and says when it cannot', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const peek = await GET(
      req('GET', { url: 'https://app.test/api/internal/studio/renders?peek=1' })
    )
    expect(await peek.json()).toEqual({ waiting: 3 })
    expect(d.calls).toEqual([])
    const got = await GET(req('GET'))
    expect(got.headers.get('cache-control')).toBe('no-store')
    expect((await got.json()).jobs).toEqual([handed])
    service.createServiceClient.mockReturnValue(
      database({ rpcError: { claim_platform_job: 'XX000' } })
    )
    const down = await GET(req('GET'))
    expect(down.status).toBe(500)
    expect(await down.json()).toEqual({
      error: 'Render jobs unavailable; they stay queued.'
    })
  })

  it('records a drawn section or its failure', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    expect(
      await (await post({ job, lease, height: 640, bytes: 1000 })).json()
    ).toEqual({ ok: true })
    expect(last(d, 'record_section_render')).toEqual({
      job,
      lease,
      height: 640,
      bytes: 1000
    })
    await post({ job, lease, failure: 'timeout' })
    expect(last(d, 'fail_section_render')).toEqual({
      job,
      lease,
      failure: 'timeout'
    })
  })

  it('refuses anything else: not JSON, unknown fields, a refusal claimed by the browser, too large', async () => {
    service.createServiceClient.mockReturnValue(database())
    for (const body of [
      'not json',
      { job, lease, failure: 'gone' },
      { job, lease, failure: 'refused' },
      { job, lease, height: 640, bytes: 4_000_000 },
      { job, lease, height: 640, bytes: 1000, extra: 1 },
      JSON.stringify({ job, lease, failure: 'timeout' }) +
        ' '.repeat(maxRenderResultBytes)
    ])
      expect((await post(body)).status).toBe(400)
    expect(
      (
        await POST(
          req('POST', {
            body: JSON.stringify({ job, lease, failure: 'timeout' }),
            headers: {
              ...auth,
              'content-length': String(maxRenderResultBytes + 1)
            }
          })
        )
      ).status
    ).toBe(400)
  })

  it('says 409 when the lease moved on, 422 (and fails the attempt) when the report does not match, 500 otherwise', async () => {
    service.createServiceClient.mockReturnValue(
      database({ rpcError: { record_section_render: 'PT409' } })
    )
    const moved = await post({ job, lease, height: 640, bytes: 1000 })
    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({
      error: 'Render not recorded',
      code: 'PT409'
    })
    const wrong = database({ rpcError: { record_section_render: '23514' } })
    service.createServiceClient.mockReturnValue(wrong)
    expect((await post({ job, lease, height: 640, bytes: 1000 })).status).toBe(
      422
    )
    expect(last(wrong, 'fail_section_render')).toEqual({
      job,
      lease,
      failure: 'failed'
    })
    service.createServiceClient.mockReturnValue(
      database({ rpcError: { fail_section_render: 'XX000' } })
    )
    expect((await post({ job, lease, failure: 'timeout' })).status).toBe(500)
  })
})

describe('the match score’s pictures in the render job (DST-004b2b)', () => {
  const secret = 's'.repeat(40)
  const post = (body: unknown) =>
    POST(
      new NextRequest('https://app.test/api/internal/studio/renders', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { authorization: `Bearer ${secret}` }
      })
    )
  beforeEach(() => vi.stubEnv('CRON_SECRET', secret))
  afterEach(() => {
    vi.unstubAllEnvs()
    service.createServiceClient.mockReset()
  })
  const crop = 'sect/00000000-0000-4000-8000-0000000000a1/1.jpg'
  const grid = (w: number, h: number, v = 200) => ({
    width: w,
    height: h,
    values: Array.from({ length: w * h }, () => v)
  })
  const askWith = (d: Fake, reference?: string) =>
    requestSectionRender(db(d), {
      build,
      lease,
      key: 's2-r1-abcd1234',
      section,
      hosts: ['cdn.shop.example'],
      ...(reference !== undefined ? { reference } : {})
    })

  it('asks with the inbox section crop it rebuilds, and never another path', async () => {
    const d = database()
    await askWith(d, crop)
    expect(last(d, 'request_section_render')).toMatchObject({ reference: crop })
    for (const bad of [
      'shot/00000000-0000-4000-8000-0000000000a1.jpg',
      '../x.jpg',
      ''
    ]) {
      const e = database()
      await askWith(e, bad)
      expect(last(e, 'request_section_render')).not.toHaveProperty('reference')
    }
    const none = database()
    await askWith(none)
    expect(last(none, 'request_section_render')).not.toHaveProperty('reference')
  })

  it('hands the browser a short link to the reference crop, or none when it cannot be made', async () => {
    const d = database({ rows: [{ ...queued, reference_path: crop }] })
    expect(await renderJobs(db(d))).toEqual([
      {
        ...handed,
        reference: `https://db.test/sign/inbox-assets/${crop}?token=r`
      }
    ])
    expect(d.signed).toEqual([
      { bucket: 'inbox-assets', path: crop, seconds: referenceLinkSeconds }
    ])
    // The link fails: the section is still drawn, its match not measured.
    const e = database({
      rows: [{ ...queued, reference_path: crop }],
      signError: true
    })
    expect(await renderJobs(db(e))).toEqual([handed])
    // A path that is not a section crop is never signed.
    const f = database({
      rows: [{ ...queued, reference_path: 'img/abc.png' }]
    })
    expect(await renderJobs(db(f))).toEqual([handed])
    expect(f.signed).toEqual([])
    // No reference: no link.
    const g = database()
    expect(await renderJobs(db(g))).toEqual([handed])
    expect(g.signed).toEqual([])
  })

  it('records the drawing’s grid and its reference’s, and refuses one that is not a grid', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const drawn = { job, lease, height: 640, bytes: 1000 }
    expect(
      (
        await post({
          ...drawn,
          grid: grid(48, 51),
          referenceGrid: grid(48, 51, 240)
        })
      ).status
    ).toBe(200)
    expect(last(d, 'record_section_render')).toEqual({
      ...drawn,
      grid: grid(48, 51),
      reference_grid: grid(48, 51, 240)
    })
    // Grids are optional, as before.
    expect((await post(drawn)).status).toBe(200)
    expect(last(d, 'record_section_render')).toEqual(drawn)
    for (const bad of [
      { width: 2, height: 2, values: [1, 2, 3] },
      { width: 1, height: 1, values: [300] },
      { width: 1, height: 1, values: [1.5] },
      { width: 0, height: 1, values: [] },
      { width: 1, height: 1, values: [1], note: 'x' }
    ])
      expect((await post({ ...drawn, grid: bad })).status).toBe(400)
  })
})
