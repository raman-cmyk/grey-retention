import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { layoutWinners } from '@/features/inbox/winners'
import { maxAgeDays, type ReferenceEmail } from './reference'

/**
 * DST-002b (part b2a): the reference emails a build may follow, read from
 * the Inspiration inbox by the build's worker (service role: a member may
 * not read the inbox's tagged sections). Only the workspace's followed
 * brands and sample brands are read (D27; the inbox is platform-wide and
 * its names and subjects reach the owner), at most a year back, labelled
 * emails only, newest first.
 */

type Db = SupabaseClient<Database>

/** At most this many emails are read for one build (their ids travel in one query string). */
export const maxReferenceEmails = 100
const dayMs = 86_400_000

export type ReferenceRows = {
  followed: readonly string[]
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
  }[]
}

/** A brand's name for the owner: its own name, else its domain. */
const brandName = (b: ReferenceRows['brands'][number] | undefined) =>
  (b?.brand_name?.trim() || b?.domain || '').slice(0, 120)

/**
 * The rows as reference emails: each email's sections in order (the
 * owner's label over the labeller's, a missing one as `unsure`), its
 * brand's name, and whether its layout is one its brand keeps sending
 * (CMP-047, in the store's timezone). An email from a brand neither
 * followed nor a sample is left out; so is one with no sections.
 */
export function toReferences(
  rows: ReferenceRows,
  { now, timezone }: { now: number; timezone: string }
): { emails: ReferenceEmail[]; followed: Set<string> } {
  const followed = new Set(rows.followed)
  const brands = new Map(rows.brands.map((b) => [b.id, b]))
  const sections = new Map<string, ReferenceRows['sections'][number][]>()
  for (const s of rows.sections) {
    const list = sections.get(s.inbox_message_id) ?? []
    list.push(s)
    sections.set(s.inbox_message_id, list)
  }
  const shown = rows.emails.filter(
    (e) => e.synthetic || followed.has(e.capture_id)
  )
  const winners = new Set<string>()
  const byBrand = new Map<string, typeof shown>()
  for (const e of shown)
    byBrand.set(e.capture_id, [...(byBrand.get(e.capture_id) ?? []), e])
  for (const list of byBrand.values()) {
    const layouts =
      layoutWinners(
        list.map((e) => ({ id: e.id, facts: e.facts })),
        { now, timezone, windowDays: maxAgeDays }
      ) ?? []
    for (const l of layouts)
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
          styles: s.styles ?? []
        }))
    })
  }
  return { emails, followed }
}

/** Reads the workspace's reference rows; throws when a read fails. */
export async function readReferenceRows(
  db: Db,
  tenantId: string,
  now: number
): Promise<ReferenceRows> {
  const since = new Date(now - maxAgeDays * dayMs).toISOString()
  const subs = await db
    .from('competitor_subscriptions')
    .select('capture_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
  if (subs.error) throw new Error('reference_follow_read_failed')
  const followed = [...new Set(subs.data.map((s) => s.capture_id))]
  // Followed brands' emails and sample brands' emails, newest first.
  const scope = followed.length
    ? `synthetic.eq.true,capture_id.in.(${followed.join(',')})`
    : 'synthetic.eq.true'
  const mail = await db
    .from('competitor_emails')
    .select(
      'id, capture_id, inbox_message_id, subject, received_at, industry, email_type, angle, synthetic, facts'
    )
    .or(scope)
    .eq('labels_state', 'tagged')
    .gte('received_at', since)
    .not('inbox_message_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(maxReferenceEmails)
  if (mail.error) throw new Error('reference_email_read_failed')
  const messageIds = mail.data
    .map((e) => e.inbox_message_id)
    .filter((id): id is string => !!id)
  const captureIds = [...new Set(mail.data.map((e) => e.capture_id))]
  if (!messageIds.length)
    return { followed, brands: [], emails: mail.data, sections: [] }
  const [brands, sections] = await Promise.all([
    db
      .from('competitor_captures')
      .select('id, brand_name, domain')
      .in('id', captureIds),
    db
      .from('email_sections')
      .select(
        'inbox_message_id, ordinal, block_type, owner_block_type, height, purpose, styles'
      )
      .in('inbox_message_id', messageIds)
      .order('ordinal', { ascending: true })
  ])
  if (brands.error) throw new Error('reference_brand_read_failed')
  if (sections.error) throw new Error('reference_section_read_failed')
  return {
    followed,
    brands: brands.data,
    emails: mail.data,
    sections: sections.data
  }
}
