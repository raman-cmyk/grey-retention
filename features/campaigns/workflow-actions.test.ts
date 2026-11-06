import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireRequestContext = vi.fn()
const rpc = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc })
}))
vi.mock('@/features/integrations/worker', () => ({ runFixtureJobs: vi.fn() }))
const { workflowAction } = await import('./workflow-actions')

const id = '11111111-1111-4111-8111-111111111111'
const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}
const asRole = (tenantRole: 'owner' | 'admin' | 'staff') =>
  requireRequestContext.mockResolvedValue({ tenantId: 'tenant-a', tenantRole })

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_MODE', 'supabase')
  requireRequestContext.mockReset()
  rpc.mockReset().mockResolvedValue({ error: null })
})

describe('owner approval is the owner’s alone (UIR-016)', () => {
  for (const role of ['staff', 'admin'] as const)
    it(`refuses ${role} approving copy, design, packaging or scheduling`, async () => {
      asRole(role)
      const attempts: Record<string, string>[] = [
        { kind: 'approve_copy', id, revision: '1' },
        { kind: 'schedule', id, revision: '1' },
        {
          kind: 'review_design',
          id,
          revision: '1',
          decision: 'approved',
          section: 'Hero',
          feedback: ''
        },
        {
          kind: 'package',
          id,
          revision: '1',
          address: '1 Main Street',
          senderName: 'Acme',
          senderEmail: 'hello@acme.example',
          unsubscribeUrl: 'https://acme.example/u',
          privacyUrl: 'https://acme.example/p'
        }
      ]
      for (const fields of attempts)
        expect(await workflowAction({}, form(fields))).toEqual({
          error: 'Brand owner permission required.'
        })
      expect(rpc).not.toHaveBeenCalled()
    })

  it('lets the owner approve copy and schedule the exact version', async () => {
    asRole('owner')
    await workflowAction({}, form({ kind: 'approve_copy', id, revision: '3' }))
    expect(rpc).toHaveBeenCalledWith('approve_copy', {
      t: 'tenant-a',
      campaign: id,
      expected_revision: 3
    })
    await workflowAction({}, form({ kind: 'schedule', id, revision: '2' }))
    expect(rpc).toHaveBeenCalledWith('enqueue_delivery', {
      t: 'tenant-a',
      package: id,
      expected_revision: 2
    })
  })

  it('shows the database refusal in words: a stale version or a past time', async () => {
    asRole('owner')
    rpc.mockResolvedValueOnce({ error: { code: 'PT409' } })
    expect(
      await workflowAction({}, form({ kind: 'schedule', id, revision: '2' }))
    ).toEqual({
      error: 'This version or lease changed. Refresh and review again.'
    })
    rpc.mockResolvedValueOnce({
      error: { code: '23514', message: 'Package is not ready' }
    })
    expect(
      await workflowAction({}, form({ kind: 'schedule', id, revision: '2' }))
    ).toEqual({ error: 'Package is not ready' })
  })

  it('refuses junk before reaching the database', async () => {
    asRole('owner')
    expect(
      await workflowAction(
        {},
        form({ kind: 'schedule', id: 'nope', revision: '1' })
      )
    ).toHaveProperty('error')
    expect(rpc).not.toHaveBeenCalled()
  })
})
