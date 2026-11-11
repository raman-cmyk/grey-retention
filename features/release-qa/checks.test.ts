// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import type { Draft } from '@/features/assembly/assemble'
import { unknownFacts } from '@/features/assembly/inputs'
import { createLinkChecker } from '@/lib/providers/link-check'
import {
  emailLinks,
  gmailClipBytes,
  runReleaseQa,
  type LinkChecker,
  type ReleaseCandidate
} from './checks'

const shop = 'https://example-store.com'
const img = 'https://cdn.klaviyomail.com/company/ABC/images/balm.png'
const draft = {
  subject: 'Meet the new balm',
  preheader: 'Our newest balm is here.',
  plan: [{ type: 'text', reason: 'Introduce it' }],
  blocks: [
    {
      type: 'text',
      content: {
        heading: 'Meet the balm',
        paras: ['Smooth it on after cleansing.']
      }
    }
  ],
  source: 'model',
  productIds: ['p1'],
  code: 'WELCOME15'
} as unknown as Draft
const html = `<html><body><img src="${img}" alt="Balm"><a href="${shop}/products/balm">Shop the balm</a>
<a href="${shop}/collections/all">Shop all</a><a href="mailto:hi@example-store.com">Email us</a>
{{ organization.name }} {{ organization.full_address }} {% unsubscribe "Unsubscribe" %} {% web_view "View" %}</body></html>`
const base: ReleaseCandidate = {
  draft,
  html,
  sendAt: '2026-11-10T21:45:00Z',
  timezone: 'America/New_York',
  approvedLocalTime: '2026-11-10T16:45',
  audienceSegmentId: 'SEG-ENGAGED',
  engagedSegmentId: 'SEG-ENGAGED',
  blackoutDates: ['2026-11-26'],
  occupiedDates: ['2026-11-12'],
  products: [
    {
      id: 'p1',
      title: 'Firming Balm',
      price: '$22.49',
      image: img,
      url: `${shop}/products/balm`,
      featurable: true
    }
  ],
  codes: [{ code: 'WELCOME15', percent: 15, expiresAt: null }],
  maxDiscountPercent: 20,
  facts: unknownFacts,
  storeHosts: ['example-store.com'],
  phoneRender: { width: 375, ok: true },
  now: '2026-11-08T00:00:00Z'
}
const allOk: LinkChecker = async (url) => ({
  ok: true,
  status: 200,
  finalUrl: url
})
const run = (
  c: Partial<ReleaseCandidate> = {},
  checkLink: LinkChecker = allOk
) => runReleaseQa({ ...base, ...c }, { checkLink })
const failed = async (c: Partial<ReleaseCandidate>, checkLink?: LinkChecker) =>
  (await run(c, checkLink)).checks.filter((x) => !x.pass).map((x) => x.id)

describe('runReleaseQa', () => {
  it('passes a clean email and reports every check in words', async () => {
    const result = await run()
    expect(result.pass).toBe(true)
    expect(result.checks.map((c) => c.id)).toEqual([
      'links',
      'code',
      'date',
      'products',
      'size',
      'phone_render',
      'copy',
      'audience',
      'send_time',
      'images',
      'footer'
    ])
    expect(result.checks.every((c) => c.label.length > 10)).toBe(true)
  })

  it('ignores mailto links and Klaviyo tags when listing links', () => {
    expect(emailLinks(html)).toEqual([
      `${shop}/products/balm`,
      `${shop}/collections/all`
    ])
  })

  describe('links', () => {
    it('blocks a broken link', async () => {
      const result = await run({}, async (url) => ({
        ok: true,
        status: url.endsWith('/all') ? 404 : 200,
        finalUrl: url
      }))
      expect(result.pass).toBe(false)
      expect(result.checks[0].problems[0]).toContain('answers 404')
    })

    it('blocks a product link that redirects away from the product (product gone)', async () => {
      const result = await run({}, async (url) => ({
        ok: true,
        status: 200,
        finalUrl: url.includes('/products/') ? `${shop}/` : url
      }))
      expect(result.checks[0].problems[0]).toMatch(/Firming Balm redirects/)
    })

    it('blocks links to other websites and plain http', async () => {
      expect(
        await failed({
          html: html.replace(
            `${shop}/collections/all`,
            'https://evil.example/x'
          )
        })
      ).toEqual(['links'])
      expect(
        await failed({
          html: html.replace(
            `${shop}/collections/all`,
            'http://example-store.com/all'
          )
        })
      ).toEqual(['links'])
    })

    it('blocks a featured product with no link', async () => {
      const r = await run({
        html: html.replace(`${shop}/products/balm`, `${shop}/pages/about`)
      })
      expect(r.checks[0].problems).toContain(
        'Firming Balm is featured but the email has no link to it.'
      )
    })

    it('reports a link that times out', async () => {
      const r = await run({}, async () => ({ ok: false, reason: 'timeout' }))
      expect(r.checks[0].problems[0]).toContain('did not answer in time')
    })
  })

  it('blocks an unknown, expired or too-big code', async () => {
    expect(
      await failed({ draft: { ...draft, code: 'SAVE50' } as Draft })
    ).toContain('code')
    expect(
      await failed({
        codes: [
          { code: 'WELCOME15', percent: 15, expiresAt: '2026-11-09T00:00:00Z' }
        ]
      })
    ).toContain('code')
    expect(await failed({ maxDiscountPercent: 10 })).toContain('code')
  })

  it('blocks a blackout or occupied date (store-local day)', async () => {
    // 01:30 UTC on the 13th is still the 12th in New York.
    expect(
      await failed({
        sendAt: '2026-11-13T01:30:00Z',
        approvedLocalTime: '2026-11-12T20:30'
      })
    ).toEqual(['date'])
    expect(
      await failed({
        sendAt: '2026-11-26T15:00:00Z',
        approvedLocalTime: '2026-11-26T10:00'
      })
    ).toEqual(['date'])
  })

  it('blocks a product that is gone or no longer featurable', async () => {
    expect(await failed({ products: [] })).toContain('products')
    expect(
      await failed({ products: [{ ...base.products[0], featurable: false }] })
    ).toEqual(['products'])
  })

  it('blocks an email over Gmail’s clipping size', async () => {
    const big = html.replace('</body>', `${'x'.repeat(gmailClipBytes)}</body>`)
    const r = await run({ html: big })
    expect(r.checks.find((c) => c.id === 'size')!.problems[0]).toMatch(
      /Gmail cuts off/
    )
  })

  it('blocks a missing or failed 375px render', async () => {
    expect(await failed({ phoneRender: null })).toEqual(['phone_render'])
    expect(await failed({ phoneRender: { width: 600, ok: true } })).toEqual([
      'phone_render'
    ])
  })

  it('blocks copy that fails the facts sheet', async () => {
    const bad = {
      ...draft,
      blocks: [
        {
          type: 'text',
          content: {
            heading: 'Free shipping on everything',
            paras: ['Clinically proven.']
          }
        }
      ]
    } as unknown as Draft
    const r = await run({ draft: bad })
    expect(
      r.checks.find((c) => c.id === 'copy')!.problems.length
    ).toBeGreaterThanOrEqual(2)
  })

  it('blocks any audience other than the Engaged segment', async () => {
    expect(await failed({ audienceSegmentId: 'SEG-ALL' })).toEqual(['audience'])
  })

  it('blocks a send time that is not the approved store time, or is past', async () => {
    const r = await run({ sendAt: '2026-11-10T16:45:00Z' })
    expect(r.checks.find((c) => c.id === 'send_time')!.problems[0]).toContain(
      'not the approved 2026-11-10 16:45'
    )
    expect(await failed({ now: '2026-11-11T00:00:00Z' })).toContain('send_time')
  })

  it('blocks images not hosted in Klaviyo', async () => {
    expect(
      await failed({
        html: html.replace(img, 'https://cdn.shopify.com/balm.png')
      })
    ).toEqual(['images'])
    expect(
      await failed({ html: html.replace(img, 'data:image/png;base64,AAAA') })
    ).toEqual(['images'])
  })

  it('blocks a footer without the unsubscribe or address tags', async () => {
    const r = await run({
      html: html.replace('{% unsubscribe "Unsubscribe" %}', '')
    })
    expect(r.checks.find((c) => c.id === 'footer')!.problems).toEqual([
      'The unsubscribe link is missing.'
    ])
  })
})

describe('createLinkChecker', () => {
  const res = (status: number, location?: string) =>
    new Response(null, { status, headers: location ? { location } : {} })

  it('follows redirects on the store and reports the final page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(301, '/products/balm-v2'))
      .mockResolvedValueOnce(res(200))
    const check = createLinkChecker({
      allowedHosts: ['example-store.com'],
      fetch
    })
    expect(await check(`${shop}/products/balm`)).toEqual({
      ok: true,
      status: 200,
      finalUrl: `${shop}/products/balm-v2`
    })
  })

  it('never fetches a host it is not allowed to, even through a redirect', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(302, 'http://169.254.169.254/latest'))
    const check = createLinkChecker({
      allowedHosts: ['example-store.com'],
      fetch
    })
    expect(await check(`${shop}/x`)).toEqual({ ok: false, reason: 'blocked' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await check('https://evil.example/')).toEqual({
      ok: false,
      reason: 'blocked'
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to GET when HEAD is refused', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(res(405))
      .mockResolvedValueOnce(res(200))
    const check = createLinkChecker({
      allowedHosts: ['example-store.com'],
      fetch
    })
    expect(await check(`${shop}/`)).toMatchObject({ ok: true, status: 200 })
    expect(fetch.mock.calls[1][1].method).toBe('GET')
  })

  it('stops a redirect loop', async () => {
    const fetch = vi.fn(async () => res(302, '/loop'))
    const check = createLinkChecker({
      allowedHosts: ['example-store.com'],
      fetch,
      maxRedirects: 3
    })
    expect(await check(`${shop}/loop`)).toEqual({
      ok: false,
      reason: 'blocked'
    })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('reports a timeout', async () => {
    const fetch = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(new Error('aborted'))
          )
        )
    ) as unknown as typeof globalThis.fetch
    const check = createLinkChecker({
      allowedHosts: ['example-store.com'],
      fetch,
      timeoutMs: 10
    })
    expect(await check(`${shop}/`)).toEqual({ ok: false, reason: 'timeout' })
  })
})
