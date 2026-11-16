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
      state: 'sample' | 'live'
      source: string
      segments: AudienceRow[]
      lists: AudienceRow[]
    }
  | { state: 'not_connected'; source: string }
  | { state: 'unavailable'; source: string }

const byPeople = (a: AudienceRow, b: AudienceRow) =>
  Number(b.starred) - Number(a.starred) ||
  b.people - a.people ||
  a.name.localeCompare(b.name)

/** The view from the Klaviyo data. Pure, for tests. */
export function audiencesView(data: KlaviyoData, now: Date): AudiencesView {
  const source = sourceLine(data, now)
  if (data.state === 'not_connected') return { state: 'not_connected', source }
  if (data.state !== 'sample') return { state: 'unavailable', source }
  const snapshot = data.snapshot
  return {
    // A snapshot with a sync time came from the store's own account.
    state: snapshot.syncedAt ? 'live' : 'sample',
    source,
    segments: snapshot.segments
      .map((s) => ({
        id: s.id,
        name: s.name,
        people: s.profileCount,
        detail: s.rules,
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
      source: 'The audiences could not be read just now.'
    }
  }
}
