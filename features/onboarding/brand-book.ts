import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandFacts } from '@/features/copy-qa/check'
import type { Database } from '@/lib/supabase/database.types'
import type { Industry } from '@/features/intelligence/taxonomy'
import {
  copyFacts,
  minConfidence,
  trueFacts,
  type FactTopic
} from './brand-facts'
import { applyCorrections, type Correction } from './brand-book-corrections'
import type { CatalogEntry } from './catalog/read'
import { claimsSafety } from './claims-safety'
import type { Finding, FindingSource, FindingTopic } from './findings'
import type { StoredHistory } from './history/read'
import { industryInWords } from './industry'
import { plain } from './words'

/**
 * The Brand book (ONB-106b, AGENT_MAP §0 and §2, D19): what the agents
 * know about the brand, put together in code from what the onboarding
 * readers found. Two kinds of content, kept apart:
 *
 * - **confirmed**: `facts`, only what is true under every source
 *   (`copyFacts`), and `owner`, the brand profile the owner approved;
 *   `unclear` names the topics the sources disagree on, with one rule:
 *   make no claim about them (never their sentences);
 * - **observed**: what the readers saw, in their own plain sentences (no
 *   number and no claim, the shared `plain` check), the surest three per
 *   topic, never a dated ad offer (those are the Brand pulse's, with end
 *   dates), and the sending habits only from a full Klaviyo read.
 *
 * The same inputs always give the same book (ties ordered by source and
 * words), so a new version is saved only when something changed. At most
 * `maxBookChars` characters: an agent's prompt takes at most 8,000. A real
 * brand never gets a sample book. The strategist's own summary (AI) is
 * ONB-106c; the owner corrects lines through ONB-058.
 */

export const brandBookSchema = 2
/** Who wrote a version (`brand_books.written_by`). */
export const brandBookAuthor = 'brand-book@2'
/** Leaves room in an agent's 8,000-character Brand book block. */
export const maxBookChars = 7_000

const perTopic = 3
const maxTitles = 8
const maxAudiences = 10
const unclearRule = 'Sources disagree: make no claim about it.'

export type BookFacts = Omit<BrandFacts, 'approvedClaims' | 'bannedPhrases'>

export type BrandBookContent = {
  schema: typeof brandBookSchema
  /** True when it rests on sample data (only ever saved for a sample brand). */
  sample: boolean
  brand: {
    name: string | null
    site: string | null
    industry: Industry
    timezone: string
    currency: string | null
  }
  /** Confirmed: true under every source. */
  facts: BookFacts
  /** Confirmed: the brand profile the owner approved, when he did. */
  owner: { positioning: string; voice: string; prohibitions: string } | null
  /** Topics the sources disagree on: never state them. */
  unclear: { topic: FactTopic; rule: string }[]
  /** What the readers saw: not confirmed, never stated as a fact. */
  observed: {
    offering: string[]
    customers: { who: string[]; love: string[]; worries: string[] }
    voice: string[]
    /** Angles in its ads and what made money in its emails. */
    marketing: string[]
    sending: {
      sendsPerWeek: number
      usualSendTime: string | null
      audiences: string[]
    } | null
  }
  products: { count: number; bestsellers: string[]; newArrivals: string[] }
  /** Why some claims are off limits for this kind of brand (ONB-062). */
  avoid: string[]
  sources: FindingSource[]
  /**
   * ONB-058: the sections the owner corrected (his facts are in `facts`,
   * his lines in `observed`). Absent when he corrected nothing.
   */
  corrected?: string[]
}

export type BrandBookParts = {
  brandName: string | null
  domain: string | null
  timezone: string
  currency: string | null
  findings: readonly Finding[]
  catalog: readonly CatalogEntry[]
  history: StoredHistory | null
  /** The catalog read's own count and whether it was live. */
  catalogStatus: { featurable: number; live: boolean } | null
  /** The approved brand profile's words, when approved. */
  owner: BrandBookContent['owner']
}

const bySureness = (a: Finding, b: Finding) =>
  b.confidence - a.confidence ||
  a.source.localeCompare(b.source) ||
  a.statement.localeCompare(b.statement)

/** The surest plain statements of the topics, at most `perTopic`, each once. */
function statements(
  findings: readonly Finding[],
  topics: readonly FindingTopic[],
  max = perTopic
) {
  const seen = new Set<string>()
  return findings
    .filter((f) => topics.includes(f.topic) && plain(f.statement))
    .sort(bySureness)
    .flatMap((f) => {
      const text = f.statement.trim()
      const key = text.toLowerCase()
      if (seen.has(key)) return []
      seen.add(key)
      return [text]
    })
    .slice(0, max)
}

const site = (domain: string | null) => {
  const d = (domain ?? '').trim().toLowerCase()
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? `https://${d}` : null
}

/** A line whatever its case and spacing (as ONB-058 matches it). */
const lineKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Drops the least needed observed lines until the book fits: the readers'
 * first, the owner's own lines (`keep`, ONB-058) only after them.
 */
function fit(
  book: BrandBookContent,
  keep: ReadonlySet<string> = new Set()
): BrandBookContent {
  const size = () => JSON.stringify(book).length
  const lists = [
    book.observed.marketing,
    book.observed.customers.worries,
    book.observed.voice,
    book.observed.customers.love,
    book.observed.customers.who,
    book.products.newArrivals,
    book.products.bestsellers,
    book.observed.offering
  ]
  const readers = (list: string[]) => {
    for (let i = list.length - 1; i >= 0 && size() > maxBookChars; i--)
      if (!keep.has(lineKey(list[i]!))) list.splice(i, 1)
  }
  for (const list of lists) readers(list)
  for (const list of lists)
    while (size() > maxBookChars && list.length) list.pop()
  if (size() > maxBookChars && book.observed.sending)
    book.observed.sending.audiences = []
  return book
}

/** The Brand book from the readers' findings, the catalog and the history. */
export function brandBookFrom(parts: BrandBookParts): BrandBookContent {
  // Read for real when any reader read the brand's own data.
  const live =
    parts.history?.live === true ||
    parts.catalogStatus?.live === true ||
    parts.findings.some((f) => f.pass !== 'sample')
  const used = parts.findings.filter(
    (f) => f.confidence >= minConfidence && !(live && f.pass === 'sample')
  )
  const facts = trueFacts(parts.findings, { live, currency: parts.currency })
  const copy = copyFacts(facts)
  const offering = statements(used, ['offering'])
  // The industry from every offering sentence, not just the first.
  const industryWords = statements(used, ['offering'], 20).join('. ')
  const featurable = parts.catalog.filter((p) => p.featurable)
  const history = parts.history
  const full = history?.state === 'ready' && history.complete
  return fit({
    schema: brandBookSchema,
    sample: !live,
    brand: {
      name: parts.brandName?.trim() || null,
      site: site(parts.domain),
      industry: industryInWords(industryWords) ?? 'other',
      timezone: parts.timezone,
      currency: parts.currency
    },
    facts: {
      freeShipping: copy.freeShipping,
      deliveryDays: copy.deliveryDays,
      returnDays: copy.returnDays,
      guaranteeDays: copy.guaranteeDays,
      reviewsVerified: copy.reviewsVerified
    },
    owner: parts.owner,
    unclear: [...new Set(facts.conflicts.map((c) => c.topic))]
      .sort()
      .map((topic) => ({ topic, rule: unclearRule })),
    observed: {
      offering,
      customers: {
        who: statements(used, ['audience']),
        love: statements(used, ['review_theme']),
        worries: statements(used, ['objection'])
      },
      voice: statements(used, ['tone']),
      // Never `promotion`: an ad's offer is dated (the Brand pulse's).
      marketing: statements(used, ['angle', 'performance']),
      sending:
        history && full
          ? {
              sendsPerWeek: history.history.sendsPerWeek,
              usualSendTime: history.history.usualSendTime,
              audiences: history.history.audiences
                .filter((a) => a.active && !a.excludedOnly)
                .map((a) => a.name)
                .sort()
                .slice(0, maxAudiences)
            }
          : null
    },
    products: {
      count: parts.catalogStatus?.featurable ?? featurable.length,
      bestsellers: featurable
        .filter((p) => p.bestsellerRank !== null)
        .sort((a, b) => a.bestsellerRank! - b.bestsellerRank!)
        .slice(0, maxTitles)
        .map((p) => p.title),
      newArrivals: featurable
        .filter((p) => p.newArrival)
        .sort(
          (a, b) =>
            (b.launchedAt ?? '').localeCompare(a.launchedAt ?? '') ||
            a.title.localeCompare(b.title)
        )
        .slice(0, maxTitles)
        .map((p) => p.title)
    },
    avoid: claimsSafety(industryWords).groups.map((g) => g.reason),
    sources: [...new Set(used.map((f) => f.source))].sort()
  })
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

async function profileOf(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_profiles')
    .select(
      'brand_name,domain,synthetic,voice,positioning,prohibitions,revision,approved_revision'
    )
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function catalogStatusOf(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('catalog_status')
    .select('currency,featurable,live')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Reads the workspace's findings, catalog, history and profile, and saves
 * the Brand book when it changed. A real brand with only sample data gets
 * none (an agent would read it as the brand's). A failed read throws.
 */
export async function writeBrandBook(
  db: Db,
  tenantId: string,
  reads: {
    findings: (db: Db, t: string) => Promise<Finding[]>
    catalog: (db: Db, t: string) => Promise<CatalogEntry[]>
    history: (db: Db, t: string) => Promise<StoredHistory | null>
    timezone: (db: Db, t: string) => Promise<string>
    /** ONB-058: the owner's live corrections, oldest first. */
    corrections: (db: Db, t: string) => Promise<Correction[]>
  }
): Promise<number | null> {
  const [findings, catalog, history, timezone, profile, status, corrections] =
    await Promise.all([
      reads.findings(db, tenantId),
      reads.catalog(db, tenantId),
      reads.history(db, tenantId),
      reads.timezone(db, tenantId),
      profileOf(db, tenantId),
      catalogStatusOf(db, tenantId),
      reads.corrections(db, tenantId)
    ])
  const approved =
    profile !== null &&
    profile.approved_revision !== null &&
    profile.approved_revision === profile.revision
  const book = brandBookFrom({
    brandName: profile?.brand_name ?? null,
    domain: profile?.domain ?? null,
    timezone,
    currency: status?.currency ?? null,
    findings,
    catalog,
    history,
    catalogStatus: status
      ? { featurable: status.featurable, live: status.live }
      : null,
    owner: approved
      ? {
          positioning: profile.positioning,
          voice: profile.voice,
          prohibitions: profile.prohibitions
        }
      : null
  })
  if (book.sample && profile?.synthetic !== true) return null
  return saveBrandBook(db, tenantId, withCorrections(book, corrections))
}

/**
 * The book with the owner's corrections (ONB-058): his facts confirmed and
 * no longer unclear, his lines in place of the readers'. Cut to size, his
 * own lines go last. A book he never corrected is unchanged.
 */
export function withCorrections(
  book: BrandBookContent,
  corrections: readonly Correction[]
): BrandBookContent {
  if (!corrections.length) return book
  const corrected = applyCorrections(book, corrections)
  // Nothing he named is in this book (yet): the book as it is.
  if (!corrected.corrected.length) return book
  const own = new Set(
    corrections.flatMap((c) =>
      !c.section.startsWith('facts.') && c.action !== 'remove' && c.value
        ? [lineKey(c.value)]
        : []
    )
  )
  return fit(corrected, own)
}

/** The onboarding readers' jobs (a read that finished changes the book). */
const readerKinds = [
  'brand.read_site',
  'brand.read_catalog',
  'brand.read_history',
  'brand.read_ads',
  'brand.read_reviews'
]

/**
 * Workspaces whose newest finished read, or the owner's newest correction
 * made or taken back (ONB-058), since `since`, is newer than their newest
 * Brand book: a write that was skipped or failed is caught up by the next
 * readers' run. At most `limit`, newest first.
 */
export async function staleBooks(
  db: Db,
  { since, limit = 5 }: { since: string; limit?: number }
): Promise<string[]> {
  const reads = await db
    .from('job_runs')
    .select('tenant_id,updated_at')
    .in('kind', readerKinds)
    .eq('status', 'succeeded')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (reads.error) throw reads.error
  const changes = (column: 'created_at' | 'withdrawn_at') =>
    db
      .from('brand_book_corrections')
      .select(`tenant_id,at:${column}`)
      .gte(column, since)
      .order(column, { ascending: false })
      .limit(200)
  const [made, withdrawn] = await Promise.all([
    changes('created_at'),
    changes('withdrawn_at')
  ])
  if (made.error) throw made.error
  if (withdrawn.error) throw withdrawn.error
  const newest = new Map<string, string>()
  const seen = (tenant: string, at: string | null) => {
    if (!at) return
    const was = newest.get(tenant)
    if (!was || Date.parse(at) > Date.parse(was)) newest.set(tenant, at)
  }
  for (const r of reads.data ?? []) seen(r.tenant_id, r.updated_at)
  for (const c of [...(made.data ?? []), ...(withdrawn.data ?? [])])
    seen(c.tenant_id, c.at)
  if (!newest.size) return []
  const books = await db
    .from('brand_books')
    .select('tenant_id,created_at')
    .in('tenant_id', [...newest.keys()])
    .order('created_at', { ascending: false })
    .limit(1000)
  if (books.error) throw books.error
  const written = new Map<string, string>()
  for (const b of books.data ?? [])
    if (!written.has(b.tenant_id)) written.set(b.tenant_id, b.created_at)
  return [...newest]
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .filter(
      ([t, at]) =>
        !written.has(t) || Date.parse(written.get(t)!) < Date.parse(at)
    )
    .map(([t]) => t)
    .slice(0, limit)
}

/** Waits at most `ms` for a write; the route must end in time. */
export async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error('brand_book_timeout'), {
                code: 'brand_book_timeout'
              })
            ),
          ms
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
