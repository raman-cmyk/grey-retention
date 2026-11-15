import type { z } from 'zod'
import { topicValues, type Finding } from '@/features/onboarding/findings'
import { minorUnits } from './clean'
import type { CatalogEntry } from './read'

/**
 * Currency and price check (owner pick #63, ONB-063). The catalog analyst
 * already finds the store's currency from its orders (`currencyCheck`, a
 * mismatch hides every product) and never features a product at no price.
 * This catches what is left before an email shows a price:
 *
 * - a product priced far from the rest of the store (a $8,900 shirt in a
 *   store of $89 shirts is usually a price typed in cents);
 * - a whole catalog on another scale from the website (its usual price far
 *   outside every price the website showed);
 * - a website that shows another currency than the catalog.
 *
 * Pure and deterministic. Pass the whole catalog (`listCatalog` without
 * `featurableOnly`), so the usual price is the store's own. Every problem
 * has plain words for the owner; the plan and the email build leave a
 * doubtful price out (`withSanePrices`) unless the owner said it is right.
 */

/** How far from the store's usual price a product may be. */
export const outlierFactor = 30
/** How far outside the website's prices the catalog's usual price may be. */
export const scaleFactor = 20
/** Fewer priced products than this: no usual price to judge one by. */
export const minPriced = 5
/** Site findings at least this sure are used. */
export const minConfidence = 0.7

/** Currencies written with "$": a site read as USD may be any of them. */
const dollars = new Set(['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'])
const sameFamily = (a: string, b: string) =>
  a === b || (dollars.has(a) && dollars.has(b))

export type PriceSuspect = {
  id: string
  title: string
  amount: number
  reason: 'far_above' | 'far_below'
  words: string
}

export type CatalogPriceCheck = {
  /** The usual price: the middle one of the store's priced products. */
  usual: number | null
  currency: {
    catalog: string | null
    site: string | null
    /** Null when either is unknown, or both are written "$". */
    agrees: boolean | null
  }
  /** The catalog's prices against every price the website showed. */
  scale: 'ok' | 'too_high' | 'too_low' | 'unknown'
  suspects: PriceSuspect[]
  /** Plain words for the owner, the catalog's problems first. */
  words: string[]
}

function format(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The store's own priced products in its main currency: no duplicates, no
 * free gifts, and none left in another currency by an earlier read.
 */
function priced(entries: readonly CatalogEntry[]) {
  const list = entries.filter(
    (e) =>
      Number.isFinite(e.amount) &&
      e.amount > 0 &&
      e.hiddenReason !== 'duplicate'
  )
  const counts = new Map<string, number>()
  for (const e of list)
    counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1)
  const main = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )[0]?.[0]
  return {
    currency: main ?? null,
    list: list.filter((e) => e.currency === main)
  }
}

/** The values of the site findings of a topic at least `minConfidence` sure. */
function siteValues<T extends 'locale' | 'price_band'>(
  findings: readonly Finding[],
  topic: T
): z.infer<(typeof topicValues)[T]>[] {
  return findings
    .filter(
      (f) =>
        f.source === 'site' &&
        f.topic === topic &&
        f.confidence >= minConfidence
    )
    .sort((a, b) => b.confidence - a.confidence)
    .flatMap((f) => {
      const value = topicValues[topic].safeParse(f.value)
      return value.success
        ? [value.data as z.infer<(typeof topicValues)[T]>]
        : []
    })
}

/** No email shows these, so the owner is not asked about their prices. */
const unshowable = new Set(['unpublished', 'currency', 'duplicate', 'retired'])

/**
 * Products priced at least `outlierFactor` times above or below the store's
 * usual price. Needs `minPriced` priced products, so a small catalog's
 * honest range is never called wrong. A product the owner confirmed
 * (`confirmed`, its id) and one no email can show are not named.
 */
export function priceSuspects(
  entries: readonly CatalogEntry[],
  { confirmed = [] }: { confirmed?: readonly string[] } = {}
): PriceSuspect[] {
  const { list } = priced(entries)
  if (list.length < minPriced) return []
  const usual = median(list.map((e) => e.amount))
  const sure = new Set(confirmed)
  return list.flatMap((e): PriceSuspect[] => {
    if (sure.has(e.id) || unshowable.has(e.hiddenReason ?? '')) return []
    const usualText = format(usual, e.currency)
    const above = e.amount >= usual * outlierFactor
    const below = e.amount * outlierFactor <= usual
    if (!above && !below) return []
    return [
      {
        id: e.id,
        title: e.title,
        amount: e.amount,
        reason: above ? 'far_above' : 'far_below',
        words: `"${e.title}" costs ${e.price}, far ${above ? 'more' : 'less'} than your other products (most are around ${usualText}). Check its price in your store.`
      }
    ]
  })
}

/**
 * The whole check: the catalog's own outliers, its usual price against
 * every price the website showed (all sure `price_band` findings in the
 * same currency, or one written "$", merged into one range), and the two
 * currencies.
 */
export function catalogPriceCheck(
  entries: readonly CatalogEntry[],
  findings: readonly Finding[],
  options: { confirmed?: readonly string[] } = {}
): CatalogPriceCheck {
  const { list, currency: catalogCurrency } = priced(entries)
  const usual = list.length ? median(list.map((e) => e.amount)) : null
  const allBands = siteValues(findings, 'price_band')
  const bands = allBands.filter(
    (b) =>
      b.max > 0 &&
      catalogCurrency !== null &&
      sameFamily(b.currency, catalogCurrency)
  )
  const siteCurrency =
    siteValues(findings, 'locale')[0]?.currency ?? allBands[0]?.currency ?? null
  const agrees =
    !catalogCurrency || !siteCurrency
      ? null
      : siteCurrency === catalogCurrency
        ? true
        : sameFamily(siteCurrency, catalogCurrency)
          ? null
          : false
  const low = Math.min(...bands.map((b) => b.min))
  const high = Math.max(...bands.map((b) => b.max))
  let scale: CatalogPriceCheck['scale'] = 'unknown'
  if (usual !== null && bands.length)
    scale =
      usual >= high * scaleFactor
        ? 'too_high'
        : usual * scaleFactor <= low
          ? 'too_low'
          : 'ok'
  const off = scale === 'too_high' || scale === 'too_low'
  const suspects = off ? [] : priceSuspects(entries, options)
  const words: string[] = []
  if (off && usual !== null && catalogCurrency) {
    const cents =
      scale === 'too_high' && minorUnits(catalogCurrency) > 1
        ? ' They may be typed in cents.'
        : ''
    words.push(
      `Your product prices (most around ${format(usual, catalogCurrency)}) are far ${scale === 'too_high' ? 'higher' : 'lower'} than on your website (${format(low, catalogCurrency)} to ${format(high, catalogCurrency)}).${cents} Check the prices in your store before emails show them.`
    )
  }
  if (agrees === false)
    words.push(
      `Your website shows prices in ${siteCurrency}, but your product catalog is in ${catalogCurrency}. Emails use the catalog's prices.`
    )
  for (const s of suspects) words.push(s.words)
  return {
    usual,
    currency: { catalog: catalogCurrency, site: siteCurrency, agrees },
    scale,
    suspects,
    words
  }
}

/**
 * The products whose prices an email may show: none when the catalog is
 * on another scale from the website, else all but the suspects. A website
 * in another currency is only said (the orders decide the currency, and a
 * site may show the visitor's own).
 */
export function withSanePrices(
  entries: readonly CatalogEntry[],
  check: CatalogPriceCheck
): CatalogEntry[] {
  if (check.scale === 'too_high' || check.scale === 'too_low') return []
  const doubtful = new Set(check.suspects.map((s) => s.id))
  return entries.filter((e) => !doubtful.has(e.id))
}
