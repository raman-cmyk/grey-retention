// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resend = vi.fn()
const createClient = vi.fn()
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClient()
}))
vi.mock('../application/request-context', () => ({
  activeTenantCookieName: 'active_tenant',
  resolveRequestContext: vi.fn()
}))

import { resendConfirmation } from './actions'

const idle = { status: 'idle' as const }
const form = (email: string) => {
  const data = new FormData()
  data.set('email', email)
  return data
}
const sent = {
  status: 'success',
  message:
    'If that address is waiting to be confirmed, a new email is on its way.'
}

beforeEach(() => {
  resend.mockReset()
  createClient.mockReset()
  createClient.mockResolvedValue({ auth: { resend } })
})

describe('sending the confirmation email again', () => {
  it('asks Supabase for the sign-up email, for the address in lower case', async () => {
    resend.mockResolvedValue({ data: {}, error: null })
    expect(await resendConfirmation(idle, form('Owner@Cedar.Example'))).toEqual(
      sent
    )
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'owner@cedar.example'
    })
  })

  it('explains a wrong address next to the field and sends nothing', async () => {
    const result = await resendConfirmation(idle, form('not-an-address'))
    expect(result.status).toBe('error')
    expect(result.fieldErrors?.email?.[0]).toBe('Enter a valid email address.')
    expect(resend).not.toHaveBeenCalled()
  })

  it('gives the same answer for an address Supabase refuses', async () => {
    for (const error of [
      { status: 400, code: 'email_address_invalid' },
      { status: 422, code: 'user_already_exists' },
      { status: 400, code: 'validation_failed' }
    ]) {
      resend.mockResolvedValueOnce({ data: {}, error })
      expect(
        await resendConfirmation(idle, form('owner@cedar.example'))
      ).toEqual(sent)
    }
  })

  it('asks to wait when Supabase’s email limit is reached', async () => {
    for (const error of [
      { status: 429, code: 'over_email_send_rate_limit' },
      { code: 'over_request_rate_limit' }
    ]) {
      resend.mockResolvedValueOnce({ data: {}, error })
      expect(
        await resendConfirmation(idle, form('owner@cedar.example'))
      ).toEqual({
        status: 'error',
        message: 'Too many emails. Wait a few minutes, then try again.'
      })
    }
  })

  it('says plainly when the email could not be sent', async () => {
    for (const error of [
      { status: 500, code: 'unexpected_failure' },
      // Supabase not reached: auth-js answers status 0.
      { status: 0, name: 'AuthRetryableFetchError' },
      {}
    ]) {
      resend.mockResolvedValueOnce({ data: {}, error })
      expect(
        await resendConfirmation(idle, form('owner@cedar.example'))
      ).toEqual({
        status: 'error',
        message: 'We could not send the email. Try again in a few minutes.'
      })
    }
  })

  it('says so when sign-in is not set up here', async () => {
    createClient.mockResolvedValue(null)
    expect(await resendConfirmation(idle, form('owner@cedar.example'))).toEqual(
      {
        status: 'error',
        message: 'Authentication is not configured in this environment.'
      }
    )
  })
})
