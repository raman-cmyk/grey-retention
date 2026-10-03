import { z } from 'zod'
export const optimizerPayloadSchema = z
  .object({
    sweepId: z.uuid(),
    stage: z.number().int().min(1).max(3),
    observedAt: z.iso.datetime({ offset: true }),
    source: z.literal('fixture'),
    synthetic: z.literal(true),
    originalMessage: z.string().nullable(),
    items: z.array(
      z.object({
        profileId: z.uuid(),
        revision: z.number().int().positive(),
        outcome: z.enum([
          'winback_1',
          'winback_2',
          'recovered',
          'suppressed',
          'skipped'
        ]),
        reason: z.string().min(1)
      })
    )
  })
  .refine(
    (x) =>
      new Set(x.items.map((i) => i.profileId)).size === x.items.length &&
      x.items.every(
        (i) =>
          i.outcome === 'skipped' ||
          (x.stage === 1
            ? i.outcome === 'winback_1'
            : x.stage === 2
              ? ['winback_2', 'recovered'].includes(i.outcome)
              : i.outcome === 'suppressed')
      ),
    'Duplicate profiles or invalid stage outcome'
  )
export interface ProfileOptimizationProvider {
  evaluate(
    job: string,
    lease: string
  ): Promise<z.infer<typeof optimizerPayloadSchema>>
}
