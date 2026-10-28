import { z } from 'zod'
export const microSchema = z.object({
  offerCode: z.string().max(80).nullable(),
  product: z.string().max(100).nullable(),
  theme: z.string().max(100),
  strips: z.array(z.string().max(100)).max(10),
  discountPercent: z.number().min(0).max(100),
  sequenceHint: z.string().max(80).nullable(),
  synthetic: z.literal(true)
})
export type Micro = z.infer<typeof microSchema>
export type SequenceEvidence = { id: string; receivedAt: string; micro: Micro }
export function detectSequences(records: SequenceEvidence[]) {
  const sorted = [...records].sort(
      (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)
    ),
    groups: {
      key: string
      evidenceIds: string[]
      confidence: 'candidate' | 'supported'
      pattern: string
    }[] = []
  for (const r of sorted) {
    const key = r.micro.sequenceHint
    if (!key) continue
    const prior = groups.findLast((g) => g.key.startsWith(`${key}:`))
    const last = prior
      ? sorted.find((e) => e.id === prior.evidenceIds.at(-1))
      : null
    // An explicit fixture hint alone does not bridge a long gap, conflicting offers or reverse time.
    if (
      prior &&
      last &&
      Date.parse(r.receivedAt) - Date.parse(last.receivedAt) <= 3 * 86400000 &&
      r.micro.offerCode === last.micro.offerCode
    ) {
      prior.evidenceIds.push(r.id)
      prior.confidence = 'supported'
    } else
      groups.push({
        key: `${key}:${r.id}`,
        evidenceIds: [r.id],
        confidence: 'candidate',
        pattern:
          'Opening → explanation → reminder; structural fixture hypothesis'
      })
  }
  return groups
}
export function intelligenceProfile(records: SequenceEvidence[]) {
  const sorted = [...records].sort(
      (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)
    ),
    days =
      sorted.length > 1
        ? Math.max(
            1,
            (Date.parse(sorted.at(-1)!.receivedAt) -
              Date.parse(sorted[0]!.receivedAt)) /
              86400000
          )
        : 0
  return {
    emails: sorted.length,
    spanDays: days,
    emailsPerWeek: days
      ? Math.round((sorted.length / days) * 7 * 10) / 10
      : null,
    discountShare: sorted.length
      ? Math.round(
          (sorted.filter((r) => r.micro.discountPercent > 0).length /
            sorted.length) *
            100
        )
      : null,
    themes: [...new Set(sorted.map((r) => r.micro.theme))],
    complete: sorted.length >= 10
  }
}
export function escapedPreviewText(html: string) {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000) || 'No readable body in this synthetic record.'
  )
}
