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
  url: httpsUrl
})
export function generateFixtureCopy(input: {
  brandRevision: number
  brandName: string
  title: string
  productTitle: string | null
  url: string
}) {
  const topic = input.productTitle ?? input.title
  return copyOutputSchema.parse({
    brandRevision: input.brandRevision,
    synthetic: true,
    subject: `A closer look: ${topic}`.slice(0, 200),
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
