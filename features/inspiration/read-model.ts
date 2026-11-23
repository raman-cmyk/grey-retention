import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import {
  trackedSummaries,
  type TrackedSummary
} from '@/features/inbox/brand-summary'
import { isSampleDomain } from '@/features/library/inspirations/domain'
import {
  domainLimit,
  referenceLibrary,
  type ReferenceLibraryData
} from '@/features/library/reference-library/data'
import type { LibraryItem } from '@/features/library/reference-library/model'
import {
  readCompetitorSuggestions,
  type CompetitorSuggestion
} from '@/features/onboarding/suggested-competitors'
import { validTimezone } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * The latest emails shown, newest first: as many as the library reads of
 * the store's own uploads, so one followed brand's newsletters never crowd
 * out another's in a busy week (a "show more" comes with the polish).
 */
export const latestEmails = 40

export type InspirationSuggestion = CompetitorSuggestion & {
  /** A sample brand: this workspace can follow it now. */
  followable: boolean
}

/**
 * Inspiration (master handoff section 11): the brands the workspace
 * follows, brands like the store it could follow or hide (REAL-01a), and
 * the latest emails to build from. The library and the store's own rows
 * are read with the member's own client; only the inbox's brand list is
 * read with the server's client, after the member's own profile read
 * (`readCompetitorSuggestions`), and never reaches the browser beyond a
 * brand's name, website and reason (and, on the owner's page, the id its
 * Hide sends back, which the database checks again). Each part that cannot be read is
 * marked; the others still show.
 */
export type InspirationView = {
  owner: boolean
  tracked: ReferenceLibraryData['tracked']
  /** The most brands a workspace follows at a time. */
  limit: number
  /** How many more brands it may follow. */
  slotsLeft: number
  summaries: Record<string, TrackedSummary['summary']>
  suggestions: InspirationSuggestion[]
  /** The newest emails first, competitors' and the store's own imports. */
  emails: LibraryItem[]
  unread: ('library' | 'suggestions')[]
}

export type InspirationInput = {
  context: Pick<ClientRequestContext, 'tenantRole' | 'timezone'>
  library: ReferenceLibraryData | null
  suggestions: CompetitorSuggestion[] | null
  now?: number
}

/** The view from its parts. Pure, for tests. */
export function inspirationView(input: InspirationInput): InspirationView {
  const { library } = input
  const unread: InspirationView['unread'] = []
  if (!library) unread.push('library')
  if (!input.suggestions) unread.push('suggestions')
  const tracked = library?.tracked ?? []
  const followed = new Set(tracked.map((t) => t.domain))
  return {
    owner: input.context.tenantRole === 'owner',
    tracked,
    limit: domainLimit,
    // Unknown while the followed brands are unread: no Follow is offered.
    slotsLeft: library ? Math.max(0, domainLimit - tracked.length) : 0,
    summaries: Object.fromEntries(
      library
        ? trackedSummaries(library.tracked, library.factsByDomain, {
            // A timezone that is not one must not fail the whole page.
            timezone: validTimezone(input.context.timezone),
            now: input.now
          }).map((s) => [s.domain, s.summary])
        : []
    ),
    suggestions: (input.suggestions ?? [])
      .filter((s) => !followed.has(s.domain))
      .map((s) => ({ ...s, followable: isSampleDomain(s.domain) })),
    emails: (library?.items ?? [])
      .filter((i) => i.source !== 'template')
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, latestEmails),
    unread
  }
}

/** Inspiration for the signed-in member's workspace. */
export async function inspirationReadModel(
  context: ClientRequestContext
): Promise<InspirationView> {
  const [library, suggestions] = await Promise.all([
    referenceLibrary(context.tenantId).catch(() => null),
    (async () => {
      const db = await createClient()
      const service = createServiceClient()
      if (!db || !service) return null
      return readCompetitorSuggestions(db, context.tenantId, { service })
    })().catch(() => null)
  ])
  return inspirationView({ context, library, suggestions })
}
