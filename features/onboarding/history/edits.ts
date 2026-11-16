import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'
import { excerptLine, voiceExcerpt } from '@/features/letter/voice/excerpt'
import { ownWordsOf } from '@/features/letter/voice/names'
import {
  learnNeverWords,
  type NeverWords,
  type OwnerEdit
} from '@/features/copy-qa/never-words'
import type { MorePages } from '@/lib/providers/klaviyo/catalog'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  maxBodyReads,
  readMessageBodies,
  type CampaignMessage,
  type MessageBody
} from '@/lib/providers/klaviyo/history'

/**
 * PIC-29 part 2b (owner pick #29, "Words this brand never uses"): during the
 * history read, the emails GROS drafted that went out are compared with
 * what GROS built (the push's newest drafted build, `email_builds.email`,
 * found by the push's Klaviyo message, `klaviyo_draft_pushes`), and what
 * the owner took out is learned (`learnNeverWords`, PIC-29 part 1). Both
 * sides are read the same way: the subject and the preview line as the
 * excerpt reads a line (`excerptLine`), then the template as a voice
 * excerpt (PIC-23 part 2a): what a reader sees, without the footer,
 * reviews, people's names, contact details or Klaviyo's tags.
 *
 * Only the AI's words teach (`copy: 'written'`): plain words are code's,
 * no choice GROS made. An email with an A/B test (two designs or two
 * subjects) is left out: which of Klaviyo's variations is which is not
 * known here. A template changed after its send is not what went out.
 *
 * The newest sent GROS emails are read (at most `maxBodyReads`); only a
 * read that compared at least one and read every one it could gives a
 * list (`learned`), which then replaces the workspace's (PIC-29 part 2a).
 * A read cut short (the sent list, an email's content not known, a
 * template skipped or every one gone, the time) keeps the list as it was.
 * An extra of the history read: Klaviyo refusing a template, a missing
 * scope or a rate limit only stop this step.
 */

/** The system's own words: the owner rewording them is no word GROS chose. */
export const systemWords = [
  'Use the code',
  'Rated out of 5',
  'View in browser',
  'Unsubscribe',
  'Manage preferences'
]

/** What an edit reads of a build: older stored emails still parse. */
const sentBuild = z.object({
  subject: z.string().min(1),
  preheader: z.string(),
  html: z.string().min(1),
  text: z.string().min(1).optional(),
  copy: z.enum(['written', 'plain']),
  designA: z.string().min(1).optional(),
  subjectB: z.string().min(1).optional()
})
export type SentBuild = z.infer<typeof sentBuild>

export type EditsRead = {
  /** What was learned, or null when the read cannot replace the list. */
  learned: NeverWords | null
  /** The sent GROS emails compared, and the edits made of them. */
  tried: number
  edits: number
  /** Sent GROS emails not compared: a test, plain words, no drafted build. */
  left: number
  stopped: 'rate_limited' | 'bad_key' | 'missing_scope' | 'incomplete' | null
}

/** One side of an edit: subject, preview, then the lines a reader sees. */
function linesOf(
  subject: string | null,
  preview: string | null,
  body: MessageBody,
  own: ReturnType<typeof ownWordsOf>
): string[] | null {
  const excerpt = voiceExcerpt(body, own)
  if (!excerpt) return null
  return [
    excerptLine(subject, own),
    excerptLine(preview, own),
    ...excerpt.text.split('\n')
  ]
}

/** What GROS built, as a template of its own. */
const builtBody = (messageId: string, email: SentBuild): MessageBody => ({
  messageId,
  templateId: 'built',
  editor: 'code',
  html: email.html,
  text: email.text ?? null,
  updated: null,
  truncated: false
})

/** The template changed after the send: not what went out. */
const changedAfter = (body: MessageBody, message: CampaignMessage) =>
  !!body.updated &&
  !!message.sendAt &&
  Date.parse(body.updated) > Date.parse(message.sendAt)

/**
 * The list without what may be a person's name: a phrase holding a word
 * GROS wrote capitalised inside a line (never its first word: "Loved by
 * Jordan", "Meet Olivia"), and without what the owner wrote instead (his
 * own lines may hold any name; no screen needs them yet).
 */
export function withoutNames(
  learned: NeverWords,
  edits: readonly OwnerEdit[]
): NeverWords {
  const capitalised = new Set<string>()
  for (const e of edits)
    for (const line of e.drafted)
      for (const sentence of line.split(/(?<=[.!?…:])\s+/))
        for (const [i, word] of sentence.split(/\s+/).entries())
          if (i > 0 && /^\p{Lu}/u.test(word))
            capitalised.add(
              word.replace(/[^\p{L}\p{N}'’-]/gu, '').toLowerCase()
            )
  const keep = (list: NeverWords['never']) =>
    list
      .filter((w) => !w.phrase.split(' ').some((p) => capitalised.has(p)))
      .map((w) => ({ ...w, instead: [] }))
  return { never: keep(learned.never), watched: keep(learned.watched) }
}

/**
 * The edits of the sent GROS emails, from what was built and what was read:
 * pure, for the read below and its tests.
 */
export function ownerEditsOf(input: {
  sent: readonly CampaignMessage[]
  built: ReadonlyMap<string, SentBuild>
  bodies: readonly MessageBody[]
  own: readonly string[]
}): OwnerEdit[] {
  const own = ownWordsOf([...input.own, ...systemWords])
  const byId = new Map(input.sent.map((m) => [m.id, m]))
  return input.bodies.flatMap((body): OwnerEdit[] => {
    const message = byId.get(body.messageId)
    const email = input.built.get(body.messageId)
    if (!message || !email || changedAfter(body, message)) return []
    const drafted = linesOf(
      email.subject,
      email.preheader,
      builtBody(body.messageId, email),
      own
    )
    const sent = linesOf(message.subject, message.preview, body, own)
    return drafted && sent ? [{ messageId: body.messageId, drafted, sent }] : []
  })
}

/** The sent GROS emails, newest first, at most `maxBodyReads`. */
function gros(
  sent: readonly CampaignMessage[],
  pushed: ReadonlySet<string>
): CampaignMessage[] {
  const time = (m: CampaignMessage) => (m.sendAt ? Date.parse(m.sendAt) : 0)
  return sent
    .filter(
      (m) =>
        m.status === 'sent' &&
        (m.channel === null || m.channel === 'email') &&
        pushed.has(m.id)
    )
    .sort((a, b) => time(b) - time(a))
    .slice(0, maxBodyReads)
}

/** Reads the owner's edits of GROS's sent emails (see above). Never throws for Klaviyo. */
export async function readOwnerEdits(input: {
  db: SupabaseClient<Database>
  tenantId: string
  client: KlaviyoClient
  more: MorePages
  sent: readonly CampaignMessage[]
  /** The sent list was read whole (the history's own `parts.sent`). */
  sentComplete: boolean
  /** The store's own words: its name and product titles. */
  own: readonly string[]
}): Promise<EditsRead> {
  const keep = (
    stopped: EditsRead['stopped'],
    counts: Partial<EditsRead> = {}
  ): EditsRead => ({
    learned: null,
    tried: 0,
    edits: 0,
    left: 0,
    ...counts,
    stopped
  })
  const pushes = await input.db
    .from('klaviyo_draft_pushes')
    .select('push_key,message_id')
    .eq('tenant_id', input.tenantId)
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5_000)
  if (pushes.error) throw pushes.error
  const keyOf = new Map(
    (pushes.data ?? []).flatMap((p) =>
      p.message_id ? [[p.message_id, p.push_key] as const] : []
    )
  )
  const incomplete = input.sentComplete ? null : 'incomplete'
  const ours = gros(input.sent, new Set(keyOf.keys()))
  // No sent GROS email in the history read: the list stays as it was (one
  // learned from emails older than the history's window is kept).
  if (!ours.length) return keep(incomplete)
  const builds = await input.db
    .from('email_builds')
    .select('push_key,email,created_at')
    .eq('tenant_id', input.tenantId)
    .eq('state', 'drafted')
    .in(
      'push_key',
      ours.map((m) => keyOf.get(m.id)!)
    )
    .not('email', 'is', null)
    .order('created_at', { ascending: false })
  if (builds.error) throw builds.error
  // The newest drafted build of each push: what Klaviyo holds (a "Try
  // again" drafts once more; one not drafted never reached Klaviyo).
  const emailOf = new Map<string, SentBuild | null>()
  for (const row of builds.data ?? []) {
    if (emailOf.has(row.push_key)) continue
    const email = sentBuild.safeParse(row.email)
    emailOf.set(row.push_key, email.success ? email.data : null)
  }
  const built = new Map<string, SentBuild>()
  let left = 0
  let unknown = 0
  for (const m of ours) {
    const email = emailOf.get(keyOf.get(m.id)!)
    if (!email || email.designA || email.subjectB || email.copy !== 'written')
      left++
    else if (!m.contentKnown || !m.templateId) unknown++
    else if (m.abTest) left++
    else built.set(m.id, email)
  }
  const tried = ours.filter((m) => built.has(m.id))
  if (!tried.length) return keep(unknown ? 'incomplete' : incomplete, { left })
  let bodies: Awaited<ReturnType<typeof readMessageBodies>>
  try {
    bodies = await readMessageBodies(input.client, tried, input.more)
  } catch (error) {
    if (!(error instanceof KlaviyoError)) throw error
    return keep(error.kind === 'bad_key' ? 'bad_key' : 'rate_limited', {
      tried: tried.length,
      left
    })
  }
  const edits = ownerEditsOf({
    sent: input.sent,
    built,
    bodies: bodies.records,
    own: input.own
  })
  // A template changed after its send is not what went out (Klaviyo may
  // touch it itself): every one changed keeps the list, as every one gone.
  const byId = new Map(input.sent.map((m) => [m.id, m]))
  const changed = bodies.records.filter((b) =>
    changedAfter(b, byId.get(b.messageId)!)
  ).length
  // Only every email read gives the list: a read cut short keeps the old
  // one, and so does every template gone (that may be Klaviyo's, not his).
  const stopped = bodies.scopeMissing
    ? 'missing_scope'
    : !bodies.complete ||
        bodies.skipped ||
        unknown ||
        (bodies.gone && !bodies.records.length) ||
        (changed && changed === bodies.records.length)
      ? 'incomplete'
      : incomplete
  return {
    learned: stopped
      ? null
      : withoutNames(
          learnNeverWords(edits, [...input.own, ...systemWords]),
          edits
        ),
    tried: tried.length,
    edits: edits.length,
    left,
    stopped
  }
}
