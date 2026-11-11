import { z } from 'zod'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'

/**
 * The fixed label lists of competitor intelligence (CI-001, AGENT_MAP §1,
 * D18). Every competitor email gets one value per email label, and every
 * section one family, layout and purpose and up to three styles. An answer
 * outside these lists is never stored. The database checks the same lists
 * (a test compares them with the migration).
 */

export const industries = [
  'apparel',
  'accessories',
  'jewelry',
  'skincare',
  'beauty',
  'beauty_tools',
  'haircare',
  'supplements',
  'wellness',
  'fitness',
  'food_drink',
  'kitchen',
  'home',
  'pet',
  'baby',
  'outdoor',
  'electronics',
  'other'
] as const

export const emailTypes = [
  'launch',
  'new_arrivals',
  'bestsellers',
  'restock',
  'sale',
  'holiday',
  'collection',
  'education',
  'story',
  'social_proof',
  'bundle',
  'gift_guide',
  'announcement',
  'newsletter',
  'other'
] as const

export const offerTypes = [
  'none',
  'percent_off',
  'amount_off',
  'free_shipping',
  'bogo',
  'gift_with_purchase',
  'bundle_price',
  'tiered',
  'early_access',
  'loyalty',
  'other'
] as const

export const seasons = [
  'none',
  'new_year',
  'valentines',
  'spring',
  'easter',
  'mothers_day',
  'summer',
  'fathers_day',
  'back_to_school',
  'autumn',
  'halloween',
  'black_friday',
  'cyber_monday',
  'holiday',
  'winter'
] as const

export const angles = [
  'product_benefit',
  'problem_solution',
  'newness',
  'scarcity',
  'urgency',
  'value',
  'social_proof',
  'founder_story',
  'education',
  'lifestyle',
  'exclusivity',
  'gifting',
  'community',
  'sustainability',
  'other'
] as const

/** One email rarely shows a brand's size: `unknown` is an honest answer. */
export const brandSizes = ['small', 'mid', 'large', 'unknown'] as const

/** The 20 seed block types are the 20 families (D18). */
export const families = blockTypes

export const layouts = [
  'single_column',
  'two_column',
  'three_column',
  'grid',
  'image_left',
  'image_right',
  'full_width_image',
  'text_over_image',
  'cards',
  'list',
  'strip',
  'other'
] as const

export const purposes = [
  'brand_header',
  'navigation',
  'announcement',
  'hook',
  'product_showcase',
  'offer',
  'social_proof',
  'education',
  'story',
  'urgency',
  'call_to_action',
  'closing',
  'legal'
] as const

export const styles = [
  'minimal',
  'bold',
  'playful',
  'luxury',
  'editorial',
  'photo_led',
  'text_led',
  'illustrated',
  'dark',
  'colourful'
] as const

export type Industry = (typeof industries)[number]
export type EmailType = (typeof emailTypes)[number]
export type OfferType = (typeof offerTypes)[number]
export type Season = (typeof seasons)[number]
export type Angle = (typeof angles)[number]
export type BrandSize = (typeof brandSizes)[number]
export type Family = BlockType
export type Layout = (typeof layouts)[number]
export type Purpose = (typeof purposes)[number]
export type Style = (typeof styles)[number]

/** Every list the database checks, by its column name. */
export const labelLists = {
  industry: industries,
  email_type: emailTypes,
  offer_type: offerTypes,
  season: seasons,
  angle: angles,
  brand_size: brandSizes,
  layout: layouts,
  purpose: purposes,
  styles
} as const

/** At most this many styles per section. */
export const maxStyles = 3

/** Below this, a pass's answer is not trusted (BLK-003's threshold). */
export const confidentFrom = 0.6

/**
 * Bumped when the lists, the prompts or the rules change. Stored with each
 * section: a section tagged at another version is asked again.
 */
export const tagVersion = 'tags-v1'

/** Links in a competitor's visible text are never sent to a model. */
export function withoutLinks(text: string) {
  return text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link]')
}

const confidence = z.number().min(0).max(1)

/** What a model must answer for an email (strict: nothing else is kept). */
export const emailLabelsSchema = z.object({
  industry: z.enum(industries),
  emailType: z.enum(emailTypes),
  offerType: z.enum(offerTypes),
  season: z.enum(seasons),
  angle: z.enum(angles),
  brandSize: z.enum(brandSizes),
  confidence
})
export type EmailLabels = z.infer<typeof emailLabelsSchema>

/** What a model must answer for a section. */
export const sectionTagsSchema = z.object({
  family: z.enum(blockTypes as [BlockType, ...BlockType[]]),
  layout: z.enum(layouts),
  purpose: z.enum(purposes),
  // Repeats are dropped before the limit is checked.
  styles: z
    .array(z.enum(styles))
    .transform((s) => [...new Set(s)])
    .pipe(z.array(z.enum(styles)).max(maxStyles)),
  confidence
})
export type SectionTags = z.infer<typeof sectionTagsSchema>

/**
 * Which pass answered: the honest sample rules (the AI port's fake), the
 * fast model, or the larger model after a low-confidence answer.
 */
export type TagPass = 'sample' | 'fast' | 'strong'

/** A stored outcome: labels, or `untagged` (left out of search, D16). */
export type Tagged<T> =
  | {
      state: 'tagged'
      labels: T
      pass: TagPass
      /** The model that answered; null for the sample rules. */
      model: string | null
    }
  | {
      state: 'untagged'
      pass: TagPass
      model: string | null
      /** Why: still unsure on the larger model, refused, or too large. */
      reason: 'unsure' | 'refused' | 'too_large'
    }

/** A JSON Schema for the model's structured answer (strict). */
export function jsonSchemaOf(
  fields: Record<string, readonly string[] | 'confidence' | 'styles'>
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [name, kind] of Object.entries(fields))
    properties[name] =
      kind === 'confidence'
        ? { type: 'number', minimum: 0, maximum: 1 }
        : kind === 'styles'
          ? {
              type: 'array',
              items: { type: 'string', enum: [...styles] },
              maxItems: maxStyles
            }
          : { type: 'string', enum: [...kind] }
  return {
    type: 'object',
    properties,
    required: Object.keys(fields),
    additionalProperties: false
  }
}
