// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const service = vi.hoisted(() => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/supabase/service', () => service)
import { GET, POST } from '@/app/api/internal/inbox/screenshots/route'
import { finishScreenshot, screenshotJobs } from './screenshots'

const job = '11111111-1111-4111-8111-111111111111'
const lease = '22222222-2222-4222-8222-222222222222'
const message = '33333333-3333-4333-8333-333333333333'

function database(
  options: { jobs?: number; htmlPath?: string | null; rpcError?: string } = {}
) {
  let left = options.jobs ?? 1
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const signedUrl = (bucket: string, path: string) =>
    `https://db.test/sign/${bucket}/${path}?token=t`
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job')
        return left-- > 0
          ? {
              data: [{ id: job, lease_token: lease, subject_key: message }],
              error: null
            }
          : { data: [], error: null }
      if (options.rpcError && name === 'record_inbox_screenshot')
        return { data: null, error: { code: options.rpcError, message: 'x' } }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => ({
          data:
            table === 'email_sections' ? [{ ordinal: 1 }, { ordinal: 2 }] : [],
          error: null
        }),
        in: async () => ({
          data: [
            {
              source_ref: 'https://cdn.shop.test/a.png?x=1&amp;y=2',
              path: 'img/aa.png'
            }
          ],
          error: null
        }),
        single: async () => ({
          data: {
            id: message,
            html_path:
              options.htmlPath === undefined
                ? `gmail/${'b'.repeat(64)}.html`
                : options.htmlPath,
            marked_html_path:
              options.htmlPath === undefined
                ? `gmail/${'c'.repeat(64)}.marked.html`
                : null
          },
          error: null
        })
      }
      expect([
        'inbox_messages',
        'inbox_message_images',
        'email_sections'
      ]).toContain(table)
      return query
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: signedUrl(bucket, path) },
          error: null
        }),
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({
            path,
            signedUrl: signedUrl(bucket, path),
            error: null
          })),
          error: null
        }),
        createSignedUploadUrl: async (path: string) => ({
          data: {
            signedUrl: `https://db.test/upload/${bucket}/${path}?token=u`,
            path,
            token: 'u'
          },
          error: null
        })
      })
    }
  }
}
type Db = Parameters<typeof screenshotJobs>[0]

describe('screenshotJobs', () => {
  it('hands out one email at a time, with signed links only', async () => {
    const db = database({ jobs: 2 })
    const jobs = await screenshotJobs(db as unknown as Db)
    // One per call, so no lease waits while another email renders.
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toEqual({
      job,
      lease,
      // INB-003: the browser renders the marked copy.
      html: `https://db.test/sign/inbox-raw/gmail/${'c'.repeat(64)}.marked.html?token=t`,
      images: [
        {
          ref: 'https://cdn.shop.test/a.png?x=1&amp;y=2',
          url: 'https://db.test/sign/inbox-assets/img/aa.png?token=t'
        }
      ],
      upload: `https://db.test/upload/inbox-assets/shot/${message}.jpg?token=u`,
      sections: [
        {
          ordinal: 1,
          upload: `https://db.test/upload/inbox-assets/sect/${message}/1.jpg?token=u`
        },
        {
          ordinal: 2,
          upload: `https://db.test/upload/inbox-assets/sect/${message}/2.jpg?token=u`
        }
      ]
    })
  })

  it('fails a job whose email has no HTML and goes on', async () => {
    const db = database({ jobs: 1, htmlPath: null })
    expect(await screenshotJobs(db as unknown as Db)).toEqual([])
    expect(
      db.calls.find((c) => c.name === 'fail_platform_job')!.args
    ).toMatchObject({
      job,
      failure: 'protocol',
      error_code: 'inbox_message_missing'
    })
  })
})

describe('finishScreenshot', () => {
  it('records the picture and finishes the job', async () => {
    const db = database()
    expect(
      await finishScreenshot(db as unknown as Db, {
        job,
        lease,
        width: 600,
        height: 2400
      })
    ).toEqual({ ok: true })
    expect(db.calls.map((c) => c.name)).toEqual([
      'record_inbox_screenshot',
      'finish_platform_job'
    ])
  })

  it('passes on a browser failure as a retry, and a lost lease as PT409', async () => {
    const db = database()
    await finishScreenshot(db as unknown as Db, {
      job,
      lease,
      failure: 'render_failed'
    })
    expect(db.calls[0]).toMatchObject({
      name: 'fail_platform_job',
      args: { error_code: 'render_failed' }
    })
    expect(
      await finishScreenshot(database({ rpcError: 'PT409' }) as unknown as Db, {
        job,
        lease,
        width: 600,
        height: 10
      })
    ).toEqual({ ok: false, code: 'PT409' })
  })
})

describe('/api/internal/inbox/screenshots', () => {
  const secret = 'original-synthetic-cron-secret-32-characters'
  const at = 'http://127.0.0.1:3100/api/internal/inbox/screenshots'
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('refuses a missing or wrong secret before anything else', async () => {
    service.createServiceClient.mockReturnValue(database())
    for (const authorization of [undefined, 'Bearer wrong'])
      for (const call of [
        () =>
          GET(
            new NextRequest(at, {
              headers: authorization ? { authorization } : {}
            })
          ),
        () =>
          POST(
            new NextRequest(at, {
              method: 'POST',
              headers: authorization ? { authorization } : {},
              body: '{}'
            })
          )
      ])
        expect((await call()).status).toBe(401)
    expect(service.createServiceClient).not.toHaveBeenCalled()
  })

  it('hands out jobs and records a valid result only', async () => {
    const db = database()
    service.createServiceClient.mockReturnValue(db)
    const headers = { authorization: `Bearer ${secret}` }
    const got = await GET(new NextRequest(at, { headers }))
    expect(got.status).toBe(200)
    expect(got.headers.get('cache-control')).toBe('no-store')
    expect((await got.json()).jobs).toHaveLength(1)
    for (const body of [
      'not json',
      JSON.stringify({ job, lease, width: 600, height: 99_999 }),
      JSON.stringify({ job: 'x', lease, width: 1, height: 1 }),
      'x'.repeat(3000)
    ])
      expect(
        (await POST(new NextRequest(at, { method: 'POST', headers, body })))
          .status
      ).toBe(400)
    const ok = await POST(
      new NextRequest(at, {
        method: 'POST',
        headers,
        body: JSON.stringify({ job, lease, width: 600, height: 1200 })
      })
    )
    expect(ok.status).toBe(200)
  })

  it('says 409 when the lease is gone', async () => {
    service.createServiceClient.mockReturnValue(database({ rpcError: 'PT409' }))
    const response = await POST(
      new NextRequest(at, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        body: JSON.stringify({ job, lease, width: 600, height: 1200 })
      })
    )
    expect(response.status).toBe(409)
  })
})
