import { describe, expect, it } from 'vitest'
import { blockLibraryCount, type BlockCountRow } from './count'

const row = (o: Partial<BlockCountRow>): BlockCountRow => ({
  source: 'inbox',
  kind: 'hero',
  quality: 'passed',
  blocks: 0,
  uses: 0,
  reused: 0,
  two_brands: 0,
  ...o
})

describe('the block library count (DES-ENGINE-004, BLK-SCALE-001)', () => {
  it('counts distinct structures that pass, with the seeds, toward 2,000; private blocks apart', () => {
    const count = blockLibraryCount([
      row({ kind: 'hero', blocks: 37, uses: 49, reused: 6, two_brands: 2 }),
      row({ kind: 'footer', blocks: 8, uses: 39, reused: 3, two_brands: 1 }),
      row({ kind: 'footer', quality: 'failed', blocks: 1, uses: 1 }),
      row({ source: 'upload', kind: 'hero', blocks: 4, uses: 5, reused: 1 })
    ])
    expect(count).toMatchObject({
      target: 2000,
      seeds: 20,
      inbox: 45,
      private: 4,
      counted: 65,
      progress: 0.033,
      sections: 93,
      merged: 44,
      twoBrands: 3,
      reused: 10,
      failed: 1
    })
    expect(count.byKind).toEqual([
      { kind: 'hero', inbox: 37, private: 4, uses: 54 },
      { kind: 'footer', inbox: 8, private: 0, uses: 39 }
    ])
  })

  it('is only the seeds when the library is empty', () => {
    expect(blockLibraryCount([])).toMatchObject({
      counted: 20,
      inbox: 0,
      merged: 0,
      byKind: []
    })
  })
})
