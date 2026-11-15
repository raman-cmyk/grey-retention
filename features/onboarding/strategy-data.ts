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
import { listFindings, type Finding } from '@/features/onboarding/findings'
import {
  planFromHistory,
  readKlaviyoHistory,
  type StoredHistory
} from '@/features/onboarding/history/read'
import { sampleStrategyData, type StrategyData } from '@/features/strategy/data'
import { workspaceTimezone } from '@/features/strategy/offers'
import type { Database } from '@/lib/supabase/database.types'

/**
 * ONB-057a (owner pick #57, D27): "Plan next 15 days" reads what onboarding
 * learned instead of the sample store. A `StrategyData` (the port in
 * features/strategy/data.ts) from the workspace's own catalog (ONB-102),
 * Klaviyo history (ONB-103: send rhythm, send time, audiences, sends
 * already planned, past results), brand findings (ONB-101), key dates
 * (PLN-034) and brand name. The worker adds the owner's offers itself.
 *
 * Until there is enough to plan a real store (a catalog, a history and at
 * least one audience to send to), it hands back the sample store, exactly
 * as today. It says `sample: false` only when the history was read live
 * from Klaviyo. A read that fails throws, so the step is tried again.
 */
export const planDays = 15
/** The most products handed to the pulse and the plan (the plan takes 5,000). */
const maxProducts = 500
const fallbackSendTime = '10:00'

export type OnboardedParts = {
  brandName: string | null
  timezone: string
  catalog: CatalogEntry[]
  history: StoredHistory | null
  findings: Finding[]
  keyDates: KeyDate[]
}

const day = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null
const cut = (text: string, max: number) =>
  Array.from(text.trim()).slice(0, max).join('')

/** What the industry is called, from the "offering" finding, else "other". */
export function industryFrom(findings: readonly Finding[]) {
  const offering = findings
    .filter((f) => f.topic === 'offering')
    .sort((a, b) => b.confidence - a.confidence)[0]
  const text = offering ? cut(offering.statement, 60) : ''
  return text.length > 0 ? text : 'other'
}

/**
 * The port's answer from the workspace's own data, or null when there is
 * not enough to plan a real store yet (the caller then uses the sample).
 */
export function strategyFrom(
  parts: OnboardedParts,
  start: string
): Awaited<ReturnType<StrategyData['load']>> | null {
  const { history } = parts
  if (!history || history.state === 'empty' || parts.catalog.length === 0)
    return null
  const fromHistory = planFromHistory(history.history, {
    start,
    days: planDays
  })
  if (fromHistory.audiences.length === 0) return null
  const industry = industryFrom(parts.findings)
  const products = [...parts.catalog]
    .sort(
      (a, b) =>
        (a.bestsellerRank ?? Infinity) - (b.bestsellerRank ?? Infinity) ||
        b.unitsSold30d - a.unitsSold30d ||
        a.title.localeCompare(b.title)
    )
    .slice(0, maxProducts)
  const currency =
    products.find((p) => /^[A-Z]{3}$/.test(p.currency))?.currency ??
    history.history.currency
  const datesInWindow = parts.keyDates
  return {
    sample: !history.live,
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
        launchedOn: day(p.launchedAt),
        unitsSold30d: p.unitsSold30d,
        stock: p.stock
      })),
      results: fromHistory.results,
      dates: toPulseDates(datesInWindow)
    },
    mapper: {
      // No reader of the competitor library yet: the step finds no moves.
      industry: 'other',
      brandSize: 'unknown',
      start,
      ourDates: datesInWindow.map((k) => ({
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
      sendTime: fromHistory.sendTime ?? fallbackSendTime,
      products: products.map((p) => {
        const launched = day(p.launchedAt)
        return {
          id: p.id,
          title: cut(p.title, 200),
          inStock: p.stock !== 0,
          availableFrom: launched && launched >= start ? launched : null
        }
      }),
      audiences: fromHistory.audiences,
      blackouts: [],
      existing: fromHistory.existing
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
  { fallback = sampleStrategyData }: { fallback?: StrategyData } = {}
): StrategyData {
  return {
    async load({ tenantId, start }) {
      const [timezone, catalog, history, findings, profile] = await Promise.all(
        [
          workspaceTimezone(db, tenantId),
          listCatalog(db, tenantId),
          readKlaviyoHistory(db, tenantId),
          listFindings(db, tenantId, { topic: 'offering' }),
          db
            .from('brand_profiles')
            .select('brand_name')
            .eq('tenant_id', tenantId)
            .maybeSingle()
        ]
      )
      if (profile.error) throw profile.error
      const industry = industryFrom(findings)
      const keyDates = await planningKeyDates(db, {
        tenantId,
        timezone,
        from: start,
        days: planDays,
        industry
      })
      const own = strategyFrom(
        {
          brandName: profile.data?.brand_name ?? null,
          timezone,
          catalog,
          history,
          findings,
          // Key dates are a help, not a need: a failed read plans without them.
          keyDates: keyDates?.dates ?? []
        },
        start
      )
      return own ?? fallback.load({ tenantId, start })
    }
  }
}
