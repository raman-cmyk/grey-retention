import { describe, expect, it } from 'vitest'
import { gate, scoreLabels, type LabelPair } from './label-score'

const pairs = (agreed: number, missed: number): LabelPair[] => [
  ...Array.from({ length: agreed }, (_, i) => ({
    id: `a${i}`,
    expected: 'hero_image' as const,
    predicted: 'hero_image' as const
  })),
  ...Array.from({ length: missed }, (_, i) => ({
    id: `m${i}`,
    expected: 'faq' as const,
    predicted: i % 2 ? ('unsure' as const) : ('text' as const)
  }))
]

describe('the Step 1 gate', () => {
  it('passes at 85% agreement on 50 sections', () => {
    const score = scoreLabels(pairs(43, 7))
    expect(score).toMatchObject({
      total: 50,
      agreed: 43,
      passed: true,
      reason: null
    })
    expect(score.agreement).toBeCloseTo(0.86)
  })

  it('fails below 85%, and says by how much', () => {
    const score = scoreLabels(pairs(42, 8))
    expect(score.passed).toBe(false)
    expect(score.reason).toBe('The model agrees on 84%; the gate needs 85%.')
  })

  it('needs at least 50 hand-labelled sections', () => {
    const score = scoreLabels(pairs(20, 0))
    expect(score).toMatchObject({ agreement: 1, passed: false })
    expect(score.reason).toBe(
      `Label at least ${gate.minimumSections} sections by hand; 20 so far.`
    )
    expect(scoreLabels([])).toMatchObject({ agreement: 0, passed: false })
  })

  it('counts "unsure" as a miss and lists what was confused with what', () => {
    const score = scoreLabels(pairs(1, 4))
    expect(score.misses).toHaveLength(4)
    expect(score.confusion).toEqual({ faq: { text: 2, unsure: 2 } })
  })
})
