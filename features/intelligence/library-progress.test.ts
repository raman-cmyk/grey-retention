// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import {
  libraryProgress,
  libraryTarget,
  readLibraryProgress,
  type VariantRow
} from './library-progress'

const now = Date.parse('2026-11-15T12:00:00Z')
const row = (
  family: string,
  source: string,
  brands: number,
  becameUsefulAt: string | null = null
): VariantRow => ({ family, source, brands, becameUsefulAt })
const seeds = blockTypes.map((f) => row(f, 'seed', 0))

describe('libraryProgress (BLK-SCALE-001)', () => {
  it('counts seeds and structures seen at 2 or more brands; one brand is not enough', () => {
    const p = libraryProgress(
      [
        ...seeds,
        row('hero_image', 'competitor', 5, '2026-10-02T00:00:00Z'),
        row('hero_image', 'competitor', 2, '2026-11-12T00:00:00Z'),
        // One brand, however many times: kept, not counted.
        row('hero_image', 'competitor', 1),
        row('text', 'competitor', 0)
      ],
      { now }
    )
    expect(p).toMatchObject({
      target: libraryTarget,
      variants: 24,
      seeds: 20,
      fromCompetitors: 4,
      useful: 22,
      progress: 0.011,
      usefulLastWeek: 1,
      complete: true
    })
    expect(p.byFamily[0]).toEqual({
      family: 'hero_image',
      variants: 4,
      useful: 3
    })
    expect(p.byFamily).toHaveLength(20)
  })

  it('counts a variant made long ago that became useful this week', () => {
    const p = libraryProgress(
      [...seeds, row('text', 'competitor', 2, '2026-11-12T00:00:00Z')],
      { now }
    )
    expect(p.usefulLastWeek).toBe(1)
    expect(
      libraryProgress(
        [...seeds, row('text', 'competitor', 2, '2026-11-07T00:00:00Z')],
        {
          now
        }
      ).usefulLastWeek
    ).toBe(0)
  })

  it('names the thin families, thinnest first: where to collect next', () => {
    // An even split is 100 useful blocks a family; under 25 is thin.
    const p = libraryProgress(
      [
        ...seeds,
        ...Array.from({ length: 30 }, () =>
          row('product_grid_2col', 'competitor', 3)
        ),
        ...Array.from({ length: 10 }, () => row('text', 'competitor', 2)),
        ...Array.from({ length: 5 }, () => row('faq', 'competitor', 2))
      ],
      { now }
    )
    expect(p.thinFamilies).not.toContain('product_grid_2col')
    expect(p.thinFamilies).toHaveLength(19)
    expect(p.thinFamilies.slice(-2)).toEqual(['faq', 'text'])
  })

  it('leaves out unknown families and sources, and odd brand counts', () => {
    const p = libraryProgress(
      [
        row('countdown', 'competitor', 9),
        row('text', 'competitor', 2.5),
        row('text', 'other', 9)
      ],
      { now }
    )
    expect(p).toMatchObject({
      variants: 1,
      fromCompetitors: 1,
      useful: 0,
      seeds: 0
    })
  })

  it('says when the numbers are a floor', () => {
    expect(libraryProgress(seeds, { now, complete: false }).complete).toBe(
      false
    )
  })
})

describe('readLibraryProgress (BLK-SCALE-001)', () => {
  type Page = { data: unknown[] | null; error: unknown }
  const fakeDb = (tables: Record<string, Page[]>) => {
    const asked: string[] = []
    const calls = new Map<string, number>()
    const from = vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        not: vi.fn(() => chain),
        order: vi.fn((column: string) => {
          asked.push(`${table} order ${column}`)
          return chain
        }),
        range: vi.fn(async (start: number, end: number) => {
          asked.push(`${table} ${start}-${end}`)
          const call = calls.get(table) ?? 0
          calls.set(table, call + 1)
          return tables[table]?.[call] ?? { data: [], error: null }
        })
      }
      return chain
    })
    return { db: { from } as never, asked }
  }
  const seedRows = blockTypes.map((f, i) => ({
    id: `s${i}`,
    family: f,
    source: 'seed'
  }))

  it('counts brands from the sections, and when the second brand appeared', async () => {
    const { db, asked } = fakeDb({
      block_variants: [
        {
          data: [
            ...seedRows,
            { id: 'v1', family: 'text', source: 'competitor' }
          ],
          error: null
        }
      ],
      email_sections: [
        {
          data: [
            // The same brand twice (one email with the structure twice): one brand.
            {
              id: 'a',
              variant_id: 'v1',
              inbox_messages: {
                capture_id: 'b1',
                received_at: '2026-10-01T00:00:00Z'
              }
            },
            {
              id: 'b',
              variant_id: 'v1',
              inbox_messages: {
                capture_id: 'b1',
                received_at: '2026-10-01T00:00:00Z'
              }
            },
            {
              id: 'c',
              variant_id: 'v1',
              inbox_messages: {
                capture_id: 'b2',
                received_at: '2026-11-13T00:00:00Z'
              }
            }
          ],
          error: null
        }
      ]
    })
    const p = (await readLibraryProgress(db, now))!
    expect(p).toMatchObject({ useful: 21, usefulLastWeek: 1, complete: true })
    expect(asked).toContain('block_variants order created_at')
    expect(asked).toContain('block_variants order id')
  })

  it('reads page after page until an empty one', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      id: `v${i}`,
      family: 'text',
      source: 'competitor'
    }))
    const { db, asked } = fakeDb({
      block_variants: [
        { data: [...seedRows, ...full.slice(20)], error: null },
        {
          data: [{ id: 'x', family: 'text', source: 'competitor' }],
          error: null
        }
      ],
      email_sections: []
    })
    const p = (await readLibraryProgress(db, now))!
    expect(p.variants).toBe(1001)
    expect(asked.filter((a) => a.startsWith('block_variants 1'))).toEqual([
      'block_variants 1000-1999',
      'block_variants 1001-2000'
    ])
  })

  it('is null when it may not read the library, or a read fails', async () => {
    // Under row security a member reads no rows at all: no seed means not allowed.
    expect(
      await readLibraryProgress(
        fakeDb({ block_variants: [], email_sections: [] }).db,
        now
      )
    ).toBeNull()
    expect(
      await readLibraryProgress(
        fakeDb({ block_variants: [{ data: null, error: { code: '42501' } }] })
          .db,
        now
      )
    ).toBeNull()
    expect(
      await readLibraryProgress(
        fakeDb({
          block_variants: [{ data: seedRows, error: null }],
          email_sections: [{ data: null, error: { code: 'PGRST301' } }]
        }).db,
        now
      )
    ).toBeNull()
    const thrown = {
      from: () => {
        throw new Error('down')
      }
    } as never
    expect(await readLibraryProgress(thrown, now)).toBeNull()
  })
})
