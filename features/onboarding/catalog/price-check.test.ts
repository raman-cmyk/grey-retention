import { describe, expect, it } from 'vitest'
import type { Finding } from '@/features/onboarding/findings'
import type { CatalogEntry } from './read'
import {
  catalogPriceCheck,
  outlierFactor,
  priceSuspects,
  withSanePrices
} from './price-check'

let n = 0
const entry = (
  amount: number,
  over: Partial<CatalogEntry> = {}
): CatalogEntry => {
  n++
  return {
    id: `p${n}`,
    externalId: `k${n}`,
    title: `Shirt ${n}`,
    url: `https://shop.example/p/${n}`,
    price: '$' + amount.toFixed(2),
    amount,
    currency: 'USD',
    compareAt: null,
    image: null,
    featurable: true,
    hiddenReason: null,
    unitsSold30d: 0,
    unitsSold90d: 0,
    bestsellerRank: null,
    launchedAt: null,
    newArrival: false,
    stock: null,
    ...over
  }
}
const store = () => [60, 75, 89, 89, 95, 120].map((a) => entry(a))
const site = (
  topic: 'locale' | 'price_band',
  value: Record<string, unknown>,
  over: Record<string, unknown> = {}
) =>
  ({
    source: 'site',
    topic,
    value,
    confidence: 0.9,
    ...over
  }) as unknown as Finding

describe('priceSuspects (ONB-063)', () => {
  it('flags a price far above or below the store’s usual one', () => {
    const typo = entry(8900, { title: 'Linen shirt' })
    const cheap = entry(1.5, { title: 'Sticker' })
    const suspects = priceSuspects([...store(), typo, cheap])
    expect(suspects.map((s) => [s.id, s.reason])).toEqual([
      [typo.id, 'far_above'],
      [cheap.id, 'far_below']
    ])
    expect(suspects[0]!.words).toBe(
      '"Linen shirt" costs $8900.00, far more than your other products (most are around $89.00). Check its price in Klaviyo.'
    )
    expect(suspects[1]!.words).toContain('far less')
  })

  it('leaves an honest range, free gifts, duplicates and small catalogs alone', () => {
    // A $400 coat in a store of $60 to $120 shirts is fine.
    expect(priceSuspects([...store(), entry(400)])).toEqual([])
    expect(priceSuspects([...store(), entry(0)])).toEqual([])
    expect(
      priceSuspects([
        ...store(),
        entry(89 * outlierFactor, { hiddenReason: 'duplicate' })
      ])
    ).toEqual([])
    expect(
      priceSuspects([entry(10), entry(20), entry(30), entry(9000)])
    ).toEqual([])
  })
})

describe('catalogPriceCheck (ONB-063)', () => {
  it('passes a catalog that matches the website', () => {
    const check = catalogPriceCheck(store(), [
      site('locale', { language: 'en', currency: 'USD' }),
      site('price_band', { min: 40, max: 150, currency: 'USD' })
    ])
    expect(check).toMatchObject({
      usual: 89,
      currency: { catalog: 'USD', site: 'USD', agrees: true },
      scale: 'ok',
      suspects: [],
      words: []
    })
  })

  it('catches a whole catalog in cents, and features none of it', () => {
    const cents = [6000, 7500, 8900, 8900, 9500, 12000].map((a) => entry(a))
    const check = catalogPriceCheck(cents, [
      site('price_band', { min: 40, max: 150, currency: 'USD' })
    ])
    expect(check.scale).toBe('off')
    expect(check.suspects).toEqual([])
    expect(check.words).toEqual([
      'Your Klaviyo prices (most around $8,900.00) do not match your website ($40.00 to $150.00). They may be in cents. Check your Klaviyo catalog before emails show prices.'
    ])
    expect(withSanePrices(cents, check)).toEqual([])
  })

  it('says when the website shows another currency, without hiding products', () => {
    const products = store()
    const check = catalogPriceCheck(products, [
      site('locale', { language: 'de', currency: 'EUR' }),
      site('price_band', { min: 1, max: 5, currency: 'EUR' })
    ])
    expect(check.currency).toEqual({
      catalog: 'USD',
      site: 'EUR',
      agrees: false
    })
    // Ranges in two currencies are never compared.
    expect(check.scale).toBe('unknown')
    expect(check.words).toEqual([
      'Your website shows prices in EUR, but your Klaviyo catalog is in USD. Emails use the Klaviyo prices.'
    ])
    expect(withSanePrices(products, check)).toEqual(products)
  })

  it('uses only sure findings from the website', () => {
    const check = catalogPriceCheck(store(), [
      site('locale', { language: 'de', currency: 'EUR' }, { confidence: 0.5 }),
      site(
        'price_band',
        { min: 1, max: 2, currency: 'USD' },
        { source: 'catalog' }
      )
    ])
    expect(check).toMatchObject({
      currency: { site: null, agrees: null },
      scale: 'unknown',
      words: []
    })
  })

  it('skips a site finding whose value does not fit its topic', () => {
    const check = catalogPriceCheck(store(), [
      site(
        'locale',
        { language: 'de', currency: 'euro' },
        { confidence: 0.95 }
      ),
      site('locale', { language: 'en', currency: 'USD' }, { confidence: 0.8 })
    ])
    expect(check.currency).toEqual({
      catalog: 'USD',
      site: 'USD',
      agrees: true
    })
  })

  it('leaves out only the doubtful prices', () => {
    const typo = entry(8900)
    const products = [...store(), typo]
    const check = catalogPriceCheck(products, [])
    expect(check.words).toEqual([check.suspects[0]!.words])
    expect(withSanePrices(products, check).map((p) => p.id)).toEqual(
      products.filter((p) => p !== typo).map((p) => p.id)
    )
  })

  it('knows nothing about an empty catalog', () => {
    expect(catalogPriceCheck([], [])).toEqual({
      usual: null,
      currency: { catalog: null, site: null, agrees: null },
      scale: 'unknown',
      suspects: [],
      words: []
    })
  })
})
