import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { revalidatePath } from 'next/cache'
import { pinRule, retireRule } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const rule = '00000000-0000-4000-8000-0000000000a1'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
/** What reading the rule back after Unpin answers. */
let after: { data: unknown; error: unknown }
const reads: unknown[][] = []
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({ tenantId: tenant, tenantRole })
const fail = (code: string, details = '') =>
  rpc.mockResolvedValueOnce({ data: null, error: { code, details } })
beforeEach(() => {
  signedInAs('owner')
  rpc = vi.fn(async () => ({ data: 3, error: null }))
  after = {
    data: { status: 'active', confidence: 0.8, expires_at: null },
    error: null
  }
  reads.length = 0
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => (reads.push(args), chain),
    maybeSingle: async () => after
  }
  supabase.createClient.mockResolvedValue({ rpc, from: () => chain })
})
afterEach(() => vi.clearAllMocks())

describe('retireRule (UI-LRNa)', () => {
  it('removes the rule with the revision the page read, then refreshes Learned and Home', async () => {
    expect(await retireRule({}, form({ rule, revision: '2' }))).toEqual({
      message: 'Removed. GROS no longer uses this rule.'
    })
    expect(rpc).toHaveBeenCalledWith('retire_memory_rule', {
      t: tenant,
      rule,
      expected_revision: 2
    })
    expect(revalidatePath).toHaveBeenCalledWith('/learned')
    expect(revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('refuses staff and admins without calling the database', async () => {
    for (const role of ['staff', 'admin']) {
      signedInAs(role)
      expect((await retireRule({}, form({ rule, revision: '2' }))).error).toBe(
        'Only this workspace’s owner can change what GROS learned.'
      )
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('checks the form before calling the database', async () => {
    for (const values of <Record<string, string>[]>[
      { rule: 'not-a-rule', revision: '2' },
      { rule, revision: '0' },
      { rule, revision: '1.5' },
      { rule }
    ])
      expect((await retireRule({}, form(values))).error).toBe(
        'Open Learned again, then try again.'
      )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says what happened in plain words when the database refuses', async () => {
    fail('PT409')
    expect((await retireRule({}, form({ rule, revision: '2' }))).error).toMatch(
      /changed in another window/
    )
    fail('PT409', 'not_active')
    expect((await retireRule({}, form({ rule, revision: '2' }))).error).toBe(
      'GROS no longer uses this rule. Open Learned again.'
    )
    // The owner was checked first: the rule is not this workspace's.
    fail('42501')
    expect((await retireRule({}, form({ rule, revision: '2' }))).error).toBe(
      'GROS no longer uses this rule. Open Learned again.'
    )
    fail('XX000')
    expect((await retireRule({}, form({ rule, revision: '2' }))).error).toBe(
      'We could not remove the rule. Nothing was changed.'
    )
    supabase.createClient.mockResolvedValue(null)
    expect((await retireRule({}, form({ rule, revision: '2' }))).error).toMatch(
      /unavailable/
    )
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('pinRule (UI-LRNa)', () => {
  it('pins and unpins with the revision the page read', async () => {
    expect(
      await pinRule({}, form({ rule, revision: '2', pinned: 'true' }))
    ).toEqual({ message: 'Pinned. GROS keeps using this rule.' })
    expect(rpc).toHaveBeenLastCalledWith('pin_memory_rule', {
      t: tenant,
      rule,
      expected_revision: 2,
      pinned: true
    })
    expect(
      await pinRule({}, form({ rule, revision: '3', pinned: 'false' }))
    ).toEqual({ message: 'Unpinned. GROS still uses this rule.' })
    expect(rpc).toHaveBeenLastCalledWith('pin_memory_rule', {
      t: tenant,
      rule,
      expected_revision: 3,
      pinned: false
    })
    expect(revalidatePath).toHaveBeenCalledWith('/learned')
  })

  it('says why an unpinned rule leaves the page, reading only this workspace’s rule', async () => {
    after = {
      data: { status: 'active', confidence: 0.2, expires_at: null },
      error: null
    }
    expect(
      (await pinRule({}, form({ rule, revision: '3', pinned: 'false' })))
        .message
    ).toBe(
      'Unpinned. GROS stopped using this rule: it is not sure enough of it, or its time ended.'
    )
    expect(reads).toEqual([
      ['tenant_id', tenant],
      ['id', rule]
    ])
    after = {
      data: {
        status: 'active',
        confidence: 0.9,
        expires_at: '2020-01-01T00:00:00Z'
      },
      error: null
    }
    expect(
      (await pinRule({}, form({ rule, revision: '3', pinned: 'false' })))
        .message
    ).toMatch(/stopped using this rule/)
    after = { data: null, error: { code: '42501' } }
    expect(
      await pinRule({}, form({ rule, revision: '3', pinned: 'false' }))
    ).toEqual({ message: 'Unpinned.' })
  })

  it('refuses staff first, and a pin that is neither on nor off', async () => {
    signedInAs('staff')
    expect(
      (await pinRule({}, form({ rule, revision: '2', pinned: 'maybe' }))).error
    ).toMatch(/Only this workspace’s owner/)
    signedInAs('owner')
    expect(
      (await pinRule({}, form({ rule, revision: '2', pinned: 'maybe' }))).error
    ).toBe('Open Learned again, then try again.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains too many pins and a stale page', async () => {
    fail('PT409', 'too_many_pins')
    expect(
      (await pinRule({}, form({ rule, revision: '2', pinned: 'true' }))).error
    ).toBe('You have 20 pinned rules. Unpin one first.')
    fail('PT409')
    expect(
      (await pinRule({}, form({ rule, revision: '2', pinned: 'false' }))).error
    ).toMatch(/changed in another window/)
    fail('XX000')
    expect(
      (await pinRule({}, form({ rule, revision: '2', pinned: 'false' }))).error
    ).toBe('We could not unpin the rule. Nothing was changed.')
  })
})
