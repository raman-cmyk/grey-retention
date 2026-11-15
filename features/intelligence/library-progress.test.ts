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
  evidence: number,
  created_at = '2026-10-01T00:00:00Z'
): VariantRow => ({ family, source, evidence, created_at })
const seeds = blockTypes.map((f) => row(f, 'seed', 0))

describe('libraryProgress (BLK-SCALE-001)', () => {
  it('counts seeds and structures seen twice as useful, one-offs not', () => {
    const p = libraryProgress(
      [
        ...seeds,
        row('hero_image', 'competitor', 5),
        row('hero_image', 'competitor', 2, '2026-11-12T00:00:00Z'),
        row('hero_image', 'competitor', 1, '2026-11-12T00:00:00Z'),
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
      usefulLastWeek: 1
    })
    expect(p.byFamily[0]).toEqual({
      family: 'hero_image',
      variants: 4,
      useful: 3
    })
    expect(p.byFamily).toHaveLength(20)
  })

  it('names the thin families: where to collect next', () => {
    // An even split is 100 useful blocks a family; under 25 is thin.
    const many = Array.from({ length: 30 }, () =>
      row('product_grid_2col', 'competitor', 3)
    )
    const p = libraryProgress([...seeds, ...many], { now })
    expect(p.thinFamilies).not.toContain('product_grid_2col')
    expect(p.thinFamilies).toHaveLength(19)
    expect(p.thinFamilies).toEqual([...p.thinFamilies].sort())
  })

  it('leaves out unknown families and odd evidence', () => {
    const p = libraryProgress(
      [
        row('countdown', 'competitor', 9),
        row('text', 'competitor', 2.5),
        row('text', 'other', 9)
      ],
      { now }
    )
    expect(p).toMatchObject({ variants: 2, useful: 0, seeds: 0 })
  })

  it('is empty, not broken, with no rows', () => {
    expect(libraryProgress([], { now })).toMatchObject({
      variants: 0,
      useful: 0,
      progress: 0,
      thinFamilies: [...blockTypes].sort()
    })
  })
})

describe('readLibraryProgress (BLK-SCALE-001)', () => {
  const fakeDb = (pages: (VariantRow[] | null)[]) => {
    const ranges: [number, number][] = []
    let call = 0
    const chain = {
      select: vi.fn(() => chain),
      order: vi.fn(() => chain),
      range: vi.fn(async (from: number, to: number) => {
        ranges.push([from, to])
        const data = pages[call++]
        return data === null
          ? { data: null, error: { code: '42501' } }
          : { data: data ?? [], error: null }
      })
    }
    return { db: { from: vi.fn(() => chain) } as never, ranges }
  }

  it('reads every page until a short one', async () => {
    const full = Array.from({ length: 1000 }, () =>
      row('text', 'competitor', 2)
    )
    const { db, ranges } = fakeDb([full, [row('text', 'competitor', 2)]])
    expect((await readLibraryProgress(db, now))!.useful).toBe(1001)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999]
    ])
  })

  it('is null when a read fails', async () => {
    expect(await readLibraryProgress(fakeDb([null]).db, now)).toBeNull()
    const thrown = {
      from: () => {
        throw new Error('down')
      }
    } as never
    expect(await readLibraryProgress(thrown, now)).toBeNull()
  })
})
