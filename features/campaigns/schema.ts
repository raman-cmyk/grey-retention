import { z } from 'zod'
export const campaignInputSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    goal: z.string().trim().max(5000),
    channel: z.enum(['email_design', 'email_text']),
    planned_at: z.iso.datetime(),
    audience_id: z.uuid().or(z.literal('')),
    product_id: z.uuid().or(z.literal('')),
    offer_id: z.uuid().or(z.literal('')),
    reference_notes: z.string().max(5000)
  })
  .strict()
export type CampaignInput = z.infer<typeof campaignInputSchema>
export const revisionSchema = z.coerce.number().int().nonnegative()
