import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { layoutWinners } from '@/features/inbox/winners'
import { maxAgeDays, type ReferenceEmail } from './reference'

/**
 * DST-002b (part b2a): the reference emails a build may follow, read from
 * the Inspiration inbox by the build's worker (service role: a member may
 * not read the inbox's tagged sections). Only brands the workspace may see
 * are read: the brands it follows, and, for a sample workspace, the sample
 * brands (as brand suggestions do, REAL-01); never a brand it hid. The
 * inbox is platform-wide and its names and subjects reach the owner.
 */

type Db = SupabaseClient<Database>

/** At most this many of the followed brands' emails are read. */
export const maxFollowedEmails = 100
/** At most this many sample brands' emails (a sample workspace only). */
export const maxSampleEmails = 50
/** The server's page size (PostgREST `max_rows`): longer reads are paged. */
export const pageRows = 1000
/** Messages per sections read (their ids travel in the query string). */
const messageBatch = 50
/** At most this many sends per read of the brands' history (winners). */
const maxHistory = 3000
const dayMs = 86_400_000

const emailColumns =
  'id, capture_id, inbox_message_id, subject, received_at, industry, email_type, angle, synthetic, facts'

export type ReferenceRows = {
  followed: readonly string[]
  hidden: readonly string[]
  brands: readonly { id: string; brand_name: string | null; domain: string }[]
  emails: readonly {
    id: string
    capture_id: string
    inbox_message_id: string | null
    subject: string | null
    received_at: string
    industry: string | null
    email_type: string | null
    angle: string | null
    synthetic: boolean
    facts: unknown
  }[]
  sections: readonly {
    inbox_message_id: string
    ordinal: number
    block_type: string | null
    owner_block_type: string | null
    height: number | null
    purpose: string | null
    styles: string[] | null
    /** DST-004b: the section's stored picture (`inbox-assets`). */
    image_path: string | null
  }[]
  /** The brands' sends of the last year, tagged or not, for winners. */
  history: readonly { id: string; capture_id: string; facts: unknown }[]
}

/** A brand's name for the owner: its own name, else its domain. */
const brandName = (b: ReferenceRows['brands'][number] | undefined) =>
  (b?.brand_name?.trim() || b?.domain || '').slice(0, 120)

/**
 * The rows as reference emails: each email's sections in order (the
 * owner's label over the labeller's, a missing one as `unsure`), its
 * brand's name, and whether its layout is one its brand keeps sending
 * (CMP-047 over the brand's year of sends, in the store's timezone). A
 * hidden brand, a brand neither followed nor a sample, and an email with
 * no sections are left out.
 */
export function toReferences(
  rows: ReferenceRows,
  { now, timezone }: { now: number; timezone: string }
): { emails: ReferenceEmail[]; followed: Set<string> } {
  const hidden = new Set(rows.hidden)
  const followed = new Set(rows.followed.filter((id) => !hidden.has(id)))
  const brands = new Map(rows.brands.map((b) => [b.id, b]))
  const sections = new Map<string, ReferenceRows['sections'][number][]>()
  for (const s of rows.sections) {
    const list = sections.get(s.inbox_message_id) ?? []
    list.push(s)
    sections.set(s.inbox_message_id, list)
  }
  const shown = rows.emails.filter(
    (e) =>
      !hidden.has(e.capture_id) && (e.synthetic || followed.has(e.capture_id))
  )
  // Winners from each shown brand's sends: its history and the emails read.
  const sends = new Map<string, Map<string, unknown>>()
  for (const e of [...rows.history, ...shown]) {
    const brand = sends.get(e.capture_id) ?? new Map<string, unknown>()
    brand.set(e.id, e.facts)
    sends.set(e.capture_id, brand)
  }
  const winners = new Set<string>()
  for (const brand of new Set(shown.map((e) => e.capture_id))) {
    const list = [...(sends.get(brand) ?? new Map()).entries()].map(
      ([id, facts]) => ({ id, facts })
    )
    for (const l of layoutWinners(list, {
      now,
      timezone,
      windowDays: maxAgeDays
    }) ?? [])
      if (l.winner) l.ids.forEach((id) => winners.add(id))
  }
  const emails: ReferenceEmail[] = []
  for (const e of shown) {
    const own = e.inbox_message_id
      ? (sections.get(e.inbox_message_id) ?? [])
      : []
    if (!own.length) continue
    emails.push({
      id: e.id,
      brandId: e.capture_id,
      brand: brandName(brands.get(e.capture_id)),
      synthetic: e.synthetic,
      subject: e.subject ?? '',
      industry: e.industry,
      emailType: e.email_type,
      angle: e.angle,
      receivedAt: e.received_at,
      winner: winners.has(e.id),
      sections: [...own]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((s) => ({
          blockType: s.owner_block_type ?? s.block_type ?? 'unsure',
          height: s.height,
          purpose: s.purpose,
          styles: s.styles ?? [],
          // Only this email's own crop of this section.
          image:
            s.image_path === `sect/${s.inbox_message_id}/${s.ordinal}.jpg`
              ? s.image_path
              : null
        }))
    })
  }
  return { emails, followed }
}

type Page<T> = PromiseLike<{
  data: T[] | null
  error: { code?: string } | null
}>

const failed = (what: string, error: { code?: string } | null) =>
  new Error(`reference_${what}_read_failed`, {
    cause: { code: error?.code ?? 'unknown' }
  })

/** Every row of a read, page by page (the server answers at most `pageRows`). */
async function allRows<T>(
  what: string,
  page: (from: number, to: number) => Page<T>,
  max: number
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < max; from += pageRows) {
    const to = Math.min(from + pageRows, max) - 1
    const { data, error } = await page(from, to)
    if (error || !data) throw failed(what, error)
    rows.push(...data)
    if (data.length < to - from + 1) break
  }
  return rows
}

const batches = <T>(items: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  )

/** Reads the workspace's reference rows; throws when a read fails. */
export async function readReferenceRows(
  db: Db,
  tenantId: string,
  now: number
): Promise<ReferenceRows> {
  const since = new Date(now - maxAgeDays * dayMs).toISOString()
  const [subs, hiddenRows, profile] = await Promise.all([
    db
      .from('competitor_subscriptions')
      .select('capture_id')
      .eq('tenant_id', tenantId)
      .eq('active', true),
    db.from('competitor_hidden').select('capture_id').eq('tenant_id', tenantId),
    db
      .from('brand_profiles')
      .select('synthetic')
      .eq('tenant_id', tenantId)
      .maybeSingle()
  ])
  if (subs.error) throw failed('follow', subs.error)
  if (hiddenRows.error) throw failed('hidden', hiddenRows.error)
  if (profile.error) throw failed('profile', profile.error)
  const hidden = [...new Set(hiddenRows.data.map((h) => h.capture_id))]
  const followed = [
    ...new Set(
      subs.data.map((s) => s.capture_id).filter((id) => !hidden.includes(id))
    )
  ]
  // Sample brands for a sample workspace only; no profile, no sample brands.
  const sampleStore = profile.data?.synthetic === true
  const recent = () =>
    db
      .from('competitor_emails')
      .select(emailColumns)
      .eq('labels_state', 'tagged')
      .gte('received_at', since)
      .not('inbox_message_id', 'is', null)
  const [own, samples] = await Promise.all([
    followed.length
      ? recent()
          .in('capture_id', followed)
          .order('received_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(maxFollowedEmails)
      : { data: [], error: null },
    sampleStore
      ? (hidden.length
          ? recent().not('capture_id', 'in', `(${hidden.join(',')})`)
          : recent()
        )
          .eq('synthetic', true)
          .order('received_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(maxSampleEmails)
      : { data: [], error: null }
  ])
  if (own.error) throw failed('email', own.error)
  if (samples.error) throw failed('email', samples.error)
  const seen = new Set<string>()
  const emails = [...own.data, ...samples.data].filter(
    (e) => !seen.has(e.id) && !!seen.add(e.id)
  )
  const messageIds = emails
    .map((e) => e.inbox_message_id)
    .filter((id): id is string => !!id)
  const brandIds = [...new Set(emails.map((e) => e.capture_id))]
  if (!messageIds.length)
    return { followed, hidden, brands: [], emails, sections: [], history: [] }
  const [brands, sections, history] = await Promise.all([
    db
      .from('competitor_captures')
      .select('id, brand_name, domain')
      .in('id', brandIds),
    Promise.all(
      batches(messageIds, messageBatch).map((ids) =>
        allRows(
          'section',
          (from, to) =>
            db
              .from('email_sections')
              .select(
                'inbox_message_id, ordinal, block_type, owner_block_type, height, purpose, styles, image_path'
              )
              .in('inbox_message_id', ids)
              .order('inbox_message_id', { ascending: true })
              .order('ordinal', { ascending: true })
              .range(from, to),
          ids.length * 40
        )
      )
    ).then((parts) => parts.flat()),
    allRows(
      'history',
      (from, to) =>
        db
          .from('competitor_emails')
          .select('id, capture_id, facts')
          .in('capture_id', brandIds)
          .gte('received_at', since)
          .order('received_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      maxHistory
    )
  ])
  if (brands.error) throw failed('brand', brands.error)
  return {
    followed,
    hidden,
    brands: brands.data,
    emails,
    sections,
    history
  }
}
