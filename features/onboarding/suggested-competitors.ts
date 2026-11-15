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
 * store, each with a plain reason. "Like" means the same industry. The
 * store's is read from what it sells as the owner corrected it
 * (`correctedIndustry`, as "Create email" reads it); a brand's, from the
 * label most of its emails carry, or else its niche's words, read the way
 * the store's own words are (`industryInWords`, whole words only), so the
 * two sides agree. Brands sending lately come first.
 * The database gives only brands the inbox is subscribed to, of the
 * store's own kind (real or sample, from its brand profile), never one
 * the workspace follows or once followed (`suggestable_inbox_brands`);
 * here the store's own website is left out too. For now only the sample
 * store gets suggestions: who may see the inbox's real brands waits for
 * Raman, with following a real brand (the follow command takes sample
 * domains only) and signing the inbox up to new brands. Not yet: "similar
 * size" (the store's own size is not known yet).
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
  /** How many of all its emails carry each industry label. */
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
const say = (industry: Industry) => {
  const words = industryWords[industry] ?? industry
  return `${/^[aeiou]/.test(words) ? 'an' : 'a'} ${words}`
}

/**
 * The host of a web address, without `www.` and case, whether it was
 * saved as a bare domain or a link ("https://www.MyStore.com/shop").
 */
export function hostOf(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#:].*$/, '')
    .replace(/^www\./, '')
}

/** Whether two hosts are one website: the same, or one inside the other. */
const sameSite = (a: string, b: string) =>
  !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))

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
  brands: readonly InboxBrand[]
  max?: number
}): CompetitorSuggestion[] {
  const { industry, live, max = maxSuggestions } = input
  // "Other" is no likeness: nothing is suggested for it.
  if (industry === 'other') return []
  const own = hostOf(input.ownDomain ?? '')
  return input.brands
    .filter(
      (b) =>
        b.subscriptionStatus === 'subscribed' &&
        b.synthetic === !live &&
        !sameSite(hostOf(b.domain), own) &&
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
          ? `Also ${say(industry)} brand, and sent ${b.recent === 1 ? 'one email' : `${b.recent} emails`} in the last ${recentDays} days.`
          : `Also ${say(industry)} brand.`
    }))
}

type Db = SupabaseClient<Database>

/**
 * The workspace's suggestions, read with the person's own client: his
 * workspace's rows under its row rules, the inbox's brands through
 * `suggestable_inbox_brands` (members of the workspace only). No brand
 * profile yet: nothing (it is not known whether the store is real). A
 * failed read throws.
 */
export async function readCompetitorSuggestions(
  db: Db,
  tenantId: string,
  { now = new Date() }: { now?: Date } = {}
): Promise<CompetitorSuggestion[]> {
  const since = new Date(now.getTime() - recentDays * 86_400_000).toISOString()
  const [profile, findings, corrections, brands] = await Promise.all([
    db
      .from('brand_profiles')
      .select('domain,synthetic')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    listFindings(db, tenantId, { topic: 'offering' }),
    listCorrections(db, tenantId),
    db.rpc('suggestable_inbox_brands', { t: tenantId, since })
  ])
  if (profile.error) throw profile.error
  if (brands.error) throw brands.error
  if (!profile.data) return []
  // A real store never counts what the sample rules found.
  const live = !profile.data.synthetic
  const own = live ? findings.filter((f) => f.pass !== 'sample') : findings
  return suggestCompetitors({
    industry: correctedIndustry(own, corrections),
    ownDomain: profile.data.domain,
    live,
    brands: (brands.data ?? []).map((b) => ({
      id: b.id,
      domain: b.domain,
      name: b.brand_name ?? null,
      niche: b.niche ?? null,
      synthetic: b.synthetic,
      // The database gives subscribed brands only.
      subscriptionStatus: 'subscribed',
      lastReceivedAt: b.last_received_at ?? null,
      recent: b.recent,
      labelled: labelCounts(b.labels)
    }))
  })
}

/** The database's label counts, only known industries and whole counts. */
function labelCounts(labels: unknown): Partial<Record<Industry, number>> {
  const counts: Partial<Record<Industry, number>> = {}
  if (!labels || typeof labels !== 'object' || Array.isArray(labels))
    return counts
  for (const [key, n] of Object.entries(labels))
    if (
      (industries as readonly string[]).includes(key) &&
      Number.isInteger(n) &&
      (n as number) > 0
    )
      counts[key as Industry] = n as number
  return counts
}
