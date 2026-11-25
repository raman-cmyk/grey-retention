import { relativeTime } from '@/lib/brand-time'
import type {
  ConnectionState,
  KlaviyoData
} from '@/features/klaviyo-data/reader'

/**
 * Where the Klaviyo pages' numbers come from (Audiences and its segment
 * and list pages, Results and its campaign, flow and metric pages), said
 * the same way everywhere.
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
