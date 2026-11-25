import { describe, expect, it } from 'vitest'
import type { Blueprint, RowItem } from './blueprint'
import { blueprint, button, image, measured, section, text } from './fixtures'
import {
  compareBlueprints,
  layoutScore,
  limits,
  phoneProblems
} from './likeness'

const clone = (bp: Blueprint): Blueprint => structuredClone(bp)

describe('the likeness check', () => {
  it('passes an email against itself with a perfect grey-box score', () => {
    const result = compareBlueprints(blueprint(), blueprint())
    expect(result).toMatchObject({ pass: true, picture: 1, problems: [] })
    expect(result.sections.every((s) => s.pass && s.picture === 1)).toBe(true)
  })

  it('allows a section 5 % taller, not 6 %', () => {
    const ok = clone(blueprint())
    ok.sections[0]!.height = 460 * 1.05
    ok.sections[0]!.bottom += 460 * 0.05
    expect(compareBlueprints(blueprint(), ok).sections[0]!.problems).toEqual([])
    const bad = clone(blueprint())
    bad.sections[0]!.height = 460 * 1.06
    const verdict = compareBlueprints(blueprint(), bad).sections[0]!
    expect(verdict.pass).toBe(false)
    expect(verdict.problems[0]).toMatch(
      /taller than the original \(460 px, 5 % allowed\)/
    )
  })

  it('allows a column 2 px off, not 3', () => {
    const shifted = (dx: number) => {
      const bp = clone(blueprint())
      const row = bp.sections[1]!.items[0] as RowItem
      row.columns[1]!.width += dx
      return compareBlueprints(blueprint(), bp).sections[1]!
    }
    expect(shifted(2).problems.filter((p) => /column/.test(p))).toEqual([])
    expect(
      shifted(3).problems.some((p) => /column 2 is 3 px wider/.test(p))
    ).toBe(true)
  })

  it('allows text, button and picture sizes 1 px off, not 2, and picture shapes 2 % off', () => {
    const at = (change: (bp: Blueprint) => void) => {
      const bp = clone(blueprint())
      change(bp)
      return compareBlueprints(blueprint(), bp).sections[0]!.problems
    }
    expect(
      at(
        (bp) =>
          ((bp.sections[0]!.items[1] as ReturnType<typeof text>).font.size += 1)
      )
    ).toEqual([])
    expect(
      at(
        (bp) =>
          ((bp.sections[0]!.items[1] as ReturnType<typeof text>).font.size += 2)
      )[0]
    ).toMatch(/text 2 is 34 px where the original is 32 px/)
    expect(
      at(
        (bp) =>
          ((bp.sections[0]!.items[2] as ReturnType<typeof button>).width += 2)
      )[0]
    ).toMatch(/a button is 162 × 48 px/)
    const picture = at(
      (bp) =>
        ((bp.sections[0]!.items[0] as ReturnType<typeof image>).height = 312)
    )
    expect(picture.some((p) => /a picture is 600 × 312 px/.test(p))).toBe(true)
    expect(picture.some((p) => /shape changed by 4 %/.test(p))).toBe(true)
  })

  it('fails a section whose parts or kind differ, or that is missing', () => {
    const bp = clone(blueprint())
    bp.sections[0]!.items = [text(), image(), button()]
    bp.sections[0]!.kind = 'text'
    const verdict = compareBlueprints(blueprint(), bp).sections[0]!
    expect(verdict.problems).toContain(
      'It reads as text where the original is hero.'
    )
    expect(verdict.problems).toContain(
      'Its parts are arranged differently from the original.'
    )
    const short = compareBlueprints(blueprint(), {
      ...blueprint(),
      sections: [section()]
    })
    expect(short.pass).toBe(false)
    expect(short.problems[0]).toMatch(/1 sections where the original has 2/)
    expect(short.sections[1]!.problems).toEqual([
      'It is missing from the redraw.'
    ])
  })

  it('scores grey-box layouts: identical 1, moved boxes lower, empty layouts alike', () => {
    const box = {
      kind: 'image' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      section: 1
    }
    expect(layoutScore([box], [box], 200, 200)).toBe(1)
    expect(layoutScore([box], [{ ...box, x: 40 }], 200, 200)).toBeLessThan(
      limits.picture
    )
    expect(layoutScore([box], [{ ...box, x: 4 }], 200, 200)).toBeGreaterThan(
      0.9
    )
    expect(layoutScore([], [], 100, 100)).toBe(1)
    // A picture where the original has words counts against it.
    expect(
      layoutScore([box], [{ ...box, kind: 'text' }], 200, 200)
    ).toBeCloseTo(0.5)
  })

  it('adds the phone problems to their sections', () => {
    const result = compareBlueprints(
      blueprint(),
      blueprint(),
      new Map([[2, ['On a phone (375 px) the email scrolls sideways.']]])
    )
    expect(result.pass).toBe(false)
    expect(result.sections[1]!.problems).toEqual([
      'On a phone (375 px) the email scrolls sideways.'
    ])
  })
})

describe('phone problems', () => {
  it('finds parts past the screen and pictures under words, by section', () => {
    const m = measured()
    const s1 = m.add(
      m.body,
      'table',
      { x: 0, y: 0, w: 600, h: 300 },
      {},
      { 'data-gr-section': '1' }
    )
    m.add(s1, 'img', { x: 0, y: 0, w: 600, h: 300 })
    const s2 = m.add(
      m.body,
      'table',
      { x: 0, y: 300, w: 375, h: 200 },
      {},
      { 'data-gr-section': '2' }
    )
    m.add(s2, 'img', { x: 0, y: 300, w: 200, h: 200 })
    m.words(s2, 'Words over the picture', [{ x: 20, y: 320, w: 150, h: 18 }])
    const s3 = m.add(
      m.body,
      'table',
      { x: 0, y: 500, w: 375, h: 100 },
      {},
      { 'data-gr-section': '3' }
    )
    m.words(s3, 'Fine words', [{ x: 20, y: 520, w: 150, h: 18 }])
    m.words(s3, 'More words', [{ x: 20, y: 520, w: 300, h: 40 }])
    const done = { ...m.done(), viewport: 375, contentWidth: 600 }
    const problems = phoneProblems(done, 375)
    expect(problems.get(1)).toEqual([
      'On a phone (375 px) a part reaches past the edge of the screen.',
      'On a phone (375 px) the email scrolls sideways.'
    ])
    expect(problems.get(2)).toEqual([
      'On a phone (375 px) two parts are drawn on top of each other.'
    ])
    expect(problems.has(3)).toBe(false)
  })
})
