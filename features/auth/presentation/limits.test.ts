// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn()
}
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth })
}))
vi.mock('../application/request-context', () => ({
  activeTenantCookieName: 'active_tenant',
  resolveRequestContext: vi.fn()
}))

import { requestPasswordReset, signIn, signUp, updatePassword } from './actions'

const idle = { status: 'idle' as const }
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const email = 'owner@cedar.example'
const tries = {
  'signing in': () =>
    signIn('client', idle, form({ email, password: 'a-good-password' })),
  'signing up': () =>
    signUp(idle, form({ name: 'Cedar', email, password: 'a-good-password' })),
  'asking for a reset link': () => requestPasswordReset(idle, form({ email })),
  'setting the new password': () =>
    updatePassword(
      idle,
      form({
        password: 'a-new-long-password',
        confirmation: 'a-new-long-password'
      })
    )
}
const answer = (error: unknown) => {
  for (const f of Object.values(auth)) f.mockResolvedValue({ data: {}, error })
}

beforeEach(() => {
  for (const f of Object.values(auth)) f.mockReset()
})

describe('Supabase Auth’s own limits, said plainly', () => {
  it.each(Object.entries(tries))('when %s', async (_name, run) => {
    for (const error of [
      { status: 429, code: 'over_request_rate_limit' },
      // A limit answer may come with only its status, or only its code.
      { status: 429 },
      { code: 'over_email_send_rate_limit' },
      { code: 'over_request_rate_limit' }
    ]) {
      answer(error)
      expect(await run()).toEqual({
        status: 'error',
        message: 'Too many attempts. Wait a few minutes, then try again.'
      })
    }
  })

  it.each(Object.entries(tries))(
    'says plainly when Supabase cannot be reached, when %s',
    async (_name, run) => {
      answer({ status: 0, name: 'AuthRetryableFetchError' })
      expect(await run()).toEqual({
        status: 'error',
        message:
          'We could not reach the sign-in service. Try again in a few minutes.'
      })
    }
  )

  it('keeps the usual answers for anything else', async () => {
    answer({ status: 400, code: 'invalid_credentials' })
    expect((await tries['signing in']()).message).toBe(
      'Email or password is incorrect.'
    )
    expect((await tries['signing up']()).message).toBe(
      'Account creation failed.'
    )
    expect((await tries['asking for a reset link']()).message).toBe(
      'Reset request failed. Try again.'
    )
    expect((await tries['setting the new password']()).message).toBe(
      'Password could not be updated.'
    )
  })
})
