// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Result = { data: unknown; error: { code: string } | null }
const db = vi.hoisted(() => ({
  on: true,
  brand: { data: null, error: null } as Result,
  /** Answers for the connection reads, by the columns asked for. */
  connections: (columns: string): Result => {
    void columns
    return { data: [], error: null }
  },
  products: { data: [], error: null } as Result,
  filters: [] as [string, string, unknown][],
  selects: [] as [string, string][]
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    db.on
      ? {
          from: (table: string) => {
            let columns = ''
            const chain: Record<string, unknown> = {}
            chain.select = (c: string) => {
              columns = c
              db.selects.push([table, c])
              return chain
            }
            const answer = () =>
              table === 'workspace_connections'
                ? db.connections(columns)
                : table === 'products'
                  ? db.products
                  : { data: [], error: null }
            chain.eq = (column: string, value: unknown) => {
              db.filters.push([table, column, value])
              return Object.assign(Promise.resolve(answer()), chain)
            }
            chain.limit = async () => answer()
            chain.maybeSingle = async () => db.brand
            return chain
          }
        }
      : null
}))

const { brandGuard } = await import('./data')
const tenant = '00000000-0000-4000-8000-000000000101'

afterEach(() => {
  db.on = true
  db.brand = { data: null, error: null }
  db.connections = () => ({ data: [], error: null })
  db.products = { data: [], error: null }
  db.filters = []
  db.selects = []
})

describe('brandGuard', () => {
  it('compares the profile with this workspace’s connected accounts only', async () => {
    db.brand = {
      data: { brand_name: 'Cedar Lane', domain: 'cedar-lane.example' },
      error: null
    }
    db.connections = () => ({
      data: [
        {
          provider: 'klaviyo',
          status: 'connected',
          account_label: 'Northwind Outdoor (sample)',
          shop_domain: null,
          account_website: 'https://northwind-outdoor.example',
          account_currency: 'EUR',
          account_country: 'DE'
        },
        {
          // Disconnected: its facts are ignored.
          provider: 'shopify',
          status: 'disconnected',
          account_label: 'other.myshopify.com',
          shop_domain: 'other.myshopify.com',
          account_website: null,
          account_currency: 'AUD',
          account_country: 'AU'
        }
      ],
      error: null
    })
    const found = await brandGuard(tenant)
    expect(found.map((m) => m.source)).toEqual(['klaviyo', 'klaviyo'])
    expect(found.some((m) => /Shopify/.test(m.message))).toBe(false)
    for (const table of ['brand_profiles', 'workspace_connections', 'products'])
      expect(db.filters).toContainEqual([table, 'tenant_id', tenant])
    // It does not read the profile sections it does not need.
    expect(db.selects.map(([table]) => table)).not.toContain(
      'brand_profile_sections'
    )
  })

  it('ignores an old connected Shopify store (v2 is Klaviyo only)', async () => {
    db.brand = {
      data: { brand_name: 'Cedar Lane', domain: 'cedar-lane.example' },
      error: null
    }
    db.connections = () => ({
      data: [
        {
          provider: 'shopify',
          status: 'connected',
          account_label: 'other.myshopify.com',
          shop_domain: 'other.myshopify.com',
          account_website: null,
          account_currency: 'EUR',
          account_country: 'DE'
        },
        {
          provider: 'klaviyo',
          status: 'connected',
          account_label: 'Cedar Lane',
          shop_domain: null,
          account_website: 'https://cedar-lane.example',
          account_currency: 'USD',
          account_country: 'US'
        }
      ],
      error: null
    })
    const found = await brandGuard(tenant)
    expect(found.some((m) => m.source === 'shopify')).toBe(false)
    expect(found.some((m) => /Shopify/.test(m.message))).toBe(false)
  })

  it('keeps the name and store checks on a database without the account facts', async () => {
    db.brand = {
      data: { brand_name: 'Cedar Lane', domain: 'cedar-lane.example' },
      error: null
    }
    db.connections = (columns) =>
      columns.includes('account_website')
        ? { data: null, error: { code: '42703' } }
        : {
            data: [
              {
                provider: 'klaviyo',
                status: 'connected',
                account_label: 'Northwind Outdoor (sample)',
                shop_domain: null
              }
            ],
            error: null
          }
    const found = await brandGuard(tenant)
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toMatch(/Northwind Outdoor \(sample\)/)
  })

  it('says nothing when it cannot read', async () => {
    db.on = false
    expect(await brandGuard(tenant)).toEqual([])
  })
})
