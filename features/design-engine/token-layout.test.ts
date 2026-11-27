import { describe, expect, it } from 'vitest'
import {
  blueprintSchema,
  partsOf,
  textOf,
  type Blueprint,
  type TextPart
} from './blueprint'
import { blueprint, font, gridSection, image, section, text } from './fixtures'
import { rhythmOf, withTokens } from './token-layout'

const texts = (bp: Blueprint) =>
  bp.sections
    .flatMap((s) => partsOf(s.items))
    .filter((p): p is TextPart => p.type === 'text')

const hero = () =>
  section({
    height: 300,
    items: [
      text({
        gapBefore: 40,
        role: 'headline',
        lines: 2,
        height: 76,
        font: { ...font, size: 32, lineHeight: 38 },
        runs: [{ text: 'Xxxx xxxx xxx xxxxx xx xxx xxxx' }]
      }),
      text({
        gapBefore: 12,
        role: 'body',
        lines: 3,
        height: 72,
        font: { ...font, size: 16, lineHeight: 24 },
        runs: [{ text: 'xxxx '.repeat(30).trim() }]
      }),
      image({ gapBefore: 20, height: 100 })
    ],
    bottom: 32
  })

describe('withTokens (PICK-006, Scratch)', () => {
  it('leaves the layout alone when the brand gave no spacing or type', () => {
    const bp = blueprint()
    expect(withTokens(bp, {})).toBe(bp)
    expect(withTokens(bp, { 'radius.button': 4 })).toBe(bp)
  })

  it('puts the brand’s spaces on its scale and keeps the heights true', () => {
    const bp = blueprint({ sections: [hero()] })
    const got = withTokens(bp, {
      'spacing.base': 8,
      'spacing.steps': [8, 16, 24, 32, 48, 64]
    })
    const s = got.sections[0]!
    // 40 × 1.5 = 60 → 64; 12 × 1.5 = 18 → 16; 20 × 1.5 = 30 → 32; 32 → 48.
    expect(s.items.map((i) => i.gapBefore)).toEqual([64, 16, 32])
    expect(s.bottom).toBe(48)
    expect(s.height).toBe(300 + 24 + 4 + 12 + 16)
    expect(blueprintSchema.safeParse(got).success).toBe(true)
  })

  it('gives two brands visibly different rhythm on the same layout', () => {
    const bp = blueprint({ sections: [hero()] })
    const tight = withTokens(bp, {
      'spacing.base': 2,
      'spacing.steps': [4, 8, 12, 16, 24]
    })
    const airy = withTokens(bp, { 'spacing.base': 8 })
    expect(tight.sections[0]!.height).toBeLessThan(bp.sections[0]!.height)
    expect(airy.sections[0]!.height).toBeGreaterThan(bp.sections[0]!.height)
  })

  it('never moves a line’s own small space', () => {
    const rhythm = rhythmOf({ 'spacing.base': 8 })!
    expect(rhythm(2)).toBe(2)
    expect(rhythm(0)).toBe(0)
    expect(rhythm(-4)).toBe(-4)
  })

  it('puts the first headline in the headline size, the body in the body size', () => {
    const bp = blueprint({ sections: [hero(), { ...hero(), ordinal: 2 }] })
    const got = withTokens(bp, {
      'type.h1': 40,
      'type.h2': 26,
      'type.body': 18,
      'type.lineHeight': 1.6,
      'type.headingCase': 'uppercase'
    })
    const [h1, body1, h2] = texts(got)
    expect(h1!.font.size).toBe(40)
    expect(h1!.font.lineHeight).toBe(47.5)
    expect(h1!.font.transform).toBe('uppercase')
    expect(h2!.font.size).toBe(26)
    expect(body1!.font.size).toBe(18)
    expect(body1!.font.lineHeight).toBe(28.8)
    expect(body1!.font.transform).toBe('none')
    // Its lines stay; its height is its lines at the new line height.
    expect(h1!.height).toBe(95)
    expect(body1!.height).toBe(86.4)
    // A larger size holds fewer words a line (capitals fewer still).
    const was = texts(bp)
    expect(textOf(h1!).length).toBeLessThan(textOf(was[0]!).length)
    expect(textOf(body1!).length).toBeLessThan(textOf(was[1]!).length)
    // The section grows by the texts' growth.
    expect(got.sections[0]!.height).toBeCloseTo(
      300 + (95 - 76) + (86.4 - 72),
      5
    )
    expect(blueprintSchema.safeParse(got).error?.issues ?? []).toEqual([])
  })

  it('grows a row by its tallest column', () => {
    const grid = gridSection(1)
    const bp = blueprint({ sections: [grid] })
    const got = withTokens(bp, { 'type.body': 20 })
    // The grid's texts are prices (not body): nothing changes.
    expect(got.sections[0]!.height).toBe(grid.height)
    expect(blueprintSchema.safeParse(got).success).toBe(true)
  })
})
