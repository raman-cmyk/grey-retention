// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  blueprint,
  section,
  text,
  font
} from '@/features/design-engine/fixtures'
import { resolveTokens } from '@/features/design-engine/tokens'
import { copyInput, copyInputSchema } from './library-copy'
import { sampleStoreFrom } from './ports'
import { composeScratch } from './scratch'

/**
 * PICK-006: the email build carries the brand's tokens into the library
 * copy's input (with their sources, checked by its schema) and puts the
 * brand's spaces and type scale on Scratch's layouts.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const draft = {
  subject: 'S',
  preheader: 'P',
  blocks: [{ type: 'text', content: { heading: 'Hello', paras: ['Body.'] } }],
  productIds: [],
  code: null
} as never

describe('design tokens in the email build', () => {
  it('carries the store’s tokens into the copy’s input', async () => {
    const s = await sampleStoreFrom('2026-03-02').read(tenantId)
    const tokens = resolveTokens({
      site: { 'radius.button': 4, 'button.style': 'outline' }
    })
    const input = copyInput({
      store: { ...s, tokens },
      draft,
      rules: { maxDiscountPercent: 20, codes: [] },
      sourceNames: [],
      mode: 'klaviyo'
    })
    expect(input.brand.tokens).toEqual(tokens)
    const parsed = copyInputSchema.safeParse(input)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.brand.tokens?.['button.style']).toEqual({
      value: 'outline',
      source: 'site'
    })
    // Without tokens (the sample store), none: the layouts' own look.
    const plain = copyInput({
      store: s,
      draft,
      rules: { maxDiscountPercent: 20, codes: [] },
      sourceNames: [],
      mode: 'klaviyo'
    })
    expect(plain.brand.tokens).toBeUndefined()
    // A token outside the email-safe range never passes.
    expect(
      copyInputSchema.safeParse({
        ...input,
        brand: {
          ...input.brand,
          tokens: { ...tokens, 'radius.card': { value: 90, source: 'site' } }
        }
      }).success
    ).toBe(false)
  })

  it('composes Scratch in the brand’s spaces and type scale (only those given)', () => {
    const block = blueprint({
      sections: [
        section({
          height: 200,
          items: [
            text({
              gapBefore: 32,
              role: 'headline',
              lines: 1,
              height: 38,
              font: { ...font, size: 32, lineHeight: 38 }
            })
          ],
          bottom: 32
        })
      ]
    })
    const plain = composeScratch([block, block])
    expect(composeScratch([block, block], resolveTokens({}))).toEqual(plain)
    const branded = composeScratch(
      [block, block],
      resolveTokens({
        site: { 'spacing.base': 8, 'type.h1': 40, 'type.h2': 26 }
      })
    )
    const [first, second] = branded.sections
    expect(first!.items[0]!.gapBefore).toBe(48)
    expect(first!.bottom).toBe(48)
    expect((first!.items[0] as { font: { size: number } }).font.size).toBe(40)
    expect((second!.items[0] as { font: { size: number } }).font.size).toBe(26)
    expect(first!.height).toBeGreaterThan(plain.sections[0]!.height)
  })
})
