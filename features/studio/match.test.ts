// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Verdict } from './critic'
import {
  gridProblem,
  isMatchScore,
  matchScore,
  matchTarget,
  resample,
  withMatch,
  type LumaGrid
} from './match'

/** A grid painted by `f(x, y)`, with x and y from 0 to 1 across it. */
const paint = (
  width: number,
  height: number,
  f: (x: number, y: number) => number
): LumaGrid => ({
  width,
  height,
  values: Array.from({ length: width * height }, (_, i) =>
    f(((i % width) + 0.5) / width, (Math.floor(i / width) + 0.5) / height)
  )
})

/**
 * A hero as grey levels: a dark photo on the left half, the headline's
 * dark lines on the right, on white.
 */
const hero = (x: number, y: number) =>
  x < 0.5
    ? y > 0.1 && y < 0.9
      ? 40
      : 245
    : y > 0.3 && y < 0.38
      ? 30
      : y > 0.5 && y < 0.55
        ? 90
        : 245
const mirrored = (x: number, y: number) => hero(1 - x, y)

describe('the match score of a drawn section against its reference (DST-004b)', () => {
  it('is 10 for the same picture, also drawn larger or a little taller', () => {
    const reference = paint(48, 50, hero)
    expect(matchScore(reference, reference)).toBe(10)
    // Drawn at another size, and 20% taller (Copy keeps about the height).
    expect(matchScore(paint(96, 100, hero), reference)).toBeGreaterThanOrEqual(
      9
    )
    expect(matchScore(paint(48, 60, hero), reference)).toBeGreaterThanOrEqual(
      matchTarget + 2
    )
  })

  it('is low for the photo on the other side, the tones turned round, or a busy picture for a plain one', () => {
    const reference = paint(48, 50, hero)
    expect(matchScore(paint(48, 50, mirrored), reference)).toBeLessThan(
      matchTarget
    )
    expect(
      matchScore(
        paint(48, 50, (x, y) => 255 - hero(x, y)),
        reference
      )
    ).toBeLessThan(matchTarget)
    const plain = paint(48, 50, () => 245)
    const busy = paint(48, 50, (x, y) =>
      Math.floor(x * 12) % 2 === Math.floor(y * 12) % 2 ? 20 : 240
    )
    expect(matchScore(plain, plain)).toBe(10)
    expect(matchScore(busy, plain)).toBeLessThan(matchTarget)
  })

  it('never counts what a textured photo shows: the brand’s own in the same place matches', () => {
    // Textured photos, different in every cell (a seeded random walk).
    const photoOf = (seed: number) => {
      let n = seed
      const next = () => (n = (n * 16807) % 2147483647) / 2147483647
      const cells = Array.from({ length: 64 }, () => 20 + next() * 190)
      return (x: number, y: number) =>
        cells[
          Math.min(7, Math.floor(x * 8)) * 8 + Math.min(7, Math.floor(y * 8))
        ]!
    }
    const words = (x: number, y: number) =>
      y > 0.3 && y < 0.38 ? 30 : y > 0.5 && y < 0.55 ? 90 : 245
    for (const width of [0.3, 0.5, 0.7]) {
      const layout = (photo: (x: number, y: number) => number) =>
        paint(120, 120, (x, y) =>
          x < width && y > 0.1 && y < 0.9 ? photo(x / width, y) : words(x, y)
        )
      expect(
        matchScore(layout(photoOf(99)), layout(photoOf(7))),
        `photo ${width * 100}% wide`
      ).toBeGreaterThanOrEqual(matchTarget)
    }
  })

  it('never counts what a smooth photo shows: a soft full-bleed photo, with the headline over it or not', () => {
    // Soft photos (a wall, a sky): a few slow waves, each seed its own.
    const smooth = (seed: number) => {
      let n = seed
      const next = () => (n = (n * 16807) % 2147483647) / 2147483647
      const waves = Array.from({ length: 4 }, () => [
        next(),
        next(),
        next() * 6.28,
        next() * 40
      ])
      return (x: number, y: number) =>
        Math.max(
          0,
          Math.min(
            255,
            120 +
              waves.reduce(
                (a, [fx, fy, ph, am]) =>
                  a + am! * Math.sin(fx! * x * 6.28 + fy! * y * 6.28 + ph!),
                0
              )
          )
        )
    }
    const headline = (x: number, y: number) =>
      y > 0.4 && y < 0.48 && x > 0.1 && x < 0.9
    for (let seed = 1; seed <= 12; seed++) {
      const drawn = smooth(seed + 500)
      const reference = smooth(seed)
      expect(
        matchScore(paint(120, 120, drawn), paint(120, 120, reference)),
        `seed ${seed}`
      ).toBeGreaterThanOrEqual(matchTarget)
      expect(
        matchScore(
          paint(120, 120, (x, y) => (headline(x, y) ? 250 : drawn(x, y))),
          paint(120, 120, (x, y) => (headline(x, y) ? 250 : reference(x, y)))
        ),
        `seed ${seed} with its headline`
      ).toBeGreaterThanOrEqual(matchTarget)
    }
  })

  it('is low for a photo that fills a section whose reference has a flat background', () => {
    const half = paint(120, 120, (x, y) =>
      x < 0.5 && y > 0.1 && y < 0.9 ? 60 + ((x * 400) % 120) : hero(x, y)
    )
    const filled = paint(120, 120, (x, y) => 40 + ((x * 300 + y * 200) % 150))
    expect(matchScore(filled, half)).toBeLessThan(matchTarget)
    // And the other way round: a flat picture for a full-bleed photo.
    expect(matchScore(half, filled)).toBeLessThan(matchTarget)
  })

  it('is low when the content sits elsewhere, at the same brightness', () => {
    const top = paint(48, 50, (_, y) => (y < 0.45 ? 40 : 245))
    const bottom = paint(48, 50, (_, y) => (y > 0.55 ? 40 : 245))
    expect(matchScore(bottom, top)).toBeLessThan(matchTarget)
  })

  it('takes only a whole score from 1 to 10', () => {
    for (const n of [1, 6, 10]) expect(isMatchScore(n)).toBe(true)
    for (const n of [0, 11, 5.5, 0.8, Number.NaN, '7', null])
      expect(isMatchScore(n)).toBe(false)
  })

  it('keeps a picture’s light and dark areas when it is made smaller or larger', () => {
    expect(
      resample({ width: 2, height: 2, values: [0, 100, 200, 100] }, 1, 1)
    ).toEqual([100])
    expect(resample({ width: 1, height: 1, values: [80] }, 3, 2)).toEqual([
      80, 80, 80, 80, 80, 80
    ])
    // Three cells into two: each takes one and a half, weighted by area.
    const two = resample({ width: 3, height: 1, values: [0, 90, 180] }, 2, 1)
    expect(two[0]).toBeCloseTo(30)
    expect(two[1]).toBeCloseTo(150)
  })

  it('compares only grids it can read, and throws for another', () => {
    expect(gridProblem(paint(4, 4, () => 0))).toBeNull()
    expect(gridProblem(null)).toBe('no grid')
    expect(gridProblem({ width: 0, height: 2, values: [] })).toBe('bad size')
    expect(gridProblem({ width: 300, height: 1, values: [] })).toBe('bad size')
    expect(gridProblem({ width: 1.5, height: 2, values: [1, 2] })).toBe(
      'bad size'
    )
    expect(gridProblem({ width: 2, height: 2, values: [1, 2, 3] })).toBe(
      'bad values'
    )
    expect(gridProblem({ width: 1, height: 2, values: [1, 256] })).toBe(
      'bad values'
    )
    expect(gridProblem({ width: 1, height: 1, values: [Number.NaN] })).toBe(
      'bad values'
    )
    expect(() =>
      matchScore(
        { width: 2, height: 2, values: [1] },
        paint(4, 4, () => 0)
      )
    ).toThrow(/cannot be compared/)
  })

  it('is a score from 1 to 10 for any two grids', () => {
    const shapes = [hero, mirrored, () => 0, () => 255, (x: number) => x * 255]
    for (const a of shapes)
      for (const b of shapes) {
        const s = matchScore(paint(30, 20, a), paint(24, 40, b))
        expect(Number.isInteger(s)).toBe(true)
        expect(s).toBeGreaterThanOrEqual(1)
        expect(s).toBeLessThanOrEqual(10)
      }
  })
})

describe('the critic’s verdict with the match score (Copy mode)', () => {
  const passed: Verdict = {
    pass: true,
    scores: {
      hierarchy: 9,
      spacing: 9,
      contrast: 9,
      alignment: 9,
      product: 9,
      phone: 9
    },
    problems: []
  }

  it('passes at the target and keeps the score', () => {
    expect(withMatch(passed, matchTarget)).toEqual({
      ...passed,
      match: matchTarget
    })
  })

  it('fails below it, saying how to come closer in layout words only', () => {
    const out = withMatch(passed, matchTarget - 1)
    expect(out.pass).toBe(false)
    expect(out.match).toBe(matchTarget - 1)
    expect(out.problems).toEqual([
      `It looks too little like the reference section (match ${matchTarget - 1} of 10, ${matchTarget} needed): keep the reference’s layout, where the picture, the words and the empty space sit, and its light and dark areas.`
    ])
  })

  it('keeps the critic’s own problems first', () => {
    const failed: Verdict = {
      ...passed,
      pass: false,
      problems: ['Contrast scored 6 of 10.']
    }
    const out = withMatch(failed, 2)
    expect(out.pass).toBe(false)
    expect(out.problems[0]).toBe('Contrast scored 6 of 10.')
    expect(out.problems).toHaveLength(2)
    expect(withMatch(failed, 9)).toMatchObject({ pass: false, match: 9 })
  })
})
