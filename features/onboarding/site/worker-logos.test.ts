// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk } from '@/features/intelligence/passes'
import { sampleSiteFetcher, type SiteFetcher } from './fetch'
import { findLogos, readBrandSite, siteRunMs } from './worker'

type Db = Parameters<typeof readBrandSite>[0]
type Job = Parameters<typeof readBrandSite>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_site',
  input: { domain: 'cedarlane.com' }
} as unknown as Job

const dark = 'https://cdn.shopify.com/files/cedar-lane-logo.svg'
const light = 'https://cedarlane.com/files/cedar-lane-logo-footer.svg'
const home = `<html><body>
<header><a href="/"><img src="${dark}" alt="Cedar Lane"></a></header>
<main><h1>Vitamins for runners</h1></main>
<footer><img class="footer-logo" src="/files/cedar-lane-logo-footer.svg" alt="Cedar Lane logo"></footer>
</body></html>`
const svg = (fill: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="${fill}" d="M0 0h10v10H0z"/></svg>`
  )

/** A live site with that home page and only that page. */
function liveSite(
  picture: SiteFetcher['picture'] = async (url) =>
    url === dark ? svg('#111111') : url === light ? svg('#ffffff') : null
): SiteFetcher {
  return {
    live: true,
    fetch: async (url) =>
      url === 'https://cedarlane.com/'
        ? { ok: true, url, html: home }
        : { ok: false, failure: 'not_found' },
    picture
  }
}

function database(fail?: string) {
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
        return name === fail
          ? {
              data: null,
              error: { code: 'PT409', message: 'Lease unavailable' }
            }
          : { data: true, error: null }
      })
    } as unknown as Db
  }
}

describe('readBrandSite keeps the logos (ONB-060b)', () => {
  it('keeps the home page’s logos for light and dark sections before the findings', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database()
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_logos',
      'record_site_findings'
    ])
    expect(calls[0]!.args).toEqual({
      job: 'job-1',
      lease: 'lease-1',
      on_light: dark,
      on_dark: light
    })
    expect(run.logos).toEqual({ onLight: true, onDark: true })
  })

  it('keeps none from the sample site, which has no logo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database()
    const run = await readBrandSite(
      db,
      { ...job, input: { domain: 'cedar-lane.example' } } as Job,
      { fetcher: sampleSiteFetcher, askFor: () => sampleAsk }
    )
    expect(calls.map((c) => c.name)).toEqual(['record_site_findings'])
    expect(run.logos).toBeUndefined()
  })

  it('keeps none when the home page cannot be read', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const picture = vi.fn()
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () => ({
        live: true,
        fetch: async () => ({ ok: false, failure: 'timeout' }),
        picture
      }),
      askFor: () => sampleAsk
    })
    expect(picture).not.toHaveBeenCalled()
    expect(calls.map((c) => c.name)).toEqual(['record_site_findings'])
  })

  it('still stores the findings when the logos cannot be kept (the emails show the name)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database('record_site_logos')
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_logos',
      'record_site_findings'
    ])
    expect(run.logos).toBeUndefined()
    expect(JSON.stringify(warn.mock.calls)).toContain('Site logos not kept')
  })
})

describe('findLogos (ONB-060b)', () => {
  const clock = { now: () => 0, deadline: siteRunMs }
  const page = { html: home, url: 'https://cedarlane.com/' }

  it('measures each picture’s ink to pick the logo for light and for dark sections', async () => {
    expect(
      await findLogos(page, 'Cedar Lane', liveSite().picture!, clock)
    ).toEqual({ onLight: dark, onDark: light })
  })

  it('takes the header’s logo for light sections when no picture can be read, and guesses none for dark', async () => {
    for (const picture of [
      async () => null,
      async () => {
        throw new Error('socket hang up')
      }
    ])
      expect(await findLogos(page, 'Cedar Lane', picture, clock)).toEqual({
        onLight: dark,
        onDark: null
      })
  })

  it('reads no picture without the time it may take', async () => {
    const picture = vi.fn(async () => svg('#111111'))
    await findLogos(page, 'Cedar Lane', picture, {
      now: () => siteRunMs - 1_000,
      deadline: siteRunMs
    })
    expect(picture).not.toHaveBeenCalled()
  })

  it('drops a logo address too long to keep', async () => {
    const long = `https://cdn.shopify.com/${'a'.repeat(1_000)}/logo.svg`
    const html = `<header><a href="/"><img src="${long}" alt="Cedar Lane"></a></header>`
    expect(
      await findLogos(
        { ...page, html },
        'Cedar Lane',
        async () => svg('#111'),
        clock
      )
    ).toEqual({ onLight: null, onDark: null })
  })
})
