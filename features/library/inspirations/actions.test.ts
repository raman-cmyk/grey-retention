import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const observer = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
  read: vi.fn()
}))
vi.mock('@/features/inbox/observer-sheet', () => ({
  observerEnabled: observer.enabled,
  observerSelection: () => ({ read: observer.read })
}))
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
  observer.enabled.mockReturnValue(false)
  signedInAs('owner')
  rpc = vi.fn(async (name: string) =>
    name === 'subscribe_competitor'
      ? { data: subscription, error: null }
      : { data: null, error: null }
  )
  rules = {
    data: { private_rules: 'Never copy prices.', label: 'northwind.example' },
    error: null
  }
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
        : columns === 'private_rules,label'
          ? rules
          : tracked
    return chain
  }
  supabase.createClient.mockResolvedValue({ rpc, from })
})
afterEach(() => vi.clearAllMocks())

describe('trackDomain', () => {
  it('follows a real brand Observer collects without launching another collector', async () => {
    observer.enabled.mockReturnValue(true)
    capture = {
      data: { id: 'cap-1', subscription_status: 'subscribed' },
      error: null
    }
    expect(await trackDomain({}, form({ domain: 'curated.test' }))).toEqual({
      message:
        'Following curated.test. Only its human-rated Exemplary emails appear here.'
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('subscribe_competitor', {
      t: tenant,
      domain: 'curated.test'
    })
    // The live Sheet is no longer read to decide (GROS-INS-002).
    expect(observer.read).not.toHaveBeenCalled()
  })

  it('records a real brand Observer does not collect yet as a request', async () => {
    observer.enabled.mockReturnValue(true)
    capture = {
      data: { id: 'cap-2', subscription_status: 'pending' },
      error: null
    }
    expect(await trackDomain({}, form({ domain: 'newbrand.com' }))).toEqual({
      message:
        'Requested newbrand.com. We are subscribing to its emails; they appear here once our team rates them Exemplary.'
    })
    // Observer subscribes; GROS starts no capture job of its own.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('subscribe_competitor', {
      t: tenant,
      domain: 'newbrand.com'
    })
  })

  it('says when the daily request limit is reached', async () => {
    observer.enabled.mockReturnValue(true)
    rpc.mockResolvedValue({ data: null, error: { code: 'PT429' } })
    expect(
      (await trackDomain({}, form({ domain: 'eleventh.com' }))).error
    ).toBe(
      'You asked for 10 new brands today, the most in a day. Try again tomorrow.'
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('tracks a sample domain and asks for its emails', async () => {
    expect(
      await trackDomain(
        {},
        form({ domain: ' https://www.Northwind.example/ ' })
      )
    ).toEqual({
      message:
        'Following northwind.example. Its newsletters usually arrive within 1–7 days.'
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
    expect(revalidatePath).toHaveBeenCalledWith('/inspiration')
  })

  it('refuses anything that is not a domain, and real domains in sample mode', async () => {
    for (const value of ['', 'owner@brand.com', 'two words.com', 'brand'])
      expect((await trackDomain({}, form({ domain: value }))).error).toMatch(
        /Enter a brand website|not a website/
      )
    expect(
      (await trackDomain({}, form({ domain: 'brand.com' }))).error
    ).toMatch(/only sample brands, whose websites end in \.example/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('changes nothing for a domain that is already tracked, but asks for its emails again', async () => {
    capture = { data: { id: 'cap-1' }, error: null }
    tracked = { data: { id: subscription }, error: null }
    expect(
      await trackDomain({}, form({ domain: 'northwind.example' }))
    ).toEqual({ message: 'You already follow northwind.example.' })
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
      'Following northwind.example, but we could not ask for their emails yet. Click Follow again to retry.'
    )
  })

  it('refuses a domain too long to be its own label', async () => {
    expect(
      (await trackDomain({}, form({ domain: `${'a'.repeat(120)}.example` })))
        .error
    ).toBe('That website is too long. Use one under 120 characters.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says when 10 domains are already tracked', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect(
      (await trackDomain({}, form({ domain: 'eleventh.example' }))).error
    ).toBe(
      'You follow 10 brands, the most at a time. Stop one to follow another.'
    )
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('is for the owner only', async () => {
    for (const role of ['staff', 'admin']) {
      signedInAs(role)
      expect(
        (await trackDomain({}, form({ domain: 'northwind.example' }))).error
      ).toBe('Only the workspace owner can change the brands you follow.')
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
        'Stopped following northwind.example. Its emails left your library.'
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
