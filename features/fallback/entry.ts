import { z } from 'zod'
import type { QaFailure, QaResult } from '@/features/copy-qa/check'
import type { AssemblyError } from '@/features/assembly/assemble'

/**
 * Decision D16 (RET-002): nothing waits for a person. When an agent's check
 * keeps failing, the job uses a safer option and records one entry: what
 * failed, in plain words, and what it did instead. Platform admins read the
 * log on Admin -> Operations; the learning agents (LRN-002) later turn
 * repeated entries into "don'ts". The limits match `public.agent_fallbacks`.
 */
export type FallbackEntry = z.infer<typeof fallbackEntry>

const key = (max: number) =>
  z.string().regex(new RegExp(`^[a-z][a-z0-9_]{1,${max - 1}}$`))
const words = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max))

export const fallbackEntry = z.strictObject({
  /** Null for platform-wide work (competitor intelligence). */
  tenantId: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  /** Which agent or check gave up, for example `copy_check`. */
  agent: key(40),
  /** A stable key for grouping, for example `copy_check_failed`. */
  reasonCode: key(60),
  /** What went wrong, for an admin. */
  reason: words(500),
  /** What the system did instead. */
  fallback: words(300),
  attempts: z.int().min(0).max(10),
  /** Small facts only (rules, revision, counts); never copy, prompts or payloads. */
  detail: z
    .record(
      z.string(),
      z.union([
        z.string().max(200),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.string().max(100)).max(20)
      ])
    )
    .refine((d) => JSON.stringify(d).length <= 4000),
  /** The same problem again updates one entry instead of adding another. */
  dedupeKey: z.string().min(1).max(300)
})

/** Cut plain words to a limit without breaking the last word in two. */
export function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const ruleList = (failures: QaFailure[]) => [
  ...new Set(failures.map((f) => f.rule))
]

/**
 * The entry for a copy check that never passed (`withCopyQa` answered
 * `fallback`). `fallback` says what the caller did instead, in plain words.
 */
export function copyCheckFallback(input: {
  tenantId: string
  campaignId: string | null
  /** The copy revision the tries were for, so a later revision is a new entry. */
  revision: number
  attempts: QaResult[]
  errors: unknown[]
  fallback: string
}): FallbackEntry {
  const tries = input.attempts.length + input.errors.length
  const last = input.attempts.at(-1)
  const reasons = [...new Set((last?.failures ?? []).map((f) => f.reason))]
  const reason = last
    ? `The copy failed the brand check ${count(tries)}. Last time: ${reasons.join(' ')}`
    : `The copywriter failed ${count(tries)} and no draft came back.`
  return fallbackEntry.parse({
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    agent: 'copy_check',
    reasonCode: last ? 'copy_check_failed' : 'copywriter_failed',
    reason: clip(reason, 500),
    fallback: clip(input.fallback, 300),
    attempts: Math.min(tries, 10),
    detail: {
      revision: input.revision,
      rules: ruleList(last?.failures ?? []).slice(0, 20),
      errors: input.errors.length
    },
    dedupeKey: `copy_check:${input.campaignId ?? 'none'}:${input.revision}`
  })
}

/**
 * The entry for an email that could not be assembled. `focus_unavailable`
 * (the product or brief cannot be placed) used to go to a person; now the
 * caller picks a safer option and says which in `fallback`.
 */
export function assemblyFallback(input: {
  tenantId: string
  campaignId: string | null
  revision: number
  error: AssemblyError
  fallback: string
}): FallbackEntry {
  return fallbackEntry.parse({
    tenantId: input.tenantId,
    campaignId: input.campaignId,
    agent: 'assembly',
    reasonCode: `assembly_${input.error.code}`,
    reason: clip(input.error.message || 'The email could not be built.', 500),
    fallback: clip(input.fallback, 300),
    attempts: 1,
    detail: { revision: input.revision, code: input.error.code },
    dedupeKey: `assembly:${input.campaignId ?? 'none'}:${input.revision}:${input.error.code}`
  })
}

function count(n: number) {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`
}
