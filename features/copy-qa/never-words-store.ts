import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'
import { maxNeverWords, type NeverWord, type NeverWords } from './never-words'

/**
 * PIC-29 part 2a: the words this brand never uses, kept per workspace
 * (`brand_never_words`): what `learnNeverWords` (PIC-29 part 1) learned from
 * the owner's edits, the phrases he never wants (`never`) and those watched.
 * Only the history read writes them, under its lease; members read them.
 */

/** One to four words, one space between, as the learner writes them. */
const words = /^[^\s\p{Cc}]+( [^\s\p{Cc}]+){0,3}$/u
const phrase = z
  .string()
  .min(1)
  .max(170)
  .refine((p) => words.test(p) && p === p.normalize('NFKC'))
const word = z.strictObject({
  phrase,
  removed: z.number().int().min(1).max(100_000),
  kept: z.number().int().min(0).max(100_000),
  instead: z.array(phrase).max(3)
})
/** The table's total for one list. */
const maxListChars = 160_000

/** The list as the table keeps it: each phrase once, at most 100 of each. */
export function neverWordsToKeep(learned: NeverWords): NeverWords {
  const seen = new Set<string>()
  const keep = (list: readonly NeverWord[], never: boolean) =>
    (Array.isArray(list) ? list : []).flatMap((w): NeverWord[] => {
      // A swap the table cannot keep goes, never the word with it.
      const swaps =
        w && Array.isArray(w.instead)
          ? w.instead.filter((t: unknown) => phrase.safeParse(t).success)
          : w?.instead
      const parsed = word.safeParse(w ? { ...w, instead: swaps } : w)
      if (!parsed.success || seen.has(parsed.data.phrase)) return []
      // Never used only when taken out twice or more, more often than kept.
      if (
        never &&
        (parsed.data.removed < 2 || parsed.data.removed <= parsed.data.kept)
      )
        return []
      seen.add(parsed.data.phrase)
      return [parsed.data]
    })
  const list = {
    never: keep(learned?.never ?? [], true).slice(0, maxNeverWords),
    watched: keep(learned?.watched ?? [], false).slice(0, maxNeverWords)
  }
  // Within the table's total: the watched go first, the last first.
  const size = () =>
    JSON.stringify([...list.never, ...list.watched]).length + 400 * 2
  while (size() > maxListChars && list.watched.length) list.watched.pop()
  while (size() > maxListChars && list.never.length) list.never.pop()
  return list
}

/**
 * Replaces the workspace's list with what this history read learned
 * (`record_never_words`, worker only, under the job's lease; an empty list
 * clears it). How many phrases were kept.
 */
export async function recordNeverWords(
  db: SupabaseClient<Database>,
  job: { id: string; lease: string },
  learned: NeverWords
): Promise<number> {
  const list = neverWordsToKeep(learned)
  const { data, error } = await db.rpc('record_never_words', {
    job: job.id,
    lease: job.lease,
    words: [
      ...list.never.map((w) => ({ ...w, state: 'never' })),
      ...list.watched.map((w) => ({ ...w, state: 'watched' }))
    ]
  })
  if (error) throw error
  return data
}

/** The workspace's list as members see it, the most removed first. */
export async function readNeverWords(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<NeverWords> {
  const { data, error } = await db
    .from('brand_never_words')
    .select('phrase,state,removed,kept,instead')
    .eq('tenant_id', tenantId)
    .order('removed', { ascending: false })
    .order('phrase', { ascending: true })
    .limit(maxNeverWords * 2)
  if (error) throw error
  const out: NeverWords = { never: [], watched: [] }
  for (const row of data ?? []) {
    const parsed = word.safeParse({
      phrase: row.phrase,
      removed: row.removed,
      kept: row.kept,
      instead: row.instead
    })
    if (!parsed.success) continue
    if (row.state === 'never') out.never.push(parsed.data)
    else if (row.state === 'watched') out.watched.push(parsed.data)
  }
  return out
}
