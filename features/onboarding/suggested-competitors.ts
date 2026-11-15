import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listCorrections } from '@/features/onboarding/brand-book-corrections'
import { listFindings } from '@/features/onboarding/findings'
import { industryInWords } from '@/features/onboarding/industry'
import { correctedIndustry } from '@/features/onboarding/store-source'
import { industries, type Industry } from '@/features/intelligence/taxonomy'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Suggested competitors (owner pick #65, ONB-065a, data only): up to 10
 * brands the Inspiration inbox already receives that are like this
 * store, each with a plain reason. "Like" means the same industry: the
 * store's is read from what it sells as the owner corrected it (the rule
 * "Create email" uses); a brand's, from its own labelled emails (the
 * label most of them carry), or else its niche's words. Brands sending lately come first. Only brands
 * the inbox is subscribed to; never the store itself, never a brand it
 * already follows, and a real store never gets a sample brand (nor a
 * sample store a real one). Following them and signing the inbox up to
 * new brands wait for Raman (the follow command takes sample domains
 * only today).
 */

export const maxSuggestions = 10
/** How far back "sending lately" looks. */
export const recentDays = 30
/** Labelled emails a brand needs before its labels outvote its niche. */
export const minLabelled = 2

export type InboxBrand = {
  id: string
  domain: string
  name: string | null
  niche: string | null
  synthetic: boolean
  subscriptionStatus: string
  lastReceivedAt: string | null
  /** Its emails in the last `recentDays`. */
  recent: number
  /** How many of its emails carry each industry label. */
  labelled: Partial<Record<Industry, number>>
}

export type CompetitorSuggestion = {
  captureId: string
  domain: string
  name: string
  industry: Industry
  /** In plain words, for the owner. */
  reason: string
}

const industryWords: Partial<Record<Industry, string>> = {
  food_drink: 'food and drink',
  beauty_tools: 'beauty tools'
}
const say = (industry: Industry) => industryWords[industry] ?? industry

/** A web address without `www.` and case (the store's own counts so too). */
const site = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')

/** A brand's industry: what most of its labelled emails say, else its niche's words. */
export function brandIndustry(brand: InboxBrand): Industry | null {
  const counts = Object.entries(brand.labelled) as [Industry, number][]
  const total = counts.reduce((a, [, n]) => a + n, 0)
  if (total >= minLabelled) {
    // The most common label; on a tie, the earlier one on the fixed list.
    const top = counts
      .filter(([k]) => k !== 'other')
      .sort(
        (a, b) =>
          b[1] - a[1] || industries.indexOf(a[0]) - industries.indexOf(b[0])
      )[0]
    if (top && top[1] * 2 > total) return top[0]
  }
  return industryInWords(brand.niche ?? '')
}

/** A time to sort by; none or unreadable sorts last. */
const when = (iso: string | null) => {
  const t = Date.parse(iso ?? '')
  return Number.isNaN(t) ? 0 : t
}

/** The suggestions, best first. Pure, for tests. */
export function suggestCompetitors(input: {
  industry: Industry
  /** The store's own web address, when known. */
  ownDomain: string | null
  /** False for the sample store: only sample brands then. */
  live: boolean
  /** Brands it already follows (their inbox ids). */
  following: ReadonlySet<string>
  brands: readonly InboxBrand[]
  max?: number
}): CompetitorSuggestion[] {
  const { industry, live, following, max = maxSuggestions } = input
  // "Other" is no likeness: nothing is suggested for it.
  if (industry === 'other') return []
  const own = input.ownDomain ? site(input.ownDomain) : null
  return input.brands
    .filter(
      (b) =>
        b.subscriptionStatus === 'subscribed' &&
        b.synthetic === !live &&
        !following.has(b.id) &&
        site(b.domain) !== own &&
        brandIndustry(b) === industry
    )
    .sort(
      (a, b) =>
        b.recent - a.recent ||
        when(b.lastReceivedAt) - when(a.lastReceivedAt) ||
        a.domain.localeCompare(b.domain)
    )
    .slice(0, max)
    .map((b) => ({
      captureId: b.id,
      domain: b.domain,
      name: b.name?.trim() || b.domain,
      industry,
      reason:
        b.recent > 0
          ? `Also a ${say(industry)} brand, and sent ${b.recent === 1 ? 'one email' : `${b.recent} emails`} in the last ${recentDays} days.`
          : `Also a ${say(industry)} brand.`
    }))
}

type Db = SupabaseClient<Database>

/** Most inbox brands and recent emails read for one suggestion. */
const brandsRead = 500
const emailsRead = 5_000

/**
 * The workspace's suggestions, read with the worker's (service) client:
 * the inbox's brands are the platform's, not any workspace's. The caller
 * has already checked the person may see this workspace. No brand
 * profile yet: nothing (it is not known whether the store is real). A
 * failed read throws.
 */
export async function readCompetitorSuggestions(
  db: Db,
  tenantId: string,
  { now = new Date() }: { now?: Date } = {}
): Promise<CompetitorSuggestion[]> {
  const since = new Date(now.getTime() - recentDays * 86_400_000).toISOString()
  const [profile, findings, corrections, following, brands] = await Promise.all(
    [
      db
        .from('brand_profiles')
        .select('domain,synthetic')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      listFindings(db, tenantId, { topic: 'offering' }),
      listCorrections(db, tenantId),
      db
        .from('competitor_subscriptions')
        .select('capture_id')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .limit(100),
      db
        .from('competitor_captures')
        .select(
          'id,domain,brand_name,niche,synthetic,subscription_status,last_received_at'
        )
        .eq('subscription_status', 'subscribed')
        .order('last_received_at', { ascending: false, nullsFirst: false })
        .limit(brandsRead)
    ]
  )
  for (const r of [profile, following, brands]) if (r.error) throw r.error
  if (!profile.data) return []
  // A real store never counts what the sample rules found.
  const live = !profile.data.synthetic
  const own = live ? findings.filter((f) => f.pass !== 'sample') : findings
  const ids = (brands.data ?? []).map((b) => b.id)
  const emails = ids.length
    ? await db
        .from('competitor_emails')
        .select('capture_id,industry')
        .in('capture_id', ids)
        .gte('received_at', since)
        .limit(emailsRead)
    : { data: [], error: null }
  if (emails.error) throw emails.error
  const recent = new Map<string, number>()
  const labelled = new Map<string, Partial<Record<Industry, number>>>()
  for (const e of emails.data ?? []) {
    recent.set(e.capture_id, (recent.get(e.capture_id) ?? 0) + 1)
    if (e.industry && (industries as readonly string[]).includes(e.industry)) {
      const counts = labelled.get(e.capture_id) ?? {}
      const key = e.industry as Industry
      counts[key] = (counts[key] ?? 0) + 1
      labelled.set(e.capture_id, counts)
    }
  }
  return suggestCompetitors({
    industry: correctedIndustry(own, corrections),
    ownDomain: profile.data.domain,
    live,
    following: new Set((following.data ?? []).map((s) => s.capture_id)),
    brands: (brands.data ?? []).map((b) => ({
      id: b.id,
      domain: b.domain,
      name: b.brand_name,
      niche: b.niche,
      synthetic: b.synthetic,
      subscriptionStatus: b.subscription_status,
      lastReceivedAt: b.last_received_at,
      recent: recent.get(b.id) ?? 0,
      labelled: labelled.get(b.id) ?? {}
    }))
  })
}
