import 'server-only'
import { isKnownTimezone, timezoneOptions } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'

/** Where the brand timezone came from (UIR-023). */
export type TimezoneSource = 'setup' | 'klaviyo' | 'owner' | 'unknown'

export type BrandTimezone = {
  /**
   * The brand timezone exactly as saved. Settings sends it back with a
   * change, so a change made in another window is noticed.
   */
  saved: string
  source: TimezoneSource
  /** The connected Klaviyo account's timezone, when it reported one. */
  klaviyoTimezone: string | null
  /**
   * The timezones the owner can pick, built here on the server so the page
   * and the browser show the same list.
   */
  options: string[]
}

const sources = new Set<TimezoneSource>(['setup', 'klaviyo', 'owner'])

/**
 * Where the workspace's brand timezone came from and the Klaviyo account's
 * timezone, for Settings. The timezone every page uses is the request
 * context's; this reads the saved name again for the stale-page check.
 */
export async function brandTimezone(context: {
  tenantId: string
  timezone: string
}): Promise<BrandTimezone> {
  const base = {
    saved: context.timezone,
    source: 'unknown' as TimezoneSource,
    klaviyoTimezone: null,
    options: timezoneOptions(context.timezone)
  }
  if (getServerEnvironment().AUTH_MODE === 'demo') return base
  const db = await createClient()
  if (!db) return base
  const [tenant, klaviyo] = await Promise.all([
    db
      .from('tenants')
      .select('timezone,timezone_source')
      .eq('id', context.tenantId)
      .maybeSingle(),
    db
      .from('workspace_connections')
      .select('status,account_timezone')
      .eq('tenant_id', context.tenantId)
      .eq('provider', 'klaviyo')
      .maybeSingle()
  ])
  const saved = (!tenant.error && tenant.data?.timezone) || context.timezone
  const source = tenant.data?.timezone_source
  const zone = klaviyo.data?.account_timezone
  return {
    saved,
    source:
      !tenant.error && sources.has(source as TimezoneSource)
        ? (source as TimezoneSource)
        : 'unknown',
    klaviyoTimezone:
      !klaviyo.error &&
      klaviyo.data?.status === 'connected' &&
      zone &&
      isKnownTimezone(zone)
        ? zone
        : null,
    options: timezoneOptions(saved)
  }
}
