import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { voiceExcerpt } from '@/features/letter/voice/excerpt'
import { ownWordsOf } from '@/features/letter/voice/names'
import {
  pickVoiceSamples,
  type VoiceSample
} from '@/features/letter/voice/samples'
import type { MorePages } from '@/lib/providers/klaviyo/catalog'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  maxBodyReads,
  readMessageBodies,
  type CampaignMessage
} from '@/lib/providers/klaviyo/history'

/**
 * PIC-23 part 2b, the read (owner pick #23, the founder's voice): during
 * the history read, the words of the emails the owner sent become voice
 * samples (`brand_voice_samples`, PIC-23 part 2b's table). The newest sent
 * emails with a template are read (at most `maxBodyReads`, PIC-23 part 1),
 * never one GROS drafted itself (its own words are not the owner's voice),
 * and each becomes a voice excerpt (PIC-23 part 2a: people's names, contact
 * details, reviews and Klaviyo's tags out), the store's name and product
 * titles kept as its own words.
 *
 * The voice is an extra of the history read: Klaviyo refusing a template,
 * the key lacking `templates:read`, a rate limit or a refused key stop
 * only this step (the history goes on and is stored); a read that stopped
 * before it found anything keeps the samples an earlier read kept.
 */

/** Sent emails tried, newest first, before reads stop at `maxBodyReads`. */
const maxCandidates = maxBodyReads * 2

export type VoiceRead = {
  /** The samples to keep; null: keep the ones an earlier read kept. */
  samples: VoiceSample[] | null
  /** Bodies read, and how many of them said enough to be a sample. */
  read: number
  excerpts: number
  /** Emails GROS drafted itself, left out. */
  ours: number
  /** Why the read stopped early, when it did (a code for the log). */
  stopped: 'scope_missing' | 'klaviyo' | 'time' | null
}

/** The emails whose words may be the owner's, newest first. */
export function voiceCandidates(
  sent: readonly CampaignMessage[],
  ours: ReadonlySet<string>
): { candidates: CampaignMessage[]; ours: number } {
  const emails = sent.filter(
    (m) =>
      m.status === 'sent' &&
      (m.channel === null || m.channel === 'email') &&
      !!m.templateId
  )
  const mine = emails.filter((m) => m.campaignId && ours.has(m.campaignId))
  const time = (m: CampaignMessage) => (m.sendAt ? Date.parse(m.sendAt) : 0)
  return {
    candidates: emails
      .filter((m) => !mine.includes(m))
      .sort((a, b) => time(b) - time(a))
      .slice(0, maxCandidates),
    ours: mine.length
  }
}

/** Reads the owner's voice from the emails they sent (see above). Never throws for Klaviyo. */
export async function readOwnerVoice(input: {
  client: KlaviyoClient
  more: MorePages
  sent: readonly CampaignMessage[]
  /** The campaigns GROS drafted (`klaviyo_draft_pushes`). */
  ours: ReadonlySet<string>
  /** The store's own words: its name and product titles. */
  own: readonly string[]
}): Promise<VoiceRead> {
  const { candidates, ours } = voiceCandidates(input.sent, input.ours)
  if (!candidates.length)
    return { samples: [], read: 0, excerpts: 0, ours, stopped: null }
  let bodies: Awaited<ReturnType<typeof readMessageBodies>>
  try {
    bodies = await readMessageBodies(input.client, candidates, input.more)
  } catch (error) {
    if (!(error instanceof KlaviyoError)) throw error
    // A rate limit or a refused key: the history read decides about the
    // job; the voice waits for the next read.
    return { samples: null, read: 0, excerpts: 0, ours, stopped: 'klaviyo' }
  }
  const sentAt = new Map(candidates.map((m) => [m.id, m.sendAt]))
  const words = ownWordsOf(input.own)
  const samples = bodies.records.flatMap((body): VoiceSample[] => {
    const excerpt = voiceExcerpt(body, words)
    return excerpt
      ? [
          {
            messageId: excerpt.messageId,
            text: excerpt.text,
            weight: excerpt.weight,
            words: excerpt.words,
            sentAt: sentAt.get(body.messageId) ?? null
          }
        ]
      : []
  })
  const stopped = bodies.scopeMissing
    ? 'scope_missing'
    : bodies.complete
      ? null
      : 'time'
  return {
    // A read that stopped with nothing found keeps the earlier samples;
    // one without the scope keeps them whatever it found.
    samples:
      bodies.scopeMissing || (stopped && !samples.length)
        ? null
        : pickVoiceSamples(samples),
    read: bodies.records.length,
    excerpts: samples.length,
    ours,
    stopped
  }
}

/** The campaigns GROS drafted for this workspace, and its own words. */
export async function voiceInputs(
  db: SupabaseClient<Database>,
  tenantId: string,
  brandName: string
): Promise<{ ours: Set<string>; own: string[] }> {
  const [pushes, products] = await Promise.all([
    db
      .from('klaviyo_draft_pushes')
      .select('campaign_id')
      .eq('tenant_id', tenantId)
      .not('campaign_id', 'is', null)
      .limit(5_000),
    db
      .from('products')
      .select('title')
      .eq('tenant_id', tenantId)
      .is('retired_at', null)
      .limit(5_000)
  ])
  if (pushes.error) throw pushes.error
  if (products.error) throw products.error
  return {
    ours: new Set(
      (pushes.data ?? []).flatMap((p) => (p.campaign_id ? [p.campaign_id] : []))
    ),
    own: [
      brandName,
      ...(products.data ?? []).flatMap((p) => (p.title ? [p.title] : []))
    ]
  }
}
