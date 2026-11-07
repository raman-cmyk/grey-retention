import type { SafePreview } from '@/features/email-generation/safe-preview'

/**
 * The ONE reference library (UIR-022, OWNER_JOURNEYS §18 decision 12): the
 * same tabs, counts, search and cards on the Inspiration page, in New draft
 * and in the editor's design picker.
 */
export const libraryTabs = ['competitors', 'yours', 'best'] as const
export type LibraryTab = (typeof libraryTabs)[number]

export const tabLabel: Record<LibraryTab, string> = {
  competitors: 'Competitors',
  yours: 'Yours',
  best: 'Best picks'
}

/** Email Design (images and layout) or Email Text (mostly words). */
export type ReferenceFormat = 'design' | 'text'

export type LibraryItem = {
  id: string
  tab: LibraryTab
  /** Where a picked item leads: the kind of source it is. */
  source: 'competitor' | 'import' | 'template'
  format: ReferenceFormat
  title: string
  /** The sender's domain for a competitor email, e.g. northwind.example. */
  domain: string | null
  /** Who sent it or where it came from, e.g. "Northwind Outdoor". */
  from: string
  /** ISO date-time it was received or saved. */
  at: string
  /** Server-sanitized markup (links off), or null for plain text. */
  preview: SafePreview | null
  /** Readable text, shown when there is no design and used by search. */
  text: string
  /** Sample (fixture) content, labelled as such. */
  sample: boolean
}

export type ShowFilter = 'all' | ReferenceFormat

/** More than this many words per image makes it a text email. */
const wordsPerImage = 60

/**
 * Email Design or Email Text from the markup itself: an email whose images
 * carry it (few words per image) is a design; one without images is text.
 * The old app tagged image-rich emails TEXT (OWNER_JOURNEYS §9).
 */
export function classifyFormat(
  html: string | null,
  text: string
): ReferenceFormat {
  if (!html) return 'text'
  const images = (html.match(/<img\b/gi) ?? []).length
  const words = text.split(/\s+/).filter(Boolean).length
  if (images === 0) return 'text'
  return words / images <= wordsPerImage ? 'design' : 'text'
}

export type LibraryQuery = {
  tab: LibraryTab
  show: ShowFilter
  /** Free text; matches title, sender, domain and body text. */
  search: string
  /** Competitor domains to keep; empty keeps all. */
  domains: string[]
}

const normal = (value: string) =>
  value.toLocaleLowerCase('en').normalize('NFKD').replace(/\p{M}/gu, '')

/** Items in one tab that match the filters, newest first. */
export function filterLibrary(items: LibraryItem[], query: LibraryQuery) {
  const words = normal(query.search).split(/\s+/).filter(Boolean)
  return items
    .filter((item) => item.tab === query.tab)
    .filter((item) => query.show === 'all' || item.format === query.show)
    .filter(
      (item) =>
        !query.domains.length ||
        (item.domain !== null && query.domains.includes(item.domain))
    )
    .filter((item) => {
      if (!words.length) return true
      const haystack = normal(
        `${item.title} ${item.from} ${item.domain ?? ''} ${item.text}`
      )
      return words.every((word) => haystack.includes(word))
    })
    .sort((a, b) => b.at.localeCompare(a.at))
}

/** How many items each tab holds (the same numbers everywhere). */
export function tabCounts(items: LibraryItem[]) {
  const counts = { competitors: 0, yours: 0, best: 0 } as Record<
    LibraryTab,
    number
  >
  for (const item of items) counts[item.tab] += 1
  return counts
}

/** Cards shown per "Load more" step. */
export const pageSize = 20

/** The latest pasted or uploaded references read (newest first). */
export const latestUploads = 40

/**
 * Where "Use this design" leads from the Inspiration page: a new draft with
 * the reference already chosen (competitor emails and uploads), or the
 * templates page for a saved layout.
 */
export function referenceHref(item: Pick<LibraryItem, 'id' | 'source'>) {
  if (item.source === 'competitor')
    return `/first-draft?reference=${encodeURIComponent(item.id)}`
  if (item.source === 'import')
    return `/first-draft?imported=${encodeURIComponent(item.id)}`
  return '/email-library'
}
