import type { BlockBrand } from '@/features/blocks/brand'
import { sampleBrand } from '@/features/blocks/samples'
import {
  unknownFacts,
  type BrandFacts,
  type CatalogProduct,
  type DiscountCode
} from '@/features/assembly/inputs'
import type { OfferSource, SupabaseOfferSource } from '@/features/offers/source'
import { sampleStore } from '@/features/strategy/sample'
import { localTimeCandidates } from '@/lib/local-time'

/**
 * EML-004 part 2: the "Create email" build reads the store and hands the
 * finished email on through three small ports. Each has a sample or fake
 * implementation; the real ones come from other items:
 *
 * - `OfferSource` (DSC-001, `features/offers/source.ts`): the owner's max
 *   discount and the codes still working when the email sends. What the
 *   owner saved in Settings wins, even while the store is the sample store;
 *   only when nothing is saved does the build read the sample offers
 *   (`ownerOrSampleOffers`).
 * - `StoreSource`: brand kit, catalog and brand facts (lane B's readers).
 * - `DraftPusher` (`lib/providers/klaviyo-draft.ts`): the email into
 *   Klaviyo as a draft (PSH-001 builds the live one).
 *
 * The sample sources are anchored to the plan's first day, like the plan's
 * own sample, so a code the plan chose is still there when the email builds.
 */

/**
 * DSC-001's offers, read safely: no answer or no max set means no discount
 * (never a guess), and only codes still working when the email sends.
 */
export async function offersAt(
  source: OfferSource,
  tenantId: string,
  at: string
): Promise<{ maxDiscountPercent: number; codes: DiscountCode[] }> {
  const read = await source.offers(tenantId, at).catch(() => null)
  if (!read || read.maxDiscountPercent === null)
    return { maxDiscountPercent: 0, codes: [] }
  const sends = Date.parse(at)
  return {
    maxDiscountPercent: read.maxDiscountPercent,
    codes: read.codes.filter(
      (c) => c.expiresAt === null || Date.parse(c.expiresAt) > sends
    )
  }
}

/** What a build reads about the store. */
export type Store = {
  /** True for the synthetic sample store: the screen says so. */
  sample: boolean
  brand: BlockBrand
  industry: string
  /** The store's IANA timezone. */
  timezone: string
  products: CatalogProduct[]
  facts: BrandFacts
}

export interface StoreSource {
  read(tenantId: string): Promise<Store>
}

const today = () => new Date().toISOString().slice(0, 10)

/** When a code ending on a store-local date stops working: that day's end. */
export function endOfLocalDay(date: string, timeZone: string) {
  const last = localTimeCandidates(`${date}T23:59`, timeZone).at(-1)
  return last ? new Date(Date.parse(last) + 60_000).toISOString() : null
}

/** The sample store's offers, through DSC-001's port, from the plan's first day. */
export const sampleOffersFrom = (start: string): OfferSource => ({
  async offers(_tenantId, at) {
    const store = sampleStore(start)
    const sends = at ? Date.parse(at) : Date.now()
    const codes = store.codes
      .map((c) => ({
        code: c.code,
        percent: c.percent,
        expiresAt:
          c.expiresOn === null
            ? null
            : (endOfLocalDay(c.expiresOn, store.brand.timezone) ??
              `${c.expiresOn}T23:59:59Z`)
      }))
      .filter((c) => c.expiresAt === null || Date.parse(c.expiresAt) > sends)
      .sort((a, b) => a.code.localeCompare(b.code))
    return {
      maxDiscountPercent: store.brand.maxDiscountPercent,
      codes
    }
  }
})
export const sampleOffers = sampleOffersFrom(today())

/** What DSC-001's `SupabaseOfferSource` reads: everything the owner saved, or null when it cannot be read. */
export type SavedOffers = Pick<SupabaseOfferSource, 'managed'>

/**
 * The offers a build uses (supervisor, 11 Nov). The owner's own wins: a
 * saved max discount (a `brand_offers` row) or any active code, even while
 * the store is the sample store. Only when the owner has saved nothing do
 * the sample offers apply, so the sample plan's codes still match. A read
 * that fails is null, so `offersAt` gives no discount: never the sample.
 */
export const ownerOrSampleOffers = (
  saved: SavedOffers,
  sample: OfferSource
): OfferSource => ({
  async offers(tenantId, at) {
    const managed = await saved.managed(tenantId).catch(() => null)
    if (!managed) return null
    if (managed.maxDiscountPercent === null && managed.codes.length === 0)
      return sample.offers(tenantId, at)
    const sends = at ? Date.parse(at) : Date.now()
    return {
      // No max saved yet means no discount, whatever codes exist (DSC-001).
      maxDiscountPercent: managed.maxDiscountPercent,
      codes: managed.codes
        .filter((c) => c.expiresAt === null || Date.parse(c.expiresAt) > sends)
        .map(({ code, percent, expiresAt }) => ({ code, percent, expiresAt }))
    }
  }
})

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)

/** The sample store's brand and catalog (until lane B's readers), from the plan's first day. */
export const sampleStoreFrom = (start: string): StoreSource => ({
  async read() {
    const store = sampleStore(start)
    const site = 'https://cedar-lane.example'
    return {
      sample: true,
      brand: { ...sampleBrand, name: store.brand.name, site },
      industry: store.brand.industry,
      timezone: store.brand.timezone,
      products: store.products.map((p) => ({
        id: p.id,
        title: p.title,
        price: money(p.price, store.brand.currency),
        image: `${site}/images/${p.id}.jpg`,
        url: `${site}/products/${p.id}`,
        // Sold out or not yet launched products are not featured.
        featurable: p.stock !== 0
      })),
      facts: unknownFacts
    }
  }
})
export const sampleStoreSource = sampleStoreFrom(today())
