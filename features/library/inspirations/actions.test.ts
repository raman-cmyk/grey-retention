import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { stopTracking, trackDomain } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const subscription = '00000000-0000-4000-8000-000000000901'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
let rules: { data: unknown; error: unknown }
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({ tenantId: tenant, tenantRole })
beforeEach(() => {
  signedInAs('owner')
  rpc = vi.fn(async (name: string) =>
    name === 'subscribe_competitor'
      ? { data: subscription, error: null }
      : { data: null, error: null }
  )
  rules = { data: { private_rules: 'Never copy prices.' }, error: null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => rules
  supabase.createClient.mockResolvedValue({ rpc, from: () => chain })
})
afterEach(() => vi.clearAllMocks())

describe('trackDomain', () => {
  it('tracks a sample domain and asks for its emails', async () => {
    expect(
      await trackDomain(
        {},
        form({ domain: ' https://www.Northwind.example/ ' })
      )
    ).toEqual({
      message:
        'Tracking northwind.example. It shows PENDING until their emails arrive.'
    })
    expect(rpc).toHaveBeenNthCalledWith(1, 'subscribe_competitor', {
      t: tenant,
      domain: 'northwind.example',
      label: 'northwind.example'
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'enqueue_reference_job', {
      t: tenant,
      kind: 'competitors.capture',
      subscription
    })
    expect(revalidatePath).toHaveBeenCalledWith('/library/inspirations')
  })

  it('refuses anything that is not a domain, and real domains in sample mode', async () => {
    for (const value of ['', 'owner@brand.com', 'two words.com', 'brand'])
      expect((await trackDomain({}, form({ domain: value }))).error).toMatch(
        /Enter a domain|not a domain/
      )
    expect(
      (await trackDomain({}, form({ domain: 'brand.com' }))).error
    ).toMatch(/only sample domains that end in \.example/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says when 10 domains are already tracked', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect(
      (await trackDomain({}, form({ domain: 'eleventh.example' }))).error
    ).toBe('You already track 10 domains. Stop tracking one to add another.')
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('is for the owner only', async () => {
    for (const role of ['staff', 'admin']) {
      signedInAs(role)
      expect(
        (await trackDomain({}, form({ domain: 'northwind.example' }))).error
      ).toBe('Only the workspace owner can change tracked domains.')
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('stopTracking', () => {
  const stop = form({
    subscription,
    revision: '3',
    domain: 'northwind.example'
  })

  it('stops tracking and keeps the owner’s private rules', async () => {
    expect(await stopTracking({}, stop)).toEqual({
      message:
        'Stopped tracking northwind.example. Its emails left your library.'
    })
    expect(rpc).toHaveBeenCalledWith('update_competitor_subscription', {
      t: tenant,
      subscription,
      expected_revision: 3,
      active: false,
      private_rules: 'Never copy prices.'
    })
  })

  it('explains a stale page, a bad form and staff', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect((await stopTracking({}, stop)).error).toMatch(
      /changed in another window/
    )
    expect(
      (
        await stopTracking(
          {},
          form({ subscription: 'nope', revision: '1', domain: 'x' })
        )
      ).error
    ).toBe('Reload the page and try again.')
    rules = { data: null, error: null }
    expect((await stopTracking({}, stop)).error).toBe(
      'Reload the page and try again.'
    )
    signedInAs('staff')
    expect((await stopTracking({}, stop)).error).toMatch(
      /Only the workspace owner/
    )
  })
})
