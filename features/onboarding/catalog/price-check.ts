import type { z } from 'zod'
import { topicValues, type Finding } from '@/features/onboarding/findings'
import type { CatalogEntry } from './read'

/**
 * Currency and price check (owner pick #63, ONB-063). The catalog analyst
 * already finds the store's currency from its orders (`currencyCheck`, a
 * mismatch hides every product) and never features a product at no price.
 * This catches what is left before an email shows it:
 *
 * - a product priced far from the rest of the store (a $8,900 shirt in a
 *   store of $89 shirts is usually a price typed in cents);
 * - a whole catalog on another scale from the website (Klaviyo prices about
 *   100 times the site's);
 * - a website that shows another currency than the Klaviyo catalog.
 *
 * Pure and deterministic. Every problem has plain words for the owner; the
 * plan and the email build leave a doubtful price out (`withSanePrices`).
 */

/** How far from the store's usual price a product may be. */
export const outlierFactor = 30
/** How far the catalog's prices may be from the website's. */
export const scaleFactor = 20
/** Fewer priced products than this: no usual price to compare with. */
export const minPriced = 5
/** A site finding surer than this is used. */
export const minConfidence = 0.7

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
    /** Null when either is unknown. */
    agrees: boolean | null
  }
  /** The catalog's prices against the website's price range. */
  scale: 'ok' | 'off' | 'unknown'
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

/** The store's own priced products: no duplicates, no free gifts. */
const priced = (entries: readonly CatalogEntry[]) =>
  entries.filter(
    (e) =>
      Number.isFinite(e.amount) &&
      e.amount > 0 &&
      e.hiddenReason !== 'duplicate'
  )

/** The value of the surest site finding of a topic, if sure enough. */
function siteValue<T extends 'locale' | 'price_band'>(
  findings: readonly Finding[],
  topic: T
): z.infer<(typeof topicValues)[T]> | null {
  const sure = findings
    .filter(
      (f) =>
        f.source === 'site' &&
        f.topic === topic &&
        f.confidence >= minConfidence
    )
    .sort((a, b) => b.confidence - a.confidence)
  for (const f of sure) {
    const value = topicValues[topic].safeParse(f.value)
    if (value.success) return value.data as z.infer<(typeof topicValues)[T]>
  }
  return null
}

/**
 * Products priced at least `outlierFactor` times above or below the store's
 * usual price. Needs `minPriced` priced products, so a small catalog's
 * honest range is never called wrong.
 */
export function priceSuspects(
  entries: readonly CatalogEntry[]
): PriceSuspect[] {
  const list = priced(entries)
  if (list.length < minPriced) return []
  const usual = median(list.map((e) => e.amount))
  return list.flatMap((e): PriceSuspect[] => {
    const usualText = format(usual, e.currency)
    if (e.amount >= usual * outlierFactor)
      return [
        {
          id: e.id,
          title: e.title,
          amount: e.amount,
          reason: 'far_above',
          words: `"${e.title}" costs ${e.price}, far more than your other products (most are around ${usualText}). Check its price in Klaviyo.`
        }
      ]
    if (e.amount * outlierFactor <= usual)
      return [
        {
          id: e.id,
          title: e.title,
          amount: e.amount,
          reason: 'far_below',
          words: `"${e.title}" costs ${e.price}, far less than your other products (most are around ${usualText}). Check its price in Klaviyo.`
        }
      ]
    return []
  })
}

/**
 * The whole check: the catalog's own outliers, its scale against the
 * website's price range, and the two currencies.
 */
export function catalogPriceCheck(
  entries: readonly CatalogEntry[],
  findings: readonly Finding[]
): CatalogPriceCheck {
  const list = priced(entries)
  const usual = list.length ? median(list.map((e) => e.amount)) : null
  const catalogCurrency = list[0]?.currency ?? entries[0]?.currency ?? null
  const locale = siteValue(findings, 'locale')
  const band = siteValue(findings, 'price_band')
  const siteCurrency = locale?.currency ?? band?.currency ?? null
  const agrees =
    catalogCurrency && siteCurrency ? catalogCurrency === siteCurrency : null
  // Compare scales only in one currency, with a real site range.
  let scale: CatalogPriceCheck['scale'] = 'unknown'
  if (
    usual !== null &&
    list.length >= minPriced &&
    band &&
    band.currency === catalogCurrency &&
    band.max > 0
  ) {
    const siteMid = (band.min + band.max) / 2
    const ratio = usual / siteMid
    scale = ratio >= scaleFactor || ratio * scaleFactor <= 1 ? 'off' : 'ok'
  }
  const suspects = scale === 'off' ? [] : priceSuspects(entries)
  const words: string[] = []
  if (scale === 'off' && band && usual !== null && catalogCurrency)
    words.push(
      `Your Klaviyo prices (most around ${format(usual, catalogCurrency)}) do not match your website (${format(band.min, catalogCurrency)} to ${format(band.max, catalogCurrency)}). They may be in cents. Check your Klaviyo catalog before emails show prices.`
    )
  if (agrees === false)
    words.push(
      `Your website shows prices in ${siteCurrency}, but your Klaviyo catalog is in ${catalogCurrency}. Emails use the Klaviyo prices.`
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
  if (check.scale === 'off') return []
  const doubtful = new Set(check.suspects.map((s) => s.id))
  return entries.filter((e) => !doubtful.has(e.id))
}
