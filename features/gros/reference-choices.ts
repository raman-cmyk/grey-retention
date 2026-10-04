import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { readPages } from '@/lib/db/read-pages'

export async function conversationReferenceChoices(
  db: SupabaseClient<Database>,
  tenantId: string
) {
  const subscriptions = await readPages((from, to) =>
    db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('id')
      .range(from, to)
  )
  if (subscriptions.error) return { data: null, error: subscriptions.error }
  const captureIds = (subscriptions.data ?? []).map((s) => s.capture_id)
  if (!captureIds.length) return { data: [], error: null }
  return db
    .from('competitor_emails')
    .select('id,subject')
    .in('capture_id', captureIds)
    .order('received_at', { ascending: false })
    .order('id')
    .limit(20)
}
