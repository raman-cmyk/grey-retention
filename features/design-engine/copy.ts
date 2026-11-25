import type { Browser } from '@playwright/test'
import type { BlockBrand } from '@/features/blocks/brand'
import { GMAIL_CLIP_BYTES } from '@/features/blocks/render'
import { previewFooterTags } from '@/features/blocks/klaviyo-tags'
import { holdsFacts, type Lengthen } from './words'
import type { Blueprint, Column, Item, PartRole, Section } from './blueprint'
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
import { compareContent } from './content'
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
/** DES-ENGINE-002: drawings a brand copy may add to fit its words to the lines. */
export const fitRounds = 3

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
  /**
   * The brand a library block is drawn in. Klaviyo mode needs it; a
   * preview reads the colours and font from the email itself.
   */
  brand?: BlockBrand
  retries?: number
  /**
   * Whether the copy keeps the source's content (the words, links,
   * pictures, colours and fonts), checked part by part
   * (`compareContent`). True in step 1, where the email is drawn back
   * unchanged; a copy that swaps the content on purpose (step 2) sets it
   * false.
   */
  keepContent?: boolean
  /** The drawing code: `drawBlueprint`, replaced only in tests. */
  drawer?: typeof drawBlueprint
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
 * phone's width. Our own marks are trusted.
 */
async function measureDrawn(
  browser: Browser,
  html: string,
  roles: RoleContext,
  options: BrowserOptions
) {
  const own = { ...options, trustMarks: true }
  const desktop = await measureHtml(browser, html, desktopWindow, own)
  if (!desktop.ok) return desktop
  const drawn = blueprintFrom(desktop.measurement, {
    ordinalsFromMarks: true,
    roles
  })
  if (!drawn.ok) return drawn
  const phone = await measureHtml(browser, html, phoneWindow, own)
  if (!phone.ok) return phone
  return {
    ok: true as const,
    blueprint: drawn.blueprint,
    phone: phoneProblems(phone.measurement, phoneWindow)
  }
}

/**
 * Measure an HTML email, draw it back, check the likeness, correct, fall
 * back. Never throws: a browser that times out, a page that tries to
 * navigate, an email over a limit or a drawing refused all come back as
 * `{ ok: false, error }` in plain words.
 */
export async function copyDesign(
  browser: Browser,
  html: string,
  options: CopyOptions = {}
): Promise<CopyResult> {
  const mode = options.mode ?? 'preview'
  if (mode === 'klaviyo' && !options.brand)
    return {
      ok: false,
      error: 'An email for Klaviyo is drawn for a brand: give the brand.'
    }
  try {
    return await copyLoop(browser, html, options, mode)
  } catch (error) {
    if (error instanceof DrawError) return { ok: false, error: error.message }
    return {
      ok: false,
      error: `The email could not be copied: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

async function copyLoop(
  browser: Browser,
  html: string,
  options: CopyOptions,
  mode: DrawMode
): Promise<CopyResult> {
  const opened = await measureHtml(browser, html, desktopWindow, {
    ...options,
    trustMarks: options.trustMarks ?? false
  })
  if (!opened.ok) return opened
  const measured = blueprintFrom(opened.measurement)
  if (!measured.ok) return measured
  return drawLoop(
    browser,
    measured.blueprint,
    measured.blueprint,
    options,
    mode
  )
}

/**
 * DES-ENGINE-002: a source's structure drawn with the brand's content.
 * Where `copyDesign` measures an email and draws it back unchanged,
 * `copyBlueprint` takes the source's blueprint and the **target**: the
 * same structure with the brand's own words, photos, colours and fonts
 * (`swapBrand`). It draws the target, measures it and checks its
 * structure against the source (`keepContent` false: the content differs
 * on purpose). A text that breaks onto more lines than the original's is
 * cut shorter at a word (`trimTo`) and drawn again; one that takes fewer
 * lines keeps the original's height by the space after it. Sections the
 * swap could not fill (`blocked`: no photo of that shape, no logo) and
 * sections that cannot be copied are built from the closest library
 * block, filled with the brand's own content, with the reason in plain
 * words. Never throws.
 */
export async function copyBlueprint(
  browser: Browser,
  source: Blueprint,
  target: Blueprint,
  options: CopyOptions & {
    /** Sections the swap could not fill, and why (words after "Section n (kind)"). */
    blocked?: ReadonlyMap<number, string>
    /** More of the brand's words for a text that broke onto fewer lines. */
    lengthen?: Lengthen
  } = {}
): Promise<CopyResult> {
  const mode = options.mode ?? 'preview'
  if (mode === 'klaviyo' && !options.brand)
    return {
      ok: false,
      error: 'An email for Klaviyo is drawn for a brand: give the brand.'
    }
  const same =
    source.sections.length === target.sections.length &&
    source.sections.every(
      (s, i) =>
        s.ordinal === target.sections[i]!.ordinal &&
        sameShape(s.items, target.sections[i]!.items)
    )
  if (!same)
    return {
      ok: false,
      error: 'The brand copy does not have the same parts as the original.'
    }
  try {
    return await drawLoop(
      browser,
      source,
      target,
      { ...options, keepContent: false },
      mode,
      options.blocked,
      options.lengthen
    )
  } catch (error) {
    if (error instanceof DrawError) return { ok: false, error: error.message }
    return {
      ok: false,
      error: `The email could not be copied: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** A drawn brand copy read with its source's section kinds and part roles. */
export function withSourceLabels(
  drawn: Blueprint,
  source: Blueprint
): Blueprint {
  const label = (items: readonly Item[], from: readonly Item[]): Item[] =>
    items.map((item, i) => {
      const f = from[i]
      if (!f || f.type !== item.type) return item
      if (item.type === 'row' && f.type === 'row')
        return {
          ...item,
          columns: item.columns.map((c, k) =>
            f.columns[k]
              ? { ...c, items: label(c.items, f.columns[k]!.items) }
              : c
          )
        }
      if (item.type !== 'row' && f.type !== 'row')
        return { ...item, role: f.role } as Item
      return item
    })
  return {
    ...drawn,
    sections: drawn.sections.map((s) => {
      const f = source.sections.find((x) => x.ordinal === s.ordinal)
      return f ? { ...s, kind: f.kind, items: label(s.items, f.items) } : s
    })
  }
}

/**
 * The writers' words made about `share` as long without changing what
 * any of them promises: whole sentences are dropped from the end (at
 * least one stays); a last sentence with no number, money, code or
 * condition (`holdsFacts`) may instead be cut at a word. A single
 * sentence that holds a fact is never cut (the section is then built
 * from a library block, with the reason).
 */
export function shorten(text: string, share: number): string {
  const want = Math.max(1, Math.floor(text.length * share))
  const sentences = text.split(/(?<=[.!?])\s+/)
  while (sentences.join(' ').length > want) {
    const last = sentences.at(-1)!
    const rest = sentences.slice(0, -1).join(' ')
    if (!holdsFacts(last)) {
      const room = want - (rest ? rest.length + 1 : 0)
      if (room >= Math.min(12, last.length)) {
        const cut = trimTo(last, room / last.length)
        if (cut !== last) {
          sentences[sentences.length - 1] = cut
          break
        }
      }
    }
    if (sentences.length === 1) break
    sentences.pop()
  }
  return sentences.join(' ')
}

/**
 * Words cut to about `share` of their length at a space, never inside a
 * word (one word at least stays, and a cut always drops one); a cut line
 * loses a comma, colon or dash left at its end.
 */
export function trimTo(text: string, share: number): string {
  const words = text.split(' ')
  if (words.length <= 1) return text
  const want = Math.max(1, Math.floor(text.length * share))
  let out = words[0]!
  for (const w of words.slice(1)) {
    if (out.length + 1 + w.length > want) break
    out += ` ${w}`
  }
  if (out === text) out = words.slice(0, -1).join(' ')
  return out.replace(/[\s,;:–—-]+$/, '')
}

/** The writers' words a brand copy may cut at a word to fit its lines. */
const writtenRoles = new Set<PartRole>([
  'footer_text',
  'headline',
  'subheadline',
  'eyebrow',
  'body',
  'caption',
  'link',
  'main_button',
  'secondary_button'
])
const cuttable = (role: PartRole, words: string) =>
  writtenRoles.has(role) && !holdsFacts(words)

const textOfRuns = (runs: readonly { text: string }[]) =>
  runs.map((r) => r.text).join('')

/** A brand copy's items refitted: words cut where they took more lines, room kept where fewer. */
function refitItems(
  plan: readonly Item[],
  target: readonly Item[],
  drawn: readonly Item[],
  lengthen: Lengthen | undefined,
  /** The space after the last item, as the original and the redraw have it. */
  ends: { target: number; drawn: number }
): { items: Item[]; changed: boolean; bottom: number } {
  let changed = false
  let carry = 0
  const items = plan.map((p, i): Item => {
    const t = target[i]!
    const d = drawn[i]!
    let item: Item = carry ? { ...p, gapBefore: p.gapBefore + carry } : p
    if (carry) changed = true
    carry = 0
    if (item.type === 'row' && t.type === 'row' && d.type === 'row') {
      const columns = item.columns.map((c, k) => {
        const got = refitItems(
          c.items,
          t.columns[k]!.items,
          d.columns[k]!.items,
          lengthen,
          { target: t.columns[k]!.bottom, drawn: d.columns[k]!.bottom }
        )
        if (!got.changed) return c
        changed = true
        return { ...c, items: got.items, bottom: c.bottom + got.bottom }
      })
      return { ...item, columns }
    }
    if (item.type === 'text' && t.type === 'text' && d.type === 'text') {
      if (d.lines > t.lines) {
        const words = textOfRuns(item.runs)
        // Facts (names, prices, codes, the footer) and words that carry a
        // number or a condition are never cut: the section is then built
        // from a library block, with the reason.
        const cut = writtenRoles.has(t.role)
          ? shorten(words, (t.lines / d.lines) * 0.97)
          : words
        if (cut !== words) {
          changed = true
          item = { ...item, runs: [{ ...item.runs[0]!, text: cut }] }
        }
      } else if (d.lines < t.lines) {
        // More of the brand's words, else the original's height is kept
        // by the space after it.
        const words = textOfRuns(item.runs)
        const chars = Math.round(
          (words.length * t.lines) / Math.max(1, d.lines)
        )
        const longer = writtenRoles.has(t.role)
          ? (lengthen?.(t.role, words, chars) ?? null)
          : null
        if (longer && longer !== words) {
          changed = true
          item = { ...item, runs: [{ ...item.runs[0]!, text: longer }] }
        } else {
          // Only what is still missing: a space added by an earlier
          // drawing is already in the redraw's next gap.
          const gap = (list: readonly Item[], end: number) =>
            list[i + 1]?.gapBefore ?? end
          const missing =
            t.height -
            d.height -
            (gap(drawn, ends.drawn) - gap(target, ends.target))
          if (missing > 0.5) carry = missing
        }
      }
    }
    if (
      item.type === 'button' &&
      t.type === 'button' &&
      d.type === 'button' &&
      d.lines > t.lines &&
      cuttable(t.role, item.label)
    ) {
      const cut = trimTo(item.label, (t.lines / d.lines) * 0.97)
      if (cut !== item.label) {
        changed = true
        item = { ...item, label: cut }
      }
    }
    return item
  })
  if (carry) changed = true
  return { items, changed, bottom: carry }
}

function refit(
  plan: Blueprint,
  target: Blueprint,
  drawn: Blueprint,
  ordinals: ReadonlySet<number>,
  lengthen: Lengthen | undefined
) {
  let changed = false
  const sections = plan.sections.map((s) => {
    if (!ordinals.has(s.ordinal)) return s
    const t = target.sections.find((x) => x.ordinal === s.ordinal)
    const d = drawn.sections.find((x) => x.ordinal === s.ordinal)
    if (!t || !d || !sameShape(t.items, d.items)) return s
    const got = refitItems(s.items, t.items, d.items, lengthen, {
      target: t.bottom,
      drawn: d.bottom
    })
    if (!got.changed) return s
    changed = true
    return { ...s, items: got.items, bottom: s.bottom + got.bottom }
  })
  return { plan: { ...plan, sections }, changed }
}

async function drawLoop(
  browser: Browser,
  source: Blueprint,
  start: Blueprint,
  options: CopyOptions,
  mode: DrawMode,
  blocked: ReadonlyMap<number, string> = new Map(),
  lengthen?: Lengthen
): Promise<CopyResult> {
  const retries = Math.max(
    0,
    Math.min(maxRetries, options.retries ?? maxRetries)
  )
  const keepContent = options.keepContent ?? true
  /** A brand copy: its content differs from the source's on purpose. */
  const swapped = start !== source
  // A brand copy may also fit its words (`fitRounds` more drawings).
  const rounds = swapped ? retries + fitRounds : retries
  const drawer = options.drawer ?? drawBlueprint
  const roles = roleContextOf(source)
  const brand = options.brand ?? brandFromBlueprint(start)
  // A brand copy's library blocks are filled from its own (the brand's)
  // section, never from the source's words or pictures.
  const filler = (ordinal: number) =>
    (swapped ? start : source).sections.find((x) => x.ordinal === ordinal)!
  const fallbacks = new Map<number, Fallback>()
  /** What a section still had wrong when it went to a library block. */
  const lastProblems = new Map<number, string[]>()
  const tries = new Map<number, number>()
  for (const s of source.sections)
    if (s.unsupported) {
      fallbacks.set(
        s.ordinal,
        fallbackFor(
          filler(s.ordinal),
          `has ${s.unsupported}, which cannot be copied`,
          brand,
          mode
        )
      )
      lastProblems.set(s.ordinal, [`It has ${s.unsupported}.`])
    } else if (blocked.has(s.ordinal)) {
      const why = blocked.get(s.ordinal)!
      fallbacks.set(s.ordinal, fallbackFor(filler(s.ordinal), why, brand, mode))
      lastProblems.set(s.ordinal, [`It ${why}.`])
    }
  const draw = (bp: Blueprint) =>
    drawer(bp, {
      mode,
      replaced: new Map([...fallbacks].map(([k, f]) => [k, f.rows])),
      brand
    })
  // A Klaviyo drawing is measured as our previews show it: the footer's
  // tags as words (Klaviyo fills them when it sends), the same geometry.
  const shownOf = (bp: Blueprint, out: string) =>
    mode === 'klaviyo'
      ? previewFooterTags(
          drawer(bp, {
            mode: 'preview',
            replaced: new Map([...fallbacks].map(([k, f]) => [k, f.rows])),
            brand
          }),
          brand.name
        )
      : out
  const check = async (bp: Blueprint, out: string) => {
    const shown = shownOf(bp, out)
    const got = await measureDrawn(browser, shown, roles, options)
    if (!got.ok) return got
    const skip = new Set(fallbacks.keys())
    const drawn = swapped
      ? withSourceLabels(got.blueprint, source)
      : got.blueprint
    const likeness = compareBlueprints(source, drawn, got.phone, skip, {
      brandLogo: swapped
    })
    if (keepContent) addContent(likeness, compareContent(source, drawn, skip))
    return { ok: true as const, drawn, likeness }
  }
  let plan = start
  let drawings = 0
  let last: { html: string; drawn: Blueprint; likeness: Likeness } | null = null
  for (let attempt = 0; attempt <= rounds; attempt++) {
    const out = draw(plan)
    const got = await check(plan, out)
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
    if (!failing.size || attempt === rounds) break
    // A brand copy fits its words first; then, as any copy, sizes and
    // places are corrected. When nothing changes (the parts themselves
    // differ), another drawing would be the same.
    const fitted = swapped
      ? refit(plan, source, got.drawn, failing, lengthen)
      : { plan, changed: false }
    const next = fitted.changed
      ? fitted
      : correct(plan, source, got.drawn, failing)
    if (!next.changed) break
    plan = next.plan
  }
  if (!last) return { ok: false, error: 'Nothing was drawn.' }
  // What still fails is built from the closest library block.
  let added = false
  for (const s of last.likeness.sections) {
    if (s.pass) continue
    const n = tries.get(s.ordinal) ?? 1
    const first = (s.problems[0] ?? 'it did not match')
      .replace(/\.$/, '')
      .replace(/^It /, 'it ')
    const why = `still differed from the original after ${n} ${n === 1 ? 'try' : 'tries'} (${first})`
    fallbacks.set(s.ordinal, fallbackFor(filler(s.ordinal), why, brand, mode))
    lastProblems.set(s.ordinal, s.problems)
    added = true
  }
  if (added) {
    const out = draw(plan)
    const got = await check(plan, out)
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
        tries:
          s.unsupported || blocked.has(s.ordinal)
            ? 0
            : (tries.get(s.ordinal) ?? 0),
        problems: lastProblems.get(s.ordinal) ?? [],
        fallback: { block: f.block, blockName: f.blockName, reason: f.reason }
      }
    const verdict = final.likeness.sections.find((x) => x.ordinal === s.ordinal)
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

/** The content check's problems, added to the likeness (ordinal 0: the whole email). */
function addContent(likeness: Likeness, content: Map<number, string[]>) {
  for (const [ordinal, list] of content) {
    if (ordinal === 0) {
      likeness.problems.push(...list)
      continue
    }
    const verdict = likeness.sections.find((s) => s.ordinal === ordinal)
    if (!verdict) continue
    verdict.problems.push(...list)
    verdict.pass = false
  }
  likeness.pass =
    likeness.problems.length === 0 && likeness.sections.every((s) => s.pass)
}

/** The plain-words lines the email's page shows for sections built from a block. */
export const fallbackLines = (result: Extract<CopyResult, { ok: true }>) =>
  result.sections.flatMap((s) => (s.fallback ? [s.fallback.reason] : []))

export { sectionName }
