// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { brandMismatches, catalogueElsewhere, hostOf } from './mismatch'

const base = {
  brandName: 'Cedar Lane',
  website: 'https://cedar-lane.example',
  klaviyoAccount: 'Cedar Lane',
  shopDomain: 'cedar-lane.myshopify.com'
}
const facts = (
  currency: string,
  country: string,
  website: string | null = null
) => ({
  website,
  currency,
  country
})

describe('brand-mismatch guard (UIR-021)', () => {
  it('reads web addresses like people type them', () => {
    expect(hostOf('https://www.Cedar-Lane.example/shop?x=1')).toBe(
      'cedar-lane.example'
    )
    expect(hostOf('cedar-lane.example')).toBe('cedar-lane.example')
    expect(hostOf('not a site')).toBeNull()
    expect(hostOf('')).toBeNull()
    expect(hostOf(null)).toBeNull()
  })

  it('says nothing when everything belongs to one brand', () => {
    expect(
      brandMismatches({
        ...base,
        klaviyo: facts('AUD', 'AU', 'https://cedar-lane.example'),
        shopify: facts('AUD', 'AU'),
        productUrls: [
          'https://cedar-lane.example/products/overshirt',
          'https://shop.cedar-lane.example/products/hat',
          'https://cedar-lane.myshopify.com/products/socks'
        ]
      })
    ).toEqual([])
  })

  it('warns when the Klaviyo organisation is another brand', () => {
    const found = brandMismatches({
      ...base,
      klaviyoAccount: 'Northwind Outdoor (sample)',
      klaviyo: facts('EUR', 'DE', 'https://northwind-outdoor.example'),
      shopify: facts('AUD', 'AU')
    })
    expect(found.map((m) => m.message)).toEqual([
      'Your Brand profile says “Cedar Lane”, but the connected Klaviyo account is “Northwind Outdoor (sample)”. Check that the profile describes this brand before the AI writes anything.',
      'Your Brand profile’s website is cedar-lane.example, but the connected Klaviyo account’s website is northwind-outdoor.example.',
      'Klaviyo reports amounts in EUR, but the Shopify store sells in AUD. Check that both accounts belong to this brand.',
      'The Klaviyo account is in DE, but the Shopify store is in AU. Check that both accounts belong to this brand.'
    ])
  })

  it('warns when the catalogue links to another site', () => {
    const urls = [
      'https://north-studio.example/products/vase',
      'https://north-studio.example/products/bowl',
      'https://cedar-lane.example/products/overshirt'
    ]
    expect(catalogueElsewhere(urls, base.website, base.shopDomain)).toBe(
      'north-studio.example'
    )
    expect(
      brandMismatches({ ...base, productUrls: urls }).map((m) => m.source)
    ).toEqual(['catalogue'])
  })

  it('does not guess from too little', () => {
    // One product, no website, or no catalogue: no catalogue warning.
    expect(
      catalogueElsewhere(['https://other.example/p'], base.website, null)
    ).toBeNull()
    expect(
      catalogueElsewhere(
        ['https://other.example/a', 'https://other.example/b'],
        '',
        null
      )
    ).toBeNull()
    // Missing facts are never a mismatch.
    expect(
      brandMismatches({
        ...base,
        klaviyo: { website: null, currency: null, country: null },
        shopify: facts('AUD', 'AU')
      })
    ).toEqual([])
    // Without a connection there is nothing to compare.
    expect(
      brandMismatches({
        ...base,
        klaviyoAccount: null,
        shopDomain: null,
        klaviyo: null,
        shopify: null
      })
    ).toEqual([])
  })
})
