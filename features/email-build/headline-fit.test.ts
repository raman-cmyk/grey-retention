// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Block } from '@/features/blocks/catalog'
import { headlineFindings, headlineLimits } from './headline-fit'

/** DST-PIC #20 and #11: written headlines that fit their sections. */
const block = (type: Block['type'], content: Record<string, unknown>) =>
  ({ type, content }) as Block

describe('headlines that fit their design (DST-PIC #20)', () => {
  it('holds a hero’s headline to 45 characters and every other heading to 60', () => {
    expect(headlineLimits).toEqual({ hero: 45, heading: 60 })
    const fits = 'x'.repeat(45)
    expect(
      headlineFindings({
        blocks: [
          block('hero_product', { headline: fits }),
          block('hero_image', { headline: ` ${fits} ` }),
          block('text', { heading: 'y'.repeat(60) }),
          block('cta', { label: 'z'.repeat(80) })
        ]
      })
    ).toEqual([])
    expect(
      headlineFindings({
        blocks: [
          block('header_logo', {}),
          block('hero_image', { headline: 'x'.repeat(46) }),
          block('product_feature', { heading: 'y'.repeat(61) })
        ]
      })
    ).toEqual([
      {
        by: 'code',
        rule: 'headline_too_long',
        field: '2-hero_image',
        reason:
          'The headline is 46 characters; a hero’s is at most 45, about two lines in its design. Use fewer, shorter words, never a smaller size.'
      },
      {
        by: 'code',
        rule: 'headline_too_long',
        field: '3-product_feature',
        reason:
          'The heading is 61 characters; at most 60. Use fewer, shorter words.'
      }
    ])
  })

  it('counts characters as a reader does, not bytes', () => {
    expect(
      headlineFindings({
        blocks: [block('hero_product', { headline: 'é'.repeat(45) })]
      })
    ).toEqual([])
  })
})
