import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { revalidatePath } from 'next/cache'
import {
  addDiscountCode,
  retireDiscountCode,
  saveMarginFloor,
  saveMaxDiscount
} from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const codeId = '00000000-0000-4000-8000-0000000000c1'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
let rpc: ReturnType<typeof vi.fn>
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole,
    timezone: 'Asia/Kathmandu'
  })
const fail = (code: string, message = '') =>
  rpc.mockResolvedValueOnce({ data: null, error: { code, message } })
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  signedInAs('owner')
  rpc = vi.fn(async () => ({ data: null, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('saveMarginFloor (owner pick #39)', () => {
  it('saves the margin and the floor with the revision the page read, and says what it allows', async () => {
    expect(
      await saveMarginFloor(
        {},
        form({ margin: '60', floor: '30', revision: '3' })
      )
    ).toEqual({
      message:
        'Saved. A sale keeps at least 30% margin, so emails offer at most 42% off (or less, if your biggest discount is lower).'
    })
    expect(rpc).toHaveBeenCalledWith('set_margin_floor', {
      t: tenant,
      gross_margin: 60,
      margin_floor: 30,
      expected_revision: 3
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('removes the floor when both are empty', async () => {
    expect(
      await saveMarginFloor({}, form({ margin: '', floor: ' ', revision: '4' }))
    ).toEqual({ message: 'Removed. Only your biggest discount limits offers.' })
    expect(rpc).toHaveBeenCalledWith('set_margin_floor', {
      t: tenant,
      gross_margin: null,
      margin_floor: null,
      expected_revision: 4
    })
  })

  it('checks both numbers before saving, never calling the database', async () => {
    for (const [margin, floor, words] of [
      ['60', '', /Enter both percents/],
      ['', '30', /Enter both percents/],
      ['0', '0', /from 1 to 99/],
      ['100', '30', /from 1 to 99/],
      ['60', '60', /below your usual margin of 60%/],
      ['60', '70', /below your usual margin of 60%/],
      ['60.5', '30', /whole percents/],
      ['-5', '3', /whole percents/],
      ['sixty', '30', /whole percents/]
    ] as const)
      expect(
        (await saveMarginFloor({}, form({ margin, floor, revision: '0' })))
          .error
      ).toMatch(words)
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: 'x' })
        )
      ).error
    ).toMatch(/Reload/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets admins save, refuses staff and the demo, and explains the database’s answers', async () => {
    signedInAs('staff')
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/owner or an admin/)
    expect(rpc).not.toHaveBeenCalled()
    signedInAs('admin')
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', details: 'no_offer_limits' }
    })
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toBe('Save your biggest discount first.')
    fail('PT409')
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/changed in another window/)
    fail('23514')
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/below your usual margin/)
    fail('42501')
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/owner or an admin/)
    fail('XX000')
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/Nothing was changed/)
    expect(revalidatePath).not.toHaveBeenCalled()
    signedInAs('owner')
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (
        await saveMarginFloor(
          {},
          form({ margin: '60', floor: '30', revision: '0' })
        )
      ).error
    ).toMatch(/sign in again/)
  })
})

describe('saveMaxDiscount', () => {
  it('saves with the revision the page read', async () => {
    expect(
      await saveMaxDiscount({}, form({ percent: '20', revision: '3' }))
    ).toEqual({
      message: 'Saved. New emails offer at most 20% off.'
    })
    expect(rpc).toHaveBeenCalledWith('set_max_discount', {
      t: tenant,
      percent: 20,
      expected_revision: 3
    })
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
    expect(
      (await saveMaxDiscount({}, form({ percent: '0', revision: '4' }))).message
    ).toMatch(/not offer a discount/)
  })

  it('lets admins save, and refuses staff and the demo without calling the database', async () => {
    signedInAs('admin')
    expect(
      (await saveMaxDiscount({}, form({ percent: '10', revision: '0' })))
        .message
    ).toBeDefined()
    rpc.mockClear()
    signedInAs('staff')
    expect(
      (await saveMaxDiscount({}, form({ percent: '10', revision: '0' }))).error
    ).toMatch(/owner or an admin/)
    signedInAs('owner')
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (await saveMaxDiscount({}, form({ percent: '10', revision: '0' }))).error
    ).toMatch(/sign in again/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('checks the number before saving and explains a stale page', async () => {
    for (const percent of ['101', '-1', '12.5', ''])
      expect(
        (await saveMaxDiscount({}, form({ percent, revision: '0' }))).error
      ).toMatch(/0 to 100/)
    expect(
      (await saveMaxDiscount({}, form({ percent: '5', revision: 'x' }))).error
    ).toMatch(/Reload/)
    expect(rpc).not.toHaveBeenCalled()
    fail('PT409')
    expect(
      (await saveMaxDiscount({}, form({ percent: '5', revision: '1' }))).error
    ).toMatch(/another window/)
  })
})

describe('addDiscountCode', () => {
  it('adds a code ending at the end of the day in the brand timezone', async () => {
    expect(
      await addDiscountCode(
        {},
        form({ code: ' CANDLE10 ', percent: '10', expires: '2026-12-31' })
      )
    ).toEqual({ message: 'Added CANDLE10. Agents can use it in new emails.' })
    expect(rpc).toHaveBeenCalledWith('add_discount_code', {
      t: tenant,
      code: 'CANDLE10',
      percent: 10,
      expires_at: '2026-12-31T18:14:59.000Z'
    })
    await addDiscountCode(
      {},
      form({ code: 'WELCOME15', percent: '15', expires: '' })
    )
    expect(rpc).toHaveBeenLastCalledWith(
      'add_discount_code',
      expect.objectContaining({ expires_at: null })
    )
  })

  it('refuses bad input before the database', async () => {
    expect(
      (await addDiscountCode({}, form({ code: 'BAD CODE', percent: '10' })))
        .error
    ).toMatch(/exactly as it works/)
    expect(
      (await addDiscountCode({}, form({ code: 'OK10', percent: '0' }))).error
    ).toMatch(/1 to 100/)
    expect(
      (
        await addDiscountCode(
          {},
          form({ code: 'OK10', percent: '10', expires: '2026-02-30' })
        )
      ).error
    ).toMatch(/valid end date/)
    signedInAs('staff')
    expect(
      (await addDiscountCode({}, form({ code: 'OK10', percent: '10' }))).error
    ).toMatch(/owner or an admin/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains a duplicate, too many codes and a past end date', async () => {
    fail('PT409', 'Code already added')
    expect(
      (await addDiscountCode({}, form({ code: 'WELCOME15', percent: '15' })))
        .error
    ).toBe('WELCOME15 is already in your list.')
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PT409',
        message: 'Too many codes',
        details: 'too_many_codes'
      }
    })
    expect(
      (await addDiscountCode({}, form({ code: 'MORE5', percent: '5' }))).error
    ).toMatch(/200 codes/)
    fail('23514')
    expect(
      (
        await addDiscountCode(
          {},
          form({ code: 'OLD5', percent: '5', expires: '2026-01-01' })
        )
      ).error
    ).toMatch(/has passed/)
  })
})

describe('retireDiscountCode', () => {
  it('retires by id, and refuses anything that is not one', async () => {
    expect(await retireDiscountCode({}, form({ id: codeId }))).toEqual({
      message: 'Removed. New emails will not use it.'
    })
    expect(rpc).toHaveBeenCalledWith('retire_discount_code', {
      code_id: codeId
    })
    rpc.mockClear()
    expect((await retireDiscountCode({}, form({ id: 'x' }))).error).toMatch(
      /Reload/
    )
    expect(rpc).not.toHaveBeenCalled()
    fail('42501')
    expect((await retireDiscountCode({}, form({ id: codeId }))).error).toMatch(
      /owner or an admin/
    )
  })
})
