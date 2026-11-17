import { z } from 'zod'

/**
 * Shared memory every agent reads (AGENT_MAP.md §0, decision D22): written
 * do's and don'ts, learned from results, inspector rejections and owner
 * edits, per brand and per industry; and the Brand book (D19).
 */

export const ruleSourceSchema = z.enum([
  'results',
  'inspector',
  'owner_edit',
  'seed'
])

export const memoryRuleSchema = z.object({
  id: z.string().min(1),
  /** The client workspace, or null for an industry-wide or global rule. */
  tenantId: z.uuid().nullable(),
  /** e.g. "skincare". Null with a null tenant means it applies everywhere. */
  industry: z.string().trim().min(1).max(60).nullable(),
  kind: z.enum(['do', 'dont']),
  rule: z.string().trim().min(5).max(500),
  why: z.string().trim().max(1000),
  /** Agent names the rule is for; empty means every agent. */
  appliesTo: z.array(z.string().min(1).max(60)).max(30),
  confidence: z.number().min(0).max(1),
  source: ruleSourceSchema,
  /** How many sends, rejections or edits back the rule (D22: 3+ for results). */
  evidenceCount: z.number().int().min(0),
  status: z.enum(['active', 'expired', 'retired']),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** The owner pinned it (UI-LRNa): read first, never dropped for confidence or age. */
  pinned: z.boolean().optional()
})
export type MemoryRule = z.infer<typeof memoryRuleSchema>

export type BrandBook = { version: number; content: Record<string, unknown> }

export interface MemoryStore {
  /** Active rules for this tenant, its industry and global rules. */
  rulesFor(input: {
    tenantId: string | null
    industry: string | null
    agent: string
    now: string
  }): Promise<MemoryRule[]>
  brandBook(tenantId: string): Promise<BrandBook | null>
}

/** At most this many rules go into one prompt, best first. */
export const maxRulesInPrompt = 20
/** Rules below this confidence are kept but not shown to agents. */
export const minConfidence = 0.5

/**
 * Agents use an active rule when the owner pinned it, or when it is
 * confident enough and not past its end.
 */
export function inUse(
  rule: Pick<MemoryRule, 'status' | 'pinned' | 'confidence' | 'expiresAt'>,
  now: number
) {
  return (
    rule.status === 'active' &&
    (rule.pinned === true ||
      (rule.confidence >= minConfidence &&
        (rule.expiresAt === null || Date.parse(rule.expiresAt) > now)))
  )
}

/** The same test as a PostgREST `or` filter, for reads of active rules. */
export const inUseFilter = (now: Date) =>
  `pinned.is.true,and(confidence.gte.${minConfidence},or(expires_at.is.null,expires_at.gt.${now.toISOString()}))`

/**
 * Picks the rules an agent should read: in use (above), meant for this
 * agent. Pinned rules come first (at most 20 per workspace, so all fit), then
 * the brand's own rules, then its industry's, then global ones; within
 * each, higher confidence first.
 */
export function selectRules(
  rules: readonly MemoryRule[],
  input: {
    tenantId: string | null
    industry: string | null
    agent: string
    now: string
  }
) {
  const now = Date.parse(input.now)
  const scope = (r: MemoryRule) =>
    r.tenantId !== null ? 0 : r.industry !== null ? 1 : 2
  return rules
    .filter(
      (r) =>
        inUse(r, now) &&
        (r.appliesTo.length === 0 || r.appliesTo.includes(input.agent)) &&
        (r.tenantId === null || r.tenantId === input.tenantId) &&
        (r.tenantId !== null ||
          r.industry === null ||
          r.industry === input.industry)
    )
    .sort(
      (a, b) =>
        Number(b.pinned === true) - Number(a.pinned === true) ||
        scope(a) - scope(b) ||
        b.confidence - a.confidence ||
        b.evidenceCount - a.evidenceCount
    )
    .slice(0, maxRulesInPrompt)
}

/** The "lessons learned" block every agent's instructions end with. */
export function lessonsBlock(rules: readonly MemoryRule[]) {
  if (!rules.length) return ''
  const line = (r: MemoryRule) =>
    `- ${r.kind === 'do' ? 'DO' : "DON'T"}: ${r.rule}${r.why ? ` (why: ${r.why})` : ''}`
  return [
    'Lessons learned from past emails. Follow them unless they break a hard rule:',
    ...rules.map(line)
  ].join('\n')
}

/** Largest Brand book excerpt put into one prompt. */
export const maxBrandBookChars = 8_000

export function brandBookBlock(book: BrandBook | null) {
  if (!book) return ''
  let text = JSON.stringify(book.content)
  if (text.length > maxBrandBookChars)
    text = `${text.slice(0, maxBrandBookChars)}…(truncated)`
  return `${brandBookHeader(book.version)}\n${text}`
}

/**
 * How an agent reads the Brand book (ONB-106b, agreed with lane A): only
 * `facts` and `owner` are confirmed; what the readers observed and what is
 * unclear are never stated as facts.
 */
export const brandBookHeader = (version: number) =>
  [
    `Brand book (version ${version}).`,
    '"facts" and "owner" are confirmed: never contradict them.',
    '"observed" is what was seen on the brand\'s own pages, emails and reviews: use it for tone and ideas, never state it as a fact.',
    '"unclear" lists what is not known: never make a claim about it.',
    '"avoid" lists words and claims the brand never uses.'
  ].join(' ')

/** Test and local double. */
export class InMemoryMemoryStore implements MemoryStore {
  constructor(
    readonly rules: MemoryRule[] = [],
    readonly books = new Map<string, BrandBook>()
  ) {}
  async rulesFor(input: Parameters<MemoryStore['rulesFor']>[0]) {
    return selectRules(this.rules, input)
  }
  async brandBook(tenantId: string) {
    return this.books.get(tenantId) ?? null
  }
}
