// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { blockTypes } from './catalog'
import {
  blockHeight,
  blockHeights,
  emailHeight,
  heroButtonRow
} from './heights'

/** DST-007: the drawn heights the plans count on (kept true in Chromium by `tests/e2e/email-length.spec.ts`). */
describe('the block heights (DST-007)', () => {
  it('has a height for every block, and an email of about 2,000 px', () => {
    for (const type of blockTypes)
      expect(blockHeights[type], type).toBeGreaterThan(30)
    expect(emailHeight).toEqual({ min: 1_800, max: 2_400 })
  })

  it('grows a product grid by its rows, and keeps the sample’s height with no count', () => {
    expect(blockHeight('product_grid_2col', 2)).toBe(443)
    expect(blockHeight('product_grid_2col', 3)).toBe(811)
    expect(blockHeight('product_grid_2col', 4)).toBe(811)
    expect(blockHeight('product_grid_3col', 3)).toBe(351)
    expect(blockHeight('product_grid_3col', 6)).toBe(627)
    expect(blockHeight('product_grid_2col')).toBe(811)
    // Any other block is its own height, whatever it shows.
    expect(blockHeight('product_feature', 1)).toBe(316)
  })

  it('counts the live button’s row under a hero the studio drew', () => {
    expect(heroButtonRow).toBe(100)
  })
})
