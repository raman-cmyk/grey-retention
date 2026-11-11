import { z } from 'zod'
import { emailTypes } from './plan'

/**
 * The shapes a run saves (`strategy_runs.pulse` and `.plan`), checked again
 * whenever they are read back: by the screen and by the job. A row of an
 * older or broken shape is shown as "could not be shown", never trusted.
 */
const isoDate = z.iso.date()
const words = z.string().max(600)
const kinds = z.enum([
  'offer',
  'launch',
  'bestseller',
  'stock',
  'result',
  'date'
])

export const storedOffer = z.object({
  id: z.string().min(1).max(120),
  code: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/),
  percent: z.number().int().min(1).max(100),
  until: isoDate.nullable()
})

export const storedPulse = z.object({
  start: isoDate,
  end: isoDate,
  offers: z.array(storedOffer).max(50),
  leftOut: z.array(z.object({ code: z.string().max(40), why: words })).max(50),
  highlights: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        kind: kinds,
        fact: words,
        why: words
      })
    )
    .max(20),
  summary: words,
  source: z.enum(['agent', 'code']),
  /** True while the store data is the sample store (no reader yet). */
  sample: z.boolean().optional()
})

export const storedPlan = z.object({
  start: isoDate,
  end: isoDate,
  dropped: z.number().int().min(0),
  brief: z.array(z.unknown()).max(20),
  notes: z.array(words).max(10),
  source: z.object({
    brief: z.enum(['agent', 'code']),
    planner: z.enum(['agent', 'code']),
    critic: z.enum(['agent', 'skipped'])
  }),
  slots: z
    .array(
      z.object({
        date: isoDate,
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        emailType: z.enum(emailTypes),
        angle: words,
        products: z
          .array(
            z.object({ id: z.string().max(120), title: z.string().max(200) })
          )
          .max(3),
        offer: z
          .object({
            id: z.string().max(120),
            code: z.string().max(40),
            percent: z.number().int().min(1).max(100)
          })
          .nullable(),
        audience: z.object({
          id: z.string().max(120),
          label: z.string().max(200)
        }),
        why: words,
        evidence: z
          .array(z.object({ id: z.string().max(160), fact: words }))
          .max(6)
      })
    )
    .max(10),
  sample: z.boolean().optional()
})

export type StoredPulse = z.infer<typeof storedPulse>
export type StoredPlan = z.infer<typeof storedPlan>
