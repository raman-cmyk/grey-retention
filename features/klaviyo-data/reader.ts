import 'server-only'
import { cache } from 'react'
import { getServerEnvironment } from '@/lib/env/server'
import { FakeKlaviyoReadProvider } from '@/lib/providers/fake-klaviyo-read'
import type { KlaviyoSnapshot } from '@/lib/providers/klaviyo-read'
import { createClient } from '@/lib/supabase/server'

export type ConnectionState =
  'connected' | 'disconnected' | 'expired' | 'error' | 'missing' | 'unknown'

/** What owner screens may show about Klaviyo, always stated honestly. */
export type KlaviyoData =
  | { state: 'sample'; snapshot: KlaviyoSnapshot; shopify: ConnectionState }
  | { state: 'not_connected'; reason: ConnectionState }
  | { state: 'unavailable' }

const states = new Set<ConnectionState>([
  'connected',
  'disconnected',
  'expired',
  'error'
])

/** The workspace's (fixture) connections, or null without a database. */
async function connections(tenantId: string) {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const { data, error } = await db
    .from('workspace_connections')
    .select('provider,status')
    .eq('tenant_id', tenantId)
  if (error) return { klaviyo: 'unknown', shopify: 'unknown' } as const
  const get = (provider: string): ConnectionState => {
    const status = data?.find((row) => row.provider === provider)?.status
    return status && states.has(status as ConnectionState)
      ? (status as ConnectionState)
      : 'missing'
  }
  return { klaviyo: get('klaviyo'), shopify: get('shopify') }
}

/**
 * One workspace's Klaviyo data for owner screens.
 * - Fake adapters (`ADAPTER_MODE=fake`, the default): labelled SAMPLE data,
 *   but only while the workspace's Klaviyo connection is on.
 * - Real mode: "unavailable", because the live read adapter is not built
 *   yet; it never claims a connected account is disconnected.
 * `now` is passed as milliseconds so request-level caching works.
 */
export const klaviyoData = cache(
  async (
    tenantId: string,
    timezone: string,
    nowMs: number
  ): Promise<KlaviyoData> => {
    if (getServerEnvironment().ADAPTER_MODE === 'real')
      return { state: 'unavailable' }
    const connection = await connections(tenantId)
    if (connection && connection.klaviyo !== 'connected')
      return { state: 'not_connected', reason: connection.klaviyo }
    const snapshot = await new FakeKlaviyoReadProvider().snapshot({
      tenantId,
      timezone,
      now: new Date(nowMs)
    })
    return {
      state: 'sample',
      snapshot,
      shopify: connection?.shopify ?? 'missing'
    }
  }
)
