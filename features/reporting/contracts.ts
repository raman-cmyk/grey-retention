import { z } from 'zod'
export const resultSchema = z
  .object({
    deliveryId: z.uuid(),
    window: z.enum(['48h', '7d']),
    source: z.literal('fixture'),
    windowStart: z.iso.datetime({ offset: true }),
    windowEnd: z.iso.datetime({ offset: true }),
    collectedAt: z.iso.datetime({ offset: true }),
    complete: z.boolean(),
    comparable: z.boolean(),
    recipients: z.number().int().nonnegative(),
    clicks: z.number().int().nonnegative(),
    revenueMinor: z.number().int().nonnegative(),
    currency: z.literal('USD'),
    unsubscribes: z.number().int().nonnegative(),
    spam: z.number().int().nonnegative(),
    confounders: z.array(z.string()).min(1)
  })
  .refine(
    (x) =>
      x.clicks <= x.recipients &&
      x.unsubscribes <= x.recipients &&
      x.spam <= x.recipients &&
      Date.parse(x.windowEnd) > Date.parse(x.windowStart) &&
      Date.parse(x.collectedAt) >= Date.parse(x.windowEnd),
    'Invalid counters or immature metric window'
  )
