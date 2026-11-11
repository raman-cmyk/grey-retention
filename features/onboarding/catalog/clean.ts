import type { CatalogItem, StoreEvent } from '@/lib/providers/klaviyo/catalog'

/**
 * Cleaning the Klaviyo catalog in code (ONB-102, VISION Step 3): variant
 * suffixes stripped and variants grouped into one product, the currency
 * checked against the account, a photo required, a permanent compare-at
 * price hidden (it would fake a discount), and the bestsellers and new
 * arrivals counted from the store's own events. Only the duplicates and
 * the words about what the brand sells come from the Catalog analyst.
 */

const day = 86_400_000
/** Products featured by default: the top bestsellers and the new ones (VISION §10). */
export const topBestsellers = 20
export const newArrivalDays = 30
/** The events read: the last 90 days. */
export const salesWindowDays = 90
/** At most this many products are kept from one read. */
export const maxProducts = 500

/** A product as read, before cleaning. */
export type RawProduct = {
  externalId: string
  title: string
  url: string | null
  image: string | null
  /** In major units of the store currency. */
  price: number | null
  compareAt: number | null
  /** Seen at its full price earlier in the window, and lower now. */
  saleSeen: boolean
  published: boolean
  /** When it was added to the store, if known. */
  launchedAt: string | null
  stock: number | null
  variantCount: number
  /** Ids of items merged into this one (listed one per variant). */
  otherIds?: string[]
}

export type Sales = { units30d: number; units90d: number }
export type Listed = RawProduct & Sales

/** One product as `record_catalog_reading` stores it. */
export type CatalogRecord = {
  externalId: string
  title: string
  url: string
  priceMinor: number
  currency: string
  imageUrl: string | null
  compareAtMinor: number | null
  compareAtIsSale: boolean
  featurable: boolean
  hiddenReason:
    'no_image' | 'currency' | 'duplicate' | 'unpublished' | 'not_picked' | null
  units30d: number
  units90d: number
  bestsellerRank: number | null
  launchedAt: string | null
  newArrival: boolean
  stock: number | null
  variantCount: number
}

/** Words that name a variant option: a size, a colour, an amount. */
const optionWord =
  /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|small|medium|large|extra large|x-large|one size|os|default title|default|regular|tall|petite|\d+(\.\d+)?\s?(ml|l|g|kg|oz|lb|cm|mm|in|pack|pcs|ct)?|pack of \d+|\d+\s?-?\s?pack|black|white|grey|gray|navy|blue|red|green|olive|sand|beige|brown|pink|purple|yellow|orange|cream|natural|charcoal|tan|khaki|ivory|silver|gold|stone|rust|forest|sky|denim|oat|clay)$/

function optionList(value: string) {
  const parts = value
    .split(/\s*[/,]\s*|\s+-\s+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  return (
    parts.length > 0 &&
    parts.every(
      (p) =>
        optionWord.test(p) ||
        p.split(/\s+/).every((word) => optionWord.test(word))
    )
  )
}

/**
 * A product title without its variant: "Weekend Knit - Navy / L" and
 * "Field Overshirt (M)" become "Weekend Knit" and "Field Overshirt"; a
 * title whose ending is not an option ("Gift Card - $50", "T-Shirt") stays.
 */
export function baseTitle(title: string) {
  let t = title.replace(/\s+/g, ' ').trim()
  const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(t)
  if (paren && optionList(paren[2]!)) t = paren[1]!
  const separator = /\s+[-–—|]\s+/g
  for (let m = separator.exec(t); m; m = separator.exec(t))
    if (optionList(t.slice(m.index + m[0].length))) {
      t = t.slice(0, m.index).trim()
      break
    }
  return t
}

const key = (title: string) => baseTitle(title).toLowerCase()
const pathOf = (url: string | null) => {
  if (!url) return ''
  try {
    return new URL(url).pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}
const idOf = (value: unknown) => {
  const raw =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''
  return /^[A-Za-z0-9$:._-]{1,120}$/.test(raw) ? raw : null
}
const numberOf = (value: unknown) => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e7
    ? n
    : null
}
const httpsOf = (value: unknown) => {
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
const textOf = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null
/** A product photo: https, and not a store's "no image" placeholder. */
const imageOf = (value: unknown) => {
  const url = httpsOf(value)
  return url && !/\/no-image|no_image|placeholder/i.test(url) ? url : null
}

/**
 * A price as a number: 89, "89.00", or a store's formatted money such as
 * "$89.00", "1.299,00 €", "Rs. 1,299" or "<span class=money>$89.00</span>"
 * (Shopify's Viewed Product sends its money format). The last separator
 * followed by one or two digits is the decimal point; others group
 * thousands.
 */
export function moneyOf(value: unknown): number | null {
  if (typeof value === 'number') return numberOf(value)
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ')
  const raw = /\d[\d.,\s']*/.exec(text)?.[0]?.replace(/[\s']/g, '') ?? ''
  if (!raw) return null
  const last = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','))
  const decimals = last >= 0 ? raw.length - last - 1 : 0
  const whole =
    last >= 0 && decimals >= 1 && decimals <= 2
      ? `${raw.slice(0, last).replace(/[.,]/g, '')}.${raw.slice(last + 1)}`
      : raw.replace(/[.,]/g, '')
  return numberOf(Number(whole))
}

/**
 * Klaviyo catalog items as products: an item's variants are its own (the
 * lowest price, the stock added up when every variant says it), and items
 * that are one product listed per variant (the same title without the
 * variant, the same page) become one product.
 */
export function fromCatalogItems(
  items: CatalogItem[],
  now: number
): RawProduct[] {
  const products = new Map<string, RawProduct>()
  for (const item of items) {
    const prices = item.variants
      .map((v) => v.price)
      .filter((p): p is number => p !== null)
    const stocks = item.variants.map((v) => v.stock)
    const product: RawProduct = {
      externalId: item.externalId,
      title: baseTitle(item.title),
      url: item.url,
      image: item.image ?? item.variants.find((v) => v.image)?.image ?? null,
      price: item.price ?? (prices.length ? Math.min(...prices) : null),
      compareAt: item.compareAt,
      saleSeen: false,
      published:
        item.published &&
        (item.variants.length === 0 || item.variants.some((v) => v.published)),
      launchedAt: item.created,
      stock:
        !item.variantsMissing &&
        stocks.length > 0 &&
        stocks.every((s) => s !== null)
          ? stocks.reduce<number>((sum, s) => sum + (s ?? 0), 0)
          : null,
      variantCount: Math.max(1, item.variants.length)
    }
    const same = `${key(item.title)}|${pathOf(item.url)}`
    const known = products.get(same)
    if (!known) {
      products.set(same, product)
      continue
    }
    known.variantCount = Math.min(
      500,
      known.variantCount + product.variantCount
    )
    known.stock =
      known.stock !== null && product.stock !== null
        ? known.stock + product.stock
        : null
    known.price =
      known.price === null
        ? product.price
        : product.price === null
          ? known.price
          : Math.min(known.price, product.price)
    known.image ??= product.image
    known.published ||= product.published
    known.otherIds = [...(known.otherIds ?? []), product.externalId]
    if (
      product.launchedAt &&
      (!known.launchedAt ||
        Date.parse(product.launchedAt) < Date.parse(known.launchedAt))
    )
      known.launchedAt = product.launchedAt
  }
  // An item's date is when it reached Klaviyo: it says when the product
  // was added only for a catalog that has been in Klaviyo long enough.
  const dates = items
    .map((i) => (i.created ? Date.parse(i.created) : NaN))
    .filter((t) => Number.isFinite(t))
  const settled = dates.length > 0 && Math.min(...dates) <= now - 60 * day
  return [...products.values()].map((p) =>
    settled ? p : { ...p, launchedAt: null }
  )
}

type Line = {
  id: string
  title: string | null
  quantity: number
  price: number | null
  url: string | null
  image: string | null
  variant: string | null
}

/**
 * The products of one order: Shopify's own line items (`$extra.line_items`)
 * or the line items an integration sends (`Items` of objects).
 */
export function orderLines(props: Record<string, unknown>): Line[] {
  const extra = props.$extra as { line_items?: unknown } | undefined
  const shopify = Array.isArray(extra?.line_items) ? extra.line_items : null
  const items = Array.isArray(props.Items) ? props.Items : null
  const lines: Line[] = []
  for (const raw of shopify ?? items ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const l = raw as Record<string, unknown>
    const id = idOf(shopify ? l.product_id : l.ProductID)
    const quantity = numberOf(shopify ? l.quantity : l.Quantity)
    if (!id || quantity === null || !Number.isInteger(quantity) || quantity < 1)
      continue
    lines.push({
      id,
      title: textOf(shopify ? l.title : l.ProductName),
      quantity: Math.min(quantity, 1000),
      price: moneyOf(shopify ? l.price : l.ItemPrice),
      url: shopify ? null : httpsOf(l.ProductURL),
      image: shopify
        ? imageOf(
            (l.product as { images?: { src?: unknown }[] } | undefined)
              ?.images?.[0]?.src
          )
        : imageOf(l.ImageURL),
      variant: textOf(shopify ? l.variant_title : l.SKU)
    })
  }
  return lines
}

/** Units sold per product id in the last 30 and 90 days. */
export function salesFrom(orders: StoreEvent[], now: number) {
  const sales = new Map<string, Sales & { titles: Set<string> }>()
  for (const order of orders) {
    const age = now - Date.parse(order.at)
    if (!(age >= 0 && age <= salesWindowDays * day)) continue
    for (const line of orderLines(order.props)) {
      const s = sales.get(line.id) ?? {
        units30d: 0,
        units90d: 0,
        titles: new Set<string>()
      }
      s.units90d += line.quantity
      if (age <= 30 * day) s.units30d += line.quantity
      if (line.title) s.titles.add(key(line.title))
      sales.set(line.id, s)
    }
  }
  return sales
}

/**
 * Products from the store's events, for a catalog Klaviyo's API cannot
 * show: each product as its latest Viewed Product event shows it, and those
 * only ordered from their order lines. A product first seen in the last 30
 * days of a window that reaches back at least 60 days is new.
 */
export function fromEvents(
  views: StoreEvent[],
  orders: StoreEvent[],
  now: number
): RawProduct[] {
  type Seen = RawProduct & {
    first: string
    firstView: string | null
    firstOrder: string | null
    titles: Map<string, number>
    variants: Set<string>
    prices: number[]
  }
  const seen = new Map<string, Seen>()
  const add = (
    id: string,
    at: string,
    stream: 'view' | 'order',
    fields: {
      title: string | null
      url: string | null
      image: string | null
      price: number | null
      compareAt: number | null
      variant: string | null
    }
  ) => {
    let s = seen.get(id)
    if (!s) {
      s = {
        externalId: id,
        title: '',
        url: null,
        image: null,
        price: null,
        compareAt: null,
        saleSeen: false,
        published: true,
        launchedAt: null,
        stock: null,
        variantCount: 1,
        first: at,
        firstView: null,
        firstOrder: null,
        titles: new Map(),
        variants: new Set(),
        prices: []
      }
      seen.set(id, s)
    }
    // Events come newest first: the first values seen are the current ones.
    s.url ??= fields.url
    s.image ??= fields.image
    if (s.price === null && fields.price !== null) {
      s.price = fields.price
      s.compareAt = fields.compareAt
    }
    if (fields.price !== null) s.prices.push(fields.price)
    if (fields.title) {
      const t = baseTitle(fields.title)
      s.titles.set(t, (s.titles.get(t) ?? 0) + 1)
    }
    if (fields.variant) s.variants.add(fields.variant)
    if (at < s.first) s.first = at
    if (stream === 'view' && (!s.firstView || at < s.firstView))
      s.firstView = at
    if (stream === 'order' && (!s.firstOrder || at < s.firstOrder))
      s.firstOrder = at
  }
  for (const view of views) {
    const p = view.props
    const id = idOf(p.ProductID)
    if (!id) continue
    // A store's own snippet sends Name and its formatted money (Shopify);
    // an integration sends ProductName and numbers.
    add(id, view.at, 'view', {
      title: textOf(p.ProductName) ?? textOf(p.Name),
      url: httpsOf(p.URL),
      image: imageOf(p.ImageURL),
      price: moneyOf(p.Price),
      compareAt: moneyOf(p.CompareAtPrice),
      variant: textOf(p.SKU)
    })
  }
  const viewed = new Set(seen.keys())
  for (const order of orders)
    for (const line of orderLines(order.props)) {
      if (viewed.has(line.id)) {
        // A viewed product keeps its page's values; its order lines only
        // fill a missing title or price, and say when it was first seen.
        const s = seen.get(line.id)!
        if (order.at < s.first) s.first = order.at
        if (!s.firstOrder || order.at < s.firstOrder) s.firstOrder = order.at
        if (line.variant) s.variants.add(line.variant)
        if (s.titles.size === 0 && line.title)
          s.titles.set(baseTitle(line.title), 1)
        if (s.price === null && line.price !== null) s.price = line.price
        s.image ??= line.image
        continue
      }
      add(line.id, order.at, 'order', { ...line, compareAt: null })
    }
  // A product is new only when first seen lately in events that reach
  // back far enough to show it was not there before.
  const oldest = (events: StoreEvent[]) =>
    events.reduce<string | null>((o, e) => (!o || e.at < o ? e.at : o), null)
  const reaches = (at: string | null) =>
    at !== null && Date.parse(at) <= now - 60 * day
  const viewsReach = reaches(oldest(views))
  const ordersReach = reaches(oldest(orders))
  const lately = (at: string | null) =>
    at !== null && Date.parse(at) >= now - newArrivalDays * day
  return [...seen.values()].map((s) => {
    const title =
      [...s.titles.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].length - b[0].length
      )[0]?.[0] ?? ''
    const fresh =
      lately(s.first) &&
      ((viewsReach && lately(s.firstView)) ||
        (ordersReach && lately(s.firstOrder)))
    // On sale: lower now than its compare-at price, and seen earlier in
    // the window at that full price.
    const saleSeen =
      s.price !== null &&
      s.compareAt !== null &&
      s.compareAt > s.price &&
      s.prices.some((p) => p >= s.compareAt!)
    return {
      externalId: s.externalId,
      title,
      url: s.url,
      image: s.image,
      price: s.price,
      compareAt: s.compareAt,
      saleSeen,
      published: true,
      launchedAt: fresh ? new Date(Date.parse(s.first)).toISOString() : null,
      stock: null,
      variantCount: Math.min(500, Math.max(1, s.variants.size))
    }
  })
}

const currencyNames = [
  '$currency_code',
  'currency_code',
  'Currency',
  'currency'
]
/** The shop's own currency in a Shopify order, when it says it. */
const shopCurrency = (props: Record<string, unknown>) =>
  (props.$extra as { currency?: unknown } | undefined)?.currency

/** The currency most of the orders are in, and how many say one. */
export function orderCurrency(orders: StoreEvent[]) {
  const counts = new Map<string, number>()
  let said = 0
  for (const order of orders) {
    const raw = [
      shopCurrency(order.props),
      ...currencyNames.map((name) => order.props[name])
    ].find((v) => typeof v === 'string')
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
    if (!/^[A-Z]{3}$/.test(code)) continue
    said++
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return { currency: top?.[0] ?? null, share: top ? top[1] / said : 0, said }
}

/**
 * Whether the store sells in the account's currency: `matched` when most
 * orders are in it; `mismatch` when nearly all are in another (the prices
 * Klaviyo shows would then be wrong); `unverified` otherwise.
 */
export function currencyCheck(
  account: string,
  orders: ReturnType<typeof orderCurrency>
): 'matched' | 'mismatch' | 'unverified' {
  if (!orders.currency) return 'unverified'
  if (orders.currency === account) return 'matched'
  return orders.share >= 0.8 ? 'mismatch' : 'unverified'
}

/**
 * Each product with its sales: by its own id, or, for a catalog whose ids
 * are not the store's (a custom catalog), by its title when exactly one
 * order product has it.
 */
export function withSales(
  products: RawProduct[],
  sales: ReturnType<typeof salesFrom>
): Listed[] {
  const byTitle = new Map<string, Sales[]>()
  for (const s of sales.values())
    for (const t of s.titles) byTitle.set(t, [...(byTitle.get(t) ?? []), s])
  return products.map((p) => {
    // Its own sales and those of the items merged into it.
    const owned = [p.externalId, ...(p.otherIds ?? [])].flatMap((id) => {
      const s = sales.get(id)
      return s ? [s] : []
    })
    const titled = byTitle.get(p.title.toLowerCase())
    const found = owned.length ? owned : titled?.length === 1 ? titled : []
    return {
      ...p,
      units30d: found.reduce((n, s) => n + s.units30d, 0),
      units90d: found.reduce((n, s) => n + s.units90d, 0)
    }
  })
}

const words = (title: string) =>
  new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1)
  )

/** How alike two titles are: shared words over all words (0 to 1). */
export function titleLikeness(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared++
  return shared / (x.size + y.size - shared)
}

export type Duplicate = { keep: string; drop: string }

/**
 * Duplicates the analyst named, checked: both products exist, are not the
 * same, have alike titles and prices within 15%; the one that sold more is
 * kept; a product is dropped once and a dropped one keeps nothing.
 */
export function checkDuplicates(
  products: Listed[],
  named: Duplicate[]
): Duplicate[] {
  const byId = new Map(products.map((p) => [p.externalId, p]))
  const dropped = new Set<string>()
  const kept = new Set<string>()
  const out: Duplicate[] = []
  for (const pair of named) {
    let keep = byId.get(pair.keep)
    let drop = byId.get(pair.drop)
    if (!keep || !drop || keep === drop) continue
    if (titleLikeness(keep.title, drop.title) < 0.6) continue
    if (keep.price === null || drop.price === null) continue
    const high = Math.max(keep.price, drop.price)
    if (high > 0 && Math.abs(keep.price - drop.price) / high > 0.15) continue
    if (drop.units90d > keep.units90d) [keep, drop] = [drop, keep]
    if (dropped.has(drop.externalId) || dropped.has(keep.externalId)) continue
    if (kept.has(drop.externalId)) continue
    dropped.add(drop.externalId)
    kept.add(keep.externalId)
    out.push({ keep: keep.externalId, drop: drop.externalId })
  }
  return out
}

/** The sample rules: the same title at the same price is one product. */
export function sampleDuplicates(products: Listed[]): Duplicate[] {
  const first = new Map<string, Listed>()
  const pairs: Duplicate[] = []
  for (const p of products) {
    const same = `${p.title.toLowerCase()}|${p.price}`
    const known = first.get(same)
    if (known) pairs.push({ keep: known.externalId, drop: p.externalId })
    else first.set(same, p)
  }
  return pairs
}

/** The number of minor units in one unit of the currency (100 for USD). */
export function minorUnits(currency: string) {
  try {
    const digits =
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency
      }).resolvedOptions().maximumFractionDigits ?? 2
    return 10 ** digits
  } catch {
    return 100
  }
}

/**
 * The cleaned catalog: products with a page, a price and a title (others
 * are left out and counted); a photo, the store's currency and a published
 * product are required to feature one; duplicates are hidden (their sales
 * go to the product kept). Featured by default: every clean product of a
 * small store (20 or fewer, or no sales yet), otherwise the top 20
 * bestsellers and the new arrivals (VISION §10); the rest wait for the
 * owner to pick them.
 */
export function finishCatalog(
  listed: Listed[],
  options: {
    currency: string
    currencyCheck: 'matched' | 'mismatch' | 'unverified'
    duplicates: Duplicate[]
    now: number
  }
): { records: CatalogRecord[]; leftOut: number; truncated: boolean } {
  const unit = minorUnits(options.currency)
  const drops = new Map(options.duplicates.map((d) => [d.drop, d.keep]))
  let leftOut = 0
  // One product per Klaviyo id (the first wins).
  const byId = new Map<string, Listed>()
  for (const p of listed)
    if (byId.has(p.externalId)) leftOut++
    else byId.set(p.externalId, { ...p })
  for (const [drop, keep] of drops) {
    const d = byId.get(drop)
    const k = byId.get(keep)
    if (!d || !k) continue
    k.units30d += d.units30d
    k.units90d += d.units90d
  }
  // What the database stores: a page (https, no spaces, 2000 characters at
  // most), a price that fits, a title of 2 to 200 characters, a known id.
  const usable = [...byId.values()].flatMap((p) => {
    const title = Array.from(p.title).slice(0, 200).join('')
    const priceMinor = p.price === null ? NaN : Math.round(p.price * unit)
    const ok =
      p.url !== null &&
      p.url.length <= 2000 &&
      !/\s/.test(p.url) &&
      Number.isSafeInteger(priceMinor) &&
      priceMinor >= 0 &&
      priceMinor <= 999_999_999 &&
      Array.from(title.trim()).length >= 2 &&
      /^[A-Za-z0-9$:._-]{1,160}$/.test(p.externalId)
    if (!ok) {
      leftOut++
      return []
    }
    const launched = p.launchedAt ? Date.parse(p.launchedAt) : NaN
    return [
      {
        ...p,
        title,
        image:
          p.image && p.image.length <= 2000 && !/\s/.test(p.image)
            ? p.image
            : null,
        launchedAt: Number.isFinite(launched)
          ? new Date(launched).toISOString()
          : null
      }
    ]
  })
  usable.sort(
    (a, b) =>
      b.units30d - a.units30d ||
      b.units90d - a.units90d ||
      a.title.localeCompare(b.title) ||
      a.externalId.localeCompare(b.externalId)
  )
  const truncated = usable.length > maxProducts
  const kept = usable.slice(0, maxProducts)
  const hidden = (p: Listed) =>
    drops.has(p.externalId)
      ? ('duplicate' as const)
      : !p.published
        ? ('unpublished' as const)
        : options.currencyCheck === 'mismatch'
          ? ('currency' as const)
          : !p.image
            ? ('no_image' as const)
            : null
  const clean = kept.filter((p) => !hidden(p))
  let rank = 0
  const ranks = new Map<string, number>()
  for (const p of clean)
    if (p.units90d > 0 && rank < 500) ranks.set(p.externalId, ++rank)
  const anySales = clean.some((p) => p.units90d > 0)
  const everyone = clean.length <= topBestsellers || !anySales
  const records = kept.map((p): CatalogRecord => {
    const reason = hidden(p)
    const newArrival =
      p.launchedAt !== null &&
      options.now - Date.parse(p.launchedAt) <= newArrivalDays * day &&
      Date.parse(p.launchedAt) <= options.now
    const bestsellerRank = ranks.get(p.externalId) ?? null
    // A product at no price (a free gift) is never featured by default.
    const picked =
      p.price! > 0 &&
      (everyone ||
        newArrival ||
        (bestsellerRank !== null && bestsellerRank <= topBestsellers))
    const priceMinor = Math.round(p.price! * unit)
    const compare = p.compareAt === null ? NaN : Math.round(p.compareAt * unit)
    const compareAtMinor =
      Number.isSafeInteger(compare) &&
      compare > priceMinor &&
      compare <= 999_999_999
        ? compare
        : null
    return {
      externalId: p.externalId,
      title: p.title,
      url: p.url!,
      priceMinor,
      currency: options.currency,
      imageUrl: p.image,
      compareAtMinor,
      compareAtIsSale: p.saleSeen && compareAtMinor !== null,
      featurable: !reason && picked,
      hiddenReason: reason ?? (picked ? null : 'not_picked'),
      units30d: p.units30d,
      units90d: p.units90d,
      bestsellerRank,
      launchedAt: p.launchedAt,
      newArrival,
      stock: p.stock,
      variantCount: Math.min(500, p.variantCount)
    }
  })
  return { records, leftOut, truncated }
}

/** The usual price range: from the 10th to the 90th percentile, to the cent. */
export function priceBand(records: CatalogRecord[]) {
  const prices = records
    .filter((r) => r.hiddenReason !== 'duplicate')
    .map((r) => r.priceMinor)
    .sort((a, b) => a - b)
  if (!prices.length) return null
  const at = (q: number) => prices[Math.round(q * (prices.length - 1))]!
  const unit = minorUnits(records[0]!.currency)
  // Major units to the cent, as findings hold money.
  const cents = (minor: number) => Math.round((minor / unit) * 100) / 100
  return { min: cents(at(0.1)), max: cents(at(0.9)) }
}
