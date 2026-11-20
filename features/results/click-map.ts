import { showsRecorded, type Shown } from '@/features/klaviyo-push/fingerprints'
import { designHash, withImages } from '@/features/klaviyo-push/html'
import { emailSections, type EmailSection } from './sections'

/**
 * Which HTML a variation's clicks are counted with (LRN-001b): always that
 * variation's own, never another design's. Our own HTML while its template
 * shows what PSH-001 put there; the template as it is now once it was
 * changed in Klaviyo (or when we have none of ours for it); else none, and
 * its clicks keep their counts with no section.
 */

export type ClickMap = {
  variation: string
  design: 'A' | 'B' | null
  /** Null: unknown (its clicks are kept without a section). */
  sections: EmailSection[] | null
  /** `build`: our own HTML; `klaviyo`: its template as read now. */
  from: 'build' | 'klaviyo' | null
  /** Its template was changed in Klaviyo since the push. */
  changed: boolean
}

type PushTemplate = {
  variation?: unknown
  hash?: unknown
  deleted?: unknown
}

/**
 * Our own HTML of each variation PSH-001 put one of our templates on: the
 * build's design whose fingerprint is that template's (each picture at
 * its Klaviyo address, with the text of a text email). A variation whose
 * template matches none of the build's designs has none.
 */
export function ownHtml(
  templates: PushTemplate[],
  designs: (string | null | undefined)[],
  images: Record<string, string>,
  text: string | null
): Map<string, string> {
  const hashes = new Map<string, string>()
  for (const d of designs) {
    if (typeof d !== 'string' || !d) continue
    const sent = withImages(d, images)
    hashes.set(designHash(sent), d)
    if (text !== null) hashes.set(designHash(sent, text), d)
  }
  const own = new Map<string, string>()
  for (const t of templates) {
    if (t.deleted === true || typeof t.variation !== 'string') continue
    const html = typeof t.hash === 'string' ? hashes.get(t.hash) : undefined
    if (html !== undefined) own.set(t.variation, html)
  }
  return own
}

/** A map's sections, or none when the HTML holds no block we can read. */
const sectionsOf = (html: string | null) => {
  const sections = html === null ? [] : emailSections(html)
  return sections.length ? sections : null
}

/**
 * One variation's map. Changed in Klaviyo: another template on it than
 * PSH-001 left (and not while PSH-001 was putting one on), or other HTML
 * in the same one, or seen changed at an earlier read (it stays so).
 */
export function variationMap(input: {
  variation: { id: string; templateId: string | null }
  design: 'A' | 'B' | null
  /** Our own HTML of this variation, when known (`ownHtml`). */
  own: string | undefined
  /** What PSH-001 recorded it showing (`shownOf`). */
  shown: Shown[string] | undefined
  /** Its template as read now; null when it could not be read. */
  read: { html: string; text: string | null } | null
  /** Seen changed at an earlier read. */
  before: boolean
}): ClickMap {
  const { variation, shown, read, own } = input
  const changed =
    input.before ||
    (!!shown &&
      (variation.templateId === shown.template
        ? !!read && !showsRecorded(read, shown.html)
        : !shown.writing))
  const html = changed ? (read?.html ?? null) : (own ?? read?.html ?? null)
  const sections = sectionsOf(html)
  return {
    variation: variation.id,
    design: input.design,
    sections,
    from: !sections
      ? null
      : !changed && own !== undefined
        ? 'build'
        : 'klaviyo',
    changed
  }
}

/** Variations an earlier read saw changed (`context.sections`). */
export function changedBefore(context: unknown): Set<string> {
  const entries = (context as { sections?: unknown } | null)?.sections
  return new Set(
    (Array.isArray(entries) ? entries : []).flatMap((s) =>
      s && typeof s === 'object' && (s as { changed?: unknown }).changed
        ? [String((s as { variation?: unknown }).variation)]
        : []
    )
  )
}
