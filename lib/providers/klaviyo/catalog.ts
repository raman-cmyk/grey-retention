import 'server-only'
import { z } from 'zod'
import { probes } from './check-key'
import { KlaviyoError, type KlaviyoClient, type KlaviyoScope } from './client'

/**
 * Reads of a Klaviyo account's catalog and store events (ONB-102), with the
 * KLV-001 client. Every read is read-only and bounded: a page is asked for
 * only while `more()` allows it (the caller's time), and never more than a
 * set number of pages. A record Klaviyo sends in a shape we do not know is
 * skipped and counted, never trusted.
 *
 * Klaviyo's catalog API shows only catalogs sent to it directly (a custom
 * integration); a Shopify store's catalog is usually not there, so the
 * products are then built from the store's own events (Viewed Product and
 * Placed Order).
 */

/** Asks whether there is time for one more page. */
export type MorePages = () => boolean

export type CatalogVariant = {
  id: string
  title: string
  sku: string | null
  price: number | null
  /** Units in stock; null when Klaviyo does not say. */
  stock: number | null
  image: string | null
  published: boolean
}

export type CatalogItem = {
  id: string
  externalId: string
  title: string
  url: string | null
  image: string | null
  price: number | null
  /** A compare-at price the catalog carries in its custom fields, if any. */
  compareAt: number | null
  published: boolean
  created: string | null
  variants: CatalogVariant[]
  /** Some of its variants were not in the answer: its stock is unknown. */
  variantsMissing: boolean
}

export type StoreEvent = {
  /** ISO time of the event. */
  at: string
  props: Record<string, unknown>
}

export type PagedRead<T> = {
  records: T[]
  /** False when the read stopped before the last page (time or page cap). */
  complete: boolean
  /** Records skipped because their shape was unknown. */
  skipped: number
}

/** At most this many pages of the catalog (100 items a page). */
export const maxCatalogPages = 10
/** At most this many pages of one metric's events (200 a page). */
export const maxEventPages = 8
/** At most this many pages of metrics. */
const maxMetricPages = 5

export const catalogItemsPath =
  '/api/catalog-items?fields[catalog-item]=external_id,title,url,image_full_url,price,custom_metadata,published,created' +
  '&fields[catalog-variant]=title,sku,price,inventory_quantity,image_full_url,published&include=variants'
export const metricsPath = '/api/metrics?fields[metric]=name,integration'
/** The account (its currency and locale), as KLV-001's key check reads it. */
export const accountPath = probes['accounts:read']

export function eventsPath(metricId: string, since: Date) {
  if (!/^[A-Za-z0-9]{1,64}$/.test(metricId))
    throw new KlaviyoError('invalid_response', { endpoint: '/api/metrics/' })
  const after = since.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return (
    `/api/events?fields[event]=event_properties,datetime` +
    `&filter=equals(metric_id,"${metricId}"),greater-than(datetime,${after})&sort=-datetime`
  )
}

const text = z.string().trim().min(1).max(2000)
const money = z.number().finite().nonnegative().max(10_000_000)
const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.toString()
      : null
  } catch {
    return null
  }
}
const pageLinks = z.object({ next: z.string().nullish() }).partial().nullish()
export const page = z.object({
  data: z.array(z.unknown()),
  included: z.array(z.unknown()).optional(),
  links: pageLinks
})

const variantRecord = z.object({
  type: z.literal('catalog-variant'),
  id: text,
  attributes: z.object({
    title: z.string().max(2000).nullish(),
    sku: z.string().max(200).nullish(),
    price: money.nullish(),
    inventory_quantity: z.number().int().nullish(),
    image_full_url: z.string().nullish(),
    published: z.boolean().nullish()
  })
})
const itemRecord = z.object({
  type: z.literal('catalog-item'),
  id: text,
  attributes: z.object({
    external_id: z.string().max(400).nullish(),
    title: text,
    url: z.string().nullish(),
    image_full_url: z.string().nullish(),
    price: money.nullish(),
    custom_metadata: z.record(z.string(), z.unknown()).nullish(),
    published: z.boolean().nullish(),
    created: z.string().nullish()
  }),
  relationships: z
    .object({
      variants: z
        .object({ data: z.array(z.object({ id: text })).nullish() })
        .nullish()
    })
    .nullish()
})

/** A compare-at price from a catalog item's custom fields, if it has one. */
function customCompareAt(meta: Record<string, unknown> | null | undefined) {
  for (const name of ['compare_at_price', 'compareAtPrice', 'CompareAtPrice']) {
    const value = meta?.[name]
    const parsed = money.safeParse(
      typeof value === 'string' ? Number(value) : value
    )
    if (parsed.success && parsed.data > 0) return parsed.data
  }
  return null
}

/** Klaviyo's id of a catalog item without its integration and catalog. */
function shortId(id: string, externalId: string | null | undefined) {
  const own = externalId?.trim()
  const raw = own || id.split(':::').pop() || id
  return raw.replace(/[^A-Za-z0-9$:._-]/g, '_').slice(0, 120)
}

/** Follows `links.next` while allowed; parses each page's records. */
export async function readPages<T>(
  client: KlaviyoClient,
  first: string,
  scope: KlaviyoScope,
  maxPages: number,
  more: MorePages,
  parse: (body: z.infer<typeof page>) => { records: T[]; skipped: number }
): Promise<PagedRead<T>> {
  const records: T[] = []
  let skipped = 0
  let body = page.safeParse(await client.get(first, scope))
  for (let pages = 1; ; pages++) {
    if (!body.success)
      throw new KlaviyoError('invalid_response', {
        endpoint: new URL(first, 'https://a.klaviyo.com').pathname
      })
    const parsed = parse(body.data)
    records.push(...parsed.records)
    skipped += parsed.skipped
    const next = body.data.links?.next
    if (!next) return { records, complete: true, skipped }
    if (pages >= maxPages || !more())
      return { records, complete: false, skipped }
    body = page.safeParse(await client.next(next, scope))
  }
}

/** The catalog, with each item's variants. */
export function readCatalogItems(
  client: KlaviyoClient,
  more: MorePages
): Promise<PagedRead<CatalogItem>> {
  return readPages(
    client,
    catalogItemsPath,
    'catalogs:read',
    maxCatalogPages,
    more,
    (body) => {
      const variants = new Map<string, CatalogVariant>()
      let skipped = 0
      for (const raw of body.included ?? []) {
        const v = variantRecord.safeParse(raw)
        // A variant we cannot read makes the read incomplete.
        if (!v.success) {
          skipped++
          continue
        }
        const a = v.data.attributes
        variants.set(v.data.id, {
          id: v.data.id,
          title: a.title?.trim() ?? '',
          sku: a.sku?.trim() || null,
          price: a.price ?? null,
          stock:
            a.inventory_quantity === null || a.inventory_quantity === undefined
              ? null
              : Math.max(0, a.inventory_quantity),
          image: httpsUrl(a.image_full_url),
          published: a.published !== false
        })
      }
      const records: CatalogItem[] = []
      let related = false
      for (const raw of body.data) {
        const item = itemRecord.safeParse(raw)
        if (!item.success) {
          skipped++
          continue
        }
        const a = item.data.attributes
        const ids = item.data.relationships?.variants?.data
        if (ids) related = true
        const own = (ids ?? []).flatMap(({ id }) => {
          const v = variants.get(id)
          return v ? [v] : []
        })
        records.push({
          id: item.data.id,
          externalId: shortId(item.data.id, a.external_id),
          title: a.title,
          url: httpsUrl(a.url),
          image: httpsUrl(a.image_full_url),
          price: a.price ?? null,
          compareAt: customCompareAt(a.custom_metadata),
          published: a.published !== false,
          created: z.iso.datetime({ offset: true }).safeParse(a.created).success
            ? a.created!
            : null,
          variants: own,
          variantsMissing: own.length < (ids?.length ?? 0)
        })
      }
      // Variants sent without saying whose they are: the read is not whole.
      if (variants.size > 0 && !related) skipped++
      return { records, skipped }
    }
  )
}

const metricRecord = z.object({
  type: z.literal('metric'),
  id: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  attributes: z.object({
    name: z.string(),
    integration: z
      .object({ name: z.string().nullish() })
      .passthrough()
      .nullish()
  })
})

export type StoreMetrics = {
  placedOrder: string | null
  viewedProduct: string | null
  /** False when not every page of metrics was read. */
  complete: boolean
}

/** Store platforms whose own metrics are preferred, in this order. */
const storePlatforms = [
  'shopify',
  'woocommerce',
  'bigcommerce',
  'magento',
  'salesforce commerce cloud',
  'wix',
  'squarespace'
]

/**
 * The store's Placed Order and Viewed Product metrics; a store's own
 * integration (Shopify, WooCommerce…) is preferred over one sent by hand.
 */
export async function findStoreMetrics(
  client: KlaviyoClient,
  more: MorePages
): Promise<StoreMetrics> {
  const read = await readPages(
    client,
    metricsPath,
    'metrics:read',
    maxMetricPages,
    more,
    (body) => {
      let skipped = 0
      const records = body.data.flatMap((raw) => {
        const m = metricRecord.safeParse(raw)
        if (m.success) return [m.data]
        skipped++
        return []
      })
      return { records, skipped }
    }
  )
  // A store platform's own metric first, then another integration's, then
  // one sent through the API.
  const rank = (m: (typeof read.records)[number]) => {
    const source = (m.attributes.integration?.name ?? '').toLowerCase()
    const platform = storePlatforms.indexOf(source)
    return platform >= 0
      ? platform
      : source && source !== 'api'
        ? storePlatforms.length
        : storePlatforms.length + 1
  }
  const pick = (name: string) =>
    read.records
      .filter((m) => m.attributes.name === name)
      .sort((a, b) => rank(a) - rank(b))[0]?.id ?? null
  return {
    placedOrder: pick('Placed Order'),
    viewedProduct: pick('Viewed Product'),
    complete: read.complete && read.skipped === 0
  }
}

const eventRecord = z.object({
  type: z.literal('event'),
  attributes: z.object({
    datetime: z.iso.datetime({ offset: true }),
    // Klaviyo may send no properties: the event then says nothing.
    event_properties: z.record(z.string(), z.unknown()).nullish()
  })
})

/** One metric's events since `since`, newest first. */
export function readEvents(
  client: KlaviyoClient,
  metricId: string,
  since: Date,
  more: MorePages,
  maxPages = maxEventPages
): Promise<PagedRead<StoreEvent>> {
  return readPages(
    client,
    eventsPath(metricId, since),
    'events:read',
    maxPages,
    more,
    (body) => {
      let skipped = 0
      const records = body.data.flatMap((raw) => {
        const e = eventRecord.safeParse(raw)
        if (!e.success) {
          skipped++
          return []
        }
        return [
          {
            at: new Date(e.data.attributes.datetime).toISOString(),
            props: e.data.attributes.event_properties ?? {}
          }
        ]
      })
      return { records, skipped }
    }
  )
}

const accountLocale = z.object({
  data: z
    .array(
      z.object({
        attributes: z.object({
          locale: z.string().nullish(),
          preferred_currency: z.string().nullish()
        })
      })
    )
    .min(1)
})

/** The account's currency and language (en-US → en), when well-formed. */
export function storeLocale(body: unknown): {
  currency: string | null
  language: string | null
} {
  const parsed = accountLocale.safeParse(body)
  if (!parsed.success)
    throw new KlaviyoError('invalid_response', { endpoint: '/api/accounts/' })
  const a = parsed.data.data[0]!.attributes
  const currency = a.preferred_currency?.trim().toUpperCase() ?? ''
  const language = (a.locale ?? '').trim().slice(0, 2).toLowerCase()
  return {
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    language: /^[a-z]{2}$/.test(language) ? language : null
  }
}
