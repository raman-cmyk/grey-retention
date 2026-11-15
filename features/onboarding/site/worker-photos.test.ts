// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk } from '@/features/intelligence/passes'
import { sampleSiteFetcher, type SiteFetcher } from './fetch'
import { maxSitePhotos, readBrandSite } from './worker'

type Db = Parameters<typeof readBrandSite>[0]
type Job = Parameters<typeof readBrandSite>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_site',
  input: { domain: 'cedarlane.com' }
} as unknown as Job
const cdn = 'https://cdn.shopify.com/s/files/1'

const home = `<html><body><main>
  <img src="${cdn}/runners.jpg" alt="Runners at dawn">
  <a href="/products/trail-socks"><img src="${cdn}/socks.jpg" alt="Trail socks"></a>
</main></body></html>`
const product = `<html><head><script type="application/ld+json">${JSON.stringify(
  {
    '@type': 'Product',
    image: [`${cdn}/socks.jpg?width=1600`, `${cdn}/socks-back.jpg`]
  }
)}</script></head><body><main><img src="${cdn}/socks-side.jpg"></main></body></html>`

/** A live site with those two pages (no logo picture loads). */
function liveSite(
  pages: Record<string, string> = {
    'https://cedarlane.com/': home,
    'https://cedarlane.com/products/trail-socks': product
  }
): SiteFetcher {
  return {
    live: true,
    fetch: async (url) =>
      pages[url]
        ? { ok: true, url, html: pages[url]! }
        : { ok: false, failure: 'not_found' },
    picture: async () => null
  }
}

function database(
  answer: { data: unknown; error: unknown } = { data: true, error: null }
) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { brand_name: 'Cedar Lane' }, error: null })
  }
  return {
    calls,
    db: {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return name === 'record_site_photos'
          ? answer
          : { data: null, error: null }
      })
    } as unknown as Db
  }
}
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}
const photosOf = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_site_photos')?.args.photos as
    | {
        url: string
        kind: string
        page: string
        alt: string | null
        source: string
      }[]
    | undefined

describe('readBrandSite keeps the photos (ONB-059b)', () => {
  it('keeps every read page’s photos, once each, in reading order, before the findings', async () => {
    quiet()
    const { db, calls } = database()
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_photos',
      'record_site_findings'
    ])
    expect(calls[0]!.args).toMatchObject({ job: 'job-1', lease: 'lease-1' })
    expect(photosOf(calls)).toEqual([
      {
        url: `${cdn}/runners.jpg`,
        kind: 'lifestyle',
        page: 'home',
        alt: 'Runners at dawn',
        source: 'page'
      },
      {
        url: `${cdn}/socks.jpg`,
        kind: 'product',
        page: 'home',
        alt: 'Trail socks',
        source: 'page'
      },
      {
        url: `${cdn}/socks-back.jpg`,
        kind: 'product',
        page: 'product',
        alt: null,
        source: 'schema'
      },
      {
        url: `${cdn}/socks-side.jpg`,
        kind: 'product',
        page: 'product',
        alt: null,
        source: 'page'
      }
    ])
    expect(run.photos).toBe(4)
  })

  it('keeps none from the sample site, or when no page can be read', async () => {
    quiet()
    const sample = database()
    await readBrandSite(
      sample.db,
      { ...job, input: { domain: 'cedar-lane.example' } } as Job,
      { fetcher: sampleSiteFetcher, askFor: () => sampleAsk }
    )
    expect(photosOf(sample.calls)).toBeUndefined()
    const down = database()
    await readBrandSite(down.db, job, {
      fetcher: () => liveSite({}),
      askFor: () => sampleAsk
    })
    expect(photosOf(down.calls)).toBeUndefined()
  })

  it('reads no photos from a page too large to parse quickly', async () => {
    quiet()
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () =>
        liveSite({ 'https://cedarlane.com/': home + ' '.repeat(1_000_001) }),
      askFor: () => sampleAsk
    })
    expect(photosOf(calls)).toBeUndefined()
  })

  it(`keeps at most ${maxSitePhotos}`, async () => {
    quiet()
    const many = `<main>${Array.from(
      { length: 30 },
      (_, i) => `<img src="${cdn}/p-${i}.jpg">`
    ).join('')}</main>`
    const pages: Record<string, string> = {
      'https://cedarlane.com/': `${many}${Array.from(
        { length: 7 },
        (_, i) => `<a href="/products/p${i}">p</a>`
      ).join('')}`
    }
    for (let i = 0; i < 7; i++)
      pages[`https://cedarlane.com/products/p${i}`] = `<main>${Array.from(
        { length: 30 },
        (_, j) => `<img src="${cdn}/q-${i}-${j}.jpg">`
      ).join('')}</main>`
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () => liveSite(pages),
      askFor: () => sampleAsk
    })
    expect(photosOf(calls)!.length).toBeLessThanOrEqual(maxSitePhotos)
    expect(photosOf(calls)![0]!.url).toBe(`${cdn}/p-0.jpg`)
  })

  it('still stores the findings when the photos cannot be kept, and says none were kept when a newer read won', async () => {
    const warn = quiet()
    const failed = database({ data: null, error: { code: '23514' } })
    const run = await readBrandSite(failed.db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(failed.calls.map((c) => c.name)).toContain('record_site_findings')
    expect(run.photos).toBeUndefined()
    expect(JSON.stringify(warn.mock.calls)).toContain('Site photos not kept')
    const late = database({ data: false, error: null })
    expect(
      (
        await readBrandSite(late.db, job, {
          fetcher: () => liveSite(),
          askFor: () => sampleAsk
        })
      ).photos
    ).toBeUndefined()
  })
})
