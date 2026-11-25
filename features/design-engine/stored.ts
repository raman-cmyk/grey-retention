import type { Browser } from '@playwright/test'
import { parseBlueprint, type Blueprint, type Item } from './blueprint'
import { desktopWindow, measureHtml } from './browser'
import { blueprintFrom } from './measure'

/**
 * DES-ENGINE-002: an Inspiration email's blueprint as it is kept
 * (`inbox_blueprints`, measured once by the blueprint browser job). It
 * keeps the email's structure and its words (as the inbox's sections
 * already do, platform admins only) and **never** its pictures or links:
 * every picture address and every link is dropped before it is stored
 * (rule 8: a copy never reuses a competitor picture; the inbox's signed
 * picture links would also run out). A picture keeps its box, size, shape,
 * corners and alt text.
 */

/**
 * The version of what the measuring job stores: the blueprint schema and
 * the measuring code. Bumped with either; the app answers a job that
 * measured with another version by trying it again later (a browser job
 * and the app may briefly run different code after a merge).
 */
export const ENGINE_VERSION = '2026-11-25.2'

/** A web address written in words, blanked letter for letter (its length stays). */
const address = /(?:https?:)?\/\/\S*|\burl\s*\(/gi
const blank = (words: string) =>
  words.replace(address, (m) => 'x'.repeat(m.length))

const bare = (items: readonly Item[]): Item[] =>
  items.map((item) => {
    if (item.type === 'row')
      return {
        ...item,
        columns: item.columns.map((c) => ({ ...c, items: bare(c.items) }))
      }
    if (item.type === 'image')
      return { ...item, src: null, href: null, alt: blank(item.alt) }
    if (item.type === 'button')
      return { ...item, href: null, label: blank(item.label) }
    if (item.type === 'text')
      return {
        ...item,
        runs: item.runs.map((r) => {
          const { href, ...rest } = r
          void href
          return { ...rest, text: blank(r.text) }
        })
      }
    return item
  })

/**
 * The blueprint as it is stored: no picture address, no link, and no web
 * address in its words (the table refuses any).
 */
export function forStorage(bp: Blueprint): Blueprint {
  return {
    ...bp,
    sections: bp.sections.map((s) => ({ ...s, items: bare(s.items) }))
  }
}

/** True when a blueprint keeps no picture address and no link. */
export function isBare(bp: Blueprint): boolean {
  return JSON.stringify(forStorage(bp)) === JSON.stringify(bp)
}

/** At most this many characters are stored (the table's own limit is 600,000). */
export const storedLimit = 500_000

/** Why a blueprint can never be measured, as the job records it. */
export const blueprintFailures = {
  too_large: 'The email is too large to measure (over 2 MB).',
  too_tall:
    'The email is taller than 16,000 px, the most that can be measured.',
  too_many_parts:
    'The email has more than 30,000 parts, the most that can be measured.',
  navigated: 'The email tried to open another page.',
  no_sections: 'The email has no sections the engine can read.',
  not_valid: 'The email could not be turned into a blueprint.',
  stored_too_large: 'The email’s blueprint is too large to keep.'
} as const
export type BlueprintFailure = keyof typeof blueprintFailures

export type StoredMeasure =
  | { ok: true; blueprint: Blueprint }
  | { ok: false; failure: BlueprintFailure; retry: false }
  /** Worth another try (the browser was slow or could not open it). */
  | { ok: false; failure: 'timeout' | 'unopened'; retry: true }

/** The failure code for the browser's or the measuring's words. */
export function failureOf(error: string): StoredMeasure & { ok: false } {
  if (/too long|took too long/i.test(error))
    return { ok: false, failure: 'timeout', retry: true }
  if (/larger than/i.test(error))
    return { ok: false, failure: 'too_large', retry: false }
  if (/px tall/i.test(error))
    return { ok: false, failure: 'too_tall', retry: false }
  if (/\bparts\b.*at most/i.test(error))
    return { ok: false, failure: 'too_many_parts', retry: false }
  if (/another page/i.test(error))
    return { ok: false, failure: 'navigated', retry: false }
  if (/no sections/i.test(error))
    return { ok: false, failure: 'no_sections', retry: false }
  if (/could not be opened/i.test(error))
    return { ok: false, failure: 'unopened', retry: true }
  return { ok: false, failure: 'not_valid', retry: false }
}

/**
 * An inbox email measured for storing: its marked HTML (our own splitter's
 * marks, trusted) laid out in the locked browser with only its own stored
 * pictures' origins allowed, turned into a blueprint, pictures and links
 * dropped. Never throws.
 */
export async function measureForStorage(
  browser: Browser,
  html: string,
  origins: readonly string[]
): Promise<StoredMeasure> {
  try {
    const measured = await measureHtml(browser, html, desktopWindow, {
      origins,
      trustMarks: true
    })
    if (!measured.ok) return failureOf(measured.error)
    const made = blueprintFrom(measured.measurement)
    if (!made.ok) return failureOf(made.error)
    return checkStored(forStorage(made.blueprint))
  } catch (error) {
    return failureOf(error instanceof Error ? error.message : String(error))
  }
}

/** A blueprint the app may store: valid, bare and small enough. */
export function checkStored(value: unknown): StoredMeasure {
  const parsed = parseBlueprint(value)
  if (!parsed.ok) return { ok: false, failure: 'not_valid', retry: false }
  const bp = forStorage(parsed.blueprint)
  if (JSON.stringify(bp).length > storedLimit)
    return { ok: false, failure: 'stored_too_large', retry: false }
  return { ok: true, blueprint: bp }
}
