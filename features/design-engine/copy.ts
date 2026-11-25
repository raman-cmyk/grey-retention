import type { Browser } from '@playwright/test'
import type { BlockBrand } from '@/features/blocks/brand'
import { GMAIL_CLIP_BYTES } from '@/features/blocks/render'
import type { Blueprint, Column, Item, Section } from './blueprint'
import {
  desktopWindow,
  measureHtml,
  phoneWindow,
  type BrowserOptions
} from './browser'
import { brandFromBlueprint, fallbackFor, type Fallback } from './fallback'
import {
  compareBlueprints,
  phoneProblems,
  sectionName,
  type Likeness
} from './likeness'
import { blueprintFrom } from './measure'
import { roleContextOf, type RoleContext } from './roles'
import { DrawError, drawBlueprint, sentBytes, type DrawMode } from './render'

/**
 * DES-ENGINE-001, the engine's loop: measure an HTML email, draw it back
 * from its blueprint, measure the redraw in the same browser and compare
 * them (`compareBlueprints`). A section that fails is drawn again up to
 * two more times, each time corrected by what the last measurement showed
 * (a gap a pixel short, a line height a little off); one that still fails
 * is built from the closest library block, and the result says which
 * section and why. A section that cannot be copied at all (a countdown
 * timer, a moving picture) goes to the library block at once. Code only:
 * no paid AI measures or draws.
 *
 * Step 1 draws the email back unchanged (the golden test). The later
 * steps take the same blueprint and swap its words, photos, colours and
 * fonts for the brand's own before drawing.
 */

export const maxRetries = 2

export type SectionOutcome = {
  ordinal: number
  kind: Section['kind']
  /** copied: drawn from the blueprint and alike; library: built from a block; left_out: nothing to draw. */
  result: 'copied' | 'library' | 'left_out'
  /** How many times it was drawn from the blueprint (1 to 3; 0 when it could not be copied). */
  tries: number
  /** What still differed (empty when copied). */
  problems: string[]
  /** For a library block: which and why, in plain words. */
  fallback: Pick<Fallback, 'block' | 'blockName' | 'reason'> | null
}

export type CopyResult =
  | {
      ok: true
      html: string
      /** The source's blueprint. */
      source: Blueprint
      /** The final redraw, measured. */
      drawn: Blueprint
      /** The final redraw against the source, sections built from a block left out. */
      likeness: Likeness
      sections: SectionOutcome[]
      /** Every section copied and alike, nothing built from a block. */
      pass: boolean
      /** Size as Gmail counts it (pictures as links). */
      bytes: number
      problems: string[]
      /** The redraw measured again after each correction (1 to 3 drawings). */
      drawings: number
    }
  | { ok: false; error: string }

export type CopyOptions = BrowserOptions & {
  mode?: DrawMode
  /** The brand a library block is drawn in; read from the email itself when absent. */
  brand?: BlockBrand
  retries?: number
}

/** The same shape: the same kinds of parts in the same places of the tree. */
function sameShape(a: readonly Item[], b: readonly Item[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]!
    if (x.type !== y.type) return false
    if (x.type === 'row' && y.type === 'row')
      return (
        x.columns.length === y.columns.length &&
        x.columns.every((c, k) => sameShape(c.items, y.columns[k]!.items))
      )
    return true
  })
}

const fix = (plan: number, target: number, drawn: number) =>
  Math.max(-2_000, plan + (target - drawn))
const fixSize = (plan: number, target: number, drawn: number) =>
  Math.max(0, plan + (target - drawn))

/**
 * The plan corrected by what the redraw measured: each gap, place and
 * size moved by the difference between the source and the redraw; a text
 * that broke onto more lines gets a pixel or two more room, one whose
 * lines are a little taller or shorter gets its line height scaled.
 */
function correctItems(
  plan: Item[],
  target: readonly Item[],
  drawn: readonly Item[]
): Item[] {
  return plan.map((p, i) => {
    const t = target[i]!
    const d = drawn[i]!
    const gapBefore = fix(p.gapBefore, t.gapBefore, d.gapBefore)
    if (p.type === 'row' && t.type === 'row' && d.type === 'row') {
      const columns: Column[] = p.columns.map((c, k) => {
        const tc = t.columns[k]!
        const dc = d.columns[k]!
        return {
          ...c,
          x: fix(c.x, tc.x, dc.x),
          y: Math.max(0, fix(c.y, tc.y, dc.y)),
          width: fixSize(c.width, tc.width, dc.width),
          bottom: fix(c.bottom, tc.bottom, dc.bottom),
          items: correctItems(c.items, tc.items, dc.items)
        }
      })
      return { ...p, gapBefore, columns }
    }
    if (p.type === 'text' && t.type === 'text' && d.type === 'text') {
      if (d.lines > t.lines) return { ...p, gapBefore, width: p.width + 2 }
      if (
        d.lines === t.lines &&
        d.height > 0 &&
        Math.abs(t.height - d.height) > 0.5
      )
        return {
          ...p,
          gapBefore,
          font: {
            ...p.font,
            lineHeight: Math.max(
              1,
              Math.round(p.font.lineHeight * (t.height / d.height) * 100) / 100
            )
          }
        }
      return { ...p, gapBefore, x: fix(p.x, t.x, d.x) }
    }
    if (p.type === 'row' || t.type === 'row' || d.type === 'row') return p
    return {
      ...p,
      gapBefore,
      x: fix(p.x, t.x, d.x),
      width: fixSize(p.width, t.width, d.width),
      height: fixSize(p.height, t.height, d.height)
    }
  })
}

function correct(
  plan: Blueprint,
  target: Blueprint,
  drawn: Blueprint,
  ordinals: ReadonlySet<number>
) {
  let changed = false
  const sections = plan.sections.map((s) => {
    if (!ordinals.has(s.ordinal)) return s
    const t = target.sections.find((x) => x.ordinal === s.ordinal)
    const d = drawn.sections.find((x) => x.ordinal === s.ordinal)
    if (!t || !d || !sameShape(t.items, d.items)) return s
    changed = true
    return {
      ...s,
      bottom: fix(s.bottom, t.bottom, d.bottom),
      items: correctItems(s.items, t.items, d.items)
    }
  })
  return { plan: { ...plan, sections }, changed }
}

/**
 * A redraw measured at the desktop window (numbered by its marks, which are
 * its source's numbers, and read against its source's roles) and at a
 * phone's width.
 */
async function measureDrawn(
  browser: Browser,
  html: string,
  roles: RoleContext,
  options: BrowserOptions
) {
  const desktop = blueprintFrom(
    await measureHtml(browser, html, desktopWindow, options),
    { ordinalsFromMarks: true, roles }
  )
  if (!desktop.ok) return desktop
  const phone = phoneProblems(
    await measureHtml(browser, html, phoneWindow, options),
    phoneWindow
  )
  return { ok: true as const, blueprint: desktop.blueprint, phone }
}

/** Measure an HTML email, draw it back, check the likeness, correct, fall back. */
export async function copyDesign(
  browser: Browser,
  html: string,
  options: CopyOptions = {}
): Promise<CopyResult> {
  const retries = Math.max(
    0,
    Math.min(maxRetries, options.retries ?? maxRetries)
  )
  const measured = blueprintFrom(
    await measureHtml(browser, html, desktopWindow, options)
  )
  if (!measured.ok) return measured
  const source = measured.blueprint
  const roles = roleContextOf(source)
  const brand = options.brand ?? brandFromBlueprint(source)
  const mode = options.mode ?? 'preview'
  const fallbacks = new Map<number, Fallback>()
  /** What a section still had wrong when it went to a library block. */
  const lastProblems = new Map<number, string[]>()
  const tries = new Map<number, number>()
  for (const s of source.sections)
    if (s.unsupported) {
      fallbacks.set(
        s.ordinal,
        fallbackFor(
          s,
          `has ${s.unsupported}, which cannot be copied`,
          brand,
          mode
        )
      )
      lastProblems.set(s.ordinal, [`It has ${s.unsupported}.`])
    }
  const draw = (bp: Blueprint) =>
    drawBlueprint(bp, {
      mode,
      replaced: new Map([...fallbacks].map(([k, f]) => [k, f.rows])),
      brand
    })
  try {
    return await loop()
  } catch (error) {
    // A drawing refused (Klaviyo mode with a picture that is not https).
    if (error instanceof DrawError) return { ok: false, error: error.message }
    throw error
  }
  async function loop(): Promise<CopyResult> {
    const check = async (out: string) => {
      const got = await measureDrawn(browser, out, roles, options)
      if (!got.ok) return got
      return {
        ok: true as const,
        drawn: got.blueprint,
        likeness: compareBlueprints(
          source,
          got.blueprint,
          got.phone,
          new Set(fallbacks.keys())
        )
      }
    }
    let plan = source
    let drawings = 0
    let last: { html: string; drawn: Blueprint; likeness: Likeness } | null =
      null
    for (let attempt = 0; attempt <= retries; attempt++) {
      const out = draw(plan)
      const got = await check(out)
      drawings++
      if (!got.ok)
        return {
          ok: false,
          error: `The redraw could not be measured: ${got.error}`
        }
      last = { html: out, drawn: got.drawn, likeness: got.likeness }
      for (const s of source.sections)
        if (!fallbacks.has(s.ordinal)) tries.set(s.ordinal, attempt + 1)
      const failing = new Set(
        got.likeness.sections.filter((s) => !s.pass).map((s) => s.ordinal)
      )
      if (!failing.size || attempt === retries) break
      const next = correct(plan, source, got.drawn, failing)
      if (!next.changed) break
      plan = next.plan
    }
    if (!last) return { ok: false, error: 'Nothing was drawn.' }
    // What still fails is built from the closest library block.
    let added = false
    for (const s of last.likeness.sections) {
      if (s.pass) continue
      const section = source.sections.find((x) => x.ordinal === s.ordinal)!
      const n = tries.get(s.ordinal) ?? 1
      const first = (s.problems[0] ?? 'it did not match')
        .replace(/\.$/, '')
        .replace(/^It /, 'it ')
      const why = `still differed from the original after ${n} ${n === 1 ? 'try' : 'tries'} (${first})`
      fallbacks.set(s.ordinal, fallbackFor(section, why, brand, mode))
      lastProblems.set(s.ordinal, s.problems)
      added = true
    }
    if (added) {
      const out = draw(plan)
      const got = await check(out)
      drawings++
      if (!got.ok)
        return {
          ok: false,
          error: `The redraw could not be measured: ${got.error}`
        }
      last = { html: out, drawn: got.drawn, likeness: got.likeness }
    }
    const final = last
    const sections: SectionOutcome[] = source.sections.map((s) => {
      const f = fallbacks.get(s.ordinal)
      if (f)
        return {
          ordinal: s.ordinal,
          kind: s.kind,
          result: f.block ? 'library' : 'left_out',
          tries: s.unsupported ? 0 : (tries.get(s.ordinal) ?? 0),
          problems: lastProblems.get(s.ordinal) ?? [],
          fallback: { block: f.block, blockName: f.blockName, reason: f.reason }
        }
      const verdict = final.likeness.sections.find(
        (x) => x.ordinal === s.ordinal
      )
      return {
        ordinal: s.ordinal,
        kind: s.kind,
        result: 'copied',
        tries: tries.get(s.ordinal) ?? 1,
        problems: verdict?.problems ?? [],
        fallback: null
      }
    })
    const bytes = sentBytes(final.html)
    const problems = [...final.likeness.problems]
    if (bytes > GMAIL_CLIP_BYTES)
      problems.push(
        `The email is ${Math.round(bytes / 1024)} KB; Gmail cuts emails above ${Math.round(GMAIL_CLIP_BYTES / 1024)} KB.`
      )
    const copiedOk = sections.every(
      (s) => s.result === 'copied' && s.problems.length === 0
    )
    return {
      ok: true,
      html: final.html,
      source,
      drawn: final.drawn,
      likeness: final.likeness,
      sections,
      pass: copiedOk && problems.length === 0,
      bytes,
      problems,
      drawings
    }
  }
}

/** The plain-words lines the email's page shows for sections built from a block. */
export const fallbackLines = (result: Extract<CopyResult, { ok: true }>) =>
  result.sections.flatMap((s) => (s.fallback ? [s.fallback.reason] : []))

export { sectionName }
