// @vitest-environment node
import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk, type Ask } from '@/features/intelligence/passes'
import { sampleSiteFetcher, type SiteFetcher } from './fetch'
import {
  emailPicture,
  findLogos,
  keepableLogo,
  readBrandSite,
  siteRunMs
} from './worker'

type Db = Parameters<typeof readBrandSite>[0]
type Job = Parameters<typeof readBrandSite>[1]
const job = {
  id: 'job-1',
  tenant_id: 'tenant-1',
  lease_token: 'lease-1',
  kind: 'brand.read_site',
  input: { domain: 'cedarlane.com' }
} as unknown as Job

/** A 4x4 RGBA PNG: `ink` in the middle, a see-through border. */
function png(ink: [number, number, number]) {
  const chunk = (name: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length)
    out.writeUInt32BE(body.length, 0)
    out.write(name, 4, 'latin1')
    body.copy(out, 8)
    out.writeUInt32BE(
      crc32(Buffer.concat([Buffer.from(name, 'latin1'), body])),
      8 + body.length
    )
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(4, 0)
  header.writeUInt32BE(4, 4)
  header[8] = 8
  header[9] = 6
  const rows = [0, 1, 2, 3].flatMap((y) => [
    0,
    ...[0, 1, 2, 3].flatMap((x) =>
      x > 0 && x < 3 && y > 0 && y < 3 ? [...ink, 255] : [0, 0, 0, 0]
    )
  ])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}
const darkInk = png([10, 10, 10])
const lightInk = png([250, 250, 250])
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])

const dark = 'https://cdn.shopify.com/files/cedar-lane-logo.png'
const light = 'https://cedarlane.com/files/cedar-lane-logo-footer.png'
const homeWith = (
  header: string,
  footer = '/files/cedar-lane-logo-footer.png'
) => `<html><body>
<header><a href="/"><img src="${header}" alt="Cedar Lane"></a></header>
<main><h1>Vitamins for runners</h1></main>
<footer><img class="footer-logo" src="${footer}" alt="Cedar Lane logo"></footer>
</body></html>`
const home = homeWith(dark)

const pictures: Record<string, Uint8Array> = {
  [dark]: darkInk,
  [light]: lightInk
}
/** A live site with that home page and only that page. */
function liveSite(
  picture: SiteFetcher['picture'] = async (url) => pictures[url] ?? null
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

function database(fail?: string, kept = true) {
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
          : { data: name === 'record_site_logos' ? kept : null, error: null }
      })
    } as unknown as Db
  }
}
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

describe('readBrandSite keeps the logos (ONB-060b)', () => {
  it('keeps the home page’s logos for light and dark sections before the findings', async () => {
    quiet()
    const { db, calls } = database()
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_logos',
      'record_site_photos',
      'record_site_tokens',
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
    quiet()
    const { db, calls } = database()
    const run = await readBrandSite(
      db,
      { ...job, input: { domain: 'cedar-lane.example' } } as Job,
      { fetcher: sampleSiteFetcher, askFor: () => sampleAsk }
    )
    // PICK-006: the sample site's design tokens are kept (it has no logo).
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_tokens',
      'record_site_findings'
    ])
    expect(run.logos).toBeUndefined()
  })

  it('replaces nothing when the home page or none of its pictures can be read', async () => {
    quiet()
    const picture = vi.fn()
    const unreadable = database()
    await readBrandSite(unreadable.db, job, {
      fetcher: () => ({
        live: true,
        fetch: async () => ({ ok: false, failure: 'timeout' }),
        picture
      }),
      askFor: () => sampleAsk
    })
    expect(picture).not.toHaveBeenCalled()
    expect(unreadable.calls.map((c) => c.name)).toEqual([
      'record_site_findings'
    ])
    // The page is read but no picture loads (its host is down): the
    // earlier logos stay.
    const down = database()
    await readBrandSite(down.db, job, {
      fetcher: () => liveSite(async () => null),
      askFor: () => sampleAsk
    })
    expect(down.calls.map((c) => c.name)).toEqual([
      'record_site_photos',
      'record_site_tokens',
      'record_site_findings'
    ])
  })

  it('says none were kept when a newer read of the site already kept its own', async () => {
    quiet()
    const { db, calls } = database(undefined, false)
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_logos',
      'record_site_photos',
      'record_site_tokens',
      'record_site_findings'
    ])
    expect(run.logos).toBeUndefined()
  })

  it('still stores the findings when the logos cannot be kept (the emails show the name)', async () => {
    const warn = quiet()
    const { db, calls } = database('record_site_logos')
    const run = await readBrandSite(db, job, {
      fetcher: () => liveSite(),
      askFor: () => sampleAsk
    })
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_logos',
      'record_site_photos',
      'record_site_tokens',
      'record_site_findings'
    ])
    expect(run.logos).toBeUndefined()
    expect(JSON.stringify(warn.mock.calls)).toContain('Site logos not kept')
  })

  it('keeps nothing when the read fails while the pictures load', async () => {
    quiet()
    let loaded = false
    const slow: SiteFetcher['picture'] = async (url) => {
      await new Promise((r) => setTimeout(r, 20))
      loaded = true
      return pictures[url] ?? null
    }
    const down: Ask = async () => ({ ok: false, code: 'unavailable' })
    const { db, calls } = database()
    await expect(
      readBrandSite(db, job, {
        fetcher: () => liveSite(slow),
        askFor: () => down
      })
    ).rejects.toMatchObject({ code: 'unavailable' })
    await new Promise((r) => setTimeout(r, 40))
    expect(loaded).toBe(true)
    expect(calls).toEqual([])
  })
})

describe('findLogos (ONB-060b)', () => {
  const clock = { now: () => 0, deadline: siteRunMs }
  const page = { html: home, url: 'https://cedarlane.com/' }
  const site = liveSite()

  it('measures each picture’s ink to pick the logo for light and for dark sections', async () => {
    expect(await findLogos(page, 'Cedar Lane', site.picture!, clock)).toEqual({
      onLight: dark,
      onDark: light
    })
  })

  it('picks only from pictures that loaded as PNG, JPEG or GIF', async () => {
    for (const picture of [
      async () => null,
      async () => {
        throw new Error('socket hang up')
      },
      // An SVG answer under a .png name is no email picture.
      async () =>
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    ])
      expect(await findLogos(page, 'Cedar Lane', picture, clock)).toBeNull()
    // A GIF's ink cannot be measured: the header logo is taken for light
    // sections, and no guess is made for dark ones.
    // (A share-tag logo alone is never taken: nothing to keep.)
    expect(
      await findLogos(
        {
          ...page,
          html: '<meta property="og:logo" content="https://cdn.shopify.com/og-logo.jpg">'
        },
        'Cedar Lane',
        async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]),
        clock
      )
    ).toBeNull()
    expect(await findLogos(page, 'Cedar Lane', async () => gif, clock)).toEqual(
      { onLight: dark, onDark: null }
    )
  })

  it('never reads an SVG, WebP, odd port or long address, which an email could not show', async () => {
    const picture = vi.fn(async () => darkInk)
    for (const header of [
      'https://cdn.shopify.com/logo.svg',
      'https://cdn.shopify.com/logo.webp?v=2',
      'https://cdn.shopify.com:8443/logo.png',
      `https://cdn.shopify.com/${'a'.repeat(1_000)}/logo.png`
    ]) {
      const html = homeWith(header, header)
      expect(
        await findLogos({ ...page, html }, 'Cedar Lane', picture, clock)
      ).toBeNull()
    }
    expect(picture).not.toHaveBeenCalled()
  })

  it('reads no picture without the time it may take', async () => {
    const picture = vi.fn(async () => darkInk)
    expect(
      await findLogos(page, 'Cedar Lane', picture, {
        now: () => siteRunMs - 1_000,
        deadline: siteRunMs
      })
    ).toBeNull()
    expect(picture).not.toHaveBeenCalled()
  })

  it('knows an email picture by its bytes and a keepable address by its form', () => {
    expect(emailPicture(darkInk)).toBe(true)
    expect(emailPicture(gif)).toBe(true)
    expect(emailPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(true)
    expect(emailPicture(new TextEncoder().encode('<svg/>'))).toBe(false)
    expect(emailPicture(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0]))).toBe(
      false
    )
    expect(keepableLogo(dark)).toBe(true)
    for (const url of [
      'http://cdn.shopify.com/logo.png',
      'https://cdn.shopify.com:443/logo.png',
      'https://a:b@cdn.shopify.com/logo.png',
      'https://cdn.shopify.com/logo.svg'
    ])
      expect(keepableLogo(url), url).toBe(false)
  })
})
