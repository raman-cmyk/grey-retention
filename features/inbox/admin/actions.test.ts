import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { inboxAdminAction } from './actions'

const task = '00000000-0000-4000-8000-000000000a01'
const brand = '00000000-0000-4000-8000-000000000b01'
const message = '00000000-0000-4000-8000-000000000c01'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  auth.requireRequestContext.mockResolvedValue({ kind: 'admin' })
  rpc = vi.fn(async (name: string) =>
    name === 'admin_assign_sender'
      ? { data: 2, error: null }
      : { data: null, error: null }
  )
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe('inboxAdminAction', () => {
  it('refuses anyone who is not a platform admin before touching the database', async () => {
    // Owners and staff have a client session, not an admin one: the admin
    // surface sends them to its login page.
    auth.requireRequestContext.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(
      inboxAdminAction(
        {},
        form({ kind: 'resolve_task', task, outcome: 'resolved' })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(auth.requireRequestContext).toHaveBeenCalledWith('admin')
    expect(supabase.createClient).not.toHaveBeenCalled()
  })

  it('marks a task done, or dismisses it, with an optional note', async () => {
    expect(
      await inboxAdminAction(
        {},
        form({
          kind: 'resolve_task',
          task,
          outcome: 'resolved',
          note: ' Signed up again '
        })
      )
    ).toEqual({ message: 'Marked as done.' })
    expect(rpc).toHaveBeenCalledWith('resolve_ops_task', {
      task,
      outcome: 'resolved',
      note: 'Signed up again'
    })
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'resolve_task', task, outcome: 'dismissed' })
      )
    ).toEqual({ message: 'Dismissed.' })
    expect(rpc).toHaveBeenLastCalledWith('resolve_ops_task', {
      task,
      outcome: 'dismissed',
      note: undefined
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/inbox')
  })

  it('assigns a sender to a brand and says how many emails moved', async () => {
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'assign_sender', sender: 'Mail.Northwind.COM', brand })
      )
    ).toEqual({
      message:
        'Assigned 2 emails. New emails from mail.northwind.com go to this brand from now on.'
    })
    expect(rpc).toHaveBeenCalledWith('admin_assign_sender', {
      sender: 'mail.northwind.com',
      brand
    })
  })

  it('assigns one email to a brand', async () => {
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'assign_message', message, brand })
      )
    ).toEqual({ message: 'Assigned.' })
    expect(rpc).toHaveBeenCalledWith('admin_assign_inbox_message', {
      message,
      brand
    })
  })

  it('saves a brand with its sender domains', async () => {
    expect(
      await inboxAdminAction(
        {},
        form({
          kind: 'save_brand',
          domain: 'Northwind.com',
          alias: 'Northwind',
          name: 'Northwind Outdoor',
          niche: 'apparel',
          senders: 'mail.northwind.com, News.Northwind.com'
        })
      )
    ).toEqual({ message: 'Saved Northwind Outdoor.' })
    expect(rpc).toHaveBeenCalledWith('admin_save_inbox_brand', {
      brand_domain: 'northwind.com',
      alias: 'northwind',
      name: 'Northwind Outdoor',
      brand_niche: 'apparel',
      senders: ['mail.northwind.com', 'news.northwind.com']
    })
  })

  it('refuses bad input without calling the database', async () => {
    const bad: Record<string, string>[] = [
      { kind: 'resolve_task', task: 'not-a-uuid', outcome: 'resolved' },
      { kind: 'resolve_task', task, outcome: 'deleted' },
      { kind: 'assign_sender', sender: 'not a domain', brand },
      {
        kind: 'save_brand',
        domain: 'northwind.com',
        alias: '-bad',
        name: 'N',
        niche: 'x'
      },
      { kind: 'drop_everything' }
    ]
    for (const values of bad)
      expect(await inboxAdminAction({}, form(values))).toEqual({
        error: 'Check the fields and try again.'
      })
    expect(
      await inboxAdminAction(
        {},
        form({
          kind: 'save_brand',
          domain: 'northwind.com',
          alias: 'northwind',
          name: 'N',
          niche: 'x',
          senders: Array.from({ length: 11 }, (_, i) => `s${i}.n.com`).join(',')
        })
      )
    ).toEqual({ error: 'At most 10 sender domains.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says in plain words what the database refused', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Platform operator required' }
    })
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'resolve_task', task, outcome: 'resolved' })
      )
    ).toEqual({ error: 'Only platform admins can do this.' })
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PT409',
        message: 'This sender already belongs to another brand'
      }
    })
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'assign_sender', sender: 'mail.northwind.com', brand })
      )
    ).toEqual({ error: 'This sender already belongs to another brand.' })
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'internal detail' }
    })
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'assign_message', message, brand })
      )
    ).toEqual({ error: 'That did not work. Reload the page and try again.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('needs a real database session (not the demo login)', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    expect(
      await inboxAdminAction(
        {},
        form({ kind: 'resolve_task', task, outcome: 'resolved' })
      )
    ).toEqual({ error: 'Supabase authentication required.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
