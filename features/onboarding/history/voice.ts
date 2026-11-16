import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { voiceExcerpt } from '@/features/letter/voice/excerpt'
import { ownWordsOf } from '@/features/letter/voice/names'
import {
  pickVoiceSamples,
  readVoiceSamples,
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
 * only this step (the history goes on and is stored). Only a read that
 * read every sent email's template (`authoritative`) replaces the samples
 * (and clears them when none said enough); a read cut short merges what it
 * found with the samples kept before (`samplesToKeep`), and one that found
 * nothing keeps them as they were.
 */

/** Sent emails tried, newest first, before reads stop at `maxBodyReads`. */
const maxCandidates = maxBodyReads * 2

/** Why a read stopped early, for the log: a closed list, never a message. */
export type VoiceStop =
  | 'rate_limited'
  | 'bad_key'
  | 'missing_scope'
  | 'cap'
  | 'time'
  | 'unavailable'
  | 'unreadable'
  | 'content_unknown'

export type VoiceRead = {
  /** The samples the read found (the excerpts that said enough). */
  found: VoiceSample[]
  /**
   * True when every sent email's template was read (or is gone): what it
   * found is all there is, so it replaces the samples, even with none.
   */
  authoritative: boolean
  /** Bodies read. */
  read: number
  /** The messages read this time (a sample of one, kept before, is replaced or goes). */
  readIds: ReadonlySet<string>
  /** Emails GROS drafted itself, left out (a sample of one kept before goes). */
  ours: number
  oursIds: ReadonlySet<string>
  stopped: VoiceStop | null
}

/** The emails whose words may be the owner's, newest first. */
export function voiceCandidates(
  sent: readonly CampaignMessage[],
  ours: ReadonlySet<string>
): {
  candidates: CampaignMessage[]
  ours: number
  oursIds: Set<string>
  /** Email messages whose template is not known (their content unread). */
  unknown: number
  /** More emails than are tried: the oldest were left out. */
  cut: boolean
} {
  const emails = sent.filter(
    (m) => m.status === 'sent' && (m.channel === null || m.channel === 'email')
  )
  const theirs: CampaignMessage[] = []
  const oursIds = new Set<string>()
  let unknown = 0
  for (const m of emails) {
    if (m.campaignId && ours.has(m.campaignId)) oursIds.add(m.id)
    else if (!m.templateId || !m.contentKnown) unknown++
    else theirs.push(m)
  }
  const time = (m: CampaignMessage) => (m.sendAt ? Date.parse(m.sendAt) : 0)
  return {
    candidates: theirs
      .sort((a, b) => time(b) - time(a))
      .slice(0, maxCandidates),
    ours: oursIds.size,
    oursIds,
    unknown,
    cut: theirs.length > maxCandidates
  }
}

/** Reads the owner's voice from the emails they sent (see above). Never throws for Klaviyo. */
export async function readOwnerVoice(input: {
  client: KlaviyoClient
  /** Whether another template may be read (time kept for the excerpts). */
  more: MorePages
  sent: readonly CampaignMessage[]
  /** The sent emails were read whole (the history's own part). */
  sentComplete: boolean
  /** The campaigns GROS drafted (`klaviyo_draft_pushes`). */
  ours: ReadonlySet<string>
  /** The store's own words: its name and product titles. */
  own: readonly string[]
}): Promise<VoiceRead> {
  const { candidates, ours, oursIds, unknown, cut } = voiceCandidates(
    input.sent,
    input.ours
  )
  const whole = input.sentComplete && unknown === 0 && !cut
  const none = new Set<string>()
  if (!candidates.length)
    return {
      found: [],
      authoritative: whole,
      read: 0,
      readIds: none,
      ours,
      oursIds,
      stopped: whole ? null : 'content_unknown'
    }
  let bodies: Awaited<ReturnType<typeof readMessageBodies>>
  try {
    bodies = await readMessageBodies(input.client, candidates, input.more)
  } catch (error) {
    if (!(error instanceof KlaviyoError)) throw error
    // A rate limit or a refused key: the history read decides about the
    // job; the voice waits for the next read.
    return {
      found: [],
      authoritative: false,
      read: 0,
      readIds: none,
      ours,
      oursIds,
      stopped:
        error.kind === 'bad_key'
          ? 'bad_key'
          : error.kind === 'rate_limited'
            ? 'rate_limited'
            : 'unreadable'
    }
  }
  const sentAt = new Map(candidates.map((m) => [m.id, m.sendAt]))
  const words = ownWordsOf(input.own)
  const found = bodies.records.flatMap((body): VoiceSample[] => {
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
  const tried = bodies.records.length + bodies.gone + bodies.skipped
  const stopped: VoiceStop | null = bodies.scopeMissing
    ? 'missing_scope'
    : !bodies.complete
      ? tried >= maxBodyReads
        ? 'cap'
        : // Stopped with time left: Klaviyo unavailable.
          input.more()
          ? 'unavailable'
          : 'time'
      : bodies.skipped
        ? 'unreadable'
        : !whole
          ? 'content_unknown'
          : null
  return {
    found,
    // Every template read, or gone (a template gone is no voice), and at
    // least one read when any were gone (every one gone may be Klaviyo's).
    authoritative:
      whole &&
      stopped === null &&
      (bodies.records.length > 0 || bodies.gone === 0),
    read: bodies.records.length,
    readIds: new Set(bodies.records.map((b) => b.messageId)),
    ours,
    oursIds,
    stopped
  }
}

/**
 * What to keep after a read: everything it found when it was whole
 * (none: the samples go), else what it found merged with what was kept
 * before (a sample found again wins), else nothing to write (null).
 */
export async function samplesToKeep(
  db: SupabaseClient<Database>,
  tenantId: string,
  voice: VoiceRead
): Promise<VoiceSample[] | null> {
  if (voice.authoritative) return pickVoiceSamples(voice.found)
  if (!voice.found.length) return null
  const before = await readVoiceSamples(db, tenantId)
  return pickVoiceSamples([
    ...voice.found,
    // A message read again (with or without an excerpt now), or one GROS
    // drafted, keeps nothing from before.
    ...before.filter(
      (b) => !voice.readIds.has(b.messageId) && !voice.oursIds.has(b.messageId)
    )
  ])
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
