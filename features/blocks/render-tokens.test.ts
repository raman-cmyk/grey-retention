import { describe, expect, it } from 'vitest'
import {
  resolveTokens,
  tokenDefaults,
  tokenValues
} from '@/features/design-engine/tokens'
import { renderEmail, themeOf } from './render'
import { sampleBlocks, sampleBrand } from './samples'

/**
 * PICK-006: the coded blocks in the brand's design tokens. The defaults are
 * the blocks' own look; two brands' tokens give the same blocks visibly
 * different spaces, corners and buttons, every value inside its
 * email-safe range, and the phone sizes never above the blocks' own.
 */
const calm = tokenValues(
  resolveTokens({
    site: {
      'spacing.base': 4,
      'type.body': 16,
      'type.h1': 30,
      'type.h2': 22,
      'type.headingCase': 'uppercase',
      'radius.button': 0,
      'radius.card': 2,
      'radius.image': 0,
      'button.style': 'filled',
      'button.paddingX': 24,
      'button.paddingY': 12,
      'button.case': 'uppercase',
      'button.weight': 600
    }
  })
)
const soft = tokenValues(
  resolveTokens({
    site: {
      'spacing.base': 8,
      'type.body': 18,
      'type.h1': 40,
      'type.h2': 28,
      'type.lineHeight': 1.6,
      'radius.button': 24,
      'radius.card': 16,
      'radius.image': 12,
      'button.style': 'outline',
      'button.paddingX': 36,
      'button.paddingY': 16,
      'button.weight': 500
    }
  })
)
const blocks = Object.values(sampleBlocks)
const draw = (tokens?: typeof calm) =>
  renderEmail({
    blocks,
    brand: tokens ? { ...sampleBrand, tokens } : sampleBrand
  })

describe('coded blocks with design tokens (PICK-006)', () => {
  it('draws the defaults as the blocks’ own look', () => {
    const plain = draw()
    const withDefaults = draw(tokenDefaults)
    // Only the code's box takes the (default) card corners.
    expect(
      withDefaults.replace('border-radius:8px;font-family', 'font-family')
    ).toBe(plain)
  })

  it('draws two brands’ tokens visibly differently on the same blocks', () => {
    const a = draw(calm)
    const b = draw(soft)
    expect(a).not.toBe(b)
    // Spaces: the blocks' 28 px is 28 in a 4 px unit, 42 in an 8 px one.
    expect(a).toContain('padding:28px 32px')
    expect(b).toContain('padding:42px 40px')
    // Buttons: filled and square in capitals, or an outline pill.
    expect(a).toMatch(
      /border-radius:0px;background:#[0-9a-f]{6};padding:12px 24px/
    )
    expect(a).toContain('font-weight:600;text-transform:uppercase;')
    expect(b).toMatch(
      /border-radius:24px;border:2px solid #[0-9a-f]{6};padding:14px 34px/
    )
    expect(b).not.toMatch(
      /<td bgcolor="[^"]+" align="center" style="border-radius:24px/
    )
    // Pictures and the code's box.
    expect(a).toContain('border-radius:0px')
    expect(b).toContain('border-radius:12px')
    expect(b).toContain('dashed')
    expect(b).toMatch(/dashed #[0-9a-f]{6};border-radius:16px;/)
    // Type: the brand's sizes, line height and heading case.
    expect(a).toContain(
      'font-size:30px;line-height:1.15;font-weight:700;text-transform:uppercase;'
    )
    expect(b).toContain('font-size:40px;line-height:1.15;font-weight:700;color')
    expect(b).toContain('font-size:18px;line-height:1.6;')
  })

  it('keeps every value inside the email-safe range, and phones at the blocks’ sizes', () => {
    const wild = tokenValues(
      resolveTokens({
        site: {
          'spacing.base': 12,
          'type.h1': 48,
          'type.h2': 36,
          'button.paddingX': 48
        }
      })
    )
    const t = themeOf({ ...sampleBrand, tokens: wild })
    expect(t.pad).toBeLessThanOrEqual(40)
    expect(t.gap).toBeLessThanOrEqual(24)
    expect(t.inner).toBeGreaterThanOrEqual(520)
    const html = draw(wild)
    // On a phone, headlines are never larger than the blocks' own phone sizes.
    expect(html).toContain('.gr-h1{font-size:28px!important}')
    expect(html).toContain('.gr-h2{font-size:20px!important}')
    const small = themeOf({
      ...sampleBrand,
      tokens: tokenValues(
        resolveTokens({ site: { 'type.h1': 24, 'type.h2': 18 } })
      )
    })
    expect(small.h1).toBe(24)
    expect(
      draw(
        tokenValues(resolveTokens({ site: { 'type.h1': 24, 'type.h2': 18 } }))
      )
    ).toContain(
      '.gr-h1{font-size:24px!important}.gr-h2{font-size:18px!important}'
    )
    // Column widths still add up to the inside width.
    expect(t.inner + 2 * t.pad).toBe(600)
  })
})
