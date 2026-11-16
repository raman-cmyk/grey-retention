// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clip, writerGuide, writerRules } from '@/features/assembly/assemble'
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
          'The headline is 46 characters; a hero’s is at most 45. Use fewer, shorter words, never a smaller size.'
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

  it('counts what a reader sees, not code units', () => {
    // A letter outside the basic plane, a decomposed accent, a skin tone.
    for (const one of ['𝐀', 'e\u0301', '👋🏽'])
      expect(
        headlineFindings({
          blocks: [block('hero_product', { headline: one.repeat(45) })]
        }),
        one
      ).toEqual([])
  })

  it('tells the writer to leave a long product title out, never to shorten it', () => {
    const title = 'Organic Cotton Waffle Bath Towel, Set of Two in Oat'
    const reasons = (blocks: Block[]) =>
      headlineFindings({ blocks }, [title, 'Mug']).map((f) => f.reason)
    // The title is what makes it too long.
    expect(
      reasons([block('hero_product', { headline: `Meet the ${title}` })])
    ).toEqual([
      'The headline is 60 characters with the product’s title in it; at most 45. Leave the title out (the picture shows the product) and write about the product in a few words.'
    ])
    // The heading is the title: the writer's, or the one code clipped in.
    expect(
      reasons([
        block('product_feature', { heading: `${title}, Large Size` }),
        block('image_text', { heading: title.toUpperCase() })
      ])
    ).toEqual([
      'The heading is 63 characters with the product’s title in it; at most 60. Leave the title out (it shows under the heading) and write about the product in a few words.'
    ])
    // The heading is a title too long for it: the writer's, or the one
    // code puts in (clipped) when the writer gave none.
    const tall = `${title}, Made by Hand in Portugal from Long-Staple Cotton`
    expect(
      headlineFindings(
        {
          blocks: [
            block('product_feature', { heading: tall }),
            block('image_text', { heading: clip(tall, 80) })
          ]
        },
        [tall]
      ).map((f) => f.reason)
    ).toEqual([
      'The heading is the product’s title, 101 characters; at most 60. Write a shorter heading of your own (it shows under the heading).',
      'The heading is the product’s title, 78 characters; at most 60. Write a shorter heading of your own (the picture shows the product).'
    ])
    // A title found only inside other words is not in the headline; one
    // with a hidden character in the store is found as the writer saw it.
    expect(
      headlineFindings(
        {
          blocks: [
            block('hero_product', {
              headline: 'Steady warmth for the colder nights, all winter'
            })
          ]
        },
        ['Tea']
      ).map((f) => f.reason)
    ).toEqual([
      'The headline is 47 characters; a hero’s is at most 45. Use fewer, shorter words, never a smaller size.'
    ])
    expect(
      headlineFindings(
        { blocks: [block('hero_product', { headline: `Meet the ${title}` })] },
        [title.replace('Waffle', 'Waf\u200bfle')]
      ).map((f) => f.reason)
    ).toEqual([
      'The headline is 60 characters with the product’s title in it; at most 45. Leave the title out (the picture shows the product) and write about the product in a few words.'
    ])
    // A short title in a long headline: fewer words.
    expect(
      reasons([
        block('hero_product', { headline: `The Mug ${'x'.repeat(45)}` })
      ])
    ).toEqual([
      'The headline is 53 characters; a hero’s is at most 45. Use fewer, shorter words, never a smaller size.'
    ])
  })

  it('tells the Copywriter the same limits in its guide and rules', () => {
    const { hero, heading } = headlineLimits
    for (const type of ['hero_product', 'hero_image'] as const)
      expect(writerGuide[type]).toContain(`headline ≤${hero},`)
    for (const type of [
      'text',
      'steps',
      'product_feature',
      'product_grid_2col',
      'product_grid_3col',
      'image_text',
      'faq'
    ] as const)
      expect(writerGuide[type]).toContain(`heading ≤${heading}`)
    expect(Object.values(writerGuide).join(' ')).not.toMatch(
      /head(line|ing) ≤80/
    )
    expect(writerRules).toContainEqual(
      expect.stringContaining(
        `headline at most ${hero} characters, every other heading at most ${heading}`
      )
    )
  })
})
