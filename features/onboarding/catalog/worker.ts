import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { Ask } from '@/features/intelligence/passes'
import {
  accountPath,
  findStoreMetrics,
  readCatalogItems,
  readEvents,
  storeLocale,
  type CatalogItem,
  type PagedRead,
  type StoreEvent
} from '@/lib/providers/klaviyo/catalog'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import { findingInput, type FindingInput } from '../findings'
import { analyseCatalog, analystInput, type CatalogAnalysis } from './analyst'
import {
  currencyCheck,
  finishCatalog,
  fromCatalogItems,
  fromEvents,
  orderCurrency,
  priceBand,
  salesFrom,
  salesWindowDays,
  withSales
} from './clean'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The whole read, so it ends well inside the job's 90-second lease. */
export const catalogRunMs = 30_000
/** The longest one Klaviyo request may take in a catalog read. */
export const klaviyoCallMs = 6_000
/** Pages of views read before the orders, when the views are the catalog. */
export const viewPagesFirst = 5

export type CatalogRun = {
  state: 'ready' | 'empty'
  source: 'api' | 'events' | null
  products: number
  featurable: number
  findings: number
  complete: boolean
  live: boolean
  analysis: 'done' | 'skipped'
}

const day = 86_400_000
const none: PagedRead<never> = { records: [], complete: true, skipped: 0 }

/** Money in words, in the store's currency: "$89.00". */
const priceWords = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/**
 * The Catalog analyst's job (ONB-102): reads the account (its currency and
 * language), the Klaviyo catalog, or, when the catalog API shows nothing
 * (a Shopify store), the products of the Viewed Product events, and the
 * Placed Order events of the last 90 days; cleans the catalog in code;
 * asks the analyst for duplicates and what the brand sells; and stores it
 * all at once (`record_catalog_reading`, which also finishes the job).
 *
 * A page of Klaviyo is asked for only while there is time for it and the
 * analyst's call; a read cut short is stored as incomplete (nothing is
 * retired then). An empty catalog is stored as "no products" and logged
 * (D16). A failed analysis leaves the products without it. Klaviyo
 * refusing the key, a scope or the pace throws (`KlaviyoError`): the job
 * is paused by its runner.
 */
export async function readBrandCatalog(
  db: Db,
  job: Job,
  deps: {
    client: KlaviyoClient
    live: boolean
    ask: Ask | null
    callMs: number
    klaviyoMs?: number
    now?: () => number
  }
): Promise<CatalogRun> {
  const now = deps.now ?? Date.now
  const started = now()
  const deadline = started + catalogRunMs
  const klaviyoMs = deps.klaviyoMs ?? klaviyoCallMs
  const more = () => now() + klaviyoMs + deps.callMs <= deadline
  const brand = await db
    .from('brand_profiles')
    .select('brand_name')
    .eq('tenant_id', job.tenant_id)
    .single()
  if (brand.error) throw brand.error

  const account = storeLocale(
    await deps.client.get(accountPath, 'accounts:read')
  )
  const since = new Date(started - salesWindowDays * day)
  const unread: PagedRead<never> = { records: [], complete: false, skipped: 0 }

  let items: PagedRead<CatalogItem> = unread
  if (more())
    try {
      items = await readCatalogItems(deps.client, more)
    } catch (error) {
      // Klaviyo refusing this read (a changed shape or query, or a key
      // without the Catalogs scope) is not the end: the events still show
      // the products. The read is then not whole.
      const usable =
        error instanceof KlaviyoError &&
        (['rejected', 'invalid_response'].includes(error.kind) ||
          (error.kind === 'missing_scope' &&
            error.details.scope === 'catalogs:read'))
      if (!usable) throw error
      logger.warn('Catalog read: Klaviyo catalog unreadable, using events', {
        kind: error.kind,
        status: error.details.status ?? 0,
        code: error.details.code ?? 'none'
      })
    }
  const fromApi = items.records.length > 0
  const metrics = more()
    ? await findStoreMetrics(deps.client, more)
    : { placedOrder: null, viewedProduct: null, complete: false }
  // Without the catalog, the views show the products: they are read first,
  // so a slow answer never leaves only the orders (which have no pages).
  const views: PagedRead<StoreEvent> = fromApi
    ? none
    : metrics.viewedProduct && more()
      ? await readEvents(
          deps.client,
          metrics.viewedProduct,
          since,
          more,
          viewPagesFirst
        )
      : metrics.viewedProduct
        ? unread
        : none
  const orders: PagedRead<StoreEvent> =
    metrics.placedOrder && more()
      ? await readEvents(deps.client, metrics.placedOrder, since, more)
      : metrics.placedOrder
        ? unread
        : none
  const skipped = items.skipped + orders.skipped + views.skipped
  const read =
    items.complete &&
    metrics.complete &&
    orders.complete &&
    views.complete &&
    skipped === 0

  const orderMoney = orderCurrency(orders.records)
  const currency = account.currency ?? orderMoney.currency
  if (!currency) {
    logger.warn('Catalog read: no currency in the account or the orders')
    throw Object.assign(new Error('No store currency'), { code: 'no_currency' })
  }
  const check = account.currency
    ? currencyCheck(account.currency, orderMoney)
    : 'unverified'
  const raw = fromApi
    ? fromCatalogItems(items.records, started)
    : fromEvents(views.records, orders.records, started)
  const listed = withSales(raw, salesFrom(orders.records, started))

  // Nothing found before the time ran out is not "no products": the read
  // is tried again later, and nothing earlier is replaced.
  if (!listed.length && !read) {
    logger.warn('Catalog read: no products found before the time ran out', {
      live: deps.live
    })
    throw new KlaviyoError('unavailable', { endpoint: '/api/events/' })
  }

  let analysis: CatalogAnalysis = { answered: false, reason: 'no_products' }
  if (listed.length && !deps.ask)
    analysis = { answered: false, reason: 'no_model' }
  else if (listed.length && now() + deps.callMs > deadline)
    analysis = { answered: false, reason: 'time_up' }
  else if (listed.length && deps.ask)
    analysis = await analyseCatalog(
      analystInput(brand.data.brand_name, currency, listed),
      listed,
      deps.ask,
      `catalog:${job.id}`
    )
  if (!analysis.answered && analysis.reason !== 'no_products')
    logger.info('Catalog read: analysis skipped', { reason: analysis.reason })

  const { records, leftOut, truncated } = finishCatalog(listed, {
    currency,
    currencyCheck: check,
    duplicates: analysis.answered ? analysis.duplicates : [],
    now: started
  })
  // Products were found but none could be stored (no page, no price…):
  // something is off, and nothing earlier is retired.
  if (!records.length && leftOut > 0) {
    logger.warn('Catalog read: no product could be stored', { leftOut })
    throw Object.assign(new Error('No storable product'), {
      code: 'no_storable_product'
    })
  }
  const state = records.length ? 'ready' : 'empty'
  const source = state === 'ready' ? (fromApi ? 'api' : 'events') : null
  const pass = (counted: boolean) =>
    !deps.live ? 'sample' : counted ? 'code' : 'model'
  const ref = `klaviyo:${fromApi ? 'catalog' : 'events'}`
  const findings: (FindingInput & {
    pass: 'sample' | 'model' | 'code'
    model: string | null
  })[] = []
  // A price band only in the store's own currency.
  const band =
    state === 'ready' && check !== 'mismatch' ? priceBand(records) : null
  if (band)
    findings.push({
      topic: 'price_band',
      statement:
        band.min === band.max
          ? `Products cost about ${priceWords(band.min, currency)}.`
          : `Most products cost between ${priceWords(band.min, currency)} and ${priceWords(band.max, currency)}.`,
      value: { min: band.min, max: band.max, currency },
      evidence: { ref },
      confidence: fromApi ? 0.9 : 0.75,
      pass: pass(true),
      model: null
    })
  if (state === 'ready' && account.language && check !== 'mismatch')
    findings.push({
      topic: 'locale',
      statement: `The store sells in ${currency}, in ${languageName(account.language)}.`,
      value: { language: account.language, currency },
      evidence: { ref: 'klaviyo:account' },
      confidence: check === 'matched' ? 0.95 : 0.8,
      pass: pass(true),
      model: null
    })
  // The sample rules only for the sample catalog, a model's words only for
  // a live one.
  if (
    state === 'ready' &&
    analysis.answered &&
    analysis.offering &&
    (analysis.pass === 'model') === deps.live
  )
    findings.push({
      topic: 'offering',
      statement: analysis.offering.statement,
      value: {},
      evidence: { ref },
      confidence: analysis.offering.confidence,
      pass: pass(false),
      model: analysis.model
    })
  // A finding that does not hold its topic's shape is left out, never sent.
  const kept = findings.filter((f) => findingInput.safeParse(f).success)
  if (kept.length < findings.length)
    logger.warn('Catalog read: findings left out', {
      count: findings.length - kept.length
    })

  const oldest = (events: StoreEvent[]) =>
    events.reduce<string | null>((o, e) => (!o || e.at < o ? e.at : o), null)
  const window = {
    since: since.toISOString(),
    orders: orders.records.length,
    views: views.records.length,
    ...(oldest(orders.records) ? { oldestOrder: oldest(orders.records) } : {}),
    ...(oldest(views.records) ? { oldestView: oldest(views.records) } : {})
  }
  const complete = read && !truncated
  const summary = {
    state,
    ...(source ? { source } : {}),
    currency,
    currencyCheck: check,
    complete,
    window,
    ...(state === 'empty'
      ? { reason: 'no_products' }
      : check === 'mismatch'
        ? { reason: 'currency_mismatch' }
        : {})
  }
  const featurable = records.filter((r) => r.featurable).length
  logger.info('Catalog read', {
    state,
    source: source ?? 'none',
    products: records.length,
    featurable,
    leftOut,
    skipped,
    complete,
    currencyCheck: check,
    live: deps.live
  })
  if (state === 'empty')
    logger.warn('Catalog read: no products', { live: deps.live })
  const stored = await db.rpc('record_catalog_reading', {
    job: job.id,
    lease: job.lease_token!,
    products: records as unknown as Json,
    findings: kept as unknown as Json,
    summary: summary as unknown as Json,
    live: deps.live
  })
  if (stored.error) throw stored.error
  return {
    state,
    source,
    products: records.length,
    featurable,
    findings: kept.length,
    complete,
    live: deps.live,
    analysis: analysis.answered ? 'done' : 'skipped'
  }
}
