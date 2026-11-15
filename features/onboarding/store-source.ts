import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { brandFromKit } from '@/features/blocks/brand'
import {
  sampleStoreFrom,
  type Store,
  type StoreSource
} from '@/features/email-build/ports'
import {
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
import { industryFrom } from '@/features/onboarding/strategy-data'
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
 * - Brand: the brand kit's colours and fonts, the brand's name and site,
 *   and its logos for light and dark sections when the Site reader kept
 *   them from this same website (ONB-060b; none: the name is shown).
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
  /** `brand_logos`: the site they were read from and the two pictures. */
  logos?: {
    domain: string
    onLight: string | null
    onDark: string | null
  } | null
  timezone: string
  /** `catalog_status`: whether it was read live, and its currency. */
  status: { live: boolean; currency: string | null }
  catalog: readonly CatalogEntry[]
  findings: readonly Finding[]
  corrections: readonly Correction[]
}

const hostname =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * The industry from what the brand sells, as the owner corrected it: the
 * planner's own rule (`industryFrom`, ONB-057c), on findings already
 * kept for this store.
 */
export const correctedIndustry = (
  findings: readonly Finding[],
  corrections: readonly Correction[]
): Industry => industryFrom(findings, { corrections }).key

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
  // Logos read from another website (the owner changed it) are not his.
  const logos =
    parts.logos &&
    parts.logos.domain === domain.replace(/^www\./, '') &&
    hostname.test(domain)
      ? parts.logos
      : null
  return {
    sample: !parts.status.live,
    brand: brandFromKit({
      name,
      site: hostname.test(domain) ? `https://${domain}` : '',
      colors: parts.kit?.colors ?? [],
      fonts: parts.kit?.fonts ?? [],
      logo: logos?.onLight ?? undefined,
      logoOnDark: logos?.onDark ?? undefined
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
      const [timezone, catalog, findings, corrections, profile, kit, logos] =
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
            .maybeSingle(),
          db
            .from('brand_logos')
            .select('domain,on_light,on_dark')
            .eq('tenant_id', tenantId)
            .maybeSingle()
        ])
      if (profile.error) throw profile.error
      if (kit.error) throw kit.error
      // The logos are optional: without them the email shows the name.
      if (logos.error)
        logger.warn('Brand logos unreadable', { code: logos.error.code })
      return storeFrom({
        brandName: profile.data?.brand_name ?? '',
        domain: profile.data?.domain ?? '',
        kit: kit.data,
        logos:
          logos.error || !logos.data
            ? null
            : {
                domain: logos.data.domain,
                onLight: logos.data.on_light,
                onDark: logos.data.on_dark
              },
        timezone,
        status: { live, currency },
        catalog,
        findings,
        corrections
      })
    }
  }
}
