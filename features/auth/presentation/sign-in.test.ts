// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signInWithPassword = vi.fn()
const createClient = vi.fn()
const resolveRequestContext = vi.fn()
class Redirected extends Error {
  constructor(readonly to: string) {
    super(to)
  }
}
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to)
  }
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient()
}))
vi.mock('../application/request-context', () => ({
  activeTenantCookieName: 'active_tenant',
  resolveRequestContext: () => resolveRequestContext()
}))

import { signIn } from './actions'

const idle = { status: 'idle' as const }
const form = (next?: string) => {
  const data = new FormData()
  data.set('email', 'owner@cedar.example')
  data.set('password', 'a-good-password')
  if (next !== undefined) data.set('next', next)
  return data
}
const landsOn = async (
  surface: 'client' | 'admin' | 'designer',
  data: FormData
) => {
  try {
    await signIn(surface, idle, data)
  } catch (error) {
    if (error instanceof Redirected) return error.to
    throw error
  }
  return null
}

beforeEach(() => {
  signInWithPassword.mockReset()
  signInWithPassword.mockResolvedValue({ error: null })
  createClient.mockResolvedValue({ auth: { signInWithPassword } })
  resolveRequestContext.mockResolvedValue({ kind: 'client' })
})

describe('signing in after the session ran out', () => {
  it('goes back to the page the owner was on', async () => {
    expect(await landsOn('client', form('/plan?day=2026-11-17'))).toBe(
      '/plan?day=2026-11-17'
    )
    expect(await landsOn('admin', form('/admin/clients'))).toBe(
      '/admin/clients'
    )
  })

  it('lands on the usual page without a safe page to go back to', async () => {
    expect(await landsOn('client', form())).toBe('/dashboard')
    expect(await landsOn('client', form('https://evil.example/'))).toBe(
      '/dashboard'
    )
    expect(await landsOn('client', form('/admin/clients'))).toBe('/dashboard')
    expect(await landsOn('admin', form('/plan'))).toBe('/admin/dashboard')
    expect(await landsOn('designer', form('//evil.example'))).toBe(
      '/designer/dashboard'
    )
  })

  it('sends an owner without a workspace to onboarding first', async () => {
    resolveRequestContext.mockResolvedValue(null)
    expect(await landsOn('client', form('/plan'))).toBe('/onboarding')
  })

  it('goes nowhere when the password is wrong', async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 400 } })
    expect(await landsOn('client', form('/plan'))).toBeNull()
  })
})
