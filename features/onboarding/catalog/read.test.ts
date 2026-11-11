// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assemblyProducts, listCatalog } from './read'

type Db = Parameters<typeof listCatalog>[0]
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  external_id: '7001',
  title: 'Field Overshirt',
  url: 'https://cedar.example/products/field-overshirt',
  price_minor: 6900,
  currency: 'USD',
  compare_at_minor: 8900,
  compare_at_is_sale: true,
  image_url: 'https://cedar.example/i.jpg',
  featurable: true,
  hidden_reason: null,
  units_30d: 3,
  units_90d: 5,
  bestseller_rank: 1,
  launched_at: null,
  new_arrival: false,
  stock: 0,
  stock_known: false,
  ...over
})

function database(rows: unknown[], error: unknown = null) {
  const ops: [string, unknown[]][] = []
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'is', 'order', 'limit'])
    chain[op] = (...args: unknown[]) => {
      ops.push([op, args])
      return chain
    }
  chain.then = (done: (v: unknown) => unknown) => done({ data: rows, error })
  return { ops, db: { from: () => chain } as unknown as Db }
}

describe('listCatalog', () => {
  it("gives the workspace's current Klaviyo products, best sellers first, in the store's money", async () => {
    const { db, ops } = database([
      row(),
      row({
        id: 'p2',
        external_id: '7002',
        title: 'Weekend Knit',
        price_minor: 12000,
        compare_at_minor: 24000,
        compare_at_is_sale: false,
        bestseller_rank: null,
        stock: 4,
        stock_known: true,
        featurable: false,
        hidden_reason: 'not_picked'
      })
    ])
    const entries = await listCatalog(db, 'tenant-1')
    expect(entries[0]).toEqual({
      id: 'p1',
      externalId: '7001',
      title: 'Field Overshirt',
      url: 'https://cedar.example/products/field-overshirt',
      price: '$69.00',
      amount: 69,
      currency: 'USD',
      compareAt: '$89.00',
      image: 'https://cedar.example/i.jpg',
      featurable: true,
      hiddenReason: null,
      unitsSold30d: 3,
      unitsSold90d: 5,
      bestsellerRank: 1,
      launchedAt: null,
      newArrival: false,
      // The store does not say: unknown, not out of stock.
      stock: null
    })
    // A permanent compare-at price is never shown.
    expect(entries[1]).toMatchObject({
      compareAt: null,
      stock: 4,
      hiddenReason: 'not_picked'
    })
    expect(ops).toContainEqual(['eq', ['tenant_id', 'tenant-1']])
    expect(ops).toContainEqual(['eq', ['source', 'klaviyo']])
    expect(ops).toContainEqual(['is', ['retired_at', null]])
    expect(ops).not.toContainEqual(['eq', ['featurable', true]])
    const only = database([])
    await listCatalog(only.db, 'tenant-1', { featurableOnly: true })
    expect(only.ops).toContainEqual(['eq', ['featurable', true]])
  })

  it('formats money without minor units in such a currency, and throws a read error', async () => {
    const yen = await listCatalog(
      database([
        row({ currency: 'JPY', price_minor: 6900, compare_at_minor: null })
      ]).db,
      't'
    )
    expect(yen[0]!.price).toBe('¥6,900')
    await expect(
      listCatalog(database([], { code: '42501' }).db, 't')
    ).rejects.toMatchObject({
      code: '42501'
    })
  })
})

describe('assemblyProducts', () => {
  it('hands the assembly only products with a photo, and a compare-at only for a sale', async () => {
    const entries = await listCatalog(
      database([
        row(),
        row({ id: 'p2', image_url: null }),
        row({ id: 'p3', compare_at_is_sale: false })
      ]).db,
      't'
    )
    expect(assemblyProducts(entries)).toEqual([
      {
        id: 'p1',
        title: 'Field Overshirt',
        price: '$69.00',
        compareAt: '$89.00',
        compareAtIsSale: true,
        image: 'https://cedar.example/i.jpg',
        url: 'https://cedar.example/products/field-overshirt',
        featurable: true
      },
      {
        id: 'p3',
        title: 'Field Overshirt',
        price: '$69.00',
        image: 'https://cedar.example/i.jpg',
        url: 'https://cedar.example/products/field-overshirt',
        featurable: true
      }
    ])
  })
})
