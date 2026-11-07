import { isBlockType, type BlockType } from './catalog'

/**
 * The Step 1 gate (VISION.md): on at least 50 different sections the owner
 * labelled by hand, the live model must pick the same block type at least
 * 85% of the time. "unsure" counts as a miss. Labels made by the sample
 * rules never count towards the gate.
 */
export const gate = { minimumSections: 50, agreement: 0.85 } as const

export type LabelPair = {
  /** The section's id; each section counts once. */
  id: string
  /** The owner's hand label. */
  expected: BlockType
  predicted: BlockType | 'unsure'
  /** Who made `predicted`: the live model or the sample rules. */
  source: 'gemini' | 'sample'
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
  confusion: Partial<
    Record<BlockType, Partial<Record<BlockType | 'unsure', number>>>
  >
}

/** One decimal, rounded down, so a near miss never reads as a pass. */
const percent = (share: number) => `${Math.floor(share * 1000) / 10}%`

export function scoreLabels(input: readonly LabelPair[]): LabelScore {
  const seen = new Set<string>()
  const pairs: LabelPair[] = []
  for (const pair of input) {
    if (!isBlockType(pair.expected))
      throw new Error(`Section ${pair.id} has no valid hand label.`)
    if (pair.predicted !== 'unsure' && !isBlockType(pair.predicted))
      throw new Error(`Section ${pair.id} has no valid model label.`)
    if (seen.has(pair.id)) continue
    seen.add(pair.id)
    pairs.push(pair)
  }
  const misses = pairs.filter((p) => p.expected !== p.predicted)
  const agreed = pairs.length - misses.length
  const agreement = pairs.length ? agreed / pairs.length : 0
  const confusion = new Map<BlockType, Map<BlockType | 'unsure', number>>()
  for (const m of misses) {
    const row = confusion.get(m.expected) ?? new Map()
    row.set(m.predicted, (row.get(m.predicted) ?? 0) + 1)
    confusion.set(m.expected, row)
  }
  const fromRules = pairs.filter((p) => p.source !== 'gemini').length
  const enough = pairs.length >= gate.minimumSections
  const good = agreement >= gate.agreement
  return {
    total: pairs.length,
    agreed,
    agreement,
    passed: enough && good && fromRules === 0,
    reason: !enough
      ? `Label at least ${gate.minimumSections} different sections by hand; ${pairs.length} so far.`
      : fromRules
        ? `${fromRules} of these labels came from the sample rules, not the model. Run the model on them first.`
        : !good
          ? `The model agrees on ${percent(agreement)}; the gate needs ${gate.agreement * 100}%.`
          : null,
    misses,
    confusion: Object.fromEntries(
      [...confusion].map(([k, row]) => [k, Object.fromEntries(row)])
    )
  }
}
