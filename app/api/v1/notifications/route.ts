import { NextResponse } from 'next/server'
import { resolveRequestContext } from '@/features/auth/application/request-context'
import { unreadNotices } from '@/features/notifications/read-model'
import { createClient } from '@/lib/supabase/server'

const noStore = { 'cache-control': 'no-store' }

/**
 * PICK-107: how many of the signed-in person's notices are new, for the
 * top bar's Notifications button. Read with the person's own client (row
 * rules keep it to their own notices in their workspace).
 */
export async function GET() {
  const context = await resolveRequestContext('client')
  if (!context || context.kind !== 'client')
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' }
      },
      { status: 401, headers: noStore }
    )
  // Nothing is kept in the demo.
  if (process.env.AUTH_MODE === 'demo')
    return NextResponse.json(
      { ok: true, data: { unread: 0 } },
      { headers: noStore }
    )
  const db = await createClient()
  const unread = db
    ? await unreadNotices(db, context.tenantId).catch(() => null)
    : null
  if (unread === null)
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAVAILABLE', message: 'Try again in a minute.' }
      },
      { status: 503, headers: noStore }
    )
  return NextResponse.json({ ok: true, data: { unread } }, { headers: noStore })
}
