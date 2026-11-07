import { NextResponse, type NextRequest } from 'next/server'
import { refreshAuthSession } from '@/lib/supabase/proxy'

const publicAuthRoutes = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/admin/login',
  '/designer/login'
])

function loginPath(pathname: string) {
  if (pathname.startsWith('/admin')) return '/admin/login'
  if (pathname.startsWith('/designer')) return '/designer/login'
  return '/login'
}

export async function proxy(request: NextRequest) {
  if (
    process.env.AUTH_MODE === 'demo' &&
    process.env.NODE_ENV !== 'production'
  ) {
    return NextResponse.next()
  }

  const refreshed = await refreshAuthSession(request)
  if (
    !refreshed.authenticated &&
    !publicAuthRoutes.has(request.nextUrl.pathname)
  ) {
    return NextResponse.redirect(
      new URL(loginPath(request.nextUrl.pathname), request.url)
    )
  }
  return refreshed.response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    // The Klaviyo detail pages (UIR-004): read-only pages that dashboard rows
    // open, often in a new tab. Pages full of server actions stay out until
    // the session refresh is proven safe for them in the browser journeys.
    '/campaigns/klaviyo/:path*',
    '/flow-messages/:path*',
    '/flows/:path*',
    '/lists/:path*',
    '/metrics/:path*',
    '/segments/:path*',
    '/brand/:path*',
    '/store/:path*',
    '/campaign-agent/:path*',
    '/competitor-agent/:path*',
    '/connections/:path*',
    '/gros/:path*',
    '/holidays/:path*',
    '/onboarding/:path*',
    '/profile/:path*',
    '/settings/:path*',
    '/support/:path*',
    '/team/:path*',
    '/admin/:path*',
    '/designer/:path*'
  ]
}
