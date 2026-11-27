import type { Blueprint, Item, Section, TextPart, TextRun } from './blueprint'
import { snapTo, stepsOf, type SiteTokens } from './tokens'

/**
 * PICK-006: a Scratch email's layouts in the brand's rhythm and type scale,
 * before the brand swap. Scratch designs from nothing (it takes layouts,
 * never a whole email), so the brand's own spaces and sizes replace the
 * library blocks' (Copy keeps its email's: rule 8). Only the tokens the
 * brand's site or owner gave are used; a block keeps its own look for the
 * rest. Pure: the result is the blueprint the copy job draws and checks
 * its drawing against, so every height it changes is changed with it.
 *
 * - **Spaces**: the space above each part of a section (its top padding
 *   first) and below its last part, on the brand's scale: the block's own
 *   space in the brand's unit (a 4 px unit is the blocks' own; 2 px draws
 *   them at 0.75, 8 px and more at 1.5), then the nearest step of its
 *   scale. Spaces under 4 px (a line's own) stay. Cards keep their inside.
 * - **Type**: the email's first headline in the brand's headline size,
 *   later ones in its section heading size, subheadlines in its small
 *   heading size, body text in its body size and line height, headings
 *   in its case. A text keeps its lines: its room for words follows its
 *   size (a larger size holds fewer words a line), so the brand's words
 *   are cut to fit, and its height is its lines at the new line height.
 */

const minGap = 4

const textOf = (p: TextPart) => p.runs.map((r) => r.text).join('')

/** A text's words made `share` as long, line by line (blanked words stay blanked). */
function resized(runs: readonly TextRun[], share: number): TextRun[] {
  if (Math.abs(share - 1) < 0.02) return [...runs]
  return runs.map((r) => {
    if (r.tag) return r
    const lines = r.text.split('\n').map((line) => {
      const n = Math.max(1, Math.round(line.length * share))
      if (!line.trim()) return line
      if (n <= line.length) return line.slice(0, n).trimEnd() || line[0]!
      const fill = line.at(-1) === line.at(-1)?.toUpperCase() ? 'X' : 'x'
      return `${line} ${fill.repeat(Math.max(1, n - line.length - 1))}`
    })
    return { ...r, text: lines.join('\n') }
  })
}

type Scale = {
  h1?: number
  h2?: number
  h3?: number
  body?: number
  lineHeight?: number
  headingCase?: 'none' | 'uppercase'
}

/** One text in the brand's scale, and how much taller it became. */
function typed(
  p: TextPart,
  scale: Scale,
  lead: { first: boolean }
): { part: TextPart; delta: number } {
  const heading = p.role === 'headline' || p.role === 'subheadline'
  let size: number | undefined
  if (p.role === 'headline') {
    size = lead.first ? scale.h1 : scale.h2
    lead.first = false
  } else if (p.role === 'subheadline') size = scale.h3
  else if (p.role === 'body') size = scale.body
  const caps =
    heading && scale.headingCase !== undefined ? scale.headingCase : undefined
  if (size === undefined && caps === undefined) return { part: p, delta: 0 }
  const was = p.font
  const f = size === undefined ? 1 : size / was.size
  const lineHeight =
    p.role === 'body' && scale.lineHeight !== undefined && size !== undefined
      ? size * scale.lineHeight
      : was.lineHeight * f
  const transform =
    caps === undefined
      ? was.transform
      : caps === 'uppercase'
        ? 'uppercase'
        : was.transform === 'uppercase'
          ? 'none'
          : was.transform
  // Capitals are wider: about 15 % fewer of them fit a line.
  const wider =
    transform === 'uppercase' &&
    was.transform !== 'uppercase' &&
    textOf(p) !== textOf(p).toUpperCase()
      ? 0.85
      : 1
  const font = {
    ...was,
    size: Math.round((size ?? was.size) * 100) / 100,
    lineHeight: Math.round(lineHeight * 100) / 100,
    transform
  }
  const runs = resized(
    p.runs.map((r) =>
      r.size !== undefined
        ? { ...r, size: Math.max(1, Math.round(r.size * f * 100) / 100) }
        : r
    ),
    wider / f
  )
  const height = Math.round(p.lines * font.lineHeight * 100) / 100
  return {
    part: { ...p, font, runs, height },
    delta: height - p.height
  }
}

type Rhythm = (gap: number) => number

/** Items with the brand's type (and, at the section's own level, its spaces), and their added height. */
function itemsOf(
  items: readonly Item[],
  scale: Scale,
  lead: { first: boolean },
  rhythm: Rhythm | null
): { items: Item[]; delta: number } {
  let delta = 0
  const out = items.map((item): Item => {
    let gapBefore = item.gapBefore
    if (rhythm) {
      gapBefore = rhythm(item.gapBefore)
      delta += gapBefore - item.gapBefore
    }
    if (item.type === 'text') {
      const t = typed(item, scale, lead)
      delta += t.delta
      return { ...t.part, gapBefore }
    }
    if (item.type === 'row') {
      const columns = item.columns.map((c) => {
        const inner = itemsOf(c.items, scale, lead, null)
        return { ...c, items: inner.items, height: c.height + inner.delta }
      })
      const bottom = (cs: readonly { y: number; height: number }[]) =>
        Math.max(0, ...cs.map((c) => c.y + c.height))
      const grow = bottom(columns) - bottom(item.columns)
      delta += grow
      return { ...item, gapBefore, columns, height: item.height + grow }
    }
    return { ...item, gapBefore }
  })
  return { items: out, delta }
}

/** The tokens the type scale takes (those given). */
function scaleOf(given: SiteTokens): Scale {
  return {
    ...(given['type.h1'] !== undefined ? { h1: given['type.h1'] } : {}),
    ...(given['type.h2'] !== undefined ? { h2: given['type.h2'] } : {}),
    ...(given['type.h3'] !== undefined ? { h3: given['type.h3'] } : {}),
    ...(given['type.body'] !== undefined ? { body: given['type.body'] } : {}),
    ...(given['type.lineHeight'] !== undefined
      ? { lineHeight: given['type.lineHeight'] }
      : {}),
    ...(given['type.headingCase'] !== undefined
      ? { headingCase: given['type.headingCase'] }
      : {})
  }
}

/** The brand's spacing as a rule for one space, or null when it gave none. */
export function rhythmOf(given: SiteTokens): Rhythm | null {
  const base = given['spacing.base']
  const steps =
    given['spacing.steps'] ?? (base !== undefined ? stepsOf(base) : null)
  if (!steps?.length) return null
  const unit = base ?? steps[0]!
  const k = Math.min(1.5, Math.max(0.75, 1 + (unit - 4) / 8))
  const top = steps.at(-1)!
  return (gap) => {
    if (gap < minGap) return gap
    const want = gap * k
    return want > top + (top - (steps.at(-2) ?? 0))
      ? Math.round(want)
      : snapTo(want, steps)
  }
}

/** The blueprint with the brand's spaces and type scale (only those given). */
export function withTokens(bp: Blueprint, given: SiteTokens): Blueprint {
  const scale = scaleOf(given)
  const rhythm = rhythmOf(given)
  if (!rhythm && !Object.keys(scale).length) return bp
  const lead = { first: true }
  const sections = bp.sections.map((s): Section => {
    if (s.unsupported || !s.items.length) return s
    const inner = itemsOf(s.items, scale, lead, rhythm)
    const bottom = rhythm ? rhythm(s.bottom) : s.bottom
    return {
      ...s,
      items: inner.items,
      bottom,
      height: Math.max(0, s.height + inner.delta + (bottom - s.bottom))
    }
  })
  return { ...bp, sections }
}
