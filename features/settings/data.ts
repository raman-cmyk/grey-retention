import 'server-only'
import { klaviyoData } from '@/features/klaviyo-data/reader'
import type { AudienceOption } from '@/components/ui/audience-picker'
import type { ProductOption } from '@/components/ui/product-picker'
import { createClient } from '@/lib/supabase/server'
import { emptyDefaults, type CampaignDefaults } from './defaults'

export type SettingsData = {
  defaults: CampaignDefaults
  products: ProductOption[]
  audiences: AudienceOption[]
  /** Where the audience list comes from, stated honestly. */
  audienceSource: 'sample' | 'not_connected' | 'unavailable'
  /** The defaults table is missing on an older hosted database. */
  unavailable: boolean
}

/**
 * Everything the Settings page reads, for the signed-in workspace only.
 * `now` is the page's clock start; `data` is null without a session.
 */
export async function settingsPage(
  context: { tenantId: string; timezone: string },
  now = Date.now()
): Promise<{ now: number; data: SettingsData | null }> {
  const db = await createClient()
  if (!db) return { now, data: null }
  return { now, data: await load(db, context, now) }
}

async function load(
  db: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  context: { tenantId: string; timezone: string },
  now: number
): Promise<SettingsData> {
  const [row, products, klaviyo] = await Promise.all([
    db
      .from('campaign_defaults')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    db
      .from('products')
      .select('id,title')
      .eq('tenant_id', context.tenantId)
      .order('title')
      .limit(200),
    klaviyoData(context.tenantId, context.timezone, now)
  ])
  const saved = row.data
  return {
    defaults: saved
      ? {
          featuredProductId: saved.featured_product_id,
          senderName: saved.sender_name,
          primaryLink: saved.primary_link,
          sendTo: saved.send_to,
          dontSendTo: saved.dont_send_to,
          includeFooter: saved.include_footer,
          footerSource: 'auto',
          revision: saved.revision
        }
      : emptyDefaults,
    products: products.data ?? [],
    audiences:
      klaviyo.state === 'sample'
        ? [
            ...klaviyo.snapshot.lists.map((l) => ({
              id: l.id,
              name: l.name,
              kind: 'list' as const
            })),
            ...klaviyo.snapshot.segments.map((s) => ({
              id: s.id,
              name: s.name,
              kind: 'segment' as const
            }))
          ]
        : [],
    audienceSource: klaviyo.state,
    unavailable: Boolean(row.error)
  }
}
