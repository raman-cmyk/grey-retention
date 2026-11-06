import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { RequestContext } from '../domain/types'

type ClaimsClient = {
  auth: {
    getClaims: () => Promise<{
      data: { claims: Record<string, unknown> } | null
      error: unknown
    }>
  }
}

/**
 * The signed-in user's email, only when the session belongs to the same
 * user as the request context (so demo profiles never show a real email).
 */
export async function sessionEmail(db: ClaimsClient, userId: string) {
  try {
    const { data, error } = await db.auth.getClaims()
    const claims = data?.claims
    if (error || !claims || claims.sub !== userId) return null
    const email = claims.email
    return typeof email === 'string' && email.trim() ? email.trim() : null
  } catch {
    return null
  }
}

export async function shellIdentity(context: RequestContext) {
  const db = await createClient()
  const profile = db
    ? await db
        .from('profiles')
        .select('full_name')
        .eq('id', context.userId)
        .maybeSingle()
    : null
  const email = db ? await sessionEmail(db, context.userId) : null
  const name = profile?.data?.full_name?.trim() || 'Your account'
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const role =
    context.kind === 'client'
      ? context.tenantRole
      : context.kind === 'admin'
        ? 'Platform admin'
        : 'Designer'
  return { name, initials, email, role }
}
