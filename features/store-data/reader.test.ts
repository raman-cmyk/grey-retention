import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: () => ({
    ADAPTER_MODE: process.env.ADAPTER_MODE === 'real' ? 'real' : 'fake'
  })
}))

type Result = { data: unknown; error: { code: string } | null }
const db = vi.hoisted(() => ({
  on: true,
  connection: { data: null, error: null } as Result,
  products: { data: [], error: null } as Result,
  filters: [] as [string, string, unknown][]
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    db.on
      ? {
          from: (table: string) => {
            const chain: Record<string, unknown> = {}
            chain.select = () => chain
            chain.eq = (column: string, value: unknown) => {
              db.filters.push([table, column, value])
              return chain
            }
            chain.order = () => chain
            chain.range = async () => db.products
            chain.maybeSingle = async () => db.connection
            return chain
          }
        }
      : null
}))

const { storeData } = await import('./reader')
const now = Date.parse('2026-11-06T12:00:00Z')
const product = {
  id: 'p1',
  title: 'Field overshirt (synthetic)',
  url: 'https://cedar-lane.example/products/overshirt',
  stock: 0,
  stock_observed_at: '2026-11-06T08:00:00Z',
  synthetic: true
}

afterEach(() => {
  vi.unstubAllEnvs()
  db.on = true
  db.connection = { data: null, error: null }
  db.products = { data: [], error: null }
  db.filters = []
})

describe('Store reader', () => {
  it('shows sample orders and the real catalogue while Shopify is connected', async () => {
    vi.stubEnv('ADAPTER_MODE', 'fake')
    db.connection = {
      data: { status: 'connected', shop_domain: 'cedar.myshopify.com' },
      error: null
    }
    db.products = { data: [product], error: null }
    const data = await storeData('t1', 'UTC', now)
    expect(data.state).toBe('sample')
    if (data.state !== 'sample') return
    expect(data.snapshot.shop.domain).toBe('cedar.myshopify.com')
    expect(data.snapshot.syncedAt).toBeNull()
    expect(data.stock?.outOfStock.map((p) => p.id)).toEqual(['p1'])
    // Only this workspace's rows, and only its Shopify connection.
    expect(db.filters).toContainEqual([
      'workspace_connections',
      'tenant_id',
      't1'
    ])
    expect(db.filters).toContainEqual([
      'workspace_connections',
      'provider',
      'shopify'
    ])
    expect(db.filters).toContainEqual(['products', 'tenant_id', 't1'])
  })

  it('says "not connected" only when Shopify was never connected', async () => {
    db.connection = { data: null, error: null }
    expect(await storeData('t3', 'UTC', now)).toEqual({
      state: 'not_connected'
    })
  })

  it('names a broken connection and keeps the stock alerts', async () => {
    db.products = { data: [product], error: null }
    for (const status of ['disconnected', 'expired', 'error', 'odd']) {
      db.connection = { data: { status, shop_domain: null }, error: null }
      const data = await storeData(`t-${status}`, 'UTC', now)
      expect(data).toMatchObject({
        state: 'broken',
        reason: status === 'odd' ? 'error' : status
      })
      if (data.state === 'broken')
        expect(data.stock?.outOfStock.map((p) => p.id)).toEqual(['p1'])
    }
  })

  it('claims nothing when the connection cannot be read', async () => {
    db.connection = { data: null, error: { code: 'XX000' } }
    expect(await storeData('t4', 'UTC', now)).toEqual({ state: 'load_failed' })
    db.on = false
    expect(await storeData('t5', 'UTC', now)).toEqual({ state: 'load_failed' })
  })

  it('in real mode says orders are unavailable but still shows stock alerts', async () => {
    vi.stubEnv('ADAPTER_MODE', 'real')
    db.connection = {
      data: { status: 'connected', shop_domain: 'cedar.myshopify.com' },
      error: null
    }
    db.products = { data: [{ ...product, stock: 3 }], error: null }
    const data = await storeData('t6', 'UTC', now)
    expect(data.state).toBe('unavailable')
    if (data.state !== 'unavailable') return
    expect(data.stock?.low.map((p) => p.id)).toEqual(['p1'])
  })

  it('keeps the dashboard when the catalogue fails, without stock alerts', async () => {
    vi.stubEnv('ADAPTER_MODE', 'fake')
    db.connection = {
      data: { status: 'connected', shop_domain: null },
      error: null
    }
    db.products = { data: null, error: { code: 'XX000' } }
    const data = await storeData('t7', 'UTC', now)
    expect(data).toMatchObject({ state: 'sample', stock: null })
  })
})
