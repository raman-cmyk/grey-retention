import type { AuthSurface } from './types'

/** Pages a "back to where you were" must never lead to. */
const authPages = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/admin/login',
  '/designer/login',
  '/auth/'
]

const inArea = (surface: AuthSurface, path: string) => {
  const admin = path === '/admin' || path.startsWith('/admin/')
  const designer = path === '/designer' || path.startsWith('/designer/')
  if (surface === 'admin') return admin
  if (surface === 'designer') return designer
  return !admin && !designer
}

/**
 * The page to go back to after signing in (BAS-003): a path of this app,
 * in the area signed in to, that is not a sign-in page. Null for anything
 * else (another site, `//host`, backslashes, another area, a sign-in page,
 * an over-long value), so the usual landing page is used.
 */
export function safeNext(surface: AuthSurface, value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512)
    return null
  // Only "/path": never "//host", "/\host" or any control character.
  if (!/^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/.test(value)) return null
  let url: URL
  try {
    url = new URL(value, 'https://app.invalid')
  } catch {
    return null
  }
  if (url.origin !== 'https://app.invalid') return null
  const path = url.pathname
  // Parsing must not change it: "/..//host" would become "//host".
  if (path.startsWith('//') || `${path}${url.search}` !== value) return null
  if (path === '/') return null
  if (
    authPages.some((p) =>
      p.endsWith('/')
        ? path.startsWith(p)
        : path === p || path.startsWith(`${p}/`)
    )
  )
    return null
  if (!inArea(surface, path)) return null
  return `${path}${url.search}`
}

/**
 * Where an email link's callback (`/auth/callback?next=`) leads after the
 * code is exchanged (UI-AUTH): the reset-password page a reset email names,
 * or a client page `safeNext` accepts (the email-change link's
 * `/settings/account`); anything else (`//host`, `/\host`, another site)
 * is Home.
 */
export function callbackNext(value: unknown): string {
  if (value === '/reset-password') return value
  return safeNext('client', value) ?? '/home'
}
