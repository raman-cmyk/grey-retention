import { describe, expect, it } from 'vitest'
import {
  adLibraryFor,
  maxAds,
  maxText,
  maxTexts,
  onDomain,
  ownAds,
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
    expect(ownAds(ads, domain).map((a) => a.pageId)).toEqual(['P1', 'P1'])
  })

  it('reads nothing when no page sends people to the brand', () => {
    expect(
      ownAds([ad(1, { linkUrl: 'https://other.example/' })], domain)
    ).toEqual([])
    expect(ownAds([ad(1, { linkUrl: null })], domain)).toEqual([])
    // An ended ad is not live.
    expect(ownAds([ad(1, { active: false })], domain)).toEqual([])
  })

  it('keeps active ads once each, newest first, at most 30', () => {
    const many = Array.from({ length: 40 }, (_, n) => ad(n))
    const kept = ownAds([...many, ad(39), ad(41, { active: false })], domain)
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
      domain
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
      ownAds([ad(1), ad(2, { id: '../x' })], domain).map((a) => a.id)
    ).toEqual(['1001'])
  })

  it('matches the domain or a subdomain only', () => {
    expect(onDomain('shop.cedar-lane.example', domain)).toBe(true)
    expect(onDomain('cedar-lane.example', domain)).toBe(true)
    expect(onDomain('evilcedar-lane.example', domain)).toBe(false)
    expect(onDomain(null, domain)).toBe(false)
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
    const kept = ownAds(sample.ads, domain)
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
    expect(adLibraryFor(domain)).toBe(sampleAdLibrary)
    const real = adLibraryFor('real-brand.com')
    expect(real.live).toBe(true)
    expect(
      await real.activeAds({ brandName: 'Real', domain: 'real-brand.com' })
    ).toEqual({ ok: false, code: 'not_set_up' })
  })
})
