// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk } from '@/features/intelligence/passes'
import { sampleSiteFetcher, type SiteFetcher } from './fetch'
import type { SiteFont } from './fonts'
import { readBrandSite } from './worker'

type Db = Parameters<typeof readBrandSite>[0]
type Job = Parameters<typeof readBrandSite>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_site',
  input: { domain: 'cedarlane.com' }
} as unknown as Job
const theme = 'https://cedarlane.com/cdn/theme.css'
const linking = (...sheets: string[]) =>
  sheets.map((s) => `<link rel="stylesheet" href="${s}">`).join('')
const pages: Record<string, string> = {
  'https://cedarlane.com/': `${linking(theme)}<a href="/products/socks">Socks</a><h1>Hi</h1>`,
  'https://cedarlane.com/products/socks': `${linking(theme, '/cdn/product.css', 'https://evil.com/x.css')}<style>body { font-family: "Inline Sans" }</style>`
}
const sheets: Record<string, string> = {
  [theme]:
    'h1 { font-family: "Cedar Serif" } @font-face { font-family: "Cedar Serif"; src: url(cedar.woff2) }',
  'https://cedarlane.com/cdn/product.css': 'boom'
}

/** A live site with those pages and stylesheets (no logo picture loads). */
function liveSite(): SiteFetcher & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    live: true,
    fetch: async (url) =>
      pages[url]
        ? { ok: true, url, html: pages[url]! }
        : { ok: false, failure: 'not_found' },
    picture: async () => null,
    stylesheet: async (url) => {
      asked.push(url)
      if (sheets[url] === 'boom') throw new Error('socket hang up')
      return sheets[url] ? { url, css: sheets[url]! } : null
    }
  }
}

function database(answer: { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { brand_name: 'Cedar Lane' }, error: null })
  }
  const db = {
    from: () => chain,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      return name === 'record_site_fonts' ? answer : { data: true, error: null }
    })
  } as unknown as Db
  const fonts = () =>
    calls.find((c) => c.name === 'record_site_fonts')?.args.fonts as
      SiteFont[] | undefined
  return { db, calls, fonts }
}
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

describe('readBrandSite keeps the fonts (FONT-b)', () => {
  it('keeps one set for the site, with the fonts its stylesheets set, before the findings', async () => {
    const warn = quiet()
    const { db, calls, fonts } = database({ data: true, error: null })
    const site = liveSite()
    const run = await readBrandSite(db, job, {
      fetcher: () => site,
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_photos',
      'record_site_fonts',
      // PICK-006: the design tokens, read with the same stylesheets.
      'record_site_tokens',
      'record_site_findings'
    ])
    expect(calls[1]!.args).toMatchObject({ job: 'job-1', lease: 'lease-1' })
    expect(fonts()).toEqual([
      {
        family: 'Cedar Serif',
        roles: ['heading'],
        kind: 'self-hosted',
        files: [
          expect.objectContaining({
            url: 'https://cedarlane.com/cdn/cedar.woff2'
          })
        ]
      },
      { family: 'Inline Sans', roles: ['body'], kind: 'unknown', files: [] }
    ])
    expect(run.fonts).toBe(2)
    // The theme's sheet once for both pages; a failed sheet skipped; never another site's.
    expect(site.asked.sort()).toEqual([
      'https://cedarlane.com/cdn/product.css',
      theme
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Site fonts not kept')
  })

  /** A read of the live site with the clock moved as each page or sheet arrives. */
  const readAt = async (
    times: { page?: number; sheet?: number; callMs?: number },
    change: (site: SiteFetcher) => Partial<SiteFetcher> = () => ({})
  ) => {
    const { db, calls, fonts } = database({ data: true, error: null })
    const site = liveSite()
    let now = 0
    const run = await readBrandSite(db, job, {
      fetcher: () => ({
        ...site,
        fetch: async (url) => {
          now = times.page ?? now
          return site.fetch(url)
        },
        stylesheet: async (url) => {
          now = times.sheet ?? now
          return site.stylesheet!(url)
        },
        ...change(site)
      }),
      askFor: () => sampleAsk,
      callMs: times.callMs ?? 0,
      now: () => now
    })
    return { run, calls, fonts: fonts(), asked: site.asked }
  }

  it('keeps the earlier fonts when no stylesheet could be read, too slow or failed', async () => {
    quiet()
    // The home page arrives with too little time left for a sheet.
    const slow = await readAt({ page: 28_000 })
    expect(slow.asked).toEqual([])
    const failed = await readAt({}, () => ({ stylesheet: async () => null }))
    for (const read of [slow, failed]) {
      expect(read.fonts).toBeUndefined()
      expect(read.run.fonts).toBeUndefined()
      expect(read.calls.at(-1)!.name).toBe('record_site_findings')
    }
  })

  it('reads no fonts from a page too large to parse quickly, or without the time a model call may take', async () => {
    quiet()
    const own = '<style>h2 { font-family: "Home Serif" }</style>'
    const huge = await readAt({}, (site) => ({
      fetch: async (url) => {
        const got = await site.fetch(url)
        return got.ok && url === 'https://cedarlane.com/'
          ? { ...got, html: got.html + own + ' '.repeat(1_000_001) }
          : got
      }
    }))
    // The product page's fonts only.
    expect(huge.fonts!.map((f) => f.family)).toEqual([
      'Cedar Serif',
      'Inline Sans'
    ])
    const late = await readAt({ page: 25_000, callMs: 10_000 })
    expect(late.asked).toEqual([])
    expect(late.fonts).toBeUndefined()
  })

  it('starts no last read of a page after the deadline', async () => {
    quiet()
    const read = await readAt({ sheet: 31_000 })
    expect(read.asked).toContain(theme)
    expect(read.fonts).toBeUndefined()
  })

  it('keeps none from the sample site, and still stores the findings when the fonts cannot be kept', async () => {
    const warn = quiet()
    const sample = database({ data: true, error: null })
    await readBrandSite(
      sample.db,
      { ...job, input: { domain: 'cedar-lane.example' } } as Job,
      { fetcher: sampleSiteFetcher, askFor: () => sampleAsk }
    )
    expect(sample.fonts()).toBeUndefined()
    const failed = database({ data: null, error: { code: '23514' } })
    const run = await readBrandSite(failed.db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(failed.calls.at(-1)!.name).toBe('record_site_findings')
    expect(run.fonts).toBeUndefined()
    expect(JSON.stringify(warn.mock.calls)).toContain('Site fonts not kept')
    // False: a newer read already kept its own.
    const late = database({ data: false, error: null })
    expect(
      (
        await readBrandSite(late.db, job, {
          fetcher: () => liveSite(),
          askFor: () => sampleAsk
        })
      ).fonts
    ).toBeUndefined()
  })
})
