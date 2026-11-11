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
  contact: z.object({}).strict()
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
    'contact'
  ],
  catalog: ['locale', 'price_band', 'offering', 'claim'],
  klaviyo_history: ['offering', 'audience', 'tone', 'claim'],
  ads: ['offering', 'audience', 'tone', 'claim', 'free_shipping'],
  reviews: ['review_platform', 'claim', 'audience'],
  social: ['audience', 'tone', 'claim', 'offering']
}

export const evidenceSchema = z.union([
  z.object({
    url: z
      .url()
      .max(500)
      .refine((u) => u.startsWith('https://'), 'https only'),
    /** Words exactly as the page shows them. */
    quote: z.string().min(1).max(300),
    page: z.enum(sitePageKinds).optional()
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
