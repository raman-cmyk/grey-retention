import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { revalidatePath } from 'next/cache'
import { sendFeatureRequest } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const good = {
  category: 'bug',
  subject: ' The preview is blank ',
  details: 'It shows nothing on my phone.'
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'staff'
  })
  rpc = vi.fn(async () => ({ data: 'id', error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('sendFeatureRequest', () => {
  it('sends for any member of this workspace', async () => {
    expect(await sendFeatureRequest({}, form(good))).toEqual({
      message: 'Thanks — your request was sent.'
    })
    expect(rpc).toHaveBeenCalledWith('request_feature', {
      t: tenant,
      category: 'bug',
      subject: 'The preview is blank',
      details: 'It shows nothing on my phone.'
    })
    expect(revalidatePath).toHaveBeenCalledWith('/feedback')
  })

  it('refuses bad input and the demo without saving', async () => {
    expect(
      (await sendFeatureRequest({}, form({ ...good, details: ' ' }))).error
    ).toBe('Details: tell us a little more.')
    expect(
      (await sendFeatureRequest({}, form({ ...good, category: 'wish' }))).error
    ).toBe('Choose a type.')
    env.values = { AUTH_MODE: 'demo' }
    expect((await sendFeatureRequest({}, form(good))).error).toMatch(
      /unavailable right now/
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains database refusals in plain words', async () => {
    const cases = [
      [{ code: '42501' }, /can no longer send requests/],
      [{ code: '23514' }, /Check the subject and details/],
      [{ code: 'XX000' }, /Nothing was saved/]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await sendFeatureRequest({}, form(good))).error).toMatch(text)
    }
  })
})
