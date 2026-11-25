// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)

import { brandAction } from './actions'

/**
 * UI-BRAND: the Brand page's Approve brand, Add product and Save offer
 * call `brandAction`. Only the owner gets past it, and an approval names
 * the exact version the owner saw (`approve_brand`'s expected revision).
 */
const tenant = '00000000-0000-4000-8000-000000000101'
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
  rpc = vi.fn(async () => ({ data: null, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('brandAction', () => {
  it('approves exactly the version on the page and refreshes the brand pages', async () => {
    const result = await brandAction(
      {},
      form({ kind: 'approve', revision: '4' })
    )
    expect(result).toEqual({ message: 'Brand version approved.' })
    expect(rpc).toHaveBeenCalledWith('approve_brand', {
      t: tenant,
      expected_revision: 4
    })
    const paths = cache.revalidatePath.mock.calls.map((c) => c[0])
    expect(paths).toEqual(
      expect.arrayContaining(['/settings/brand', '/settings/brand/book'])
    )
    expect(paths).not.toContain('/brand')
  })

  it('refuses a version changed in another window', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409' } })
    expect(
      await brandAction({}, form({ kind: 'approve', revision: '4' }))
    ).toEqual({ error: 'Brand context changed. Refresh before approving.' })
  })

  it('refuses a missing or non-positive version before any write', async () => {
    for (const revision of ['', '0', '-1', 'v4'])
      expect(
        (await brandAction({}, form({ kind: 'approve', revision }))).error,
        revision
      ).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lets only the owner approve, add a product or save an offer', async () => {
    for (const role of ['staff', 'manager', 'admin']) {
      auth.requireRequestContext.mockResolvedValue({
        tenantId: tenant,
        tenantRole: role
      })
      for (const values of [
        { kind: 'approve', revision: '4' },
        {
          kind: 'product',
          title: 'Field overshirt',
          url: 'https://cedarlane.example/p/1',
          price_minor: '0',
          stock: '0'
        }
      ] as Record<string, string>[])
        expect(
          (await brandAction({}, form(values))).error,
          `${role} ${values.kind}`
        ).toBe('Only an owner may update or approve brand inputs.')
    }
    expect(supabase.createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('adds a product only with an https address', async () => {
    const product = {
      kind: 'product',
      title: 'Field overshirt',
      price_minor: '2500',
      stock: '3'
    }
    expect(
      (
        await brandAction(
          {},
          form({ ...product, url: 'http://cedarlane.example/p/1' })
        )
      ).error
    ).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
    await brandAction(
      {},
      form({ ...product, url: 'https://cedarlane.example/p/1' })
    )
    expect(rpc).toHaveBeenCalledWith('create_product', {
      t: tenant,
      title: 'Field overshirt',
      url: 'https://cedarlane.example/p/1',
      price_minor: 2500,
      stock: 3
    })
  })
})
