import type { StatusKind } from '@/components/gros/status'
import type { EmailStatus } from './sync'

/**
 * PICK-99 (owner pick #99): what the owner did in Klaviyo with a draft GROS
 * put there, in plain words, from what the results sync last read (LRN-001
 * with PICK-99's send time and design check). Pure: the email page, the
 * Plan rows and the Results rows all say it the same way. Times are in the
 * store's time zone.
 */
export type KlaviyoState = {
  status: EmailStatus
  /** Its words, its design or its campaign changed in Klaviyo since the push. */
  edited: boolean
  /** When Klaviyo will send it, while scheduled or sending. */
  scheduledFor: string | null
  /** How (`static`, `local_timezone`…), while scheduled or sending. */
  sendStrategy: string | null
  sentAt: string | null
  /** When the sync last read it (null: not yet). */
  checkedAt: string | null
}

/** "14 Jan, 9:00" in the store's time zone; null for no time. */
export function storeTime(iso: string | null, timeZone: string) {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone
    }).formatToParts(new Date(t))
  } catch {
    return null
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  const hour = String(Number(part('hour') ?? '0'))
  return `${part('day')} ${part('month')}, ${hour}:${part('minute')}`
}

/** When it sends, with how Klaviyo sends it. */
function when(state: KlaviyoState, timeZone: string) {
  const at = storeTime(state.scheduledFor, timeZone)
  if (!at) return ''
  if (state.sendStrategy === 'local_timezone')
    return ` for ${at.split(',')[0]}, at each person’s own local time`
  if (state.sendStrategy && state.sendStrategy !== 'static')
    return ` from ${at} (store time; Klaviyo picks each person’s time)`
  return ` for ${at} (store time)`
}

/** Klaviyo's status of it, in one line. */
export function stateLine(state: KlaviyoState, timeZone: string): string {
  switch (state.status) {
    case 'draft':
      return 'Draft in Klaviyo'
    case 'scheduled':
      return `Scheduled in Klaviyo${when(state, timeZone)}`
    case 'sending':
      return 'Sending from Klaviyo'
    case 'sent': {
      const at = storeTime(state.sentAt, timeZone)
      return at ? `Sent on ${at} (store time)` : 'Sent'
    }
    case 'cancelled':
      return 'Cancelled in Klaviyo'
    case 'deleted':
      return 'Deleted in Klaviyo'
    case 'stale':
      return 'Not sent: its day has passed'
  }
}

/**
 * Its status, then "Edited in Klaviyo" when the owner changed it there
 * (a deleted one says only that it was deleted).
 */
export function stateParts(state: KlaviyoState, timeZone: string): string[] {
  return [
    stateLine(state, timeZone),
    ...(state.edited && state.status !== 'deleted' ? ['Edited in Klaviyo'] : [])
  ]
}

/**
 * What the owner should know about it on the email's page, in a sentence:
 * GROS leaves his changes alone; a deleted or cancelled draft is no send.
 */
export function stateNote(state: KlaviyoState): string | null {
  if (state.status === 'deleted')
    return 'You deleted this draft in Klaviyo, so it will not be sent and it does not count in Results. GROS will not put it back.'
  if (state.status === 'cancelled')
    return 'It was cancelled in Klaviyo, so it was not sent and it does not count in Results.'
  if (state.edited)
    return state.status === 'sent' || state.status === 'sending'
      ? 'You changed it in Klaviyo before it went out: its results are counted as your edited email, not as GROS’s own words.'
      : 'You changed it in Klaviyo. GROS will not replace your changes; what Klaviyo holds is what will be sent.'
  if (state.status === 'scheduled')
    return 'GROS will not change it now that it is scheduled.'
  return null
}

/**
 * BRAND.md's Status for it (only the four), as Results already maps them:
 * a draft, scheduled, sending, sent or cancelled campaign is In Klaviyo
 * (an edited one too: its words say so); a deleted one, or one never sent,
 * has no pill (none of the four is true: its words say it). The design
 * question of a look for those is in docs/PROJECT_TODOS.md (PICK-99).
 */
export function statePill(state: KlaviyoState): StatusKind | null {
  return state.status === 'deleted' || state.status === 'stale'
    ? null
    : 'in_klaviyo'
}
