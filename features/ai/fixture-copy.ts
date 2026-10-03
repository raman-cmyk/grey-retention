import { z } from 'zod'
import { httpsUrl } from '@/features/workflow/domain/contracts'
export const copyOutputSchema = z.object({
  brandRevision: z.number().int().positive(),
  synthetic: z.literal(true),
  subject: z.string().min(1).max(200),
  subjects: z.array(z.string().min(1).max(200)).length(3),
  preheader: z.string().max(300),
  body: z.string().min(1).max(20000),
  cta: z.string().min(1).max(200),
  url: httpsUrl,
  learningPreference: z
    .object({
      ruleId: z.uuid(),
      preferredGroup: z.enum(['short', 'detailed']),
      evidenceHash: z.string().length(64)
    })
    .optional()
})
export function generateFixtureCopy(input: {
  brandRevision: number
  brandName: string
  title: string
  productTitle: string | null
  url: string
  learningPreference?: {
    ruleId: string
    preferredGroup: 'short' | 'detailed'
    evidenceHash: string
  }
}) {
  const topic = input.productTitle ?? input.title
  return copyOutputSchema.parse({
    brandRevision: input.brandRevision,
    synthetic: true,
    subject:
      input.learningPreference?.preferredGroup === 'short'
        ? 'A considered note'
        : input.learningPreference?.preferredGroup === 'detailed'
          ? `A closer look at the details: ${topic}, considered at your own pace`.slice(
              0,
              200
            )
          : `A closer look: ${topic}`.slice(0, 200),
    ...(input.learningPreference
      ? { learningPreference: input.learningPreference }
      : {}),
    subjects: [
      `A closer look: ${topic}`.slice(0, 200),
      `A note from ${input.brandName}`.slice(0, 200),
      `${topic}, considered`.slice(0, 200)
    ],
    preheader: 'Explore the details at your own pace.',
    body: `A note from ${input.brandName}.\n\nTake a closer look at ${topic}. Explore the collection and choose what works for you.\n\nThis is original synthetic copy for local review. No discount, performance claim or deadline is implied.`,
    cta: 'Explore the collection',
    url: input.url
  })
}
