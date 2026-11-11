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
vi.mock('./worker', () => ({ runStrategyRuns: vi.fn() }))

import { redirect } from 'next/navigation'
import { pickOffers, startPlan } from './actions'

const tenantId = '00000000-0000-4000-8000-000000000101'
const run = '00000000-0000-4000-8000-0000000000aa'
const rpc = vi.fn()
const form = (fields: [string, string][]) => {
  const f = new FormData()
  for (const [k, v] of fields) f.append(k, v)
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.requireRequestContext.mockResolvedValue({
    tenantId,
    tenantRole: 'owner'
  })
  supabase.createClient.mockResolvedValue({ rpc })
  rpc.mockResolvedValue({ data: run, error: null })
})

describe('starting a plan', () => {
  it('starts it for the owner, runs the first step after the reply, and shows the page', async () => {
    expect(await startPlan()).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('start_strategy_run', { t: tenantId })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/plan')
  })

  it('is the owner’s only', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(await startPlan()).toEqual({
      error: 'Only this workspace’s owner plans its emails.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('says when it could not start', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(await startPlan()).toEqual({
      error: 'We could not start the plan. Try again.'
    })
    expect(after).not.toHaveBeenCalled()
  })
})

describe('picking offers', () => {
  const pick = (fields: [string, string][]) =>
    pickOffers({}, form([['run', run], ...fields]))

  it('sends only the ticked offers, then runs this plan', async () => {
    await pick([
      ['mode', 'picked'],
      ['offers', 'offer:CANDLE10'],
      ['offers', 'offer:WELCOME15']
    ])
    expect(rpc).toHaveBeenCalledWith('pick_strategy_offers', {
      t: tenantId,
      run,
      pick: { mode: 'picked', offers: ['offer:CANDLE10', 'offer:WELCOME15'] }
    })
    expect(after).toHaveBeenCalledOnce()
    expect(redirect).toHaveBeenCalledWith('/plan')
  })

  it('sends "you choose" and "none" when nothing is ticked', async () => {
    await pick([['mode', 'auto']])
    expect(rpc).toHaveBeenLastCalledWith('pick_strategy_offers', {
      t: tenantId,
      run,
      pick: { mode: 'auto' }
    })
    await pick([['mode', 'none']])
    expect(rpc).toHaveBeenLastCalledWith('pick_strategy_offers', {
      t: tenantId,
      run,
      pick: { mode: 'none' }
    })
  })

  it('never throws away ticked offers: ticks need "only the offers I tick"', async () => {
    for (const mode of ['auto', 'none'])
      expect(
        await pick([
          ['mode', mode],
          ['offers', 'offer:X']
        ])
      ).toEqual({
        error:
          'You ticked offers: choose “Only the offers I tick”, or untick them.'
      })
    expect(await pick([['mode', 'picked']])).toEqual({
      error: 'Tick at least one offer, or choose another option.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a broken form', async () => {
    expect(await pick([['mode', 'all']])).toEqual({
      error: 'Choose how to use your offers.'
    })
    expect(
      await pickOffers(
        {},
        form([
          ['run', 'x'],
          ['mode', 'auto']
        ])
      )
    ).toEqual({ error: 'Choose how to use your offers.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('is the owner’s only', async () => {
    auth.requireRequestContext.mockResolvedValue({
      tenantId,
      tenantRole: 'staff'
    })
    expect(await pick([['mode', 'auto']])).toEqual({
      error: 'Only this workspace’s owner plans its emails.'
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('shows the plan where it is when it already moved on', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PT409' } })
    expect(await pick([['mode', 'none']])).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith('/plan')
    expect(after).not.toHaveBeenCalled()
  })

  it('says what went wrong otherwise', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023' } })
    expect(await pick([['mode', 'none']])).toEqual({
      error: 'Those offers are not in this plan. Choose again.'
    })
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    expect(await pick([['mode', 'none']])).toEqual({
      error: 'We could not save your choice. Try again.'
    })
    supabase.createClient.mockResolvedValue(null)
    expect(await pick([['mode', 'none']])).toEqual({
      error: 'Planning is unavailable right now.'
    })
  })
})
