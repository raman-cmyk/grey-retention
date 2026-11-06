import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { RequestContext } from '../domain/types'

export async function shellIdentity(context: RequestContext) {
  const db = await createClient()
  const profile = db
    ? await db
        .from('profiles')
        .select('full_name')
        .eq('id', context.userId)
        .maybeSingle()
    : null
  const claims = db ? await db.auth.getClaims() : null
  const rawEmail = claims?.data?.claims?.email
  const email = typeof rawEmail === 'string' && rawEmail ? rawEmail : null
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
