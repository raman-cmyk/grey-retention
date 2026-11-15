import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { brandFromKit } from '@/features/blocks/brand'
import {
  sampleStoreFrom,
  type Store,
  type StoreSource
} from '@/features/email-build/ports'
import {
  applyCorrections,
  correctedFacts,
  listCorrections,
  type Correction
} from '@/features/onboarding/brand-book-corrections'
import { copyFacts, trueFacts } from '@/features/onboarding/brand-facts'
import {
  catalogPriceCheck,
  withSanePrices
} from '@/features/onboarding/catalog/price-check'
import {
  assemblyProducts,
  listCatalog,
  type CatalogEntry
} from '@/features/onboarding/catalog/read'
import { withClaimsSafety } from '@/features/onboarding/claims-safety'
import { customerWords } from '@/features/onboarding/customer-words'
import { listFindings, type Finding } from '@/features/onboarding/findings'
import { industryInWords } from '@/features/onboarding/industry'
import { workspaceTimezone } from '@/features/strategy/offers'
import type { Industry } from '@/features/intelligence/taxonomy'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The store "Create email" builds from (ONB-057b part 2): the store its
 * plan was made from (`storeForPlan`). A plan made from the sample builds
 * on the sample store (marked sample: never pushed to a real account); a
 * plan made from the workspace's own data builds on its own store:
 *
 * - Products: the catalog's featurable ones with a photo, only the fake
 *   Klaviyo's while it was read fake and never once it is read live, and
 *   without prices the check doubts (ONB-063: none when the catalog is on
 *   another scale from the website). A store with none left has none: it
 *   never gets the sample's.
 * - Brand: the brand kit's colours and fonts, the brand's name and site.
 * - Facts: only what every source agrees on (ONB-106a), the owner's own
 *   corrections on top (ONB-058), and the industry's risky claims banned
 *   (ONB-062). Anything unknown stays unknown, so copy QA refuses it.
 * - Industry: from what the brand sells, as the owner corrected it.
 * - Customer words: the reviews' own phrases, checked like copy (ONB-061).
 *
 * It is `sample` while the catalog was read from the fake Klaviyo. A
 * paused read (Klaviyo refused the key) keeps the last read's products. A
 * read that fails throws (the step is tried again); it never turns the
 * workspace's own store into the sample.
 */

type Db = SupabaseClient<Database>

export type OwnStoreParts = {
  brandName: string
  domain: string
  kit: { colors: string[]; fonts: string[] } | null
  timezone: string
  /** `catalog_status`: whether it was read live, and its currency. */
  status: { live: boolean; currency: string | null }
  catalog: readonly CatalogEntry[]
  findings: readonly Finding[]
  corrections: readonly Correction[]
}

const hostname =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const key = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The industry from what the brand sells: the owner's own lines first,
 * then the readers' surest, as he corrected them (ONB-058).
 */
export function correctedIndustry(
  findings: readonly Finding[],
  corrections: readonly Correction[]
): Industry {
  const offering = findings
    .filter((f) => f.topic === 'offering')
    .sort((a, b) => b.confidence - a.confidence)
    .map((f) => f.statement.trim())
  const own = corrections.filter((c) => c.section === 'offering')
  const lines =
    applyCorrections({ observed: { offering } }, own).observed?.offering ?? []
  const added = new Set(
    own.flatMap((c) => (c.action === 'add' && c.value ? [key(c.value)] : []))
  )
  const first =
    lines.find((l) => added.has(key(l))) ??
    lines.find((l) => !added.has(key(l))) ??
    ''
  return industryInWords(first) ?? 'other'
}

/** The store, from its parts. Pure, for tests. */
export function storeFrom(parts: OwnStoreParts): Store {
  // A live workspace never counts what the sample rules found.
  const live =
    parts.status.live || parts.findings.some((f) => f.pass !== 'sample')
  const findings = live
    ? parts.findings.filter((f) => f.pass !== 'sample')
    : parts.findings
  const industry = correctedIndustry(findings, parts.corrections)
  const check = catalogPriceCheck(parts.catalog, findings, {
    currency: parts.status.currency
  })
  const products = assemblyProducts(withSanePrices(parts.catalog, check))
  const facts = withClaimsSafety(
    correctedFacts(
      copyFacts(trueFacts(findings, { live, currency: parts.status.currency })),
      parts.corrections
    ),
    industry
  )
  const name = parts.brandName.trim()
  const domain = parts.domain.trim().toLowerCase()
  return {
    sample: !parts.status.live,
    brand: brandFromKit({
      name,
      site: hostname.test(domain) ? `https://${domain}` : '',
      colors: parts.kit?.colors ?? [],
      fonts: parts.kit?.fonts ?? []
    }),
    industry,
    timezone: parts.timezone,
    products,
    facts,
    customerWords: customerWords(findings, {
      facts,
      live,
      names: [name, ...products.map((p) => p.title)].filter(Boolean)
    }).map((p) => p.phrase)
  }
}

/** Which store a plan was made from (`strategy_runs.plan`). */
export type PlanStore = { own: boolean; sample: boolean }

/**
 * The store the email's plan was made from. A plan saved before the flags,
 * or not found, counts as made from the sample store. Throws on a failed
 * read.
 */
export async function planStore(
  db: Db,
  job: { tenant_id: string; run_id: string }
): Promise<PlanStore> {
  const { data, error } = await db
    .from('strategy_runs')
    .select('own:plan->own,sample:plan->sample')
    .eq('tenant_id', job.tenant_id)
    .eq('id', job.run_id)
    .maybeSingle()
  if (error) throw error
  return { own: data?.own === true, sample: data?.sample !== false }
}

/** The store to build from: the one the plan was made from. */
export const storeForPlan = (
  db: Db,
  plan: PlanStore,
  start: string
): StoreSource => (plan.own ? ownStoreSource(db) : sampleStoreFrom(start))

/**
 * The workspace's own store. Reads with the worker's client. A workspace
 * whose catalog was never read has none: `plan_store_changed` (planning
 * again makes a plan from the sample store).
 */
export function ownStoreSource(db: Db): StoreSource {
  return {
    async read(tenantId) {
      // The catalog's state first: no other read until there is a store.
      const status = await db
        .from('catalog_status')
        .select('live,currency')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (status.error) throw status.error
      if (!status.data)
        throw Object.assign(new Error('plan_store_changed'), {
          code: 'plan_store_changed'
        })
      const { live, currency } = status.data
      const [timezone, catalog, findings, corrections, profile, kit] =
        await Promise.all([
          workspaceTimezone(db, tenantId),
          listCatalog(db, tenantId, { featurableOnly: true, synthetic: !live }),
          listFindings(db, tenantId),
          listCorrections(db, tenantId),
          db
            .from('brand_profiles')
            .select('brand_name,domain')
            .eq('tenant_id', tenantId)
            .maybeSingle(),
          db
            .from('brand_kits')
            .select('colors,fonts')
            .eq('tenant_id', tenantId)
            .maybeSingle()
        ])
      if (profile.error) throw profile.error
      if (kit.error) throw kit.error
      return storeFrom({
        brandName: profile.data?.brand_name ?? '',
        domain: profile.data?.domain ?? '',
        kit: kit.data,
        timezone,
        status: { live, currency },
        catalog,
        findings,
        corrections
      })
    }
  }
}
