import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandFacts } from '@/features/copy-qa/check'
import type { Database } from '@/lib/supabase/database.types'
import type { Industry } from '@/features/intelligence/taxonomy'
import { copyFacts, trueFacts, type FactTopic } from './brand-facts'
import type { CatalogEntry } from './catalog/read'
import { claimsSafety } from './claims-safety'
import type { Finding, FindingSource, FindingTopic } from './findings'
import type { StoredHistory } from './history/read'
import { industryInWords } from './industry'

/**
 * The Brand book (ONB-106b, AGENT_MAP §0 and §2, D19): what the agents
 * know about the brand, put together in code from what the onboarding
 * readers found. Every agent that uses the Brand book reads it as "the
 * brand's confirmed facts; never contradict them" (`brandBookBlock`), so:
 *
 * - `facts` holds only what is true under every source (`copyFacts`);
 * - what the sources disagree on is in `unclear`, never stated;
 * - everything else is the readers' own plain sentences, the surest few
 *   per topic, never a number or claim they did not check.
 *
 * Small on purpose: an agent's prompt takes at most 8,000 characters of it.
 * The strategist's own summary (AI) is ONB-106c; the owner corrects lines
 * on the Brand book review page (#58).
 */

export const brandBookSchema = 1
/** Who wrote a version (`brand_books.written_by`). */
export const brandBookAuthor = 'brand-book@1'

const perTopic = 3
const maxTitles = 8
const maxAudiences = 10

export type BrandBookContent = {
  schema: typeof brandBookSchema
  /** True when it rests on sample data, not the brand's own. */
  sample: boolean
  brand: {
    name: string | null
    site: string | null
    industry: Industry
    timezone: string
    currency: string | null
  }
  facts: Omit<BrandFacts, 'approvedClaims' | 'bannedPhrases'>
  /** What the sources disagree on: never state it until the owner says. */
  unclear: { topic: FactTopic; said: string[] }[]
  offering: string[]
  customers: {
    who: string[]
    love: string[]
    worries: string[]
  }
  voice: string[]
  /** Offers and angles seen in the brand's own ads and emails. */
  marketing: string[]
  products: {
    count: number
    bestsellers: string[]
    newArrivals: string[]
  }
  sending: {
    sendsPerWeek: number
    usualSendTime: string | null
    audiences: string[]
  } | null
  /** Why some claims are off limits for this kind of brand (ONB-062). */
  avoid: string[]
  sources: FindingSource[]
}

export type BrandBookParts = {
  brandName: string | null
  domain: string | null
  timezone: string
  currency: string | null
  findings: readonly Finding[]
  catalog: readonly CatalogEntry[]
  history: StoredHistory | null
}

/** The surest statements of the topics, at most `perTopic`, each once. */
function statements(
  findings: readonly Finding[],
  topics: readonly FindingTopic[],
  live: boolean
) {
  const seen = new Set<string>()
  return findings
    .filter(
      (f) =>
        topics.includes(f.topic) &&
        f.confidence >= 0.6 &&
        !(live && f.pass === 'sample')
    )
    .sort((a, b) => b.confidence - a.confidence)
    .flatMap((f) => {
      const key = f.statement.trim().toLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      return [f.statement.trim()]
    })
    .slice(0, perTopic)
}

const site = (domain: string | null) => {
  const d = (domain ?? '').trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? `https://${d}` : null
}

/** The Brand book from the readers' findings, the catalog and the history. */
export function brandBookFrom(parts: BrandBookParts): BrandBookContent {
  // A workspace read for real never takes a sample-rules finding.
  const live =
    parts.history?.live === true ||
    parts.findings.some((f) => f.pass === 'model')
  const facts = trueFacts(parts.findings, { live, currency: parts.currency })
  const copy = copyFacts(facts)
  // Only the facts: the brand's claims and banned words live elsewhere.
  const safe = {
    freeShipping: copy.freeShipping,
    deliveryDays: copy.deliveryDays,
    returnDays: copy.returnDays,
    guaranteeDays: copy.guaranteeDays,
    reviewsVerified: copy.reviewsVerified
  }
  const offering = statements(parts.findings, ['offering'], live)
  const industryWords = offering[0] ?? ''
  const featurable = parts.catalog.filter((p) => p.featurable)
  const used = parts.findings.filter((f) => !(live && f.pass === 'sample'))
  const history = parts.history
  return {
    schema: brandBookSchema,
    sample:
      !live ||
      used.some((f) => f.pass === 'sample') ||
      (history !== null && !history.live),
    brand: {
      name: parts.brandName?.trim() || null,
      site: site(parts.domain),
      industry: industryInWords(industryWords) ?? 'other',
      timezone: parts.timezone,
      currency: parts.currency
    },
    facts: safe,
    unclear: facts.conflicts.map((c) => ({
      topic: c.topic,
      said: [...new Set(c.said.map((s) => s.statement))].slice(0, perTopic)
    })),
    offering,
    customers: {
      who: statements(parts.findings, ['audience'], live),
      love: statements(parts.findings, ['review_theme'], live),
      worries: statements(parts.findings, ['objection'], live)
    },
    voice: statements(parts.findings, ['tone'], live),
    marketing: statements(
      parts.findings,
      ['promotion', 'angle', 'performance'],
      live
    ),
    products: {
      count: featurable.length,
      bestsellers: featurable
        .filter((p) => p.bestsellerRank !== null)
        .sort((a, b) => a.bestsellerRank! - b.bestsellerRank!)
        .slice(0, maxTitles)
        .map((p) => p.title),
      newArrivals: featurable
        .filter((p) => p.newArrival)
        .slice(0, maxTitles)
        .map((p) => p.title)
    },
    sending:
      history && history.state !== 'empty'
        ? {
            sendsPerWeek: history.history.sendsPerWeek,
            usualSendTime: history.history.usualSendTime,
            audiences: history.history.audiences
              .filter((a) => a.active && !a.excludedOnly)
              .slice(0, maxAudiences)
              .map((a) => a.name)
          }
        : null,
    avoid: claimsSafety(industryWords).groups.map((g) => g.reason),
    sources: [...new Set(used.map((f) => f.source))].sort()
  }
}

type Db = SupabaseClient<Database>

/** The same JSON whatever its keys' order (Postgres reorders jsonb keys). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)])
    )
  return value
}
export const sameBook = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/**
 * Saves the Brand book as a new version when it changed (the worker's
 * service-role client; `save_brand_book` is the only way to write one).
 * Returns the version saved, or null when nothing changed.
 */
export async function saveBrandBook(
  db: Db,
  tenantId: string,
  content: BrandBookContent
): Promise<number | null> {
  const latest = await db
    .from('brand_books')
    .select('content')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (latest.error) throw latest.error
  const before = latest.data?.[0]?.content
  if (before && sameBook(before, content)) return null
  const saved = await db.rpc('save_brand_book', {
    t: tenantId,
    content: content as never,
    written_by: brandBookAuthor
  })
  if (saved.error) throw saved.error
  return saved.data as number
}

/**
 * Reads the workspace's findings, catalog, history and profile, and saves
 * the Brand book when it changed. A failed read throws (the caller logs).
 */
export async function writeBrandBook(
  db: Db,
  tenantId: string,
  reads: {
    findings: (db: Db, t: string) => Promise<Finding[]>
    catalog: (db: Db, t: string) => Promise<CatalogEntry[]>
    history: (db: Db, t: string) => Promise<StoredHistory | null>
    timezone: (db: Db, t: string) => Promise<string>
  }
): Promise<number | null> {
  const [findings, catalog, history, timezone, profile, status] =
    await Promise.all([
      reads.findings(db, tenantId),
      reads.catalog(db, tenantId),
      reads.history(db, tenantId),
      reads.timezone(db, tenantId),
      db
        .from('brand_profiles')
        .select('brand_name,domain')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      db
        .from('catalog_status')
        .select('currency')
        .eq('tenant_id', tenantId)
        .maybeSingle()
    ])
  if (profile.error) throw profile.error
  if (status.error) throw status.error
  return saveBrandBook(
    db,
    tenantId,
    brandBookFrom({
      brandName: profile.data?.brand_name ?? null,
      domain: profile.data?.domain ?? null,
      timezone,
      currency: status.data?.currency ?? null,
      findings,
      catalog,
      history
    })
  )
}
