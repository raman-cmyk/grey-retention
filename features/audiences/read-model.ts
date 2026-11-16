import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { sourceLine } from '@/features/klaviyo-detail/source'
import { validTimezone } from '@/lib/brand-time'

/**
 * Audiences (master handoff section 11, basic part): the store's Klaviyo
 * segments and lists with their sizes, each opening its own page. Read
 * through the Klaviyo reader for the signed-in member's workspace (sample
 * data in this version, said plainly). Building a segment from chat text
 * and exposure per customer come later.
 */
export type AudienceRow = {
  id: string
  name: string
  people: number
  /** Segments: the rules in plain words; lists: how people join. */
  detail: string
  /** A starred segment (the owner's own mark in Klaviyo) comes first. */
  starred: boolean
  /** A segment Klaviyo keeps up to date. */
  active: boolean
}

export type AudiencesView =
  | {
      state: 'ready'
      /** Where the numbers come from (sample data today), said once. */
      source: string
      segments: AudienceRow[]
      lists: AudienceRow[]
    }
  /** Klaviyo was never connected, or was disconnected. */
  | { state: 'not_connected' }
  /** The saved key stopped working (expired or refused). */
  | { state: 'reconnect' }
  /** The audiences could not be read: the reason, in the owner's words. */
  | { state: 'unavailable'; reason: string }

const byPeople = (a: AudienceRow, b: AudienceRow) =>
  Number(b.starred) - Number(a.starred) ||
  b.people - a.people ||
  a.name.localeCompare(b.name)

/** Klaviyo's rule text without its closing full stop (it sits in a row). */
const phrase = (text: string) => text.trim().replace(/\.+$/, '')

/** The view from the Klaviyo data. Pure, for tests. */
export function audiencesView(data: KlaviyoData, now: Date): AudiencesView {
  if (data.state === 'not_connected') {
    if (data.reason === 'expired' || data.reason === 'error')
      return { state: 'reconnect' }
    // A connection that could not be checked is not "not connected".
    if (data.reason === 'unknown')
      return { state: 'unavailable', reason: sourceLine(data, now) }
    return { state: 'not_connected' }
  }
  if (data.state !== 'sample')
    return { state: 'unavailable', reason: sourceLine(data, now) }
  const snapshot = data.snapshot
  return {
    state: 'ready',
    source: sourceLine(data, now),
    segments: snapshot.segments
      .map((s) => ({
        id: s.id,
        name: s.name,
        people: s.profileCount,
        detail: phrase(s.rules),
        starred: s.starred,
        active: s.active
      }))
      .sort(byPeople),
    lists: snapshot.lists
      .map((l) => ({
        id: l.id,
        name: l.name,
        people: l.profileCount,
        detail: l.optIn === 'double' ? 'Double opt-in' : 'Single opt-in',
        starred: false,
        active: true
      }))
      .sort(byPeople)
  }
}

/** Audiences for the signed-in member's workspace. */
export async function audiencesReadModel(
  context: ClientRequestContext,
  now = new Date()
): Promise<AudiencesView> {
  const timezone = validTimezone(context.timezone)
  try {
    return audiencesView(
      await klaviyoData(context.tenantId, timezone, now.getTime()),
      now
    )
  } catch {
    return {
      state: 'unavailable',
      reason: 'The audiences could not be read just now.'
    }
  }
}
