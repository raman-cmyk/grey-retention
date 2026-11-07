import type { BlockType } from './catalog'

/**
 * The Step 1 gate (VISION.md): on at least 50 sections the owner labelled
 * by hand, the model must pick the same block type at least 85% of the
 * time. "unsure" counts as a miss.
 */
export const gate = { minimumSections: 50, agreement: 0.85 } as const

export type LabelPair = {
  id: string
  expected: BlockType
  predicted: BlockType | 'unsure'
}

export type LabelScore = {
  total: number
  agreed: number
  /** 0 to 1; 0 when nothing is labelled yet. */
  agreement: number
  passed: boolean
  /** Why the gate is not passed yet, in plain words. */
  reason: string | null
  misses: LabelPair[]
  /** expected type → predicted type → count, misses only. */
  confusion: Partial<Record<BlockType, Partial<Record<string, number>>>>
}

export function scoreLabels(pairs: readonly LabelPair[]): LabelScore {
  const misses = pairs.filter((p) => p.expected !== p.predicted)
  const agreed = pairs.length - misses.length
  const agreement = pairs.length ? agreed / pairs.length : 0
  const confusion: LabelScore['confusion'] = {}
  for (const m of misses) {
    const row = (confusion[m.expected] ??= {})
    row[m.predicted] = (row[m.predicted] ?? 0) + 1
  }
  const enough = pairs.length >= gate.minimumSections
  const good = agreement >= gate.agreement
  return {
    total: pairs.length,
    agreed,
    agreement,
    passed: enough && good,
    reason: !enough
      ? `Label at least ${gate.minimumSections} sections by hand; ${pairs.length} so far.`
      : !good
        ? `The model agrees on ${Math.round(agreement * 100)}%; the gate needs ${gate.agreement * 100}%.`
        : null,
    misses,
    confusion
  }
}
