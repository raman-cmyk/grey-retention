// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
import { GET, POST } from '@/app/api/internal/studio/previews/route'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import {
  emailOrigins,
  EmailNotDrawable,
  previewJobs,
  previewsWaiting,
  requestEmailRender
} from './preview-jobs'

/** DST-005b part 2b: the email's views as jobs, and their route. */
const job = '11111111-1111-4111-8111-111111111111'
const lease = '22222222-2222-4222-8222-222222222222'
const render = '33333333-3333-4333-8333-333333333333'
const build = '44444444-4444-4444-8444-444444444444'
const html = `<!doctype html><html><head><style>.hero{background:url("https://img.shop.example/bg.jpg")}</style></head><body><img src="https://cdn.shop.example/tray.jpg" alt="The tray"><p>${klaviyoFooterTags.unsubscribe}</p></body></html>`
const page = html.replace(
  klaviyoFooterTags.unsubscribe,
  '<a href="#" style="color:#555555">Unsubscribe</a>'
)
const queued = {
  id: render,
  build_id: build,
  view: 'phone',
  document: page,
  origins: ['https://img.shop.example', 'https://cdn.shop.example'],
  state: 'queued'
}

type Row = Record<string, unknown> | null | 'error' | 'throw'
function database(
  options: {
    rows?: Row[]
    buildState?: string
    uploadError?: boolean
    rpcError?: Record<string, string>
  } = {}
) {
  const rows = [...(options.rows ?? [queued])]
  let current: Row = null
  const calls: { name: string; args: Record<string, unknown> }[] = []
  /** Each read's table and filters, as asked. */
  const reads: { table: string; filters: unknown[][] }[] = []
  return {
    calls,
    reads,
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
      if (name === 'request_email_render') return { data: render, error: null }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const read = { table, filters: [] as unknown[][] }
      reads.push(read)
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => (read.filters.push(['eq', ...args]), query),
        or: async (...args: unknown[]) => {
          read.filters.push(['or', ...args])
          return { count: 2, error: null }
        },
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
              }
      })
    }
  }
}
type Fake = ReturnType<typeof database>
const db = (d: Fake) => d as unknown as Parameters<typeof previewJobs>[0]
const handed = {
  job,
  lease,
  render,
  document: page,
  view: 'phone',
  origins: ['https://img.shop.example', 'https://cdn.shop.example'],
  upload: `https://db.test/upload/studio-renders/email/${render}.jpg?token=t`
}
const last = (d: Fake, name: string) =>
  d.calls.filter((c) => c.name === name).at(-1)?.args

describe('the hosts an email’s pictures come from (DST-005b)', () => {
  it('reads src, srcset, background and CSS links, https hosts once each', () => {
    expect(
      emailOrigins(
        `<style>td{background-image:url(https://a.example/x.png)}</style>
         <img src="https://CDN.shop.example/a.jpg" srcset="https://b.example/a.jpg 2x, https://cdn.shop.example/c.jpg 3x">
         <table background="https://c.example/t.gif"><tr><td style="background:url('https://d.example/y.png')">x</td></tr></table>
         <a href="https://links-only.example/">A link loads nothing</a>`
      )
    ).toEqual([
      'https://a.example',
      'https://cdn.shop.example',
      'https://b.example',
      'https://c.example',
      'https://d.example'
    ])
  })

  it('reads pictures inside <noscript>, as the browser with JavaScript off draws them', () => {
    expect(
      emailOrigins('<noscript><img src="https://ns.example/a.jpg"></noscript>')
    ).toEqual(['https://ns.example'])
  })

  it('leaves out what may not load: http, IP addresses, ports, users, inline pictures', () => {
    expect(
      emailOrigins(
        `<img src="http://plain.example/a.jpg"><img src="https://10.0.0.5/a.jpg"><img src="https://cdn.example:8443/a.jpg">
         <img src="https://u:p@cdn.example/a.jpg"><img src="data:image/png;base64,iVBORw0KGgo="><img src="not a link">`
      )
    ).toEqual([])
  })

  it('refuses an email with pictures from more than 8 places', () => {
    const many = Array.from(
      { length: 9 },
      (_, i) => `<img src="https://h${i}.example/a.jpg">`
    ).join('')
    expect(() => emailOrigins(many)).toThrow(EmailNotDrawable)
    expect(emailOrigins(many.slice(0, many.lastIndexOf('<img')))).toHaveLength(
      8
    )
  })
})

describe('asking for a view of the email (DST-005b)', () => {
  const ask = (d: Fake, change: { html?: string; view?: 'dark' } = {}) =>
    requestEmailRender(db(d), {
      build,
      lease,
      key: 'e-r1-ab12cd34',
      view: change.view ?? 'phone',
      html: change.html ?? html,
      brandName: 'Cedar Lane'
    })

  it('queues the email as the preview shows it, with its pictures’ origins', async () => {
    const d = database()
    expect(await ask(d)).toBe(render)
    expect(d.calls).toEqual([
      {
        name: 'request_email_render',
        args: {
          build,
          lease,
          render_key: 'e-r1-ab12cd34',
          email_view: 'phone',
          document: page,
          origins: ['https://img.shop.example', 'https://cdn.shop.example']
        }
      }
    ])
    expect(JSON.stringify(d.calls)).not.toContain('{%')
  })

  it('never queues an email too large to draw, with too many picture hosts, or that the browser would refuse', async () => {
    for (const big of [
      `${html}<link rel="preconnect" href="https://evil.example">`,
      `${html}<meta http-equiv="refresh" content="0">`,
      `${html}<iframe srcdoc="x"></iframe>`,
      `${html}<p>${'x'.repeat(200_001)}</p>`,
      Array.from(
        { length: 9 },
        (_, i) => `<img src="https://h${i}.example/a.jpg">`
      ).join('')
    ]) {
      const d = database()
      await expect(ask(d, { html: big })).rejects.toBeInstanceOf(
        EmailNotDrawable
      )
      expect(d.calls).toEqual([])
    }
  })

  it('passes on the command’s refusals (another email under the key, the wrong step)', async () => {
    const d = database({ rpcError: { request_email_render: 'PT409' } })
    await expect(ask(d)).rejects.toMatchObject({ code: 'PT409' })
  })
})

describe('handing out views to draw (DST-005b)', () => {
  it('hands out one view: its page, its view, its origins, its upload link', async () => {
    const d = database({ rows: [queued, queued] })
    expect(await previewJobs(db(d))).toEqual([handed])
    expect(d.calls.filter((c) => c.name === 'claim_platform_job')).toEqual([
      { name: 'claim_platform_job', args: { kinds: ['studio.preview'] } }
    ])
    // The job's own view, then that view's own build.
    expect(d.reads).toEqual([
      { table: 'email_renders', filters: [['eq', 'id', render]] },
      { table: 'email_builds', filters: [['eq', 'id', build]] }
    ])
  })

  it('closes the job of a view gone with its build, at once, never retried', async () => {
    const d = database({ rows: [null] })
    expect(await previewJobs(db(d))).toEqual([])
    expect(last(d, 'finish_platform_job')).toEqual({
      job,
      lease,
      outcome: { settled: 'gone' }
    })
    expect(last(d, 'fail_platform_job')).toBeUndefined()
    // Gone between the two reads: refusing it finds no view, so the job is closed.
    const race = database({
      buildState: 'failed',
      rpcError: { fail_email_render: 'PT409' }
    })
    expect(await previewJobs(db(race))).toEqual([])
    expect(last(race, 'finish_platform_job')).toEqual({
      job,
      lease,
      outcome: { settled: 'gone' }
    })
  })

  it('refuses a view whose stored origins are not exactly the ones its page loads, or whose page would reach out', async () => {
    for (const row of [
      { ...queued, origins: ['https://10.0.0.5'] },
      { ...queued, origins: [...queued.origins, 'https://extra.example'] },
      { ...queued, origins: ['https://cdn.shop.example'] },
      {
        ...queued,
        document: `${page}<link rel="prefetch" href="https://evil.example/">`
      }
    ]) {
      const d = database({ rows: [row] })
      expect(await previewJobs(db(d))).toEqual([])
      expect(last(d, 'fail_email_render')).toEqual({
        job,
        lease,
        failure: 'refused'
      })
    }
  })

  it('claims on past a view it cannot hand out, so one bad view never stops the run', async () => {
    const d = database({
      rows: [
        null,
        'error',
        { ...queued, state: 'drawn' },
        { ...queued, view: 'tablet' },
        { ...queued, origins: ['http://cdn.shop.example'] },
        queued
      ]
    })
    expect(await previewJobs(db(d))).toEqual([])
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
      ['fail_email_render', 'refused'],
      ['claim_platform_job', ''],
      ['fail_email_render', 'refused']
    ])
    // A sixth claim is never made: five a call.
    const next = database({ rows: [null, queued] })
    expect(await previewJobs(db(next))).toEqual([handed])
  })

  it('stops when nothing is waiting, and counts only the email’s views waiting', async () => {
    expect(await previewJobs(db(database({ rows: [] })))).toEqual([])
    const d = database()
    expect(await previewsWaiting(db(d))).toBe(2)
    expect(d.reads[0]).toMatchObject({
      table: 'platform_jobs',
      filters: [
        ['eq', 'kind', 'studio.preview'],
        ['or', expect.any(String)]
      ]
    })
  })

  it('never draws for a build that no longer wants the view, or a page that can no longer be drawn', async () => {
    const gone = database({ buildState: 'push_queued' })
    expect(await previewJobs(db(gone))).toEqual([])
    expect(last(gone, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'refused'
    })
    const many = Array.from(
      { length: 9 },
      (_, i) => `<img src="https://h${i}.example/a.jpg">`
    ).join('')
    const wide = database({ rows: [{ ...queued, document: many }] })
    expect(await previewJobs(db(wide))).toEqual([])
    expect(last(wide, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'refused'
    })
  })

  it('fails a view whose upload link cannot be signed, or whose hand-out throws', async () => {
    const noLink = database({ uploadError: true })
    expect(await previewJobs(db(noLink))).toEqual([])
    expect(last(noLink, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'upload_failed'
    })
    const boom = database({ rows: ['throw'] })
    expect(await previewJobs(db(boom))).toEqual([])
    expect(last(boom, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'failed'
    })
  })
})

describe('the preview route (DST-005b)', () => {
  const secret = 's'.repeat(40)
  const auth = { authorization: `Bearer ${secret}` }
  const req = (
    method: string,
    init: { url?: string; body?: string; headers?: Record<string, string> } = {}
  ) =>
    new NextRequest(
      init.url ?? 'https://app.test/api/internal/studio/previews',
      { method, body: init.body, headers: init.headers ?? auth }
    )
  const post = (body: unknown) =>
    POST(
      req('POST', {
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
    )
  const drawn = {
    job,
    lease,
    height: 2100,
    cut: false,
    wide: false,
    bytes: 90_000
  }
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
    expect((await post(drawn)).status).toBe(503)
  })

  it('peeks without claiming, hands out views, and says when it cannot', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    const peek = await GET(
      req('GET', {
        url: 'https://app.test/api/internal/studio/previews?peek=1'
      })
    )
    expect(await peek.json()).toEqual({ waiting: 2 })
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
      error: 'Preview jobs unavailable; they stay queued.'
    })
  })

  it('records a drawn view, cut or not, or its failure', async () => {
    const d = database()
    service.createServiceClient.mockReturnValue(d)
    expect(await (await post(drawn)).json()).toEqual({ ok: true })
    expect(last(d, 'record_email_render')).toEqual(drawn)
    await post({ ...drawn, height: 6000, cut: true, wide: true })
    expect(last(d, 'record_email_render')).toMatchObject({
      cut: true,
      wide: true
    })
    await post({ job, lease, failure: 'timeout' })
    expect(last(d, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'timeout'
    })
  })

  it('refuses anything else: not JSON, unknown fields, a refusal claimed by the browser, out of range, too large', async () => {
    service.createServiceClient.mockReturnValue(database())
    for (const body of [
      'not json',
      { job, lease, failure: 'gone' },
      { job, lease, failure: 'refused' },
      { ...drawn, bytes: 4_000_000 },
      { ...drawn, height: 6001 },
      { ...drawn, cut: 'no' },
      { job, lease, height: 2100, bytes: 90_000 },
      { job, lease, height: 2100, cut: false, bytes: 90_000 },
      { ...drawn, extra: 1 },
      JSON.stringify({ job, lease, failure: 'timeout' }) + ' '.repeat(2_000)
    ])
      expect((await post(body)).status).toBe(400)
    expect(
      (
        await POST(
          req('POST', {
            body: JSON.stringify({ job, lease, failure: 'timeout' }),
            headers: { ...auth, 'content-length': '2001' }
          })
        )
      ).status
    ).toBe(400)
  })

  it('says 409 when the lease moved on, 422 (and fails the attempt) when the report does not match, 500 otherwise', async () => {
    service.createServiceClient.mockReturnValue(
      database({ rpcError: { record_email_render: 'PT409' } })
    )
    const moved = await post(drawn)
    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({
      error: 'Preview not recorded',
      code: 'PT409'
    })
    const wrong = database({ rpcError: { record_email_render: '23514' } })
    service.createServiceClient.mockReturnValue(wrong)
    expect((await post(drawn)).status).toBe(422)
    expect(last(wrong, 'fail_email_render')).toEqual({
      job,
      lease,
      failure: 'failed'
    })
    service.createServiceClient.mockReturnValue(
      database({ rpcError: { fail_email_render: 'XX000' } })
    )
    expect((await post({ job, lease, failure: 'timeout' })).status).toBe(500)
  })
})
