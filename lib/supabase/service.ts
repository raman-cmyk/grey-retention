import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
/** Only authenticated server use cases may call this; no UI queries use privileged access. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}
