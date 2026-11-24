import { NextResponse, type NextRequest } from 'next/server'
import { resolveRequestContext } from '@/features/auth/application/request-context'
import { callbackNext } from '@/features/auth/domain/next'
import { setupLanding } from '@/features/onboarding/landing'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  // The same check as sign in's `next` (UI-AUTH): `/\host` and `//host`
  // never leave the app.
  const next = callbackNext(request.nextUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = supabase
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error('Authentication unavailable') }
    if (!error) {
      if (next === '/home') {
        const { data } = await supabase!.rpc('resolve_client_context', {
          requested_tenant_id: undefined
        })
        if (!data?.[0]) {
          return NextResponse.redirect(new URL('/onboarding', request.url))
        }
        // An owner whose setup is not finished lands on it (UI-ONBe).
        const context = await resolveRequestContext('client')
        const landing =
          context?.kind === 'client' ? await setupLanding(context) : '/home'
        return NextResponse.redirect(new URL(landing, request.url))
      }
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  return NextResponse.redirect(new URL('/login?error=callback', request.url))
}
