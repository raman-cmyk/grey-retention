import 'server-only'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { SupabaseOfferSource } from './source'

/** What the Offers card in Settings shows, or null when unavailable. */
export async function offersPage(context: { tenantId: string }) {
  if (getServerEnvironment().AUTH_MODE === 'demo') return null
  const db = await createClient()
  if (!db) return null
  return new SupabaseOfferSource(db).managed(context.tenantId)
}
