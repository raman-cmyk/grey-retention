import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFirstDraft } from './actions'
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
const tenantId = crypto.randomUUID()
const campaignId = crypto.randomUUID()
function form() {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    requestKey: crypto.randomUUID(),
    source: 'original',
    title: 'Welcome to the studio',
    goal: 'Introduce our brand to new subscribers',
    plannedLocal: '2099-11-01T10:00',
    occurrence: '',
    audience: '',
    channel: 'email_design'
  }))
    data.set(key, value)
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner',
    timezone: 'Asia/Kathmandu'
  })
  createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: campaignId, error: null })
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
})
describe('First draft command', () => {
  it('uses the authorized timezone and same request key, then opens the saved campaign', async () => {
    const data = form()
    data.set('timezone', 'America/New_York')
    await expect(createFirstDraft({}, data)).rejects.toThrow('NEXT_REDIRECT')
    expect(rpc).toHaveBeenCalledWith(
      'create_first_draft',
      expect.objectContaining({
        t: tenantId,
        request_key: data.get('requestKey'),
        input: expect.objectContaining({
          planned_at: '2099-11-01T04:15:00.000Z',
          audience_id: ''
        })
      })
    )
    expect(redirect).toHaveBeenCalledWith(`/campaigns/${campaignId}`)
    expect(revalidatePath).toHaveBeenCalledWith('/get-started')
  })
  it('denies nonowners before creating a database client', async () => {
    requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff',
      timezone: 'UTC'
    })
    expect(await createFirstDraft({}, form())).toEqual({
      error: 'Ask your workspace owner to create this draft.'
    })
    expect(createClient).not.toHaveBeenCalled()
  })
  it('rejects malformed sources and invalid dates before mutation', async () => {
    const data = form()
    data.set('source', 'not-an-authorized-email')
    expect((await createFirstDraft({}, data)).error).toContain(
      'available reference'
    )
    data.set('source', 'original')
    data.set('plannedLocal', '2099-02-30T10:00')
    expect((await createFirstDraft({}, data)).error).toContain('does not exist')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('reports a conflicting replay without redirecting or altering a saved draft', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    expect((await createFirstDraft({}, form())).error).toContain(
      'already saved a different draft'
    )
    expect(redirect).not.toHaveBeenCalled()
  })
})
