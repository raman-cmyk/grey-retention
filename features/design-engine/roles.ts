import {
  partsOf,
  textOf,
  type Blueprint,
  type Column,
  type Item,
  type Part,
  type PartRole,
  type Section,
  type SectionKind
} from './blueprint'

/**
 * DES-ENGINE-001: what each part of a measured email is for (logo, product
 * photo, price, main button, …) and what each section is (header, hero,
 * product grid, …), marked by code from where things sit and how they
 * look. No AI: the same email always gets the same marks, so a source and
 * its redraw can be compared section by section.
 */

const price =
  /^(?:(?:from|now|was|only)\s+)?(?:[$€£¥₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥₹]|usd|eur|gbp|aud|cad|kr|zł))(?:\s*[-–/]\s*\S+)?$/i
const legal =
  /unsubscribe|manage (?:your )?preferences|view (?:it )?in (?:your )?browser|privacy policy|©|\(c\)\s*\d{4}|all rights reserved|you (?:are )?receiv/i
const codeWords = /\b(?:code|coupon|promo)\b/i
const codeToken = /^[A-Z0-9][A-Z0-9-]{3,19}$/
const offerWords =
  /\d+\s?%\s?off|% off|\bsale\b|free shipping|\bsave\b|\bdeal\b|\bdiscount\b|\boffer\b/i

type Placed = {
  part: Part
  section: Section
  column: Column | null
  row: Column[] | null
}

/** Every part with the section and the column (and its row) it sits in. */
function placedParts(bp: Blueprint): Placed[] {
  const out: Placed[] = []
  const walk = (
    items: readonly Item[],
    section: Section,
    column: Column | null,
    row: Column[] | null
  ) => {
    for (const item of items)
      if (item.type === 'row')
        for (const c of item.columns) walk(c.items, section, c, item.columns)
      else out.push({ part: item, section, column, row })
  }
  for (const s of bp.sections) walk(s.items, s, null, null)
  return out
}

/** A column of a grid: a picture with words under it (a product card). */
const cardLike = (c: Column) => {
  const parts = partsOf(c.items)
  return (
    parts.some((p) => p.type === 'image') &&
    parts.some((p) => p.type === 'text' || p.type === 'button')
  )
}

/** A row of at least two cards, all about as wide: a product grid. */
function gridRow(row: readonly Column[] | null) {
  if (!row || row.length < 2) return false
  const cards = row.filter(cardLike)
  if (cards.length < 2) return false
  const widths = cards.map((c) => c.width)
  return Math.max(...widths) - Math.min(...widths) <= Math.max(...widths) * 0.15
}

function roleOf(
  p: Placed,
  ctx: {
    width: number
    biggestText: number
    mainButton: Part | null
    last: number
  }
): PartRole {
  const { part, section, column, row } = p
  const index = section.ordinal
  if (part.type === 'divider') return 'divider'
  if (part.type === 'button')
    return part === ctx.mainButton ? 'main_button' : 'secondary_button'
  if (part.type === 'image') {
    if (part.width <= 48 && part.height <= 48) {
      const icons =
        row?.filter((c) =>
          partsOf(c.items).every((x) => x.type === 'image' && x.width <= 48)
        ).length ?? 0
      return icons >= 3 ? 'social' : 'icon'
    }
    if (index <= 2 && part.width <= 320 && part.height <= 150 && !gridRow(row))
      return 'logo'
    if (gridRow(row) && column && cardLike(column)) return 'product_photo'
    if (part.width >= ctx.width * 0.8 && index <= 3) return 'hero_photo'
    return 'photo'
  }
  const words = textOf(part).trim()
  const size = part.font.size
  const allLinks = part.runs.every((r) => r.href || !r.text.trim())
  if (legal.test(words) && index >= ctx.last - 1) return 'legal'
  if (price.test(words.replace(/\s+/g, ' ')))
    return part.runs.every((r) => r.strike || !r.text.trim())
      ? 'old_price'
      : 'price'
  if (
    (codeWords.test(words) &&
      /[A-Z0-9]{4,}/.test(words) &&
      words.length <= 60) ||
    (codeToken.test(words) && part.font.letterSpacing >= 1)
  )
    return 'code'
  if (allLinks && words.length <= 30 && row && row.length >= 3) return 'nav'
  if (size <= 12) return index >= ctx.last - 1 ? 'footer_text' : 'caption'
  if (size >= 22 && size >= ctx.biggestText - 0.5) return 'headline'
  if (size >= 20) return 'subheadline'
  const caps =
    part.font.transform === 'uppercase' ||
    (words === words.toUpperCase() && /[A-Z]/.test(words))
  if (
    caps &&
    words.length <= 40 &&
    size <= 14 &&
    part.font.letterSpacing >= 0.5
  )
    return 'eyebrow'
  if (gridRow(row) && column && cardLike(column)) return 'product_name'
  if (allLinks && words.length <= 40) return 'link'
  return 'body'
}

function kindOf(s: Section, roles: Map<Part, PartRole>): SectionKind {
  const parts = partsOf(s.items)
  if (!parts.length) return 'spacer'
  const has = (r: PartRole) => parts.some((p) => roles.get(p) === r)
  const rows = s.items.filter((i) => i.type === 'row')
  if (has('legal')) return 'footer'
  if (parts.every((p) => p.type === 'divider')) return 'divider'
  if (rows.some((r) => r.type === 'row' && gridRow(r.columns)))
    return 'product_grid'
  if (
    has('social') &&
    parts.every(
      (p) =>
        p.type === 'image' || roles.get(p) === 'nav' || roles.get(p) === 'link'
    )
  )
    return 'social'
  if (has('logo') && s.ordinal <= 2 && !has('headline') && !has('hero_photo'))
    return 'header'
  const words = parts
    .filter((p) => p.type === 'text')
    .map((p) => textOf(p as never))
    .join(' ')
  if (
    has('code') ||
    (offerWords.test(words) &&
      parts.some((p) => p.type === 'button') &&
      !has('hero_photo'))
  )
    return 'offer'
  if (has('hero_photo') || (has('headline') && s.ordinal <= 3)) return 'hero'
  if (rows.some((r) => r.type === 'row' && r.columns.length >= 2))
    return 'columns'
  if (parts.every((p) => p.type === 'button')) return 'button'
  if (parts.every((p) => p.type === 'image')) return 'image'
  if (
    parts.every(
      (p) => p.type === 'text' || p.type === 'button' || p.type === 'divider'
    )
  )
    return 'text'
  return 'mixed'
}

/** Rows of small things (icons, a menu) stay side by side on a phone. */
function markRows(items: Item[], width: number): Item[] {
  return items.map((item) => {
    if (item.type !== 'row') return item
    const columns = item.columns.map((c) => ({
      ...c,
      items: markRows(c.items, c.width)
    }))
    // Small things in a row (icons, a menu), or an icon beside its words.
    const small =
      columns.length >= 2 &&
      (columns.every((c) => c.width <= Math.max(120, width * 0.22)) ||
        columns.filter((c) => c.width > 64).length <= 1)
    return { ...item, columns, keepOnPhone: small }
  })
}

/** The blueprint with every part's role, each section's kind and the phone rows marked. */
export function markRoles(bp: Blueprint): Blueprint {
  const rowsMarked: Blueprint = {
    ...bp,
    sections: bp.sections.map((s) => ({
      ...s,
      items: markRows(s.items, s.width)
    }))
  }
  const placed = placedParts(rowsMarked)
  const texts = placed.flatMap((p) => (p.part.type === 'text' ? [p.part] : []))
  const biggestText = Math.max(0, ...texts.map((t) => t.font.size))
  const buttons = placed.flatMap((p) =>
    p.part.type === 'button' ? [p.part] : []
  )
  const mainButton =
    [...buttons].sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
    null
  const ctx = {
    width: bp.width,
    biggestText,
    mainButton,
    last: bp.sections.length
  }
  const roles = new Map<Part, PartRole>()
  for (const p of placed) roles.set(p.part, roleOf(p, ctx))
  const apply = (items: readonly Item[]): Item[] =>
    items.map((item) =>
      item.type === 'row'
        ? {
            ...item,
            columns: item.columns.map((c) => ({ ...c, items: apply(c.items) }))
          }
        : { ...item, role: roles.get(item) ?? item.role }
    )
  return {
    ...rowsMarked,
    sections: rowsMarked.sections.map((s) => ({
      ...s,
      kind: kindOf(s, roles),
      items: apply(s.items)
    }))
  }
}
