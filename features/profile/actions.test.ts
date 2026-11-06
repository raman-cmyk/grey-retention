import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const server = vi.hoisted(() => ({ createClient: vi.fn() }))
const stateless = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => server)
vi.mock('@supabase/supabase-js', () => stateless)

import { changePassword, updateAccount } from './actions'

const user = { id: 'user-1', email: 'owner@example.com' }
function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

let update: ReturnType<typeof vi.fn>
let updateUser: ReturnType<typeof vi.fn>
let signIn: ReturnType<typeof vi.fn>
let eq: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  auth.requireRequestContext.mockResolvedValue({ userId: user.id })
  eq = vi.fn(() => ({
    select: async () => ({ data: [{ id: user.id }], error: null })
  }))
  update = vi.fn(() => ({ eq }))
  updateUser = vi.fn(async () => ({ error: null }))
  server.createClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      updateUser
    },
    from: () => ({ update })
  })
  signIn = vi.fn(async () => ({ data: { user: { id: user.id } }, error: null }))
  stateless.createClient.mockReturnValue({
    auth: { signInWithPassword: signIn, signOut: vi.fn(async () => ({})) }
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('updateAccount', () => {
  it('saves name, job title and phone for the signed-in user only', async () => {
    const result = await updateAccount(
      {},
      form({
        name: ' Rae Owner ',
        jobTitle: 'Founder',
        phone: '+977 1 555 0101'
      })
    )
    expect(result).toEqual({ status: 'success', message: 'Saved.' })
    expect(update).toHaveBeenCalledWith({
      full_name: 'Rae Owner',
      job_title: 'Founder',
      phone: '+977 1 555 0101'
    })
    expect(eq).toHaveBeenCalledWith('id', user.id)
  })

  it('clears empty optional fields', async () => {
    await updateAccount({}, form({ name: 'Rae', jobTitle: ' ', phone: '' }))
    expect(update).toHaveBeenCalledWith({
      full_name: 'Rae',
      job_title: null,
      phone: null
    })
  })

  it('explains bad fields next to them without saving', async () => {
    const result = await updateAccount(
      {},
      form({ name: '', jobTitle: 'x'.repeat(121), phone: 'call me' })
    )
    expect(result.fieldErrors).toEqual({
      name: 'Enter your name.',
      jobTitle: 'Use at most 120 characters.',
      phone: 'Use digits, spaces and + ( ) - only.'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a refused save (for example a deactivated profile)', async () => {
    eq.mockReturnValue({ select: async () => ({ data: [], error: null }) })
    expect(
      (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' })))
        .message
    ).toContain('Nothing was changed')
  })

  it('refuses demo sign-in', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    expect(
      (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' })))
        .message
    ).toContain('sign in again')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('changePassword', () => {
  const good = {
    current: 'old-password',
    next: 'new-password-1',
    confirm: 'new-password-1'
  }

  it('checks the current password with a separate client, then updates', async () => {
    expect(await changePassword({}, form(good))).toEqual({
      status: 'success',
      message: 'Password updated.'
    })
    expect(stateless.createClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'anon',
      {
        auth: { persistSession: false, autoRefreshToken: false }
      }
    )
    expect(signIn).toHaveBeenCalledWith({
      email: user.email,
      password: 'old-password'
    })
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-1' })
  })

  it('says when the current password is wrong and changes nothing', async () => {
    signIn.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login' }
    })
    expect(await changePassword({}, form(good))).toEqual({
      status: 'error',
      fieldErrors: { current: 'That is not your current password.' }
    })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('refuses a password that belongs to a different account', async () => {
    signIn.mockResolvedValue({
      data: { user: { id: 'someone-else' } },
      error: null
    })
    expect(
      (await changePassword({}, form(good))).fieldErrors?.current
    ).toBeDefined()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it.each([
    [
      { ...good, next: 'short', confirm: 'short' },
      'next',
      'Use at least 8 characters.'
    ],
    [
      { ...good, confirm: 'different-1' },
      'confirm',
      'The new passwords do not match.'
    ],
    [
      { ...good, next: 'old-password', confirm: 'old-password' },
      'next',
      'Choose a password different from your current one.'
    ],
    [{ ...good, current: '' }, 'current', 'Enter your current password.']
  ])(
    'shows an inline error before checking anything',
    async (values, field, message) => {
      const result = await changePassword({}, form(values))
      expect(result.fieldErrors?.[field]).toBe(message)
      expect(signIn).not.toHaveBeenCalled()
      expect(updateUser).not.toHaveBeenCalled()
    }
  )

  it('keeps the old password when the update fails', async () => {
    updateUser.mockResolvedValue({ error: { message: 'weak' } })
    expect((await changePassword({}, form(good))).message).toBe(
      'We could not change your password. Your old password still works.'
    )
  })
})
