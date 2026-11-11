import { z } from 'zod'
import type { QaFailure, QaResult, QaRule } from '@/features/copy-qa/check'
import type { AssemblyError } from '@/features/assembly/assemble'

/**
 * Decision D16 (RET-002): nothing waits for a person. When an agent's check
 * keeps failing, the job uses a safer option and records one entry: what
 * failed, in plain words, and what it did instead. Platform admins read the
 * log on Admin -> Operations; the learning agents (LRN-002) later turn
 * repeated entries into "don'ts". The limits match `public.agent_fallbacks`.
 *
 * This is not the run log: MEM-001's `agent_runs` keeps every AI call; this
 * log keeps one line per give-up decision, AI or code, and points at the
 * last run with `detail.runId` when there is one. Agent names are the same
 * as `AgentDefinition.name` (lowercase, hyphens), e.g. `copy-check`.
 *
 * Platform admins read every workspace's entries, so reasons are fixed words
 * per rule or code: never the email's copy, codes, products or prompts.
 */
export type FallbackEntry = z.infer<typeof fallbackEntry>

const words = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max))

export const fallbackEntry = z.strictObject({
  /** Null for platform-wide work (competitor intelligence). */
  tenantId: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  /** Which agent or check gave up, for example `copy-check`. */
  agent: z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/),
  /** A stable key for grouping, for example `copy_check_failed`. */
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
  /** What went wrong, for an admin. */
  reason: words(500),
  /** What the system did instead. */
  fallback: words(300),
  attempts: z.int().min(0).max(10),
  /** Small facts only (rules, revision, counts, run id). */
  detail: z
    .record(
      z.string().max(40),
      z.union([
        z.string().max(200),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.string().max(100)).max(20)
      ])
    )
    // The table allows 4000 characters of jsonb text, which spells JSON a
    // little longer than JSON.stringify; stay well inside it.
    .refine((d) => JSON.stringify(d).length <= 3000),
  /** The same problem again updates one entry instead of adding another. */
  dedupeKey: z
    .string()
    .max(300)
    .regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/)
})

/** Cut plain words to a limit without breaking a word or a character. */
export function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  // Whole characters only, so an emoji is never cut in half.
  let cut = ''
  for (const char of clean) {
    if (cut.length + char.length > max - 1) break
    cut += char
  }
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** A caller's id as a dedupe-key part: only the allowed characters. */
export function keyPart(id: string) {
  return id.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 120) || 'none'
}

const ruleList = (failures: QaFailure[]) => [
  ...new Set(failures.map((f) => f.rule))
]

/**
 * Fixed words per rule. The check's own reasons quote the copy and list the
 * brand's live codes, so the log never repeats them (the keys are in
 * `detail.rules`).
 */
export const ruleWords: Record<QaRule, string> = {
  discount_over_max: 'a discount above the brand’s maximum',
  discount_not_allowed: 'a discount where none is allowed',
  discount_no_code: 'a discount without its code',
  money_off: 'a money-off amount the brand does not offer',
  unknown_code: 'a code that is not one of the brand’s codes',
  expired_code: 'a code that is expired at the send time',
  code_over_max: 'a code worth more than the maximum discount',
  unsupported_percent: 'a percentage the brand does not offer',
  shipping_claim: 'a shipping claim the brand facts do not support',
  delivery_promise: 'a delivery promise the brand facts do not support',
  returns_claim: 'a returns claim the brand facts do not support',
  guarantee_claim: 'a guarantee the brand facts do not support',
  banned_phrase: 'a banned word or phrase',
  unsupported_claim: 'a claim the brand cannot back up',
  unverified_review: 'a rating or review count without a verified source'
}

/** Fixed words per assembly error code (its message names products). */
export const assemblyWords: Record<AssemblyError['code'], string> = {
  focus_unavailable:
    'The email’s main product could not be placed (out of stock, or no usable photo or price).',
  bug: 'The email builder stopped on an internal error.'
}

/**
 * The entry for a copy check that never passed (`withCopyQa` answered
 * `fallback`). `fallback` says what the caller did instead, in plain words.
 * Builders never throw: `FallbackLog.record` checks the entry.
 */
export function copyCheckFallback(input: {
  tenantId: string
  campaignId: string | null
  /** What the email is (its campaign or plan slot id), for the dedupe key. */
  subject: string
  /** The copy revision the tries were for, so a later revision is a new entry. */
  revision: number
  attempts: QaResult[]
  errors: unknown[]
  fallback: string
  /** The last agent run (`agent_runs`), when an agent wrote the copy. */
  runId?: string
}): FallbackEntry {
  const checks = input.attempts.length
  const crashes = input.errors.length
  const last = input.attempts.at(-1)
  const rules = ruleList(last?.failures ?? [])
  const reason = last
    ? `The copy failed the brand check ${count(checks)}${
        crashes ? `, and the copywriter failed ${count(crashes)}` : ''
      }. Last time it had ${rules.map((r) => ruleWords[r]).join('; ')}.`
    : `The copywriter failed ${count(crashes)} and no draft came back.`
  return {
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    agent: 'copy-check',
    reasonCode: last ? 'copy_check_failed' : 'copywriter_failed',
    reason: clip(reason, 500),
    fallback: clip(input.fallback, 300),
    attempts: Math.min(checks + crashes, 10),
    detail: {
      revision: input.revision,
      rules: rules.slice(0, 20),
      errors: crashes,
      ...(input.runId ? { runId: input.runId.slice(0, 200) } : {})
    },
    dedupeKey: `copy-check:${keyPart(input.subject)}:${input.revision}`
  }
}

/**
 * The entry for an email that could not be assembled. `focus_unavailable`
 * used to go to a person; now the caller picks a safer option and says
 * which in `fallback`.
 */
export function assemblyFallback(input: {
  tenantId: string
  campaignId: string | null
  /** What the email is (its campaign or plan slot id), for the dedupe key. */
  subject: string
  revision: number
  error: AssemblyError
  fallback: string
}): FallbackEntry {
  return {
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    agent: 'assembly',
    reasonCode: `assembly_${input.error.code}`,
    reason: assemblyWords[input.error.code] ?? assemblyWords.bug,
    fallback: clip(input.fallback, 300),
    attempts: 1,
    detail: { revision: input.revision, code: input.error.code },
    dedupeKey: `assembly:${keyPart(input.subject)}:${input.revision}:${input.error.code}`
  }
}

function count(n: number) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
}
