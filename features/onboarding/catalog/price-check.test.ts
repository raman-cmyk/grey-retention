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
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
const entry = (
  amount: number,
  over: Partial<CatalogEntry> = {}
): CatalogEntry => {
  n++
  const currency = over.currency ?? 'USD'
  return {
    id: `p${n}`,
    externalId: `k${n}`,
    title: `Shirt ${n}`,
    url: `https://shop.example/p/${n}`,
    // As `listCatalog` formats it.
    price: money(amount, currency),
    amount,
    currency,
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
const band = (min: number, max: number, currency = 'USD', over = {}) =>
  site('price_band', { min, max, currency }, over)
/** Two pages whose price levels (geometric middles) are both 100. */
const twoPages = (currency = 'USD') => [
  band(50, 200, currency),
  band(25, 400, currency)
]

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
      '"Linen shirt" costs $8,900.00, far more than your other products (most are around $89.00). Check its price in your store.'
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

  it('never names a price the owner confirmed, or a product no email shows', () => {
    const ring = entry(5000, { title: 'Diamond ring' })
    const draft = entry(9000, { hiddenReason: 'unpublished' })
    const products = [...store(), ring, draft]
    expect(priceSuspects(products).map((s) => s.id)).toEqual([ring.id])
    expect(priceSuspects(products, { confirmed: [ring.id] })).toEqual([])
  })

  it('judges the store’s main currency only', () => {
    const left = [
      entry(2000, { currency: 'JPY' }),
      entry(3000, { currency: 'JPY' })
    ]
    const check = catalogPriceCheck([...store(), ...left], [])
    expect(check).toMatchObject({ usual: 89, currency: { catalog: 'USD' } })
    expect(check.suspects).toEqual([])
  })
})

describe('catalogPriceCheck (ONB-063)', () => {
  it('passes a catalog that matches the website', () => {
    const check = catalogPriceCheck(store(), [
      site('locale', { language: 'en', currency: 'USD' }),
      ...twoPages()
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
    const check = catalogPriceCheck(cents, twoPages())
    expect(check.scale).toBe('too_high')
    expect(check.suspects).toEqual([])
    expect(check.words).toEqual([
      'Your product prices (most around $8,900.00) are far higher than on your website (most around $100.00). They may be typed in cents. Check the prices in your store before emails show them.'
    ])
    expect(withSanePrices(cents, check)).toEqual([])
  })

  it('catches prices far too low, without talking of cents', () => {
    const low = [0.6, 0.75, 0.89, 0.89, 0.95].map((a) => entry(a))
    const check = catalogPriceCheck(low, twoPages())
    expect(check.scale).toBe('too_low')
    expect(check.words[0]).toBe(
      'Your product prices (most around $0.89) are far lower than on your website (most around $100.00). Check the prices in your store before emails show them.'
    )
    expect(withSanePrices(low, check)).toEqual([])
  })

  it('never talks of cents for a currency without them', () => {
    const yen = [450000, 460000, 470000].map((a) =>
      entry(a, { currency: 'JPY' })
    )
    const check = catalogPriceCheck(yen, [
      band(4000, 9000, 'JPY'),
      band(3000, 12000, 'JPY')
    ])
    expect(check.scale).toBe('too_high')
    expect(check.words[0]).not.toContain('cents')
    expect(check.words[0]).toContain('¥460,000')
  })

  it('checks a small catalog against the website too', () => {
    const check = catalogPriceCheck([entry(8900)], twoPages())
    expect(check.scale).toBe('too_high')
  })

  it('takes every price the website showed, so one odd page decides nothing', () => {
    const small = [8, 10, 12, 12, 15].map((a) => entry(a))
    // A gift card page ($10 to $500) and the home page ($8 to $15).
    const giftCard = catalogPriceCheck(small, [
      band(10, 500, 'USD', { confidence: 0.95 }),
      band(8, 15)
    ])
    expect(giftCard.scale).toBe('ok')
    expect(withSanePrices(small, giftCard)).toEqual(small)
    // One $5 product page in a $90 to $150 store.
    const big = [90, 110, 120, 130, 150].map((a) => entry(a))
    expect(catalogPriceCheck(big, [band(5, 5), band(90, 150)]).scale).toBe('ok')
    // A range of nothing is no range, and one page alone decides nothing.
    expect(catalogPriceCheck(big, [band(0, 0), band(90, 150)]).scale).toBe(
      'unknown'
    )
    expect(catalogPriceCheck(big, [band(5, 5)]).scale).toBe('unknown')
    // A catalog in cents is still caught next to a gift card page.
    const cents = [6000, 7500, 8900, 8900, 9500].map((a) => entry(a))
    expect(catalogPriceCheck(cents, [band(10, 500), band(8, 15)]).scale).toBe(
      'too_high'
    )
  })

  it('says when the website shows another currency, without hiding products', () => {
    const products = store()
    const check = catalogPriceCheck(products, [
      site('locale', { language: 'de', currency: 'EUR' }),
      band(1, 5, 'EUR')
    ])
    expect(check.currency).toEqual({
      catalog: 'USD',
      site: 'EUR',
      agrees: false
    })
    // Ranges in two currencies are never compared.
    expect(check.scale).toBe('unknown')
    expect(check.words).toEqual([
      "Your website shows prices in EUR, but your product catalog is in USD. Emails use the catalog's prices."
    ])
    expect(withSanePrices(products, check)).toEqual(products)
  })

  it('never calls "$" prices another currency', () => {
    const cad = [60, 75, 89, 89, 95].map((a) => entry(a, { currency: 'CAD' }))
    const check = catalogPriceCheck(cad, [
      site('locale', { language: 'en', currency: 'USD' }),
      ...twoPages()
    ])
    expect(check.currency).toEqual({
      catalog: 'CAD',
      site: 'USD',
      agrees: null
    })
    expect(check.scale).toBe('ok')
    expect(check.words).toEqual([])
  })

  it('never compares pesos with dollars', () => {
    const mxn = [899, 950, 999, 999, 1100].map((a) =>
      entry(a, { currency: 'MXN' })
    )
    const check = catalogPriceCheck(mxn, [band(25, 45), band(30, 50)])
    expect(check.scale).toBe('unknown')
    expect(withSanePrices(mxn, check)).toEqual(mxn)
  })

  it('prices only products in the catalog’s currency, the store’s own when known', () => {
    const current = store()
    const left = [
      entry(2000, { currency: 'JPY' }),
      entry(3000, { currency: 'JPY' })
    ]
    const check = catalogPriceCheck([...current, ...left], [])
    expect(withSanePrices([...current, ...left], check)).toEqual(current)
    // More leftovers than current products: the catalog read's currency wins.
    const euros = [10, 20, 30, 40].map((a) => entry(a, { currency: 'EUR' }))
    const dollars = [60, 75, 89].map((a) => entry(a))
    const own = catalogPriceCheck([...euros, ...dollars], [], {
      currency: 'USD'
    })
    expect(own.currency.catalog).toBe('USD')
    expect(withSanePrices([...euros, ...dollars], own)).toEqual(dollars)
  })

  it('uses only sure findings from the website', () => {
    const check = catalogPriceCheck(store(), [
      site('locale', { language: 'de', currency: 'EUR' }, { confidence: 0.5 }),
      band(1, 2, 'USD', { source: 'catalog' })
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
    const sure = catalogPriceCheck(products, [], { confirmed: [typo.id] })
    expect(withSanePrices(products, sure)).toEqual(products)
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
