import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { clampTokens, type SiteTokens } from '@/features/design-engine/tokens'
import { hostOf } from './suggested-competitors'

type Db = SupabaseClient<Database>

/**
 * PICK-006: the brand's design tokens as the Site reader kept them from
 * its newest read (`brand_tokens`), clamped again. None from a website
 * other than the workspace's current one (the owner changed it): the
 * defaults then, never another site's look. The Brand book's writer and
 * the email build read it with the worker's client, after the caller
 * checked the workspace. A failed read throws.
 */
export async function brandTokens(
  db: Db,
  tenantId: string
): Promise<SiteTokens | null> {
  const [profile, kept] = await Promise.all([
    db
      .from('brand_profiles')
      .select('domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('brand_tokens')
      .select('domain,tokens')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  for (const r of [profile, kept]) if (r.error) throw r.error
  const current = hostOf(profile.data?.domain ?? '')
  const tokens = kept.data?.tokens
  if (
    !current ||
    kept.data?.domain !== current ||
    !tokens ||
    typeof tokens !== 'object' ||
    Array.isArray(tokens)
  )
    return null
  // The database keeps only the reader's own shape (`private.site_tokens_ok`).
  return clampTokens(tokens as Record<string, unknown>)
}
