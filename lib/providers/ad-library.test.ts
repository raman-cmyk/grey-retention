import { describe, expect, it } from 'vitest'
import {
  adLibraryFor,
  maxAds,
  maxText,
  maxTexts,
  namedLike,
  onDomain,
  ownAds,
  ownPage,
  sampleAdLibrary,
  sampleAds,
  type LibraryAd
} from './ad-library'

const domain = 'cedar-lane.example'
const ad = (n: number, over: Partial<LibraryAd> = {}): LibraryAd => ({
  id: String(1000 + n),
  pageId: 'P1',
  pageName: 'Cedar Lane',
  startedAt: new Date(Date.UTC(2026, 10, 1) + n * 3_600_000).toISOString(),
  active: true,
  texts: [`Ad number ${n}.`],
  titles: [],
  descriptions: [],
  linkUrl: `https://${domain}/p/${n}`,
  platforms: ['facebook'],
  media: 'image',
  ...over
})

describe('the ads the Ads analyst reads (ownAds)', () => {
  it('keeps only the page sending people to the brand’s own domain most', () => {
    const ads = [
      ad(1),
      ad(2),
      // A reseller linking to the brand once: not the brand's page.
      ad(3, { pageId: 'P2', pageName: 'Reseller' }),
      // A look-alike domain counts for nothing.
      ad(4, { pageId: 'P3', linkUrl: 'https://cedar-lane.example.evil/x' }),
      ad(5, { pageId: 'P3', linkUrl: 'https://notcedar-lane.example/x' })
    ]
    expect(ownAds(ads, domain, 'Cedar Lane').map((a) => a.pageId)).toEqual([
      'P1',
      'P1'
    ])
  })

  it('reads nothing when no page sends people to the brand', () => {
    expect(
      ownAds(
        [ad(1, { linkUrl: 'https://other.example/' })],
        domain,
        'Cedar Lane'
      )
    ).toEqual([])
    expect(ownAds([ad(1, { linkUrl: null })], domain, 'Cedar Lane')).toEqual([])
    // An ended ad is not live.
    expect(ownAds([ad(1, { active: false })], domain, 'Cedar Lane')).toEqual([])
  })

  it('keeps active ads once each, newest first, at most 30', () => {
    const many = Array.from({ length: 40 }, (_, n) => ad(n))
    const kept = ownAds(
      [...many, ad(39), ad(41, { active: false })],
      domain,
      'Cedar Lane'
    )
    expect(kept).toHaveLength(maxAds)
    expect(kept[0]!.id).toBe('1039')
    expect(new Set(kept.map((a) => a.id)).size).toBe(maxAds)
  })

  it('caps and cleans each text, and drops a link off the brand’s domain', () => {
    const [kept] = ownAds(
      [
        ad(1),
        ad(2, {
          texts: [
            `  A\u0000long\n\ntext ${'x'.repeat(2_000)}`,
            'two',
            'two',
            'three',
            'four',
            'five'
          ],
          linkUrl: 'http://cedar-lane.example/insecure',
          pageName: 'N'.repeat(300)
        })
      ],
      domain,
      'Cedar Lane'
    )
    expect(kept!.id).toBe('1002')
    expect(kept!.texts).toHaveLength(maxTexts)
    expect(kept!.texts[0]!.startsWith('A long text')).toBe(true)
    expect(kept!.texts[0]!.length).toBe(maxText)
    expect(kept!.linkUrl).toBeNull()
    expect(kept!.pageName).toHaveLength(120)
  })

  it('takes only an id the Ad Library gives (digits)', () => {
    expect(
      ownAds([ad(1), ad(2, { id: '../x' })], domain, 'Cedar Lane').map(
        (a) => a.id
      )
    ).toEqual(['1001'])
  })

  it('matches the domain or a subdomain only', () => {
    expect(onDomain('shop.cedar-lane.example', domain)).toBe(true)
    expect(onDomain('cedar-lane.example', domain)).toBe(true)
    expect(onDomain('evilcedar-lane.example', domain)).toBe(false)
    expect(onDomain(null, domain)).toBe(false)
  })
})

describe('the brand’s own page (ownPage)', () => {
  it('counts each ad once, so a page repeated in the answer cannot win', () => {
    const affiliate = (n: number) =>
      ad(n, { pageId: 'AFF', pageName: 'Deals Hub', id: '5000' })
    expect(
      ownPage(
        [ad(1), ad(2), affiliate(3), affiliate(4), affiliate(5)],
        domain,
        'Cedar Lane'
      )
    ).toBe('P1')
  })

  it('takes the page named like the brand over one with more ads', () => {
    const affiliate = (n: number) =>
      ad(n, { pageId: 'AFF', pageName: 'Deals Hub' })
    expect(
      ownPage(
        [ad(1), affiliate(2), affiliate(3), affiliate(4)],
        domain,
        'Cedar Lane Co'
      )
    ).toBe('P1')
    expect(namedLike('Cedar Lane', 'Cedar Lane — synthetic demo')).toBe(true)
    expect(namedLike('Deals Hub', 'Cedar Lane')).toBe(false)
  })

  it('never guesses between two pages equally likely', () => {
    expect(
      ownPage(
        [
          ad(1, { pageId: 'A', pageName: 'Shop A' }),
          ad(2, { pageId: 'B', pageName: 'Shop B' })
        ],
        domain,
        'Cedar Lane'
      )
    ).toBeNull()
  })

  it('keeps a link as a browser reads it, and drops one that is not the brand’s', () => {
    const links = (linkUrl: string) =>
      ownAds([ad(1), ad(2, { linkUrl })], domain, 'Cedar Lane').find(
        (a) => a.id === '1002'
      )?.linkUrl
    expect(links('https://Cedar-Lane.example:443/p?x=1')).toBe(
      'https://cedar-lane.example/p?x=1'
    )
    expect(links('https://shop.cedar-lane.example/p')).toBe(
      'https://shop.cedar-lane.example/p'
    )
    expect(links('https://evil.example\\.cedar-lane.example/x')).toBeNull()
    expect(links('https://cedar-lane.example:8443/p')).toBeNull()
    expect(links('https://user@cedar-lane.example/p')).toBeNull()
  })

  it('takes out hidden characters from what an ad says', () => {
    const [kept] = ownAds(
      [ad(1, { texts: ['20%\u200b off\u202e today'] })],
      domain,
      'Cedar Lane'
    )
    expect(kept!.texts).toEqual(['20% off today'])
  })
})

describe('the sample library', () => {
  it('serves sample ads for a synthetic brand only, never a real one', async () => {
    const sample = await sampleAdLibrary.activeAds({
      brandName: 'Cedar Lane',
      domain
    })
    expect(sample.ok).toBe(true)
    if (!sample.ok) return
    const kept = ownAds(sample.ads, domain, 'Cedar Lane')
    // The ended ad and the reseller's ad are left out.
    expect(kept.map((a) => a.media)).toEqual([
      'video',
      'carousel',
      'image',
      'image'
    ])
    expect(kept.every((a) => a.pageName === 'Cedar Lane')).toBe(true)
    expect(
      await sampleAdLibrary.activeAds({
        brandName: 'Real',
        domain: 'real-brand.com'
      })
    ).toEqual({ ok: false, code: 'not_set_up' })
    expect(sampleAds('no-ads-shop.example')).toEqual([])
  })

  it('reads no real brand until the owner chooses a live library', async () => {
    expect(adLibraryFor('sample')).toBe(sampleAdLibrary)
    const real = adLibraryFor('live')
    expect(real.live).toBe(true)
    expect(
      await real.activeAds({ brandName: 'Real', domain: 'real-brand.com' })
    ).toEqual({ ok: false, code: 'not_set_up' })
  })
})
