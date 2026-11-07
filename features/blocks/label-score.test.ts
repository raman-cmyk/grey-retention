import { describe, expect, it } from 'vitest'
import { gate, scoreLabels, type LabelPair } from './label-score'

const pairs = (
  agreed: number,
  missed: number,
  source: LabelPair['source'] = 'gemini'
): LabelPair[] => [
  ...Array.from({ length: agreed }, (_, i) => ({
    id: `a${i}`,
    expected: 'hero_image' as const,
    predicted: 'hero_image' as const,
    source
  })),
  ...Array.from({ length: missed }, (_, i) => ({
    id: `m${i}`,
    expected: 'faq' as const,
    predicted: i % 2 ? ('unsure' as const) : ('text' as const),
    source
  }))
]

describe('the Step 1 gate', () => {
  it('passes at exactly 85% agreement', () => {
    const score = scoreLabels(pairs(51, 9))
    expect(score).toMatchObject({
      total: 60,
      agreed: 51,
      agreement: 0.85,
      passed: true,
      reason: null
    })
  })

  it('fails below 85%, and never rounds a near miss up', () => {
    const score = scoreLabels(pairs(55, 10))
    expect(score.passed).toBe(false)
    expect(score.reason).toBe('The model agrees on 84.6%; the gate needs 85%.')
  })

  it('needs at least 50 different hand-labelled sections', () => {
    const score = scoreLabels(pairs(20, 0))
    expect(score).toMatchObject({ agreement: 1, passed: false })
    expect(score.reason).toBe(
      `Label at least ${gate.minimumSections} different sections by hand; 20 so far.`
    )
    expect(scoreLabels([])).toMatchObject({ agreement: 0, passed: false })
    const twice = [...pairs(25, 0), ...pairs(25, 0)]
    expect(scoreLabels(twice)).toMatchObject({ total: 25, passed: false })
  })

  it('never passes on labels from the sample rules', () => {
    const score = scoreLabels([...pairs(50, 0, 'sample')])
    expect(score.passed).toBe(false)
    expect(score.reason).toMatch(
      /50 of these labels came from the sample rules/
    )
  })

  it('counts "unsure" as a miss and lists what was confused with what', () => {
    const score = scoreLabels(pairs(1, 4))
    expect(score.misses).toHaveLength(4)
    expect(score.confusion).toEqual({ faq: { text: 2, unsure: 2 } })
  })

  it('refuses labels that are not block types, without touching shared objects', () => {
    const bad = {
      id: 'x',
      expected: '__proto__',
      predicted: 'text',
      source: 'gemini'
    } as unknown as LabelPair
    expect(() => scoreLabels([bad])).toThrow(/valid hand label/)
    expect(() =>
      scoreLabels([
        { ...pairs(1, 0)[0], predicted: 'countdown' } as unknown as LabelPair
      ])
    ).toThrow(/valid model label/)
    expect(({} as Record<string, unknown>).text).toBeUndefined()
  })
})
