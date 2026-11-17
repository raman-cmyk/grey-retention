import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { unstable_rethrow } from 'next/navigation'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { offersPage } from '@/features/offers/data'
import type { ManagedOffers } from '@/features/offers/source'
import { klaviyoState, type KlaviyoState } from '@/features/settings/read-model'
import { getServerEnvironment } from '@/lib/env/server'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import { readBrandFound, type BrandFound } from './brand-found'
import {
  klaviyoWorking,
  setupFlow,
  siteDomain,
  type SetupFlow
} from './flow-model'
import { readOnboardingProgress, type OnboardingProgress } from './progress'

type Db = SupabaseClient<Database>

/**
 * The onboarding screen's read model (UI-ONBa, master handoff section 11):
 * the five steps and the one that is Now, the brand as saved, the Klaviyo
 * connection and the offers, read with the signed-in member's own client
 * (row rules keep it to the workspace). Every step's state needs every
 * record: when one cannot be read, the flow is unreadable and the screen
 * says so, never a guess. Once a website is saved it also reads what was
 * found there (`readBrandFound`) and the readers' progress (UI-ONBc); each
 * is null when it cannot be read, and the steps still show.
 */
export type SetupView = {
  state: 'ready' | 'demo' | 'unreadable'
  /** Only the owner saves steps; everyone else sees where setup is. */
  owner: boolean
  /** The workspace's name: the store's name until one is saved. */
  workspaceName: string
  flow: SetupFlow | null
  /** The brand as saved, with its revision for the next save. */
  brand: {
    name: string
    domain: string
    revision: number
    /** How emails should sound and what to avoid, as saved (optional). */
    voice: string
    prohibitions: string
  } | null
  klaviyo: KlaviyoState | null
  /** A key is checked with Klaviyo itself (KLAVIYO_MODE=live), else its format only. */
  liveKeys: boolean
  offers: ManagedOffers | null
  /** What was found for the saved website; null before one or when unreadable. */
  found: BrandFound | null
  /** The readers' progress; null before a website or when unreadable. */
  reading: OnboardingProgress | null
}

/** The records the steps are read from; null when one cannot be read. */
export async function setupRecords(db: Db, tenantId: string) {
  const [brand, marks, following, klaviyo] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name,domain,revision,voice,prohibitions')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('onboarding_steps')
      .select('brand_site,rivals_skipped_at,finished_at')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('competitor_subscriptions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .limit(1),
    klaviyoState(db, tenantId)
  ])
  if (brand.error || marks.error || following.error || !klaviyo) return null
  return {
    brand: brand.data,
    marks: marks.data,
    following: following.data?.length ?? 0,
    klaviyo
  }
}

const settle = <T>(work: Promise<T>) =>
  work.catch((error: unknown) => {
    unstable_rethrow(error)
    return null
  })

/** Onboarding for the signed-in member's workspace. */
export async function setupReadModel(
  context: ClientRequestContext
): Promise<SetupView> {
  const liveKeys = klaviyoMode() === 'live'
  const view: SetupView = {
    state: 'unreadable',
    owner: context.tenantRole === 'owner',
    workspaceName: context.tenantName,
    flow: null,
    brand: null,
    klaviyo: null,
    liveKeys,
    offers: null,
    found: null,
    reading: null
  }
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return { ...view, state: 'demo' }
  const db = await createClient()
  if (!db) return view
  const [records, offers] = await Promise.all([
    settle(setupRecords(db, context.tenantId)),
    settle(offersPage(context))
  ])
  // Discount is a step: without the offers its state is not known.
  if (!records || !offers) return view
  const { brand, marks } = records
  const site = siteDomain(brand?.domain)
  const [found, reading] = site
    ? await Promise.all([
        settle(readBrandFound(db, context.tenantId, site)),
        settle(readOnboardingProgress(db, context.tenantId))
      ])
    : [null, null]
  return {
    ...view,
    state: 'ready',
    flow: setupFlow({
      domain: brand?.domain ?? null,
      confirmedSite: marks?.brand_site ?? null,
      klaviyoWorking: klaviyoWorking(records.klaviyo, liveKeys),
      maxDiscountSet: offers.maxDiscountPercent !== null,
      following: records.following,
      rivalsSkipped: !!marks?.rivals_skipped_at,
      finished: !!marks?.finished_at,
      tracked: !!marks
    }),
    brand: brand
      ? {
          name: brand.brand_name,
          domain: brand.domain,
          revision: brand.revision,
          voice: brand.voice,
          prohibitions: brand.prohibitions
        }
      : null,
    klaviyo: records.klaviyo,
    offers,
    found,
    reading
  }
}
