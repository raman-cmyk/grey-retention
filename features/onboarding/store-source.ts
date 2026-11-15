import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { brandFromKit } from '@/features/blocks/brand'
import type { Store, StoreSource } from '@/features/email-build/ports'
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
import { listFindings, type Finding } from '@/features/onboarding/findings'
import { industryFrom } from '@/features/onboarding/strategy-data'
import { workspaceTimezone } from '@/features/strategy/offers'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The store "Create email" builds from (ONB-057b part 2): the workspace's
 * own once its catalog has been read, else `fallback` (the sample store).
 *
 * - Products: the catalog's featurable ones with a photo, without prices
 *   the check doubts (ONB-063: none when the catalog is on another scale
 *   from the website).
 * - Brand: the brand kit's colours and fonts, the brand's name and site.
 * - Facts: only what every source agrees on (ONB-106a), the owner's own
 *   corrections on top (ONB-058), and the industry's risky claims banned
 *   (ONB-062). Anything unknown stays unknown, so copy QA refuses it.
 * - Industry: the surest "offering" finding on the fixed list (ONB-062).
 *
 * The store is real whenever the catalog is, whatever the plan was built
 * from: the build takes its products from the store, and a step on real
 * data after one on the sample starts over (REL-AI). It is `sample` while
 * the catalog was read from the fake Klaviyo. A read that fails throws
 * (the step is tried again); it never turns a real store into the sample.
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

/** Whether a catalog read can be built from: finished, with products to feature. */
export const catalogReady = (
  status: { state: string; featurable: number } | null
) => status !== null && status.state === 'ready' && status.featurable > 0

const hostname =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** The store, from its parts. Pure, for tests. */
export function storeFrom(parts: OwnStoreParts): Store {
  // A live workspace never counts what the sample rules found.
  const live =
    parts.status.live || parts.findings.some((f) => f.pass !== 'sample')
  const industry = industryFrom(parts.findings, { live }).key
  const check = catalogPriceCheck(parts.catalog, parts.findings, {
    currency: parts.status.currency
  })
  const products = assemblyProducts(withSanePrices(parts.catalog, check))
  const facts = withClaimsSafety(
    correctedFacts(
      copyFacts(
        trueFacts(parts.findings, { live, currency: parts.status.currency })
      ),
      parts.corrections
    ),
    industry
  )
  const domain = parts.domain.trim().toLowerCase()
  return {
    sample: !parts.status.live,
    brand: brandFromKit({
      name: parts.brandName,
      site: hostname.test(domain) ? `https://${domain}` : '',
      colors: parts.kit?.colors ?? [],
      fonts: parts.kit?.fonts ?? []
    }),
    industry,
    timezone: parts.timezone,
    products,
    facts
  }
}

/** The workspace's own store, or `fallback` until its catalog is read. Reads with the worker's client. */
export function onboardedStoreSource(
  db: Db,
  { fallback }: { fallback: StoreSource }
): StoreSource {
  return {
    async read(tenantId) {
      // The catalog's state first: no other read until there is a store.
      const status = await db
        .from('catalog_status')
        .select('state,featurable,live,currency')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (status.error) throw status.error
      if (!catalogReady(status.data)) return fallback.read(tenantId)
      const [timezone, catalog, findings, corrections, profile, kit] =
        await Promise.all([
          workspaceTimezone(db, tenantId),
          listCatalog(db, tenantId, { featurableOnly: true }),
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
        status: {
          live: status.data!.live,
          currency: status.data!.currency
        },
        catalog,
        findings,
        corrections
      })
    }
  }
}
