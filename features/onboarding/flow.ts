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
import { klaviyoWorking, setupFlow, type SetupFlow } from './flow-model'

type Db = SupabaseClient<Database>

/**
 * The onboarding screen's read model (UI-ONBa, master handoff section 11):
 * the five steps and the one that is Now, the brand as saved, the Klaviyo
 * connection and the offers, read with the signed-in member's own client
 * (row rules keep it to the workspace). Every step's state needs every
 * record: when one cannot be read, the flow is unreadable and the screen
 * says so, never a guess. The brand found on the website and the readers'
 * progress come with the Brand step (UI-ONBc).
 */
export type SetupView = {
  state: 'ready' | 'demo' | 'unreadable'
  /** Only the owner saves steps; everyone else sees where setup is. */
  owner: boolean
  /** The workspace's name: the store's name until one is saved. */
  workspaceName: string
  flow: SetupFlow | null
  /** The brand as saved, with its revision for the next save. */
  brand: { name: string; domain: string; revision: number } | null
  klaviyo: KlaviyoState | null
  /** A key is checked with Klaviyo itself (KLAVIYO_MODE=live), else its format only. */
  liveKeys: boolean
  offers: ManagedOffers | null
}

/** The records the steps are read from; null when one cannot be read. */
export async function setupRecords(db: Db, tenantId: string) {
  const [brand, marks, following, klaviyo] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name,domain,revision')
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
    offers: null
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
      finished: !!marks?.finished_at
    }),
    brand: brand
      ? {
          name: brand.brand_name,
          domain: brand.domain,
          revision: brand.revision
        }
      : null,
    klaviyo: records.klaviyo,
    offers
  }
}
