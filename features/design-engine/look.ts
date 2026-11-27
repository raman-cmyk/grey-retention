import type { Blueprint, Item, Part } from './blueprint'
import { sameFamily } from './content'
import { contrast, neededContrast } from './palette'

/**
 * DES-ENGINE-003b, the **look kept** check, for a copy of the brand's own
 * design (an email the owner uploaded as his own): the content changes on
 * purpose (words, products, prices, links, codes), so `keepContent` does
 * not apply, but everything that makes the look must be the original's,
 * measured on the drawn copy:
 * - the colours around and behind the email, every section's and
 *   column's fills and borders;
 * - every text's colour and font (the drawn font list starts with the
 *   original's), every button's face, words' colour, border and font, and
 *   every divider's colour;
 * - every picture that is not a product photo (the logo, icons, the
 *   brand's own pictures): the same picture.
 * Sections built from a library block are left out (their reason is
 * shown). Each problem is one plain sentence after "Section n (kind)".
 */

const lower = (c: string | null | undefined) => (c ?? '').toLowerCase()

/** Every part in order, with the fill behind it. */
function walk(items: readonly Item[], behind: string): [Part, string][] {
  return items.flatMap((item): [Part, string][] =>
    item.type === 'row'
      ? item.columns.flatMap((c) => walk(c.items, c.background ?? behind))
      : [[item, behind]]
  )
}

/** The original's colour, or (where it could not be read) a readable one. */
const keptColour = (a: string, b: string, behind: string, size: number) =>
  lower(a) === lower(b) ||
  (contrast(a, behind) < neededContrast(size) &&
    contrast(b, behind) >= neededContrast(size))

function cols(items: readonly Item[]) {
  const out: { background: string | null; border: string | null }[] = []
  for (const item of items)
    if (item.type === 'row')
      for (const c of item.columns) {
        out.push({
          background: c.background ?? null,
          border: c.border?.color ?? null
        })
        out.push(...cols(c.items))
      }
  return out
}

function partProblems(a: Part, b: Part, behind: string): string | null {
  if (a.type !== b.type) return 'has other parts than the original'
  if (a.type === 'text' && b.type === 'text') {
    if (!keptColour(a.color, b.color, behind, a.font.size))
      return `has words in ${b.color} where the original’s are ${a.color}`
    if (!sameFamily(a.font.family, b.font.family))
      return `has words in ${b.font.family} where the original’s are in ${a.font.family}`
    return null
  }
  if (a.type === 'button' && b.type === 'button') {
    if (lower(a.background) !== lower(b.background))
      return `has a button in ${b.background ?? 'no colour'} where the original’s is ${a.background ?? 'clear'}`
    if (!keptColour(a.color, b.color, a.background ?? behind, a.font.size))
      return `has button words in ${b.color} where the original’s are ${a.color}`
    if (lower(a.border?.color) !== lower(b.border?.color))
      return 'has a button border of another colour'
    if (!sameFamily(a.font.family, b.font.family))
      return `has a button in ${b.font.family} where the original’s is in ${a.font.family}`
    return null
  }
  if (a.type === 'image' && b.type === 'image') {
    if (a.role === 'product_photo') return null
    if ((a.src ?? '') !== (b.src ?? ''))
      return a.role === 'logo'
        ? 'has another logo than the original'
        : 'has another picture than the original'
    return null
  }
  if (a.type === 'divider' && b.type === 'divider')
    return lower(a.color) !== lower(b.color)
      ? 'has a line of another colour'
      : null
  return null
}

export function lookProblems(
  source: Blueprint,
  drawn: Blueprint,
  skip: ReadonlySet<number> = new Set()
): string[] {
  const out: string[] = []
  if (lower(source.page) !== lower(drawn.page))
    out.push(
      `The colour around the email is ${drawn.page}, not ${source.page}.`
    )
  if (lower(source.body) !== lower(drawn.body))
    out.push(`The email’s own colour is ${drawn.body}, not ${source.body}.`)
  for (const s of source.sections) {
    if (skip.has(s.ordinal)) continue
    const d = drawn.sections.find((x) => x.ordinal === s.ordinal)
    const name = `Section ${s.ordinal} (${s.kind})`
    if (!d) {
      out.push(`${name} is missing.`)
      continue
    }
    if (lower(s.background) !== lower(d.background))
      out.push(
        `${name} is ${d.background ?? 'clear'}, not ${s.background ?? 'clear'}.`
      )
    const ca = cols(s.items)
    const cb = cols(d.items)
    if (
      ca.length !== cb.length ||
      ca.some(
        (c, i) =>
          lower(c.background) !== lower(cb[i]!.background) ||
          lower(c.border) !== lower(cb[i]!.border)
      )
    )
      out.push(`${name} has columns of other colours than the original.`)
    const pa = walk(s.items, s.background ?? source.body)
    const pb = walk(d.items, d.background ?? drawn.body)
    if (pa.length !== pb.length) {
      out.push(`${name} has other parts than the original.`)
      continue
    }
    for (let i = 0; i < pa.length; i++) {
      const why = partProblems(pa[i]![0], pb[i]![0], pa[i]![1])
      if (why) {
        out.push(`${name} ${why}.`)
        break
      }
    }
  }
  return out
}
