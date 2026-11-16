// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import {
  emailOrigins,
  EmailNotDrawable,
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
const db = (d: Fake) => d as unknown as Parameters<typeof requestEmailRender>[0]
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
