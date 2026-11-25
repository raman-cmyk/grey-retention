import 'server-only'
import type { Route } from 'next'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { flowHref, klaviyoCampaignHref } from '@/features/klaviyo-detail/hrefs'
import { sourceLine } from '@/features/klaviyo-detail/source'
import { optInWords } from '@/features/klaviyo-detail/words'
import { formatBrandDate, relativeTime, validTimezone } from '@/lib/brand-time'
import type {
  KlaviyoCampaign,
  KlaviyoSnapshot
} from '@/lib/providers/klaviyo-read'
import { audiencesProblem, type AudiencesProblem } from './read-model'

/**
 * A segment's or a list's own page (UI-AUDc), read from the same Klaviyo
 * data as Audiences: its size, its rules or how people join, when Klaviyo
 * made and last changed it, and the campaigns and flows that use it. The
 * facts the old pages showed, in the owner's words (Klaviyo's raw JSON is
 * left in Klaviyo).
 */
export type AudienceDate = {
  /** `Nov 1, 2026` in the brand's timezone. */
  date: string
  /** `3 weeks ago`. */
  ago: string
} | null

/** A campaign or a flow that uses this segment or list. */
export type AudienceUse = {
  key: string
  kind: 'campaign' | 'flow'
  name: string
  /** Joined with a middle dot: Campaign · Sent · Sends to it. */
  details: string[]
  /** Its own page under Results (UI-KLV). */
  href: Route
}

type Common = {
  id: string
  name: string
  people: number
  created: AudienceDate
  updated: AudienceDate
  usedBy: AudienceUse[]
}

export type SegmentDetail = Common & {
  kind: 'segment'
  /** Klaviyo's rules in plain words. */
  rules: string
  starred: boolean
  /** Klaviyo keeps it up to date as people match its rules. */
  active: boolean
}

export type ListDetail = Common & {
  kind: 'list'
  /** How people join: Double opt-in, and what that means. */
  signUp: { label: string; line: string }
}

export type AudienceDetailView<T extends SegmentDetail | ListDetail> =
  | {
      state: 'ready'
      /** Where the numbers come from (sample data today). */
      source: string
      audience: T
    }
  /** Klaviyo has no segment or list with this id. */
  | { state: 'not_found' }
  | AudiencesProblem

const campaignStatus: Record<KlaviyoCampaign['status'], string> = {
  sent: 'Sent',
  scheduled: 'Scheduled',
  draft: 'Draft',
  cancelled: 'Cancelled'
}

function when(value: string, timezone: string, now: Date): AudienceDate {
  const date = formatBrandDate(value, timezone)
  const ago = relativeTime(value, now)
  return date && ago ? { date, ago } : null
}

function campaignsUsing(
  snapshot: KlaviyoSnapshot,
  id: string,
  what: 'segment' | 'list'
): AudienceUse[] {
  return snapshot.campaigns.flatMap((c): AudienceUse[] => {
    const sends = c.included.some((a) => a.id === id)
    const skips = c.excluded.some((a) => a.id === id)
    if (!sends && !skips) return []
    return [
      {
        key: `campaign-${c.id}`,
        kind: 'campaign',
        name: c.name,
        details: [
          'Campaign',
          campaignStatus[c.status],
          sends ? `Sends to this ${what}` : `Leaves this ${what} out`
        ],
        href: klaviyoCampaignHref(c.id)
      }
    ]
  })
}

type Reading = { data: KlaviyoData; timezone: string; now: Date }

/** A segment's page from the Klaviyo data. Pure, for tests. */
export function segmentView(
  { data, timezone, now }: Reading,
  segmentId: string
): AudienceDetailView<SegmentDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const segment = data.snapshot.segments.find((s) => s.id === segmentId)
  if (!segment) return { state: 'not_found' }
  return {
    state: 'ready',
    source: sourceLine(data, now),
    audience: {
      kind: 'segment',
      id: segment.id,
      name: segment.name,
      people: segment.profileCount,
      rules: segment.rules.trim(),
      starred: segment.starred,
      active: segment.active,
      created: when(segment.created, timezone, now),
      updated: when(segment.updated, timezone, now),
      usedBy: campaignsUsing(data.snapshot, segment.id, 'segment')
    }
  }
}

/** A list's page from the Klaviyo data. Pure, for tests. */
export function listView(
  { data, timezone, now }: Reading,
  listId: string
): AudienceDetailView<ListDetail> {
  if (data.state !== 'sample') return audiencesProblem(data, now)
  const list = data.snapshot.lists.find((l) => l.id === listId)
  if (!list) return { state: 'not_found' }
  // Klaviyo names a flow's list by name (the old page matched it the same way).
  const flows = data.snapshot.flows
    .filter((f) => f.trigger.kind === 'list' && f.trigger.name === list.name)
    .map((f): AudienceUse => ({
      key: `flow-${f.id}`,
      kind: 'flow',
      name: f.name,
      details: [
        'Flow',
        ...(f.status === 'live'
          ? ['Live', 'Starts when someone joins']
          : ['Draft', 'Would start when someone joins'])
      ],
      href: flowHref(f.id)
    }))
  return {
    state: 'ready',
    source: sourceLine(data, now),
    audience: {
      kind: 'list',
      id: list.id,
      name: list.name,
      people: list.profileCount,
      signUp: optInWords(list.optIn),
      created: when(list.created, timezone, now),
      updated: when(list.updated, timezone, now),
      usedBy: [...flows, ...campaignsUsing(data.snapshot, list.id, 'list')]
    }
  }
}

const unread: AudiencesProblem = {
  state: 'unavailable',
  reason: 'Klaviyo could not be read just now.',
  retry: true
}

/** Reads the signed-in member's workspace's Klaviyo data, once. */
async function reading(
  context: ClientRequestContext,
  now: Date
): Promise<Reading | null> {
  const timezone = validTimezone(context.timezone)
  try {
    return {
      data: await klaviyoData(context.tenantId, timezone, now.getTime()),
      timezone,
      now
    }
  } catch {
    return null
  }
}

/** A segment's page for the signed-in member's workspace. */
export async function segmentDetail(
  context: ClientRequestContext,
  segmentId: string,
  now = new Date()
): Promise<AudienceDetailView<SegmentDetail>> {
  const read = await reading(context, now)
  return read ? segmentView(read, segmentId) : unread
}

/** A list's page for the signed-in member's workspace. */
export async function listDetail(
  context: ClientRequestContext,
  listId: string,
  now = new Date()
): Promise<AudienceDetailView<ListDetail>> {
  const read = await reading(context, now)
  return read ? listView(read, listId) : unread
}
