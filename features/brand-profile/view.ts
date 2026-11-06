import {
  factFields,
  hasFacts,
  hasSampleText,
  sectionKeys,
  type BrandFacts,
  type SectionContent,
  type SectionKey
} from './sections'

export type SectionRow = {
  section: SectionKey
  content: SectionContent
  locked: string[]
  revision: number
  updatedAt: string
}
export type SavedBrand = {
  brand_name: string
  domain: string
  positioning: string
  voice: string
  prohibitions: string
  revision: number
} | null

/** What one card shows: its own notes plus, on Identity and Tone, the facts. */
export type SectionView = {
  section: SectionKey
  content: SectionContent
  /** Brand facts read from brand_profiles (what the AI reads); null if none. */
  facts: BrandFacts | null
  locked: string[]
  revision: number
  /** brand_profiles revision the facts were read at (0 = no brand yet). */
  brandRevision: number
  updated: string | null
  /** Some text still comes from the sample writer. */
  sample: boolean
}

/** "today", "yesterday", "96 days ago". */
export function updatedAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000))
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    -days,
    'day'
  )
}

/**
 * One view per section. Brand facts always come from the saved brand (never
 * from a copy), so the cards show exactly what the AI reads, even after the
 * brand was edited on another page.
 */
export function profileViews(
  brand: SavedBrand,
  rows: SectionRow[],
  now = Date.now()
): SectionView[] {
  return sectionKeys.map((key) => {
    const row = rows.find((r) => r.section === key)
    const content = row?.content ?? {}
    const facts = hasFacts(key)
      ? Object.fromEntries(
          factFields(key).map((f) => [f.fact!, brand?.[f.fact!] ?? ''])
        )
      : null
    return {
      section: key,
      content,
      facts,
      locked: row?.locked ?? [],
      revision: row?.revision ?? 0,
      brandRevision: brand?.revision ?? 0,
      updated: updatedAgo(row?.updatedAt, now),
      sample: hasSampleText(content)
    }
  })
}

/** Newest section change, for "Last updated …". */
export function lastUpdated(rows: SectionRow[], now = Date.now()) {
  return updatedAgo(
    rows
      .map((r) => r.updatedAt)
      .sort()
      .at(-1),
    now
  )
}
