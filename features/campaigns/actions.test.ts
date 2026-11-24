import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * UI-OLDc: the draft page's server actions check the role on the server
 * (the page hiding a button is not the check). Staff may edit a draft and
 * add notes; only the owner approves a date or the copy and asks for copy.
 */
const { requireRequestContext, createClient, rpc, redirect, revalidatePath } =
  vi.hoisted(() => ({
    requireRequestContext: vi.fn(),
    createClient: vi.fn(),
    rpc: vi.fn(),
    redirect: vi.fn(),
    revalidatePath: vi.fn()
  }))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext
}))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/features/integrations/worker', () => ({
  runFixtureJobs: vi.fn()
}))

import { addNote, approveCalendar, saveCampaign } from './actions'
import { workflowAction } from './workflow-actions'

const tenantId = crypto.randomUUID()
const id = crypto.randomUUID()
const as = (tenantRole: 'owner' | 'staff') =>
  requireRequestContext.mockResolvedValue({
    kind: 'client',
    tenantId,
    tenantRole
  })
const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

beforeEach(() => {
  vi.resetAllMocks()
  createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: id, error: null })
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
})

describe('the draft page’s owner gates', () => {
  it('refuses staff approving a date before any database call', async () => {
    as('staff')
    expect(
      await approveCalendar({}, form({ id, revision: '1' }))
    ).toMatchObject({ error: expect.any(String) })
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets the owner approve a date, and opens nothing else', async () => {
    as('owner')
    expect(await approveCalendar({}, form({ id, revision: '2' }))).toEqual({
      message: 'Date approved.'
    })
    expect(rpc).toHaveBeenCalledWith('approve_calendar', {
      t: tenantId,
      target_id: id,
      expected_revision: 2
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/plan/draft/${id}`)
  })

  it.each(['generate_copy', 'approve_copy'])(
    'refuses staff the owner’s %s',
    async (kind) => {
      as('staff')
      expect(
        await workflowAction({}, form({ kind, id, revision: '1' }))
      ).toEqual({ error: 'Brand owner permission required.' })
      expect(rpc).not.toHaveBeenCalled()
    }
  )

  it('lets the owner ask for the copy, in plain words', async () => {
    as('owner')
    rpc.mockResolvedValue({ error: null })
    expect(
      await workflowAction(
        {},
        form({ kind: 'generate_copy', id, revision: '1' })
      )
    ).toEqual({
      message: 'The copy is being written. It shows here in a few minutes.'
    })
    expect(rpc).toHaveBeenCalledWith('enqueue_copy', {
      t: tenantId,
      campaign: id,
      expected_revision: 1
    })
  })

  it('lets staff save copy and notes, and edit the draft', async () => {
    as('staff')
    rpc.mockResolvedValue({ data: id, error: null })
    expect(
      await workflowAction(
        {},
        form({
          kind: 'save_copy',
          id,
          revision: '1',
          subject: 'Winter is here',
          preheader: '',
          body: 'Hello',
          cta: 'Shop',
          url: 'https://cedarlane.example/shop'
        })
      )
    ).toEqual({ message: 'Copy saved.' })
    expect(await addNote({}, form({ id, body: 'Red socks' }))).toEqual({
      message: 'Note saved.'
    })
    await expect(
      saveCampaign(
        {},
        form({
          id,
          revision: '1',
          title: 'Cedar Lane · winter',
          goal: '',
          channel: 'email_design',
          planned_at: '2099-12-01T10:00:00.000Z',
          audience_id: '',
          product_id: '',
          offer_id: '',
          reference_notes: ''
        })
      )
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(`/plan/draft/${id}`)
  })
})
