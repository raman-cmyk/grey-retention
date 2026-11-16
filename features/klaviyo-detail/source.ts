import type { Route } from 'next'
import type { KlaviyoCampaign } from '@/lib/providers/klaviyo-read'
import type { PillTone } from '@/lib/campaign-status'
import { relativeTime } from '@/lib/brand-time'
import type {
  ConnectionState,
  KlaviyoData
} from '@/features/klaviyo-data/reader'

/**
 * What the Klaviyo detail pages (lists, segments, flows, metrics, Klaviyo
 * campaigns) kept from the retired dashboard (UI-HOMEb): where their
 * numbers come from, a campaign's status look, and the way back, which is
 * Home until Audiences and Results take these pages.
 */
const notConnectedWords: Record<ConnectionState, string> = {
  connected: 'Klaviyo is connected.',
  disconnected: 'Klaviyo is disconnected.',
  expired: 'The Klaviyo connection has expired.',
  error: 'The Klaviyo connection has an error.',
  missing: 'Klaviyo is not connected yet.',
  unknown: "We couldn't check the Klaviyo connection."
}

/** Where the numbers come from, said plainly (no invented sync times). */
export function sourceLine(data: KlaviyoData, now: Date) {
  if (data.state === 'unavailable')
    return "Klaviyo numbers aren't available in this version yet."
  if (data.state === 'not_connected') return notConnectedWords[data.reason]
  return data.snapshot.syncedAt
    ? `Last synced ${relativeTime(data.snapshot.syncedAt, now)}.`
    : 'Sample Klaviyo data: made up for this preview, not synced from a real account.'
}

export const campaignTone: Record<KlaviyoCampaign['status'], PillTone> = {
  sent: 'solid',
  scheduled: 'info',
  draft: 'warning',
  cancelled: 'danger'
}

const homeHref: Route = '/home'

/** The way back from a detail page: Home. */
export const backHome = { href: homeHref, label: 'Back to Home' } as const

const audiencesHref: Route = '/audiences'

/** The way back from a segment's or a list's page: Audiences (UI-AUDa). */
export const backToAudiences = {
  href: audiencesHref,
  label: 'Back to Audiences'
} as const
