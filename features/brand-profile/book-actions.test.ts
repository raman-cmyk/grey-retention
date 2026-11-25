// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const writes = vi.hoisted(() => ({ rewriteBrandBookSoon: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/features/onboarding/brand-book-writes', () => writes)

import {
  correctBrandBookFacts,
  correctBrandBookLine,
  retryBrandBookRewrite,
  withdrawBrandBookCorrection
} from './book-actions'

/**
 * UI-BRAND-2: the owner's corrections typed into the Brand book. Owner
 * only, checked by zod before any write, against the Brand book version
 * the page showed; each one rewrites the book right after the reply.
 */
const tenant = '00000000-0000-4000-8000-000000000101'
const correction = '00000000-0000-4000-8000-0000000000c1'
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner'
  })
  rpc = vi.fn(async () => ({ data: 1, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('correctBrandBookLine', () => {
  it('changes a line against the version shown, then rewrites the book', async () => {
    expect(
      await correctBrandBookLine(
        {},
        form({
          version: '6',
          section: 'voice',
          action: 'replace',
          original: 'Loud and bold.',
          value: '  Calm and plain.  '
        })
      )
    ).toEqual({ message: 'Saved. Rewriting the Brand book.' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('correct_brand_book_at', {
      t: tenant,
      expected_version: 6,
      corrections: [
        {
          section: 'voice',
          original: 'Loud and bold.',
          action: 'replace',
          value: 'Calm and plain.'
        }
      ]
    })
    expect(writes.rewriteBrandBookSoon).toHaveBeenCalledExactlyOnceWith(tenant)
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      '/brand',
      '/brand/book'
    ])
  })

  it('removes a line and adds one of his own', async () => {
    await correctBrandBookLine(
      {},
      form({
        version: '6',
        section: 'marketing',
        action: 'remove',
        original: 'Runs a summer sale.',
        value: 'ignored'
      })
    )
    await correctBrandBookLine(
      {},
      form({
        version: '6',
        section: 'customers.love',
        action: 'add',
        original: 'ignored',
        value: 'The soft linen.'
      })
    )
    expect(
      rpc.mock.calls.map((c) => (c[1] as { corrections: unknown }).corrections)
    ).toEqual([
      [
        {
          section: 'marketing',
          original: 'Runs a summer sale.',
          action: 'remove',
          value: null
        }
      ],
      [
        {
          section: 'customers.love',
          original: null,
          action: 'add',
          value: 'The soft linen.'
        }
      ]
    ])
  })

  it('refuses bad input before any write', async () => {
    const good = {
      version: '6',
      section: 'voice',
      action: 'replace',
      original: 'Loud and bold.',
      value: 'Calm and plain.'
    }
    for (const [bad, words] of [
      [{ version: '' }, 'Open the Brand book again, then correct it.'],
      [{ version: '-1' }, 'Open the Brand book again, then correct it.'],
      [{ version: 'v6' }, 'Open the Brand book again, then correct it.'],
      [{ section: 'products' }, 'Choose a part of the Brand book.'],
      [{ section: 'facts.returnDays' }, 'Choose a part of the Brand book.'],
      [{ action: 'rewrite' }, 'Choose what to do with the line.'],
      [{ value: '   ' }, 'Write the line first.'],
      [{ value: 'x'.repeat(301) }, 'Keep the line to 300 characters.'],
      [{ value: ' loud  AND bold. ' }, 'Change the words first.'],
      [{ original: '' }, 'Write the line first.']
    ] as const)
      expect(
        await correctBrandBookLine({}, form({ ...good, ...bad })),
        JSON.stringify(bad)
      ).toEqual({ error: words })
    expect(rpc).not.toHaveBeenCalled()
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
  })

  it('lets only the owner correct the book', async () => {
    for (const role of ['admin', 'staff', 'manager']) {
      auth.requireRequestContext.mockResolvedValue({
        tenantId: tenant,
        tenantRole: role
      })
      expect(
        await correctBrandBookLine(
          {},
          form({
            version: '6',
            section: 'offering',
            action: 'add',
            value: 'Linen shirts.'
          })
        ),
        role
      ).toEqual({
        error: 'Only the workspace owner can correct the Brand book.'
      })
      expect(
        (
          await withdrawBrandBookCorrection(
            {},
            form({ version: '6', correction })
          )
        ).error
      ).toBe('Only the workspace owner can correct the Brand book.')
      expect((await retryBrandBookRewrite()).error).toBe(
        'Only the workspace owner can rewrite the Brand book.'
      )
    }
    expect(supabase.createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
  })

  it('refuses a book changed since the page opened, and rewrites nothing', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PT409',
        message: 'Brand book changed',
        hint: 'brand_book_changed'
      }
    })
    expect(
      await correctBrandBookLine(
        {},
        form({
          version: '5',
          section: 'offering',
          action: 'add',
          value: 'Linen shirts.'
        })
      )
    ).toEqual({
      error:
        'Your Brand book changed since you opened it. Open it again, then correct it.'
    })
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
    expect(cache.revalidatePath).not.toHaveBeenCalled()
  })

  it('says the database’s other refusals in plain words', async () => {
    const add = form({
      version: '6',
      section: 'offering',
      action: 'add',
      value: 'Linen shirts.'
    })
    for (const [error, words] of [
      [
        { code: 'PT409', message: 'Line already added' },
        'You already added this line.'
      ],
      [
        { code: 'PT409', message: 'Too many added lines' },
        'This part already has 20 of your lines. Remove one first.'
      ],
      [
        { code: 'PT409', message: 'Too many corrections' },
        'You have 200 corrections already. Take one back before adding more.'
      ],
      [
        { code: '42501', message: 'Access denied' },
        'Only the workspace owner can correct the Brand book.'
      ],
      [{ code: '23514' }, 'Check the words, then save again.'],
      [{ code: 'XX000' }, 'Your correction was not saved. Try again.']
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect(await correctBrandBookLine({}, add), error.code).toEqual({
        error: words
      })
    }
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
  })

  it('is unavailable without a database session', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    expect(
      (
        await correctBrandBookLine(
          {},
          form({
            version: '6',
            section: 'offering',
            action: 'add',
            value: 'Linen shirts.'
          })
        )
      ).error
    ).toBe('Correcting the Brand book is not available right now.')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('correctBrandBookFacts', () => {
  const shown = {
    version: '6',
    was_freeShipping: 'over 75',
    was_returnDays: '30',
    was_guaranteeDays: '',
    was_deliveryDays: '3 to 5'
  }

  it('sends only the facts he changed, all at once', async () => {
    expect(
      await correctBrandBookFacts(
        {},
        form({
          ...shown,
          freeShipping: 'Every order',
          returnDays: '30',
          guaranteeDays: '60',
          deliveryDays: ''
        })
      )
    ).toEqual({ message: 'Facts saved. Rewriting the Brand book.' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('correct_brand_book_at', {
      t: tenant,
      expected_version: 6,
      corrections: [
        {
          section: 'facts.freeShipping',
          original: null,
          action: 'replace',
          value: 'always'
        },
        {
          section: 'facts.guaranteeDays',
          original: null,
          action: 'replace',
          value: '60'
        },
        // Emptied: unknown, so no email claims it.
        {
          section: 'facts.deliveryDays',
          original: null,
          action: 'remove',
          value: null
        }
      ]
    })
    expect(writes.rewriteBrandBookSoon).toHaveBeenCalledExactlyOnceWith(tenant)
  })

  it('refuses a fact it cannot read, or no change at all, before any write', async () => {
    expect(
      await correctBrandBookFacts(
        {},
        form({ ...shown, returnDays: 'two weeks' })
      )
    ).toEqual({ error: 'Returns: write a number of days from 0 to 3650.' })
    expect(
      await correctBrandBookFacts(
        {},
        form({ ...shown, deliveryDays: '7 to 3' })
      )
    ).toEqual({
      error: 'Delivery time: write the days like 3 to 7, at most 90.'
    })
    expect(
      await correctBrandBookFacts(
        {},
        form({
          ...shown,
          freeShipping: 'over 75',
          returnDays: '30 days',
          guaranteeDays: '',
          deliveryDays: '3-5'
        })
      )
    ).toEqual({ error: 'Change a fact first.' })
    expect(
      await correctBrandBookFacts({}, form({ ...shown, version: 'x' }))
    ).toEqual({ error: 'Open the Brand book again, then correct it.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('withdrawBrandBookCorrection', () => {
  it('takes one back against the version shown, then rewrites the book', async () => {
    expect(
      await withdrawBrandBookCorrection({}, form({ version: '6', correction }))
    ).toEqual({ message: 'Taken back. Rewriting the Brand book.' })
    expect(rpc).toHaveBeenCalledWith('withdraw_brand_book_correction_at', {
      t: tenant,
      expected_version: 6,
      correction
    })
    expect(writes.rewriteBrandBookSoon).toHaveBeenCalledExactlyOnceWith(tenant)
  })

  it('refuses a stale version, an unknown or a bad correction', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', hint: 'brand_book_changed' }
    })
    expect(
      (
        await withdrawBrandBookCorrection(
          {},
          form({ version: '5', correction })
        )
      ).error
    ).toBe(
      'Your Brand book changed since you opened it. Open it again, then correct it.'
    )
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', message: 'Correction not found' }
    })
    expect(
      (
        await withdrawBrandBookCorrection(
          {},
          form({ version: '6', correction })
        )
      ).error
    ).toBe('That correction was already taken back.')
    expect(
      (
        await withdrawBrandBookCorrection(
          {},
          form({ version: '6', correction: 'c1' })
        )
      ).error
    ).toBe('Choose a correction.')
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
  })
})

describe('retryBrandBookRewrite', () => {
  it('makes the rewrite due now and runs it after the reply', async () => {
    expect(await retryBrandBookRewrite()).toEqual({
      message: 'Rewriting the Brand book.'
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('retry_brand_book_write', {
      t: tenant
    })
    expect(writes.rewriteBrandBookSoon).toHaveBeenCalledExactlyOnceWith(tenant)
  })

  it('says when it could not start', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect((await retryBrandBookRewrite()).error).toBe(
      'The rewrite did not start. Try again in a minute.'
    )
    expect(writes.rewriteBrandBookSoon).not.toHaveBeenCalled()
  })
})
