import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'

/**
 * PIC-23 part 2b: the owner's own words kept per workspace
 * (`brand_voice_samples`): one voice excerpt of an email the store sent
 * (PIC-23 part 2a's voice excerpt, already without people's names,
 * contact details, reviews and Klaviyo's tags), with when it was sent.
 * Only the history read writes them, under its lease; members read them.
 */
export type VoiceSample = {
  messageId: string
  text: string
  /** 3: Klaviyo's rich text editor (a letter), 2: custom code, 1: designed. */
  weight: 1 | 2 | 3
  /** The owner's words in it (placeholders not counted). */
  words: number
  sentAt: string | null
}

/** At most this many samples a workspace, and this many characters in all. */
export const maxVoiceSamples = 20
export const maxVoiceChars = 60_000

const sample = z
  .object({
    messageId: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
    text: z.string().min(1).max(8_000),
    weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    words: z.number().int().min(25).max(8_000),
    // As the table keeps it: a real time from 2000 on, in one spelling.
    sentAt: z.iso
      .datetime({ offset: true })
      .transform((t) => new Date(t))
      .refine((d) => !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000)
      .transform((d) => d.toISOString())
      .nullable()
  })
  // A word is at least one letter and a space (as the table checks).
  .refine((v) => v.words <= (v.text.length + 1) / 2)

/**
 * The samples worth keeping: the letters first (by weight), then the
 * newest, each message once, at most `maxVoiceSamples` and `maxVoiceChars`
 * in all (one that would go past the total is passed over for a shorter
 * one). A sample of a shape the table refuses is left out.
 */
export function pickVoiceSamples(found: readonly VoiceSample[]): VoiceSample[] {
  // Only what the table keeps, in its own shape (no other field).
  const valid = found.flatMap((s) => {
    const parsed = sample.safeParse(s)
    return parsed.success ? [parsed.data] : []
  })
  const time = (s: VoiceSample) => (s.sentAt ? Date.parse(s.sentAt) : 0)
  const order = [...valid].sort(
    (a, b) => b.weight - a.weight || time(b) - time(a)
  )
  const seen = new Set<string>()
  const kept: VoiceSample[] = []
  let chars = 0
  for (const s of order) {
    if (kept.length >= maxVoiceSamples) break
    if (seen.has(s.messageId) || chars + s.text.length > maxVoiceChars) continue
    seen.add(s.messageId)
    chars += s.text.length
    kept.push(s)
  }
  return kept
}

/**
 * Replaces the workspace's samples with what this history read found
 * (`record_voice_samples`, worker only, under the job's lease; an empty
 * list clears them). How many were kept.
 */
export async function recordVoiceSamples(
  db: SupabaseClient<Database>,
  job: { id: string; lease: string },
  samples: readonly VoiceSample[]
): Promise<number> {
  const { data, error } = await db.rpc('record_voice_samples', {
    job: job.id,
    lease: job.lease,
    samples: pickVoiceSamples(samples)
  })
  if (error) throw error
  return data
}

/** The workspace's samples as members see them, the letters first. */
export async function readVoiceSamples(
  db: SupabaseClient<Database>,
  tenantId: string
): Promise<VoiceSample[]> {
  const { data, error } = await db
    .from('brand_voice_samples')
    .select('message_id,text,weight,words,sent_at')
    .eq('tenant_id', tenantId)
    .order('weight', { ascending: false })
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(maxVoiceSamples)
  if (error) throw error
  return (data ?? []).flatMap((row) => {
    const parsed = sample.safeParse({
      messageId: row.message_id,
      text: row.text,
      weight: row.weight,
      words: row.words,
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null
    })
    return parsed.success ? [parsed.data] : []
  })
}
