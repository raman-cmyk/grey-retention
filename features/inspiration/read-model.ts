import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import {
  trackedSummaries,
  type TrackedSummary
} from '@/features/inbox/brand-summary'
import { observerEnabled } from '@/features/inbox/observer-sheet'
import {
  domainShape,
  isSampleDomain
} from '@/features/library/inspirations/domain'
import {
  domainLimit,
  referenceLibrary,
  type ReferenceLibraryData
} from '@/features/library/reference-library/data'
import type {
  LibraryItem,
  ShowFilter
} from '@/features/library/reference-library/model'
import {
  readCompetitorSuggestions,
  type CompetitorSuggestion
} from '@/features/onboarding/suggested-competitors'
import { industryName } from '@/features/intelligence/taxonomy'
import { validTimezone } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { nicheEmails } from './niche-read'

/**
 * The latest emails shown, newest first: as many as the library reads of
 * the store's own uploads, so one followed brand's newsletters never crowd
 * out another's in a busy week (a "show more" comes with the polish).
 */
export const latestEmails = 40

export type InspirationSuggestion = CompetitorSuggestion & {
  /** This workspace can follow it now (a sample brand, or with Observer on). */
  followable: boolean
}

/**
 * Which emails the page lists (GROS-INS-002), kept in the address so a
 * link or Back shows the same list: the brands the workspace follows or
 * the brands of its niche, Email Design or Email Text or both, and one
 * brand or all.
 */
export type InspirationSource = 'competitors' | 'niche'
export type InspirationSelection = {
  source: InspirationSource
  show: ShowFilter
  /** A brand's website, or null for every brand. */
  brand: string | null
}
export const allEmails: InspirationSelection = {
  source: 'competitors',
  show: 'all',
  brand: null
}

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? ''

/** The selection from the page's address; anything unknown is "all". Pure. */
export function selectionOf(params: {
  source?: string | string[]
  show?: string | string[]
  brand?: string | string[]
}): InspirationSelection {
  const source = one(params.source)
  const show = one(params.show)
  const brand = one(params.brand)
  return {
    source: source === 'niche' ? 'niche' : 'competitors',
    show: show === 'design' || show === 'text' ? show : 'all',
    brand: brand.length <= 200 && domainShape.test(brand) ? brand : null
  }
}

/** A brand in the brand filter, with how many listed emails it has. */
export type InspirationBrand = { domain: string; name: string; emails: number }

/**
 * Inspiration (master handoff section 11): the brands the workspace
 * follows, brands like the store it could follow or hide (REAL-01a), and
 * the emails to build from: those of the brands it follows, or of its
 * niche (GROS-INS-002). The library and the store's own rows are read
 * with the member's own client; only the inbox's brand list and the
 * niche's emails are read with the server's client, after the member's
 * own profile read (`readCompetitorSuggestions`), and never reach the
 * browser beyond a brand's name, website and reason, an email's preview
 * and subject (and, on the owner's page, the id its Hide sends back, which
 * the database checks again). Each part that cannot be read is marked; the
 * others still show.
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
  selection: InspirationSelection
  /** The store's industry in words when known: Supplements. */
  niche: string | null
  /** The brands of the chosen source that have emails, for the brand filter. */
  brands: InspirationBrand[]
  /** The chosen source's emails after the filters, newest first. */
  emails: LibraryItem[]
  /** Websites the workspace follows: their emails can be used as designs. */
  followed: string[]
  unread: ('library' | 'suggestions' | 'niche')[]
}

export type InspirationInput = {
  context: Pick<ClientRequestContext, 'tenantRole' | 'timezone'>
  library: ReferenceLibraryData | null
  suggestions: CompetitorSuggestion[] | null
  /** The niche's emails; null when they could not be read. */
  niche?: LibraryItem[] | null
  selection?: InspirationSelection
  /** Real brands can be followed (the Observer source is on). */
  observer?: boolean
  now?: number
}

/** The view from its parts. Pure, for tests. */
export function inspirationView(input: InspirationInput): InspirationView {
  const { library } = input
  const selection = input.selection ?? allEmails
  const unread: InspirationView['unread'] = []
  if (!library) unread.push('library')
  if (!input.suggestions) unread.push('suggestions')
  if (selection.source === 'niche' && input.niche === null) unread.push('niche')
  const tracked = library?.tracked ?? []
  const followed = new Set(tracked.map((t) => t.domain))
  const source =
    selection.source === 'niche'
      ? (input.niche ?? [])
      : (library?.items ?? []).filter((i) => i.source !== 'template')
  const shown = source.filter(
    (i) => selection.show === 'all' || i.format === selection.show
  )
  const perBrand = new Map<string, InspirationBrand>()
  for (const item of shown)
    if (item.domain) {
      const brand = perBrand.get(item.domain) ?? {
        domain: item.domain,
        name: item.from || item.domain,
        emails: 0
      }
      brand.emails++
      perBrand.set(item.domain, brand)
    }
  const industry = input.suggestions?.[0]?.industry
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
      .map((s) => ({
        ...s,
        followable: isSampleDomain(s.domain) || !!input.observer
      })),
    selection,
    niche: industry ? industryName(industry) : null,
    brands: [...perBrand.values()].sort((a, b) => a.name.localeCompare(b.name)),
    emails: shown
      .filter((i) => !selection.brand || i.domain === selection.brand)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, latestEmails),
    followed: [...followed],
    unread
  }
}

/** Inspiration for the signed-in member's workspace. */
export async function inspirationReadModel(
  context: ClientRequestContext,
  selection: InspirationSelection = allEmails
): Promise<InspirationView> {
  const service = createServiceClient()
  const [library, suggestions] = await Promise.all([
    referenceLibrary(context.tenantId).catch(() => null),
    (async () => {
      const db = await createClient()
      if (!db || !service) return null
      return readCompetitorSuggestions(db, context.tenantId, { service })
    })().catch(() => null)
  ])
  // The niche's emails are read only when its list is asked for; its
  // brands are the workspace's own suggestions, so none without them.
  const niche =
    selection.source !== 'niche'
      ? []
      : !suggestions || !service
        ? null
        : await nicheEmails(
            service,
            suggestions.map((s) => ({
              captureId: s.captureId,
              domain: s.domain,
              name: s.name
            }))
          ).catch(() => null)
  return inspirationView({
    context,
    library,
    suggestions,
    niche,
    selection,
    observer: observerEnabled()
  })
}
