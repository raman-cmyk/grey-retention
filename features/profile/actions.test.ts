import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const server = vi.hoisted(() => ({ createClient: vi.fn() }))
const stateless = vi.hoisted(() => ({ createStatelessClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => server)
vi.mock('@/lib/supabase/stateless', () => stateless)

import { changeEmail, changePassword, updateAccount } from './actions'

const user = { id: 'user-1', email: 'owner@example.com' }
function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

let update: ReturnType<typeof vi.fn>
let updateUser: ReturnType<typeof vi.fn>
let getUser: ReturnType<typeof vi.fn>
let signIn: ReturnType<typeof vi.fn>
let signOut: ReturnType<typeof vi.fn>
let eq: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({ userId: user.id })
  eq = vi.fn(() => ({
    select: async () => ({ data: [{ id: user.id }], error: null })
  }))
  update = vi.fn(() => ({ eq }))
  updateUser = vi.fn(async () => ({ error: null }))
  getUser = vi.fn(async () => ({ data: { user }, error: null }))
  server.createClient.mockResolvedValue({
    auth: { getUser, updateUser },
    from: () => ({ update })
  })
  signIn = vi.fn(async () => ({ data: { user: { id: user.id } }, error: null }))
  signOut = vi.fn(async () => ({}))
  stateless.createStatelessClient.mockReturnValue({
    auth: { signInWithPassword: signIn, signOut }
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
    expect(auth.requireRequestContext).toHaveBeenCalledWith('client')
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

  it('explains bad fields next to them, with a summary, without saving', async () => {
    const result = await updateAccount(
      {},
      form({ name: 'R', jobTitle: 'x'.repeat(121), phone: 'call me' })
    )
    expect(result).toEqual({
      status: 'error',
      message: 'Check the fields marked below.',
      fieldErrors: {
        name: 'Use at least 2 characters.',
        jobTitle: 'Use at most 120 characters.',
        phone: 'Use digits, spaces and + ( ) - . only.'
      }
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses phone numbers with no digits or hidden line breaks', async () => {
    for (const phone of ['+()-', '555\n0101', '555\t0101'])
      expect(
        (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone })))
          .fieldErrors?.phone
      ).toBeDefined()
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a refused save (for example a deactivated profile)', async () => {
    eq.mockReturnValue({ select: async () => ({ data: [], error: null }) })
    expect(
      (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' })))
        .message
    ).toContain('Nothing was changed')
  })

  it('stops before writing when the request context redirects', async () => {
    auth.requireRequestContext.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(
      updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' }))
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses demo sign-in and a failed user check', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    expect(
      (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' })))
        .message
    ).toBe('Please sign in again.')
    vi.stubEnv('AUTH_MODE', 'supabase')
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } })
    expect(
      (await updateAccount({}, form({ name: 'Rae', jobTitle: '', phone: '' })))
        .message
    ).toBe('Please sign in again.')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('changePassword', () => {
  const good = {
    current: 'old-password',
    next: 'new-password-12',
    confirm: 'new-password-12'
  }

  it('checks the current password with a throwaway session, then updates', async () => {
    expect(await changePassword({}, form(good))).toEqual({
      status: 'success',
      message: 'Password updated.'
    })
    expect(signIn).toHaveBeenCalledWith({
      email: user.email,
      password: 'old-password'
    })
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-12' })
  })

  it('says when the current password is wrong and changes nothing', async () => {
    signIn.mockResolvedValue({
      data: { user: null },
      error: { code: 'invalid_credentials', status: 400 }
    })
    expect(await changePassword({}, form(good))).toEqual({
      status: 'error',
      message: 'Check the fields marked below.',
      fieldErrors: { current: 'That is not your current password.' }
    })
    expect(signOut).toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('does not call a rate limit or an outage a wrong password', async () => {
    signIn.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'over_request_rate_limit', status: 429 }
    })
    expect((await changePassword({}, form(good))).message).toBe(
      'Too many attempts. Wait a few minutes, then try again.'
    )
    signIn.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'unexpected_failure', status: 500 }
    })
    const outage = await changePassword({}, form(good))
    expect(outage.fieldErrors).toBeUndefined()
    expect(outage.message).toBe(
      'We could not check your current password. Nothing was changed. Try again.'
    )
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('refuses a password that belongs to a different account', async () => {
    signIn.mockResolvedValue({
      data: { user: { id: 'someone-else' } },
      error: null
    })
    expect((await changePassword({}, form(good))).status).toBe('error')
    expect(signOut).toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it.each([
    [
      { ...good, next: 'short-pass', confirm: 'short-pass' },
      'next',
      'Use at least 12 characters.'
    ],
    [
      // 36 emoji are 36 letters but 144 bytes; Auth allows 72 bytes.
      { ...good, next: '🙂'.repeat(36), confirm: '🙂'.repeat(36) },
      'next',
      'Too long: use fewer characters (letters outside English count as 2–4).'
    ],
    [
      { ...good, confirm: 'different-12' },
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
      expect(result.message).toBe('Check the fields marked below.')
      expect(signIn).not.toHaveBeenCalled()
      expect(updateUser).not.toHaveBeenCalled()
    }
  )

  it('accepts 72 English letters and refuses the same new password', async () => {
    const long = 'a'.repeat(72)
    expect(
      (await changePassword({}, form({ ...good, next: long, confirm: long })))
        .status
    ).toBe('success')
    const same = 'same-password-1'
    expect(
      (
        await changePassword(
          {},
          form({ current: same, next: same, confirm: same })
        )
      ).fieldErrors?.next
    ).toBe('Choose a password different from your current one.')
  })

  it('shows weak or reused passwords next to the field', async () => {
    updateUser.mockResolvedValueOnce({ error: { code: 'weak_password' } })
    expect((await changePassword({}, form(good))).fieldErrors?.next).toMatch(
      /too easy to guess/
    )
    updateUser.mockResolvedValueOnce({ error: { code: 'same_password' } })
    expect((await changePassword({}, form(good))).fieldErrors?.next).toBe(
      'Choose a password different from your current one.'
    )
  })

  it('keeps the old password when the update fails', async () => {
    updateUser.mockResolvedValue({ error: { code: 'unexpected_failure' } })
    expect((await changePassword({}, form(good))).message).toBe(
      'We could not change your password. Your old password still works.'
    )
  })

  it('checks the session before reading the form', async () => {
    auth.requireRequestContext.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(changePassword({}, form(good))).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('changeEmail', () => {
  const good = { email: 'New.Owner@Example.com', current: 'old-password' }
  const sent = {
    status: 'success',
    message:
      'If new.owner@example.com can be used, a link to confirm it is on its way there, and one may come to owner@example.com: click each link you get. Your email stays owner@example.com until then.'
  }

  it('checks the current password, then asks Supabase to confirm the new address', async () => {
    expect(await changeEmail({}, form(good))).toEqual(sent)
    expect(signIn).toHaveBeenCalledWith({
      email: user.email,
      password: 'old-password'
    })
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'new.owner@example.com' },
      {
        emailRedirectTo: expect.stringMatching(
          /\/auth\/callback\?next=\/profile$/
        )
      }
    )
    expect(signIn.mock.invocationCallOrder[0]).toBeLessThan(
      updateUser.mock.invocationCallOrder[0]!
    )
  })

  it.each([
    [
      { ...good, email: 'not-an-address' },
      'email',
      'Enter a valid email address.'
    ],
    [
      { ...good, email: 'OWNER@example.com' },
      'email',
      'This is already your email.'
    ],
    [{ ...good, current: '' }, 'current', 'Enter your current password.']
  ])(
    'shows an inline error before changing anything',
    async (values, field, message) => {
      const result = await changeEmail({}, form(values))
      expect(result.fieldErrors?.[field]).toBe(message)
      expect(result.message).toBe('Check the fields marked below.')
      expect(signIn).not.toHaveBeenCalled()
      expect(updateUser).not.toHaveBeenCalled()
    }
  )

  it('refuses a wrong current password without changing anything', async () => {
    signIn.mockResolvedValueOnce({
      data: { user: null },
      error: { code: 'invalid_credentials', status: 400 }
    })
    expect((await changeEmail({}, form(good))).fieldErrors?.current).toBe(
      'That is not your current password.'
    )
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('gives the same answer for an address another account uses', async () => {
    for (const error of [
      { code: 'email_exists', status: 422 },
      { code: 'email_address_invalid', status: 400 }
    ]) {
      updateUser.mockResolvedValueOnce({ error })
      expect(await changeEmail({}, form(good))).toEqual(sent)
    }
  })

  it('asks to wait at Supabase’s limits', async () => {
    for (const error of [
      { code: 'over_email_send_rate_limit', status: 429 },
      { code: 'over_email_send_rate_limit' },
      { code: 'over_request_rate_limit' }
    ]) {
      updateUser.mockResolvedValueOnce({ error })
      expect((await changeEmail({}, form(good))).message).toBe(
        'Too many attempts. Wait a few minutes, then try again.'
      )
    }
  })

  it('says plainly when the change could not start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const error of [
      { code: 'unexpected_failure', status: 500 },
      // Supabase not reached: auth-js answers status 0.
      { name: 'AuthRetryableFetchError', status: 0 },
      // A refusal that is not about the address: nothing was sent.
      { code: 'email_address_not_authorized', status: 400 },
      {}
    ]) {
      updateUser.mockResolvedValueOnce({ error })
      expect(await changeEmail({}, form(good))).toEqual({
        status: 'error',
        message:
          'We could not start the change. Your email stays the same. Try again.'
      })
    }
  })

  it('asks to sign in again when Supabase has no session for the change', async () => {
    updateUser.mockResolvedValueOnce({
      error: { name: 'AuthSessionMissingError', status: 400 }
    })
    expect(await changeEmail({}, form(good))).toEqual({
      status: 'error',
      message: 'Please sign in again.'
    })
  })

  it('asks a signed-out visitor to sign in again', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect(await changeEmail({}, form(good))).toEqual({
      status: 'error',
      message: 'Please sign in again.'
    })
    expect(updateUser).not.toHaveBeenCalled()
  })
})
