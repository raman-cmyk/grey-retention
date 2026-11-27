import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  })
}))
vi.mock('next/navigation', () => navigation)
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { markAllNoticesRead, openNotice, setNoticeEmail } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const notice = '00000000-0000-4000-8000-0000000000a1'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({ tenantId: tenant, tenantRole })
let rpc: ReturnType<typeof vi.fn>
let found: { data: unknown; error: unknown }
const reads: unknown[][] = []
beforeEach(() => {
  signedInAs('staff')
  rpc = vi.fn(async () => ({ data: 2, error: null }))
  found = { data: { href: '/plan/email/abc' }, error: null }
  reads.length = 0
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => (reads.push(args), chain),
    not: () => chain,
    maybeSingle: async () => found
  }
  supabase.createClient.mockResolvedValue({ rpc, from: () => chain })
})
afterEach(() => vi.clearAllMocks())

const redirectedTo = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    return (error as { to?: string }).to
  }
  return null
}

describe('markAllNoticesRead (PICK-107)', () => {
  it('marks the person’s own notices read in their workspace, staff included', async () => {
    expect(await markAllNoticesRead({}, form({}))).toEqual({
      message: 'Done. Every notification is read.'
    })
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read', { t: tenant })
    expect(revalidatePath).toHaveBeenCalledWith('/notifications')
  })

  it('says when there was nothing to mark, and when it failed', async () => {
    rpc.mockResolvedValueOnce({ data: 0, error: null })
    expect((await markAllNoticesRead({}, form({}))).message).toBe(
      'Nothing new to mark.'
    )
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await markAllNoticesRead({}, form({}))).error).toBe(
      'We could not mark them read. Try again.'
    )
  })
})

describe('openNotice', () => {
  it('marks that one notice read, then opens its page', async () => {
    expect(await redirectedTo(openNotice(form({ notice })))).toBe(
      '/plan/email/abc'
    )
    expect(reads).toEqual([
      ['tenant_id', tenant],
      ['id', notice]
    ])
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read', {
      t: tenant,
      ids: [notice]
    })
  })

  it('opens the list again for a bad id or a notice that is not theirs', async () => {
    expect(await redirectedTo(openNotice(form({ notice: 'x' })))).toBe(
      '/notifications'
    )
    found = { data: null, error: null }
    expect(await redirectedTo(openNotice(form({ notice })))).toBe(
      '/notifications'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('never opens a page outside the app', async () => {
    found = { data: { href: 'https://example.com' }, error: null }
    expect(await redirectedTo(openNotice(form({ notice })))).toBe('/plan')
  })
})

describe('setNoticeEmail', () => {
  it('lets only the owner turn emails on or off', async () => {
    for (const role of ['staff', 'admin']) {
      signedInAs(role)
      expect((await setNoticeEmail({}, form({ turn: 'on' }))).error).toBe(
        'Only the workspace owner can turn notification emails on.'
      )
    }
    expect(rpc).not.toHaveBeenCalled()
    signedInAs('owner')
    expect(await setNoticeEmail({}, form({ turn: 'on' }))).toEqual({
      message: 'Emails are on. This build records each one but sends none yet.'
    })
    expect(rpc).toHaveBeenCalledWith('set_notification_email', {
      t: tenant,
      turn_on: true
    })
    expect((await setNoticeEmail({}, form({ turn: 'off' }))).message).toBe(
      'Emails are off. Notifications stay in the app.'
    )
    expect(rpc).toHaveBeenLastCalledWith('set_notification_email', {
      t: tenant,
      turn_on: false
    })
  })

  it('checks the form and says when the database refused', async () => {
    signedInAs('owner')
    expect((await setNoticeEmail({}, form({ turn: 'yes' }))).error).toBe(
      'Open Notifications again, then try again.'
    )
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await setNoticeEmail({}, form({ turn: 'on' }))).error).toBe(
      'Only the workspace owner can turn notification emails on.'
    )
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect((await setNoticeEmail({}, form({ turn: 'on' }))).error).toBe(
      'We could not change it. Nothing was changed.'
    )
  })
})
