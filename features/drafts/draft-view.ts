import { z } from 'zod'
import type { StatusKind } from '@/components/gros/status'
import { campaignStatusOf, stepStateWords } from '@/features/campaigns/status'
import { localDateTime } from '@/lib/local-time'
import type { Database } from '@/lib/supabase/database.types'

type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

/**
 * A saved draft's GROS page (UI-OLDc), read from the old campaign page's
 * data (`campaignDetail`): what it is, where it started, its steps in
 * words and what the owner can do next. Pure, so the screen only draws.
 */
export type DraftView = {
  id: string
  title: string
  goal: string
  /** One of the four GROS statuses, or null for a replaced draft. */
  status: StatusKind | null
  replaced: boolean
  facts: [string, string][]
  steps: [string, string][]
  /** The owner may approve this date now (its calendar revision). */
  approveDate: number | null
  copy:
    | { kind: 'wait' }
    | { kind: 'none'; write: number | null }
    | {
        kind: 'written'
        revision: number
        subject: string
        preheader: string
        body: string
        cta: string
        url: string
        options: string[]
        problems: string[]
        approved: boolean
        /** Saving a change is allowed (anyone before approval, the owner after). */
        edit: boolean
        /** The owner may approve this copy revision now. */
        approve: boolean
        /** The owner may ask for the copy to be written again. */
        rewrite: boolean
      }
  /** The details the owner or staff may change (null once replaced). */
  details: {
    revision: number
    title: string
    goal: string
    channel: string
    /** The send time in the store's own timezone, for the field. */
    local: string
    timezone: string
    audienceId: string
    productId: string
    offerId: string
    notes: string
  } | null
  audiences: { id: string; label: string }[]
  notes: { id: string; body: string }[]
  owner: boolean
}

const lineage = z
  .object({
    structureSource: z.string().optional().catch(undefined),
    structure: z.array(z.string()).catch([])
  })
  .catch({ structureSource: undefined, structure: [] })

/** Where the draft started, in the owner's words. */
export function startedFrom(value: unknown) {
  const parsed = lineage.parse(value ?? {})
  const outline = parsed.structure.filter((s) => s.trim() !== '')
  const from =
    parsed.structureSource === 'imported_reference'
      ? 'An email you added'
      : parsed.structureSource === 'reference_structure'
        ? 'An Inspiration email'
        : parsed.structureSource
          ? 'A saved layout'
          : 'Scratch'
  return outline.length && from !== 'Scratch'
    ? `${from} (${outline.join(', ')})`
    : from
}

/** The old campaign statuses on the four GROS ones (BRAND.md rule 24). */
export function draftStatus(
  campaign: Parameters<typeof campaignStatusOf>[0],
  now?: Date
): StatusKind | null {
  const status = campaignStatusOf(campaign, now)
  if (!status) return null
  if (status === 'sent' || status === 'scheduled') return 'in_klaviyo'
  if (status === 'with_designer') return 'working'
  if (status === 'draft' || status === 'cancelled') return 'planned'
  return 'needs_you'
}

/** `YYYY-MM-DDTHH:mm` in the store's timezone, or empty when unreadable. */
function localValue(iso: string, timezone: string) {
  try {
    return localDateTime(iso, timezone)
  } catch {
    return ''
  }
}

function when(iso: string, timezone: string) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'Not set'
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 16).replace('T', ' ')
  }
}

export function draftView(input: {
  campaign: Row<'campaigns'>
  content: Row<'campaign_content'> | null
  comments: Pick<Row<'campaign_comments'>, 'id' | 'body'>[]
  audiences: Pick<Row<'audiences'>, 'id' | 'label'>[]
  owner: boolean
  now?: Date
}): DraftView {
  const c = input.campaign
  const live = !c.superseded_by_plan
  const audience = input.audiences.find((a) => a.id === c.audience_id)
  const content = input.content
  const dateApproved = c.calendar_state === 'approved'
  const copyApproved = c.copy_state === 'approved'
  return {
    id: c.id,
    title: c.title,
    goal: c.goal,
    status: draftStatus(c, input.now),
    replaced: !live,
    facts: [
      ['Send time', when(c.planned_at, c.timezone)],
      ['Format', c.channel === 'email_text' ? 'Text email' : 'Designed email'],
      ['Audience', audience?.label ?? 'Not chosen'],
      ['Starts from', startedFrom(c.lineage)]
    ],
    steps: (
      [
        ['Date', 'calendar', c.calendar_state],
        ['Copy', 'copy', c.copy_state],
        ['Design', 'design', c.design_state],
        ['Delivery', 'delivery', c.delivery_state]
      ] as const
    ).map(([label, step, state]) => [label, stepStateWords(step, state)]),
    approveDate:
      input.owner && live && !dateApproved ? c.calendar_revision : null,
    copy: !dateApproved
      ? { kind: 'wait' }
      : !content?.body
        ? {
            kind: 'none',
            write: input.owner && live && !copyApproved ? c.copy_revision : null
          }
        : {
            kind: 'written',
            revision: c.copy_revision,
            subject: content.subject,
            preheader: content.preheader,
            body: content.body,
            cta: content.cta,
            url: content.primary_url,
            options: content.subject_options,
            problems: content.validation_errors,
            approved: copyApproved,
            edit: live && (input.owner || !copyApproved),
            approve: input.owner && live && c.copy_state === 'pending_approval',
            rewrite: input.owner && live && !copyApproved
          },
    details: live
      ? {
          revision: c.calendar_revision,
          title: c.title,
          goal: c.goal,
          channel: c.channel,
          local: localValue(c.planned_at, c.timezone),
          timezone: c.timezone,
          audienceId: c.audience_id ?? '',
          productId: c.product_id ?? '',
          offerId: c.offer_id ?? '',
          notes: c.reference_notes
        }
      : null,
    audiences: input.audiences.map((a) => ({ id: a.id, label: a.label })),
    notes: input.comments.map((n) => ({ id: n.id, body: n.body })),
    owner: input.owner
  }
}
