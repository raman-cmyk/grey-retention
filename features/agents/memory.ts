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
  createdAt: z.iso.datetime({ offset: true })
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
 * Picks the rules an agent should read: active, not expired, meant for this
 * agent, confident enough. The brand's own rules come first, then its
 * industry's, then global ones; within each, higher confidence first.
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
        r.status === 'active' &&
        r.confidence >= minConfidence &&
        (r.expiresAt === null || Date.parse(r.expiresAt) > now) &&
        (r.appliesTo.length === 0 || r.appliesTo.includes(input.agent)) &&
        (r.tenantId === null || r.tenantId === input.tenantId) &&
        (r.tenantId !== null ||
          r.industry === null ||
          r.industry === input.industry)
    )
    .sort(
      (a, b) =>
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
  return `Brand book (version ${book.version}). These are the brand's confirmed facts; never contradict them:\n${text}`
}

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
