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
let capture: { data: unknown; error: unknown }
let tracked: { data: unknown; error: unknown }
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
  capture = { data: null, error: null }
  tracked = { data: null, error: null }
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    let columns = ''
    chain.select = (c: string) => {
      columns = c
      return chain
    }
    chain.eq = () => chain
    chain.maybeSingle = async () =>
      table === 'competitor_captures'
        ? capture
        : columns === 'private_rules'
          ? rules
          : tracked
    return chain
  }
  supabase.createClient.mockResolvedValue({ rpc, from })
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
    // No label or rules: a stopped domain keeps its own.
    expect(rpc).toHaveBeenNthCalledWith(1, 'subscribe_competitor', {
      t: tenant,
      domain: 'northwind.example'
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

  it('changes nothing for a domain that is already tracked, but asks for its emails again', async () => {
    capture = { data: { id: 'cap-1' }, error: null }
    tracked = { data: { id: subscription }, error: null }
    expect(
      await trackDomain({}, form({ domain: 'northwind.example' }))
    ).toEqual({ message: 'You already track northwind.example.' })
    expect(rpc).not.toHaveBeenCalledWith(
      'subscribe_competitor',
      expect.anything()
    )
    expect(rpc).toHaveBeenCalledWith('enqueue_reference_job', {
      t: tenant,
      kind: 'competitors.capture',
      subscription
    })
  })

  it('says when their emails could not be requested', async () => {
    rpc.mockImplementation(async (name: string) =>
      name === 'subscribe_competitor'
        ? { data: subscription, error: null }
        : { data: null, error: { code: 'XX000' } }
    )
    expect(
      (await trackDomain({}, form({ domain: 'northwind.example' }))).error
    ).toBe(
      'Tracking northwind.example, but we could not ask for their emails yet. Click Track again to retry.'
    )
  })

  it('refuses a domain too long to be its own label', async () => {
    expect(
      (await trackDomain({}, form({ domain: `${'a'.repeat(120)}.example` })))
        .error
    ).toBe('That domain is too long. Use one under 120 characters.')
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
