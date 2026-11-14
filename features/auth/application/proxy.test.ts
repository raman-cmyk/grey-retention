// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refreshAuthSession = vi.fn()
vi.mock('@/lib/supabase/proxy', () => ({
  refreshAuthSession: (request: NextRequest) => refreshAuthSession(request)
}))

import { proxy } from '@/proxy'

const open = (path: string, method = 'GET') =>
  proxy(new NextRequest(new URL(path, 'https://app.example'), { method }))

beforeEach(() => {
  vi.unstubAllEnvs()
  refreshAuthSession.mockResolvedValue({
    response: NextResponse.next(),
    authenticated: false
  })
})

describe('a signed-out visitor', () => {
  it('is sent to the area’s login page, which remembers the page', async () => {
    for (const [path, login] of [
      ['/plan?day=2026-11-17', '/login'],
      ['/admin/clients', '/admin/login']
    ] as const) {
      const location = new URL((await open(path)).headers.get('location')!)
      expect(location.pathname).toBe(login)
      expect(location.searchParams.get('next')).toBe(path)
    }
  })

  it('is not sent back to a form it sent', async () => {
    const location = new URL(
      (await open('/plan', 'POST')).headers.get('location')!
    )
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.has('next')).toBe(false)
  })

  it('keeps the session’s answer when signed in', async () => {
    const response = NextResponse.next()
    refreshAuthSession.mockResolvedValue({ response, authenticated: true })
    expect(await open('/plan')).toBe(response)
  })
})
