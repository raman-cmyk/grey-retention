// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { SupabaseOfferSource } from './source'

const tenant = '00000000-0000-4000-8000-000000000101'
const code = (over: Record<string, unknown>) => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  code: 'WELCOME15',
  percent: 15,
  expires_at: null,
  ...over
})

function fakeDb(
  offers: unknown[] | null,
  codes: unknown[] | null,
  error: unknown = null
) {
  const calls: string[][] = []
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn((c1: string, v1: string) => {
        const first = Promise.resolve({
          data: table === 'brand_offers' ? offers : codes,
          error
        })
        return Object.assign(first, {
          eq: vi.fn((c2: string, v2: string) => {
            calls.push([table, c1, v1, c2, v2])
            return first
          })
        })
      })
    }))
  }))
  return { db: { from } as never, calls }
}

describe('SupabaseOfferSource', () => {
  it('reads the max discount and active codes, sorted', async () => {
    const { db, calls } = fakeDb(
      [{ max_discount_percent: 20, revision: 3 }],
      [
        code({
          code: 'ZED10',
          percent: 10,
          id: '00000000-0000-4000-8000-0000000000c2'
        }),
        code({})
      ]
    )
    expect(await new SupabaseOfferSource(db).managed(tenant)).toEqual({
      maxDiscountPercent: 20,
      grossMarginPercent: null,
      marginFloorPercent: null,
      revision: 3,
      codes: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          code: 'WELCOME15',
          percent: 15,
          expiresAt: null,
          ended: false
        },
        {
          id: '00000000-0000-4000-8000-0000000000c2',
          code: 'ZED10',
          percent: 10,
          expiresAt: null,
          ended: false
        }
      ]
    })
    expect(calls).toEqual([
      ['discount_codes', 'tenant_id', tenant, 'status', 'active']
    ])
  })

  it('marks a code whose end date has passed', async () => {
    const { db } = fakeDb(
      [],
      [code({ expires_at: '2020-01-01T00:00:00+00:00' })]
    )
    const managed = await new SupabaseOfferSource(db).managed(tenant)
    expect(managed?.codes[0]).toMatchObject({ code: 'WELCOME15', ended: true })
  })

  it('says "not set" before the owner saves anything', async () => {
    const { db } = fakeDb([], [])
    expect(await new SupabaseOfferSource(db).managed(tenant)).toEqual({
      maxDiscountPercent: null,
      grossMarginPercent: null,
      marginFloorPercent: null,
      revision: 0,
      codes: []
    })
  })

  it('gives agents only codes that still work when the email sends', async () => {
    const { db } = fakeDb(
      [{ max_discount_percent: 25, revision: 1 }],
      [
        code({
          code: 'SOON',
          expires_at: '2026-11-20T00:00:00+00:00',
          id: '00000000-0000-4000-8000-0000000000c3'
        }),
        code({
          code: 'LATER',
          expires_at: '2026-12-20T00:00:00+00:00',
          id: '00000000-0000-4000-8000-0000000000c4'
        }),
        code({
          code: 'BAD',
          percent: 0,
          id: '00000000-0000-4000-8000-0000000000c5'
        })
      ]
    )
    expect(
      await new SupabaseOfferSource(db).offers(tenant, '2026-12-01T00:00:00Z')
    ).toEqual({
      maxDiscountPercent: 25,
      limitedBy: 'max_discount',
      codes: [
        { code: 'LATER', percent: 15, expiresAt: '2026-12-20T00:00:00.000Z' }
      ]
    })
  })

  it('caps the max discount at the margin floor, and says so (PLN-039)', async () => {
    const source = (gross: number | null, floor: number | null) =>
      new SupabaseOfferSource(
        fakeDb(
          [
            {
              max_discount_percent: 50,
              gross_margin_percent: gross,
              margin_floor_percent: floor,
              revision: 2
            }
          ],
          [code({})]
        ).db
      )
    expect(await source(60, 30).managed(tenant)).toMatchObject({
      maxDiscountPercent: 50,
      grossMarginPercent: 60,
      marginFloorPercent: 30
    })
    // Agents read 42%: a 60% margin with a 30% floor allows no more.
    expect(await source(60, 30).offers(tenant)).toMatchObject({
      maxDiscountPercent: 42,
      limitedBy: 'margin_floor',
      codes: [{ code: 'WELCOME15', percent: 15 }]
    })
    // A loose floor leaves the owner's max as the limit.
    expect(await source(80, 10).offers(tenant)).toMatchObject({
      maxDiscountPercent: 50,
      limitedBy: 'max_discount'
    })
    expect(await source(null, null).offers(tenant)).toMatchObject({
      maxDiscountPercent: 50,
      limitedBy: 'max_discount'
    })
  })

  it('returns null when it cannot read, never a guess', async () => {
    expect(
      await new SupabaseOfferSource(
        fakeDb(null, null, { code: '42501' }).db
      ).offers(tenant)
    ).toBeNull()
    expect(
      await new SupabaseOfferSource(fakeDb([], []).db).offers('not-a-uuid')
    ).toBeNull()
  })
})
