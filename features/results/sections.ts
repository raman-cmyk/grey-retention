import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'

/**
 * The sections of an email we built (BLK-001's coded blocks: each block
 * one or more `<tr data-block="…">` rows, one after another) and the links
 * each holds, so a link click Klaviyo reports can be counted for the
 * section it came from. Two blocks of the same type one after the other
 * read as one section (the rows do not say where one ends).
 */

type Node = T.ChildNode | T.ParentNode
const isElement = (n: Node): n is T.Element => 'tagName' in n
const children = (n: Node): T.ChildNode[] =>
  'childNodes' in n ? n.childNodes : []
const attr = (n: T.Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? null

export type EmailSection = {
  /** Its place in the email, from 0 at the top. */
  index: number
  /** Its block type (`hero_product`, `product_grid`…). */
  block: string
  /** The links it holds, each written one way (`linkKey`). */
  links: string[]
}

/** Sections read per email, at most (a section's place is below 60). */
const maxSections = 60
const blockName = /^[a-z][a-z_]{1,39}$/

/** Parameters Klaviyo adds to a clicked link (tracking, the clicker's own). */
const added = /^(?:utm_|_kx$|_ke$|kl_)/i

/**
 * An address written one way, so the link we wrote and the one Klaviyo
 * recorded (with its tracking parameters added) compare equal: http(s)
 * only, host in small letters, no `utm_*`, Klaviyo or account tracking
 * parameters (`extra`, as the message names them), no fragment, no
 * trailing slash; null for anything else (`mailto:`, a Klaviyo tag such
 * as `{% unsubscribe %}`).
 */
export function linkKey(url: string, extra: string[] = []): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  for (const name of [...u.searchParams.keys()])
    if (added.test(name) || extra.includes(name)) u.searchParams.delete(name)
  u.searchParams.sort()
  u.hash = ''
  const path = u.pathname.replace(/\/+$/, '')
  const query = u.searchParams.toString()
  return `${u.hostname}${path}${query ? `?${query}` : ''}`
}

/** The email's sections, top to bottom, with the links in each. */
export function emailSections(html: string): EmailSection[] {
  const sections: EmailSection[] = []
  const walk = (n: Node, current: EmailSection | null) => {
    let here = current
    if (isElement(n)) {
      const block = n.tagName === 'tr' ? attr(n, 'data-block') : null
      // A block inside a block belongs to the outer one.
      if (block && !current && blockName.test(block)) {
        const last = sections[sections.length - 1]
        // The next row of the same block, or a new section.
        if (last?.block === block) here = last
        else if (sections.length < maxSections) {
          here = { index: sections.length, block, links: [] }
          sections.push(here)
        }
      }
      if (n.tagName === 'a' && here) {
        const key = linkKey(attr(n, 'href') ?? '')
        if (key && !here.links.includes(key)) here.links.push(key)
      }
    }
    for (const c of children(n)) walk(c, here)
  }
  walk(parse(html.slice(0, 300_000)), null)
  return sections
}

/**
 * A clicked address as it is kept: never with the parameters that name
 * the person who clicked (Klaviyo's `_kx`, `_ke`); null for one that is
 * not an http(s) address of at most 2,000 characters.
 */
export function keptUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  for (const name of [...u.searchParams.keys()])
    if (/^_k[xe]$/i.test(name)) u.searchParams.delete(name)
  const kept = u.toString()
  return kept.length <= 2_000 ? kept : null
}

/**
 * The section a clicked address came from: the one section that holds it;
 * none when no section does (Klaviyo's own links) or several do (the same
 * product linked twice: the click cannot be told apart).
 */
export function sectionOf(
  sections: EmailSection[],
  url: string,
  extra: string[] = []
): { section: number; block: string } | null {
  const key = linkKey(url, extra)
  if (!key) return null
  const holding = sections.filter((s) => s.links.includes(key))
  return holding.length === 1
    ? { section: holding[0]!.index, block: holding[0]!.block }
    : null
}
