import 'server-only'
import { klaviyoData } from '@/features/klaviyo-data/reader'
import type { AudienceOption } from '@/components/ui/audience-picker'
import type { ProductOption } from '@/components/ui/product-picker'
import { getServerEnvironment } from '@/lib/env/server'
import { validTimezone } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import { emptyDefaults, type CampaignDefaults } from './defaults'

export type SettingsData = {
  defaults: CampaignDefaults
  products: ProductOption[]
  /** 'error' keeps the saved product when the catalogue could not load. */
  productsState: 'ready' | 'error'
  /** The catalogue holds sample (fixture) products. */
  productsSample: boolean
  audiences: AudienceOption[]
  /** Where the audience list comes from, stated honestly. */
  audienceSource: 'sample' | 'not_connected' | 'unavailable'
}

export type SettingsPage = {
  now: number
  /** The one brand timezone (the Dashboard's), UTC if this runtime lacks it. */
  timezone: string
  state: 'ready' | 'missing_table' | 'load_failed' | 'demo' | 'no_database'
  data: SettingsData | null
}

/** PostgREST / Postgres codes for "this table does not exist yet". */
const missingTable = new Set(['PGRST205', '42P01'])

/** Everything the Settings page reads, for the signed-in workspace only. */
export async function settingsPage(
  context: { tenantId: string; timezone: string },
  now = Date.now()
): Promise<SettingsPage> {
  const timezone = validTimezone(context.timezone)
  const base = { now, timezone }
  if (getServerEnvironment().AUTH_MODE === 'demo')
    return { ...base, state: 'demo', data: null }
  const db = await createClient()
  if (!db) return { ...base, state: 'no_database', data: null }
  const [row, products, klaviyo] = await Promise.all([
    db
      .from('campaign_defaults')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    db
      .from('products')
      .select('id,title,synthetic')
      .eq('tenant_id', context.tenantId)
      .order('title')
      .limit(200),
    klaviyoData(context.tenantId, timezone, now)
  ])
  if (row.error)
    return {
      ...base,
      state: missingTable.has(row.error.code) ? 'missing_table' : 'load_failed',
      data: null
    }
  const saved = row.data
  const defaults: CampaignDefaults = saved
    ? {
        featuredProductId: saved.featured_product_id,
        senderName: saved.sender_name,
        primaryLink: saved.primary_link,
        sendTo: saved.send_to,
        dontSendTo: saved.dont_send_to,
        includeFooter: saved.include_footer,
        // The database allows only 'auto' for now.
        footerSource: 'auto',
        revision: saved.revision
      }
    : emptyDefaults
  const list = products.data ?? []
  // The saved product is always offered, even past the first 200.
  const savedId = defaults.featuredProductId
  if (!products.error && savedId && !list.some((p) => p.id === savedId)) {
    const one = await db
      .from('products')
      .select('id,title,synthetic')
      .eq('tenant_id', context.tenantId)
      .eq('id', savedId)
      .maybeSingle()
    if (one.data) list.unshift(one.data)
  }
  return {
    ...base,
    state: 'ready',
    data: {
      defaults,
      products: list.map(({ id, title }) => ({ id, title })),
      productsState: products.error ? 'error' : 'ready',
      productsSample: list.some((p) => p.synthetic),
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
      audienceSource: klaviyo.state
    }
  }
}
