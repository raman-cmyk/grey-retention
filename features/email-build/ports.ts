import type { BlockBrand } from '@/features/blocks/brand'
import { sampleBrand } from '@/features/blocks/samples'
import {
  unknownFacts,
  type BrandFacts,
  type CatalogProduct,
  type DiscountCode
} from '@/features/assembly/inputs'
import type { OfferSource } from '@/features/offers/source'
import { sampleStore } from '@/features/strategy/sample'
import { localTimeCandidates } from '@/lib/local-time'

/**
 * EML-004 part 2: the "Create email" build reads the store and hands the
 * finished email on through three small ports. Each has a sample or fake
 * implementation; the real ones come from other items:
 *
 * - `OfferSource` (DSC-001, `features/offers/source.ts`): the owner's max
 *   discount and the codes still working when the email sends. While the
 *   store is the sample store, the build reads `sampleOffers`, so the
 *   plan's sample codes match; the real source comes with the first reader.
 * - `StoreSource`: brand kit, catalog and brand facts (lane B's readers).
 * - `DraftPusher`: the email into Klaviyo as a draft (PSH-001).
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

/**
 * Puts one built email into the client's Klaviyo account as a DRAFT
 * campaign. Contract (supervisor, 11 Nov), for PSH-001's live adapter:
 *
 * 1. It only ever creates a draft campaign: it never schedules or sends
 *    (D17: the owner schedules in Klaviyo).
 * 2. `idempotencyKey` is one per email build: the same key again returns
 *    the same campaign id, never a second draft.
 * 3. It never throws: failures come back as codes. `rate_limited` and
 *    `unavailable` are tried again later (with `retryAfterSeconds` when
 *    Klaviyo gives one); `auth` and `rejected` are final.
 *
 * Before it creates the draft it uploads the pictures to Klaviyo (VISION
 * rule 11) and runs the launch check (QAG-001 `runReleaseQa`); a failed
 * check comes back as `rejected` with the failing check ids.
 */
export type DraftInput = {
  tenantId: string
  idempotencyKey: string
  /** The campaign's name in Klaviyo, e.g. "Tue 17 Nov · Offer". */
  name: string
  subject: string
  preheader: string
  html: string
  /** When the plan meant it to send, ISO with offset; Klaviyo keeps it unscheduled. */
  plannedSendAt: string
  /** The plan's audience, by our id (lane B maps it to a Klaviyo segment). */
  audienceId: string
}

export type DraftResult =
  | { ok: true; campaignId: string; sample: boolean }
  | {
      ok: false
      code: 'auth' | 'rate_limited' | 'unavailable' | 'rejected'
      retryAfterSeconds?: number
      /** For `rejected` by the launch check: the failing check ids. */
      checks?: string[]
    }

export interface DraftPusher {
  createDraft(input: DraftInput): Promise<DraftResult>
}

/** When a code ending on a store-local date stops working: that day's end. */
export function endOfLocalDay(date: string, timeZone: string) {
  const last = localTimeCandidates(`${date}T23:59`, timeZone).at(-1)
  return last ? new Date(Date.parse(last) + 60_000).toISOString() : null
}

/** The sample store's offers, through DSC-001's port. */
export const sampleOffers: OfferSource = {
  async offers(_tenantId, at) {
    const today = new Date().toISOString().slice(0, 10)
    const store = sampleStore(today)
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
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)

/** The sample store's brand and catalog (until lane B's readers). */
export const sampleStoreSource: StoreSource = {
  async read() {
    const today = new Date().toISOString().slice(0, 10)
    const store = sampleStore(today)
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
}

/** The fake pusher: no Klaviyo call; the same key gives the same id. */
export function fakeDraftPusher(): DraftPusher & { calls: DraftInput[] } {
  const calls: DraftInput[] = []
  return {
    calls,
    async createDraft(input) {
      calls.push(input)
      return {
        ok: true,
        campaignId: `sample-draft-${input.idempotencyKey}`,
        sample: true
      }
    }
  }
}
