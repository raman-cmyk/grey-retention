import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  planningKeyDates,
  toPulseDates,
  type KeyDate
} from '@/features/holidays/key-dates'
import {
  listCatalog,
  type CatalogEntry
} from '@/features/onboarding/catalog/read'
import {
  applyCorrections,
  listCorrections,
  type Correction
} from '@/features/onboarding/brand-book-corrections'
import { listFindings, type Finding } from '@/features/onboarding/findings'
import { industryInWords } from '@/features/onboarding/industry'
import {
  planFromHistory,
  readKlaviyoHistory,
  windowCampaigns,
  type StoredHistory
} from '@/features/onboarding/history/read'
import { resolveSendTimes } from '@/features/onboarding/history/send-times'
import {
  readSendTimes,
  type StoredSendTimes
} from '@/features/onboarding/history/send-times-store'
import { sampleStrategyData, type StrategyData } from '@/features/strategy/data'
import { readOfferPercents } from '@/features/strategy/offer-memory'
import { addDays } from '@/features/strategy/pulse'
import { workspaceTimezone } from '@/features/strategy/offers'
import type { Industry } from '@/features/intelligence/taxonomy'
import { localDateTime } from '@/lib/local-time'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'

/**
 * ONB-057a (owner pick #57, D27): "Plan next 15 days" reads what onboarding
 * learned instead of the sample store. A `StrategyData` (the port in
 * features/strategy/data.ts) from the workspace's own catalog (ONB-102),
 * Klaviyo history (ONB-103: send rhythm, send time, audiences, sends
 * already planned, past results), brand findings (ONB-101), key dates
 * (PLN-034) and brand name. The worker adds the owner's offers itself.
 *
 * Until there is enough to plan a real store, it hands back the sample
 * store, exactly as today: products emails may feature, and a Klaviyo
 * history that is ready, read in full (`complete`: the historian sets it
 * only when every part and every message was read; the sent, scheduled and
 * audiences parts are checked again) and
 * read in the last `historyFreshDays`, with at least one audience to send
 * to. A stale history would miss campaigns scheduled since, which the
 * weekly cap and the same-day rules must see. It says `sample: false` only
 * when the history was read live from Klaviyo. A read that fails, the key
 * dates' included, throws, so the step is tried again.
 */
export const planDays = 15
/** How old a history may be and still be planned from. */
export const historyFreshDays = 3
const fallbackSendTime = '10:00'

export type OnboardedParts = {
  brandName: string | null
  timezone: string
  catalog: CatalogEntry[]
  history: StoredHistory | null
  findings: Finding[]
  /** ONB-057c: the owner's corrections (what the brand sells). */
  corrections?: readonly Correction[]
  keyDates: KeyDate[]
  /**
   * PICK-97: the best send times the history read counted; missing or
   * null: none (every email at the usual time).
   */
  sendTimes?: StoredSendTimes | null
  /**
   * PLN-040b: the percent of the code GROS drafted for a Klaviyo campaign,
   * by campaign id (`readOfferPercents`); missing: none known.
   */
  offerPercents?: ReadonlyMap<string, number>
}

/** The store's own date of a moment (a launch at 02:00 UTC may be the day before). */
const day = (iso: string | null, timezone: string) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? localDateTime(iso, timezone).slice(0, 10)
    : null
const cut = (text: string, max: number) =>
  Array.from(text.trim()).slice(0, max).join('')

const lineKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The brand's industry from what it sells: `key` on the fixed industry
 * list (what the agents and their industry rules use), and `words`, the
 * line it comes from (what key dates are matched on). The owner's own
 * lines come first, then the readers' surest, as he corrected them
 * (ONB-058); the planner and "Create email" read it the same way
 * (ONB-057c). A finding from the sample rules is not used for a live
 * history.
 */
export function industryFrom(
  findings: readonly Finding[],
  {
    live = false,
    corrections = []
  }: { live?: boolean; corrections?: readonly Correction[] } = {}
): { key: Industry; words: string } {
  const offering = findings
    .filter((f) => f.topic === 'offering' && !(live && f.pass === 'sample'))
    // Equally sure lines by their words, so the read order never picks the
    // industry (REL-STO: the same store gives the same email).
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        (a.statement < b.statement ? -1 : a.statement > b.statement ? 1 : 0)
    )
    .map((f) => f.statement.trim())
  const own = corrections.filter((c) => c.section === 'offering')
  const lines = own.length
    ? (applyCorrections({ observed: { offering } }, own).observed?.offering ??
      [])
    : offering
  const added = new Set(
    own.flatMap((c) =>
      c.action === 'add' && c.value ? [lineKey(c.value)] : []
    )
  )
  const words =
    lines.find((l) => added.has(lineKey(l))) ??
    lines.find((l) => !added.has(lineKey(l))) ??
    ''
  return { key: industryInWords(words) ?? 'other', words }
}

/** Whether a stored history can be planned from on `now`. */
export function historyUsable(history: StoredHistory | null, now: Date) {
  if (!history || history.state !== 'ready' || !history.complete) return false
  const { parts } = history.history
  if (!parts.sent || !parts.scheduled || !parts.audiences) return false
  const age = now.getTime() - Date.parse(history.readAt)
  return age >= -60_000 && age <= historyFreshDays * 86_400_000
}

/**
 * The port's answer from the workspace's own data, or null when there is
 * not enough to plan a real store yet (the caller then uses the sample).
 */
export function strategyFrom(
  parts: OnboardedParts,
  start: string,
  now = new Date()
): Awaited<ReturnType<StrategyData['load']>> | null {
  const { history } = parts
  const catalog = parts.catalog.filter((p) => p.featurable)
  if (!history || !historyUsable(history, now) || catalog.length === 0)
    return null
  const fromHistory = planFromHistory(
    history.history,
    { start, days: planDays },
    parts.offerPercents
  )
  if (fromHistory.audiences.length === 0) return null
  const industry = industryFrom(parts.findings, {
    live: history.live,
    corrections: parts.corrections
  }).key
  // The catalog read keeps at most 500 products; best sellers first.
  const products = [...catalog].sort(
    (a, b) =>
      (a.bestsellerRank ?? Infinity) - (b.bestsellerRank ?? Infinity) ||
      b.unitsSold30d - a.unitsSold30d ||
      a.title.localeCompare(b.title)
  )
  const currency =
    products.find((p) => /^[A-Z]{3}$/.test(p.currency))?.currency ??
    history.history.currency
  const last = addDays(start, planDays - 1)
  // PICK-97: counted in this timezone from this same kind of read (live or
  // the sample account); otherwise its hours mean nothing here.
  const counted =
    parts.sendTimes &&
    parts.sendTimes.live === history.live &&
    parts.sendTimes.timezone === parts.timezone
      ? parts.sendTimes.entries
      : null
  const sendTime = fromHistory.sendTime ?? fallbackSendTime
  const sendTimes = resolveSendTimes(
    fromHistory.audiences.map((a) => a.id),
    counted,
    fromHistory.sendTime,
    fallbackSendTime
  )
  return {
    sample: !history.live,
    own: true,
    pulse: {
      brand: {
        name: cut(parts.brandName ?? '', 120) || 'Your store',
        industry,
        timezone: parts.timezone,
        currency,
        // The worker replaces it with the owner's saved max discount.
        maxDiscountPercent: 0
      },
      start,
      codes: [],
      products: products.map((p) => ({
        id: p.id,
        title: cut(p.title, 200),
        price: p.amount,
        launchedOn: day(p.launchedAt, parts.timezone),
        unitsSold30d: p.unitsSold30d,
        stock: p.stock
      })),
      results: fromHistory.results,
      dates: toPulseDates(parts.keyDates)
    },
    mapper: {
      // No reader of the competitor library yet: the step finds no moves.
      industry,
      brandSize: 'unknown',
      start,
      // Named dates in our 15 days only.
      ourDates: parts.keyDates
        .filter((k) => k.date >= start && k.date <= last)
        .map((k) => ({
          date: k.date,
          name: cut(k.name, 80),
          kind: k.kind
        })),
      pastDates: [],
      library: []
    },
    plan: {
      industry,
      sendsPerWeek: fromHistory.sendsPerWeek,
      sendTime,
      // Nothing counted yet: no send times, so no time is changed or
      // explained (never "not enough history" for a history not counted).
      ...(sendTimes ? { sendTimes } : {}),
      products: products.map((p) => {
        const launched = day(p.launchedAt, parts.timezone)
        return {
          id: p.id,
          title: cut(p.title, 200),
          inStock: p.stock !== 0,
          availableFrom: launched && launched >= start ? launched : null
        }
      }),
      audiences: fromHistory.audiences,
      blackouts: [],
      existing: fromHistory.existing,
      ...(fromHistory.saleOffers ? { saleOffers: fromHistory.saleOffers } : {})
    }
  }
}

type Db = SupabaseClient<Database>

/**
 * The store source "Plan next 15 days" should use (ONB-057b wires it in):
 * the workspace's own data, or `fallback` (the sample store) until there is
 * enough of it. Reads with the worker's client.
 */
export function onboardedStrategyData(
  db: Db,
  {
    fallback = sampleStrategyData,
    now = () => new Date()
  }: { fallback?: StrategyData; now?: () => Date } = {}
): StrategyData {
  return {
    async load({ tenantId, start }) {
      // First what decides whether the workspace's own store can be
      // planned at all; the sample store needs nothing more (a sample plan
      // never waits on reads it does not use).
      const [timezone, history, status] = await Promise.all([
        workspaceTimezone(db, tenantId),
        readKlaviyoHistory(db, tenantId),
        db
          .from('catalog_status')
          .select('live')
          .eq('tenant_id', tenantId)
          .maybeSingle()
      ])
      if (status.error) throw status.error
      const at = now()
      // ONB-057b: the catalog and the history read the same way (both live
      // or both fake), so "Create email" finds the very store planned from.
      if (
        !history ||
        !historyUsable(history, at) ||
        !status.data ||
        status.data.live !== history.live
      )
        return fallback.load({ tenantId, start })
      // A live store never plans the fake Klaviyo's products.
      const catalog = await listCatalog(db, tenantId, {
        featurableOnly: true,
        synthetic: !history.live
      })
      if (catalog.length === 0) return fallback.load({ tenantId, start })
      const [findings, corrections, profile, sendTimes] = await Promise.all([
        listFindings(db, tenantId, { topic: 'offering' }),
        listCorrections(db, tenantId),
        db
          .from('brand_profiles')
          .select('brand_name')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        // PICK-97: a failed read plans at the usual time, never not at all.
        readSendTimes(db, tenantId, at).catch(() => {
          logger.warn('Plan: send times unreadable; the usual time is used')
          return null
        })
      ])
      if (profile.error) throw profile.error
      // PLN-040b: the offers GROS drafted for the sends already in
      // Klaviyo; a failed read plans as before (each sale starts low).
      const offerPercents = await readOfferPercents(db, tenantId, {
        campaignIds: windowCampaigns(history.history, {
          start,
          days: planDays
        }),
        live: history.live
      }).catch(() => {
        logger.warn('Plan: drafted offers unreadable; the sale starts low')
        return new Map<string, number>()
      })
      const keyDates = await planningKeyDates(db, {
        tenantId,
        timezone,
        from: start,
        days: planDays,
        industry: industryFrom(findings, {
          live: history.live,
          corrections
        }).words
      })
      // A failed read (holidays, the owner's own days) is tried again, never
      // planned without: a plan missing Black Friday would say nothing.
      if (!keyDates)
        throw Object.assign(new Error('key_dates_unreadable'), {
          code: 'key_dates_unreadable'
        })
      const own = strategyFrom(
        {
          brandName: profile.data?.brand_name ?? null,
          timezone,
          catalog,
          history,
          findings,
          corrections,
          keyDates: keyDates.dates,
          sendTimes,
          offerPercents
        },
        start,
        at
      )
      return own ?? fallback.load({ tenantId, start })
    }
  }
}
