import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const requestedNext = request.nextUrl.searchParams.get('next')
  const next =
    requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = supabase
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error('Authentication unavailable') }
    if (!error) {
      if (next === '/dashboard') {
        const { data } = await supabase!.rpc('resolve_client_context', {
          requested_tenant_id: null
        })
        if (!data?.[0]) {
          return NextResponse.redirect(new URL('/onboarding', request.url))
        }
      }
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  return NextResponse.redirect(new URL('/login?error=callback', request.url))
}
