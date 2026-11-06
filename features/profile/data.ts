import 'server-only'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

/** The signed-in user's own profile for /profile, or null to sign in again. */
export async function profilePageData() {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db) return null
  const [user, profile] = await Promise.all([
    db.auth.getUser(),
    db
      .from('profiles')
      .select('full_name,job_title,phone')
      .eq('id', context.userId)
      .maybeSingle()
  ])
  const signedIn = user.data.user
  if (user.error || !signedIn || signedIn.id !== context.userId) return null
  if (profile.error || !profile.data) return null
  return {
    name: profile.data.full_name,
    email: signedIn.email ?? '',
    jobTitle: profile.data.job_title ?? '',
    phone: profile.data.phone ?? ''
  }
}
