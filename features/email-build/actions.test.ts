// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const after = vi.hoisted(() => vi.fn())
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => null }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/server', () => ({ after }))
vi.mock('./worker', () => ({ runEmailBuilds: vi.fn() }))

import { redirect } from 'next/navigation'
import { createEmail } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const run = '00000000-0000-4000-8000-0000000000aa'
const build = '00000000-0000-4000-8000-0000000000bb'
const rpc = vi.fn()
const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner'
  })
  supabase.createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: build, error: null })
})

describe('creating an email', () => {
  it('creates it for the owner, builds it after the reply, and shows the plan', async () => {
    expect(await createEmail({}, form({ run, slot: '2' }))).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('create_email_build', {
      t: tenantId,
      run,
      slot: 2
    })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/plan')
  })

  it('is the owner’s only', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
      error: 'Only this workspace’s owner creates emails.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a broken form', async () => {
    for (const fields of <Record<string, string>[]>[
      { run: 'x', slot: '0' },
      { run, slot: '-1' },
      { run, slot: '20' },
      { run }
    ])
      expect(await createEmail({}, form(fields))).toEqual({
        error: 'Choose an email from the plan.'
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says why it could not', async () => {
    const cases = [
      [
        { code: 'PT409' },
        'This email’s day has passed or the plan has changed. Plan again to create it.'
      ],
      [{ code: '22023' }, 'This plan has no such email. Reload the page.'],
      [{ code: 'XX000' }, 'We could not create the email. Try again.']
    ] as const
    for (const [error, message] of cases) {
      rpc.mockResolvedValue({ data: null, error })
      expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
        error: message
      })
    }
    supabase.createClient.mockResolvedValue(null)
    expect(await createEmail({}, form({ run, slot: '0' }))).toEqual({
      error: 'Creating emails is unavailable right now.'
    })
    expect(after).not.toHaveBeenCalled()
  })
})
