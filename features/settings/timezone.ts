import 'server-only'
import { isKnownTimezone, validTimezone } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'

/** Where the brand timezone came from (UIR-023). */
export type TimezoneSource = 'setup' | 'klaviyo' | 'owner' | 'unknown'

export type BrandTimezone = {
  /** The ONE brand timezone every screen uses (UTC if unknown). */
  timezone: string
  source: TimezoneSource
  /** The connected Klaviyo account's timezone, when it reported one. */
  klaviyoTimezone: string | null
}

const sources = new Set<TimezoneSource>(['setup', 'klaviyo', 'owner'])

/**
 * The workspace's brand timezone and where it came from. The timezone itself
 * is the request context's (the same one every page uses); this adds the
 * source and the Klaviyo account's timezone for Settings.
 */
export async function brandTimezone(context: {
  tenantId: string
  timezone: string
}): Promise<BrandTimezone> {
  const base = {
    timezone: validTimezone(context.timezone),
    source: 'unknown' as TimezoneSource,
    klaviyoTimezone: null
  }
  if (getServerEnvironment().AUTH_MODE === 'demo') return base
  const db = await createClient()
  if (!db) return base
  const [tenant, klaviyo] = await Promise.all([
    db
      .from('tenants')
      .select('timezone_source')
      .eq('id', context.tenantId)
      .maybeSingle(),
    db
      .from('workspace_connections')
      .select('status,account_timezone')
      .eq('tenant_id', context.tenantId)
      .eq('provider', 'klaviyo')
      .maybeSingle()
  ])
  const source = tenant.data?.timezone_source
  const zone = klaviyo.data?.account_timezone
  return {
    ...base,
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
        : null
  }
}
