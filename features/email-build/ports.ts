import type { FounderVoice } from '@/features/letter/voice/profile'
import type { PastSubject } from './subject-traits'
import type { BlockBrand } from '@/features/blocks/brand'
import { sampleBrand } from '@/features/blocks/samples'
import {
  unknownFacts,
  type AssemblyInput,
  type BrandFacts,
  type CatalogProduct,
  type DiscountCode
} from '@/features/assembly/inputs'
import {
  offersFrom,
  type OfferSource,
  type SupabaseOfferSource
} from '@/features/offers/source'
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
  /** `featurable` comes from `featurableStock`: unknown stock is allowed. */
  products: CatalogProduct[]
  facts: BrandFacts
  /**
   * ONB-061: the customers' own words from reviews, already checked like
   * copy (lane A carries them into the writer's data). Absent for the
   * sample store.
   */
  customerWords?: string[]
  /**
   * PIC-26 part 2: the subjects the store sent and how they were opened
   * (its Klaviyo history, `pastSubjects`), for the subject line lab.
   * Absent for the sample store and before a history read.
   */
  pastSubjects?: PastSubject[]
  /**
   * REL-ONB2: the store's own material for its blocks (its quotable
   * reviews so far; `storeMaterial`), only from what its readers kept.
   * Absent for the sample store and when a source has none, so the block
   * stays disallowed (`allowedBlockTypes`).
   */
  confirmed?: NonNullable<AssemblyInput['confirmed']>
  /**
   * PIC-23 part 3b: how the founder writes, measured from the owner's own
   * sent emails (`founderVoice`), for the Letter writer. Absent for the
   * sample store, before a history read and when the letters say too little.
   */
  founderVoice?: FounderVoice
}

/**
 * Whether a product's stock lets an email feature it: only a stock known
 * to be 0 rules it out. Unknown stock (null or missing, e.g. products
 * built from Klaviyo "Viewed Product" events, lane B) is allowed, or emails
 * for those stores would have no products at all.
 */
export const featurableStock = (stock: number | null | undefined) => stock !== 0

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
 * that fails is null, never the sample: an email without an offer then
 * goes on with no discount, and an offer email's first step is tried again
 * (`sectionsStep`, REL-084).
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
    // No max saved yet means no discount, whatever codes exist (DSC-001);
    // the margin floor caps the rest (PLN-039).
    return offersFrom(managed, at)
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
        // A product known to be sold out is not featured.
        featurable: featurableStock(p.stock)
      })),
      facts: unknownFacts
    }
  }
})
export const sampleStoreSource = sampleStoreFrom(today())
