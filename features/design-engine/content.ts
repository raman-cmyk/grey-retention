import type {
  Blueprint,
  Column,
  FontSpec,
  Item,
  Section,
  TextRun
} from './blueprint'

/**
 * DES-ENGINE-001, the **content unchanged** check: for a copy meant to keep
 * the source's content (step 1's golden test; an upload of the brand's own
 * design keeps its look too), every part must say and show exactly what
 * the original does, besides being the same size: the same words and line
 * breaks with the same bold, italic, colour, size, underline and links;
 * the same picture address, alt text and link; the same button words,
 * link and colours; the same fills, borders and fonts (the drawn font list
 * starts with the original's, safe fonts added after it). So a dropped
 * link or a wrong colour fails even where every size is right.
 *
 * Step 2 (a library email in the brand's own look) swaps the content on
 * purpose, so it does not use this check.
 */

const sameRuns = (a: readonly TextRun[], b: readonly TextRun[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i]!
    return (
      x.text === y.text &&
      x.weight === y.weight &&
      x.italic === y.italic &&
      x.color === y.color &&
      (x.size === undefined) === (y.size === undefined) &&
      (x.size === undefined || Math.abs(x.size - y.size!) <= 0.5) &&
      !!x.underline === !!y.underline &&
      !!x.strike === !!y.strike &&
      x.href === y.href
    )
  })

const names = (family: string) =>
  family
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean)

/** The drawn font list starts with the original's (safe fonts may follow). */
export const sameFamily = (source: string, drawn: string) => {
  const a = names(source)
  const b = names(drawn)
  return a.length <= b.length && a.every((n, i) => b[i] === n)
}

function fontProblems(a: FontSpec, b: FontSpec, what: string) {
  const out: string[] = []
  if (!sameFamily(a.family, b.family))
    out.push(
      `${what} is in ${b.family || 'no font'} where the original is in ${a.family || 'no font'}.`
    )
  if (a.weight !== b.weight)
    out.push(
      `${what} has weight ${b.weight} where the original has ${a.weight}.`
    )
  if (a.italic !== b.italic)
    out.push(
      `${what} is ${b.italic ? '' : 'not '}italic where the original is${a.italic ? '' : ' not'}.`
    )
  if (a.transform !== b.transform)
    out.push(
      `${what} is written ${b.transform} where the original is ${a.transform}.`
    )
  if (Math.abs(a.letterSpacing - b.letterSpacing) > 0.1)
    out.push(`${what} has different letter spacing from the original.`)
  return out
}

function fillProblems(a: Column, b: Column, where: string) {
  const out: string[] = []
  if (a.background !== b.background)
    out.push(
      `${where} is filled ${b.background ?? 'with nothing'} where the original is ${a.background ?? 'not filled'}.`
    )
  const ba = a.border ? `${a.border.width}px ${a.border.color}` : 'none'
  const bb = b.border ? `${b.border.width}px ${b.border.color}` : 'none'
  if (ba !== bb)
    out.push(`${where} has border ${bb} where the original has ${ba}.`)
  if (Math.abs(a.radius - b.radius) > 0.5)
    out.push(
      `${where} has ${b.radius} px corners where the original has ${a.radius} px.`
    )
  return out
}

function itemProblems(
  a: readonly Item[],
  b: readonly Item[],
  where: string,
  out: string[]
) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!
    const y = b[i]!
    const what = `${where}, part ${i + 1}`
    if (x.type === 'row' && y.type === 'row') {
      x.columns.forEach((c, k) => {
        const d = y.columns[k]
        if (!d) return
        const col = `${where}, column ${k + 1}`
        out.push(...fillProblems(c, d, col))
        itemProblems(c.items, d.items, col, out)
      })
      continue
    }
    if (x.type === 'text' && y.type === 'text') {
      if (!sameRuns(x.runs, y.runs))
        out.push(
          `${what}: its words, links or their look differ from the original.`
        )
      if (x.color !== y.color)
        out.push(
          `${what}: its words are ${y.color} where the original's are ${x.color}.`
        )
      if (x.align !== y.align)
        out.push(
          `${what}: its words are aligned ${y.align} where the original's are ${x.align}.`
        )
      out.push(...fontProblems(x.font, y.font, `${what}: the text`))
      continue
    }
    if (x.type === 'image' && y.type === 'image') {
      if (x.src !== y.src) out.push(`${what}: the picture is a different one.`)
      if (x.alt !== y.alt) out.push(`${what}: the picture's alt text differs.`)
      if (x.href !== y.href)
        out.push(`${what}: the picture links somewhere else.`)
      continue
    }
    if (x.type === 'button' && y.type === 'button') {
      if (x.label !== y.label)
        out.push(
          `${what}: the button says "${y.label}" where the original says "${x.label}".`
        )
      if (x.href !== y.href)
        out.push(`${what}: the button links somewhere else.`)
      if (x.color !== y.color || x.background !== y.background)
        out.push(`${what}: the button's colours differ from the original.`)
      const ba = x.border ? `${x.border.width}px ${x.border.color}` : 'none'
      const bb = y.border ? `${y.border.width}px ${y.border.color}` : 'none'
      if (ba !== bb)
        out.push(`${what}: the button's border differs from the original.`)
      out.push(...fontProblems(x.font, y.font, `${what}: the button`))
      continue
    }
    if (x.type === 'divider' && y.type === 'divider' && x.color !== y.color)
      out.push(
        `${what}: the divider is ${y.color} where the original is ${x.color}.`
      )
  }
}

/** One section's content against the same section of the redraw. */
export function contentProblems(a: Section, b: Section): string[] {
  const out: string[] = []
  if (a.background !== b.background)
    out.push(
      `It is filled ${b.background ?? 'with nothing'} where the original is ${a.background ?? 'not filled'}.`
    )
  if (a.around !== b.around)
    out.push(
      `The colour around it is ${b.around} where the original's is ${a.around}.`
    )
  itemProblems(a.items, b.items, 'In it', out)
  return out
}

/** Every section's content problems, by ordinal (sections in `skip` left out). */
export function compareContent(
  source: Blueprint,
  drawn: Blueprint,
  skip: ReadonlySet<number> = new Set()
): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const s of source.sections) {
    if (skip.has(s.ordinal)) continue
    const d = drawn.sections.find((x) => x.ordinal === s.ordinal)
    if (!d) continue
    const list = contentProblems(s, d)
    if (list.length) out.set(s.ordinal, list)
  }
  if (source.page !== drawn.page || source.body !== drawn.body)
    out.set(0, ['The colours around the email differ from the original.'])
  return out
}
