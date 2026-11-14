import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { discountCap, type DiscountLimit } from './cap'

/**
 * The owner's offer limits (DSC-001): the max discount any email may offer
 * and the real discount codes. `DiscountCode` is the same shape copy QA and
 * assembly use (features/assembly/inputs.ts). Agents read these through an
 * `OfferSource`; the AI never makes up a code or a percent.
 */
export type DiscountCode = {
  code: string
  /** Whole percent off, 1 to 100. */
  percent: number
  /** ISO time the code stops working; null means it doesn't expire. */
  expiresAt: string | null
}

export type Offers = {
  /**
   * null: the owner has not set one yet, so emails offer no discount.
   * Already capped by the margin floor (PLN-039), so agents use it as is.
   */
  maxDiscountPercent: number | null
  /**
   * Which owner setting sets `maxDiscountPercent` (PLN-039): their max
   * discount, or the margin floor when that allows less. null or absent
   * when there is no max discount (or the source does not know).
   */
  limitedBy?: DiscountLimit | null
  /** Active codes that still work at the time asked about, sorted by code. */
  codes: DiscountCode[]
}

export interface OfferSource {
  /** `at`: the moment the email sends (codes must still work then). */
  offers(tenantId: string, at?: string): Promise<Offers | null>
}

/** Everything the owner saved about offers, as Settings reads it. */
export type ManagedOffers = {
  maxDiscountPercent: number | null
  /** PLN-039: both set, or both null. */
  grossMarginPercent: number | null
  marginFloorPercent: number | null
  revision: number
  codes: ManagedCode[]
}

/** A code the owner manages in Settings. */
export type ManagedCode = DiscountCode & {
  id: string
  /** Its end date has passed; agents no longer use it. */
  ended: boolean
}

type Row = Record<string, unknown>
type Query = PromiseLike<{ data: Row[] | null; error: unknown }>
type Untyped = {
  from(table: 'brand_offers' | 'discount_codes'): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): Query & { eq(column: string, value: string): Query }
    }
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toCode(row: Row, now: number): ManagedCode | null {
  const percent = Number(row.percent)
  if (
    typeof row.id !== 'string' ||
    typeof row.code !== 'string' ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 100
  )
    return null
  const expiresAt = row.expires_at
    ? new Date(String(row.expires_at)).toISOString()
    : null
  return {
    id: row.id,
    code: row.code,
    percent,
    expiresAt,
    ended: expiresAt !== null && Date.parse(expiresAt) <= now
  }
}

/**
 * Reads offer limits with the caller's client: a signed-in member reads
 * their own workspace through RLS; the worker passes a service-role client.
 * Until the next `pnpm supabase:types`, the new tables are reached through
 * the narrow typed signature above.
 */
export class SupabaseOfferSource implements OfferSource {
  private readonly db: Untyped
  constructor(db: SupabaseClient<Database>) {
    this.db = db as unknown as Untyped
  }

  /** Everything Settings shows, or null when it cannot be read. */
  async managed(tenantId: string): Promise<ManagedOffers | null> {
    if (!uuid.test(tenantId)) return null
    const [offers, codes] = await Promise.all([
      this.db
        .from('brand_offers')
        .select(
          'max_discount_percent,gross_margin_percent,margin_floor_percent,revision'
        )
        .eq('tenant_id', tenantId),
      this.db
        .from('discount_codes')
        .select('id,code,percent,expires_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
    ])
    if (offers.error || codes.error || !offers.data || !codes.data) return null
    const row = offers.data[0]
    return {
      maxDiscountPercent: row ? Number(row.max_discount_percent) : null,
      grossMarginPercent: wholeOrNull(row?.gross_margin_percent),
      marginFloorPercent: wholeOrNull(row?.margin_floor_percent),
      revision: row ? Number(row.revision) : 0,
      codes: codes.data
        .map((r) => toCode(r, Date.now()))
        .filter((c): c is ManagedCode => c !== null)
        .sort((a, b) => a.code.localeCompare(b.code))
    }
  }

  async offers(tenantId: string, at = new Date().toISOString()) {
    const managed = await this.managed(tenantId)
    return managed ? offersFrom(managed, at) : null
  }
}

const wholeOrNull = (value: unknown) =>
  value === null || value === undefined || !Number.isInteger(Number(value))
    ? null
    : Number(value)

/**
 * What agents read from what the owner saved: the max discount capped by
 * the margin floor (PLN-039), and the codes that still work at `at`.
 */
export function offersFrom(
  managed: Pick<ManagedOffers, 'maxDiscountPercent' | 'codes'> &
    Partial<Pick<ManagedOffers, 'grossMarginPercent' | 'marginFloorPercent'>>,
  at = new Date().toISOString()
): Offers {
  const when = Date.parse(at)
  return {
    ...discountCap(managed),
    codes: managed.codes
      .filter((c) => c.expiresAt === null || Date.parse(c.expiresAt) > when)
      .map(({ code, percent, expiresAt }) => ({ code, percent, expiresAt }))
  }
}
