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
    // Every workspace page, so a page opened in a new tab can refresh its
    // session (UIR-004: rows are real links now).
    '/assets/:path*',
    '/campaigns/:path*',
    '/copy-review/:path*',
    '/email-library/:path*',
    '/emails/:path*',
    '/flow-messages/:path*',
    '/flows/:path*',
    '/lists/:path*',
    '/metrics/:path*',
    '/optimizer/:path*',
    '/reports/:path*',
    '/segments/:path*',
    '/brand/:path*',
    '/store/:path*',
    '/campaign-agent/:path*',
    '/competitor-agent/:path*',
    '/connections/:path*',
    '/create-email/:path*',
    '/first-draft/:path*',
    '/get-started/:path*',
    '/import-reference/:path*',
    '/gros/:path*',
    '/onboarding/:path*',
    '/profile/:path*',
    '/settings/:path*',
    '/support/:path*',
    '/team/:path*',
    '/admin/:path*',
    '/designer/:path*'
  ]
}
