import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Onboarding source findings (D19, AGENT_MAP §2): what each source says
 * about the brand, one fact per row, with its evidence. The source readers
 * (ONB-101..105, lane B) write them; the Brand strategist (ONB-106, lane
 * A) reads them, takes the stricter fact when sources disagree and never
 * states a claim it cannot back. A newer run of a source replaces that
 * source's older findings.
 */

export const findingSources = [
  'site',
  'catalog',
  'klaviyo_history',
  'ads',
  'reviews',
  'social'
] as const
export type FindingSource = (typeof findingSources)[number]

/** Pages the Site reader reads. */
export const sitePageKinds = [
  'home',
  'product',
  'about',
  'shipping',
  'returns',
  'faq'
] as const
export type SitePageKind = (typeof sitePageKinds)[number]

const currency = z.string().regex(/^[A-Z]{3}$/)
/** Money in major units (24.5, not 2450), always with its currency. */
const amount = z.number().nonnegative().max(1_000_000)
const days = z.number().int().min(0).max(3_650)

/**
 * A customer's photo's address as the database keeps it
 * (`private.photo_url_ok`): https, a plain host of lower-case labels
 * (never a `\`, `%`, `@` or port a browser would read another way), then
 * only URL-safe characters (no space, quote, `<`, `>` or `\`), never an
 * `@`, `%40` or `%25` (an email address, escaped once or more), a JPEG or PNG.
 */
export const photoUrlPattern =
  /^(?!.*%(?:40|25))https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+\/[A-Za-z0-9._~!$&'()*+,;=:%/-]*\.(?:[jJ][pP][eE]?[gG]|[pP][nN][gG])(?:\?[A-Za-z0-9._~!$&'()*+,;=:%/?-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:%/?-]*)?$/

/** The value each topic holds: one fixed shape per topic. */
export const topicValues = {
  free_shipping: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('always') }),
    z.object({ kind: z.literal('never') }),
    z.object({ kind: z.literal('over'), amount, currency })
  ]),
  /** 0 days means no returns. */
  returns: z.object({ days }),
  guarantee: z.object({ days }),
  delivery_days: z
    .object({
      min: z.number().int().min(0).max(90),
      max: z.number().int().min(0).max(90),
      region: z.string().min(2).max(60).optional()
    })
    .refine((v) => v.min <= v.max, 'min after max'),
  locale: z.object({
    language: z.string().regex(/^[a-z]{2}$/),
    currency
  }),
  price_band: z
    .object({ min: amount, max: amount, currency })
    .refine((v) => v.min <= v.max, 'min after max'),
  claim: z.object({
    subject: z.enum(['brand', 'product']),
    productId: z.string().min(1).max(100).optional()
  }),
  review_platform: z.object({
    name: z.string().min(2).max(60),
    verified: z.boolean(),
    rating: z.number().min(0).max(5).optional(),
    count: z.number().int().nonnegative().optional()
  }),
  // In words only: the statement says it.
  shipping: z.object({}).strict(),
  offering: z.object({}).strict(),
  audience: z.object({}).strict(),
  tone: z.object({}).strict(),
  contact: z.object({}).strict(),
  /** What made money, in words (the Klaviyo historian, ONB-103). */
  performance: z.object({}).strict(),
  /**
   * An offer a live ad runs (the Ads analyst, ONB-104): a percentage or an
   * amount off, a gift or a bundle; free shipping is its own topic.
   */
  promotion: z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('percent_off'),
        percent: z.number().int().min(1).max(90)
      })
      .strict(),
    z
      .object({
        kind: z.literal('amount_off'),
        amount: amount.positive(),
        currency
      })
      .strict(),
    z.object({ kind: z.literal('gift') }).strict(),
    z.object({ kind: z.literal('bundle') }).strict()
  ]),
  /** Why the ads say to buy (in words). */
  angle: z.object({}).strict(),
  /** What the ads show and how (in words). */
  creative: z.object({}).strict(),
  /** What customers love, in their reviews and comments (in words). */
  review_theme: z.object({}).strict(),
  /** What customers worry about or complain of (in words). */
  objection: z.object({}).strict(),
  /** A phrase customers use, quoted as the evidence (in words). */
  customer_words: z.object({}).strict(),
  /**
   * A real review an email may quote (ONB-105): its author as shown, the
   * page it is on, its stars and day when known; its exact words are the
   * evidence's quote.
   */
  quotable_review: z
    .object({
      author: z.string().min(1).max(80),
      url: z
        .url()
        .max(500)
        .refine((u) => u.startsWith('https://'), 'https only'),
      rating: z.number().int().min(1).max(5).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    })
    .strict(),
  /** Where a live ad sends people: a page on the brand's own site. */
  landing_page: z
    .object({
      url: z
        .url()
        .max(500)
        .refine((u) => u.startsWith('https://'), 'https only')
    })
    .strict(),
  /**
   * A photo a customer posted with their review on the store's own product
   * page (REL-ONB2 part e): the photo's address (a JPEG or PNG), the page
   * and, when the page names it, the product; never the reviewer's name or
   * words. Its evidence cites the page's review data (`ref`).
   */
  customer_photo: z
    .object({
      url: z.url().max(500).regex(photoUrlPattern),
      page: z
        .url()
        .max(500)
        .refine((u) => u.startsWith('https://'), 'https only'),
      product: z.string().max(120).regex(/\S/).optional()
    })
    .strict()
    // As the database keeps it: a value of at most 1,000 characters.
    .refine((v) => JSON.stringify(v).length <= 900, 'too long'),
  /**
   * The founder's own words on the About page (REL-ONB2 part d): their
   * name and role as the page writes them; the note is the evidence's
   * quote, whole sentences of the page in its own letters (`whole`).
   */
  founder: z
    .object({
      name: z.string().max(60).regex(/\S/),
      role: z.string().max(60).regex(/\S/).optional()
    })
    .strict()
} as const
export type FindingTopic = keyof typeof topicValues
export const findingTopics = Object.keys(topicValues) as FindingTopic[]

/** The topics each source may state. */
export const sourceTopics: Record<FindingSource, readonly FindingTopic[]> = {
  site: [
    'free_shipping',
    'returns',
    'guarantee',
    'delivery_days',
    'shipping',
    'locale',
    'price_band',
    'offering',
    'audience',
    'tone',
    'claim',
    'contact',
    'founder'
  ],
  catalog: ['locale', 'price_band', 'offering', 'claim'],
  klaviyo_history: ['offering', 'audience', 'tone', 'claim', 'performance'],
  ads: [
    'offering',
    'audience',
    'tone',
    'claim',
    'free_shipping',
    'promotion',
    'angle',
    'creative',
    'landing_page'
  ],
  reviews: [
    'review_platform',
    'claim',
    'audience',
    'review_theme',
    'objection',
    'customer_words',
    'quotable_review',
    'customer_photo'
  ],
  social: [
    'audience',
    'tone',
    'claim',
    'offering',
    'review_theme',
    'objection',
    'customer_words'
  ]
}

export const evidenceSchema = z.union([
  z.object({
    url: z
      .url()
      .max(500)
      .refine((u) => u.startsWith('https://'), 'https only'),
    /** Words exactly as the page shows them. */
    quote: z.string().min(1).max(300),
    page: z.enum(sitePageKinds).optional(),
    /**
     * The quote is whole sentences of the page, in the page's own letters
     * (REL-ONB2 part d): marked by the Site reader on a founder's note only.
     */
    whole: z.literal(true).optional()
  }),
  z.object({ ref: z.string().min(1).max(200) })
])

/** One finding as a reader hands it over (before it is stored). */
export const findingInput = z
  .object({
    topic: z.enum(findingTopics as [FindingTopic, ...FindingTopic[]]),
    statement: z.string().min(2).max(300),
    value: z.record(z.string(), z.unknown()),
    evidence: evidenceSchema,
    confidence: z.number().min(0).max(1)
  })
  .superRefine((f, ctx) => {
    const value = topicValues[f.topic].safeParse(f.value)
    if (!value.success)
      ctx.addIssue({ code: 'custom', message: `value for ${f.topic}` })
    // A founder's note is whole sentences of the About page, and only it
    // is marked so (`record_site_findings` holds the same rule).
    const whole = 'quote' in f.evidence && f.evidence.whole === true
    const about = 'quote' in f.evidence && f.evidence.page === 'about'
    if ((f.topic === 'founder') !== whole || (whole && !about))
      ctx.addIssue({ code: 'custom', message: 'whole sentences' })
    // A customer's photo cites the page's review data, never words.
    if (f.topic === 'customer_photo' && !('ref' in f.evidence))
      ctx.addIssue({ code: 'custom', message: 'review data' })
  })
export type FindingInput = z.infer<typeof findingInput>

/** A stored finding, as the Brand strategist reads it. */
export type Finding = FindingInput & {
  id: string
  runId: string
  source: FindingSource
  /**
   * How it was found: the sample rules on sample data, a model on real
   * data, or code counting real data (a catalog's price band).
   */
  pass: 'sample' | 'model' | 'code'
  model: string | null
  createdAt: string
}

/**
 * The current findings of a workspace (not replaced by a newer run of the
 * same source), newest run first. RLS lets any active member read them.
 */
export async function listFindings(
  db: SupabaseClient<Database>,
  tenantId: string,
  filter: {
    source?: FindingSource
    topic?: FindingTopic
    minConfidence?: number
  } = {}
): Promise<Finding[]> {
  let query = db
    .from('brand_findings')
    .select(
      'id,run_id,source,topic,statement,value,evidence,confidence,pass,model,created_at'
    )
    .eq('tenant_id', tenantId)
    .is('superseded_at', null)
    .order('created_at', { ascending: false })
    // A run's findings share one time: their id makes the order total, so
    // two reads of the same findings give the same list (REL-STO).
    .order('id', { ascending: true })
    .limit(500)
  if (filter.source) query = query.eq('source', filter.source)
  if (filter.topic) query = query.eq('topic', filter.topic)
  if (filter.minConfidence !== undefined)
    query = query.gte('confidence', filter.minConfidence)
  const { data, error } = await query
  if (error) throw error
  const findings: Finding[] = []
  for (const row of data ?? []) {
    const parsed = findingInput.safeParse({
      topic: row.topic,
      statement: row.statement,
      value: row.value,
      evidence: row.evidence,
      confidence: Number(row.confidence)
    })
    // A row that no longer reads as a finding is skipped, not handed on.
    if (!parsed.success) continue
    findings.push({
      ...parsed.data,
      id: row.id,
      runId: row.run_id,
      source: row.source as FindingSource,
      pass: row.pass as Finding['pass'],
      model: row.model,
      createdAt: row.created_at
    })
  }
  return findings
}
