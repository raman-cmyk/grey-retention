import { logger } from '@/lib/logger'
import { sheetTimeoutMs } from './fetch'
import {
  maxFamilies,
  maxFontFiles,
  maxStylesheets,
  maxTotalCss,
  siteFonts,
  type Sheet,
  type SiteFont
} from './fonts'

/**
 * The brand's fonts for its whole site (owner pick #3, FONT-SITE part b,
 * ledger row FONT-b): each page the live Site reader reads, read again
 * with the stylesheets it links, then one set for the site.
 */

/** Files kept per weight and style, as part a keeps them. */
const perStyle = 2

/**
 * Reads the stylesheets a site read's pages link: each address once per
 * read (the pages share their theme's), at most `maxStylesheets` in all
 * and `maxTotalCss` characters kept, none started without
 * `sheetTimeoutMs` left. A sheet not read in time, or at all, is null.
 */
export function sheetReader(
  load: (url: string) => Promise<Sheet | null>,
  { now, deadline }: { now: () => number; deadline: number }
): (url: string) => Promise<Sheet | null> {
  const started = new Map<string, Promise<Sheet | null>>()
  let kept = 0
  return (url) => {
    const was = started.get(url)
    if (was) return was
    if (started.size >= maxStylesheets || now() + sheetTimeoutMs > deadline)
      return Promise.resolve(null)
    const sheet = load(url)
      .catch(() => null)
      .then((s) => {
        if (!s || kept + s.css.length > maxTotalCss) return null
        kept += s.css.length
        return s
      })
    started.set(url, sheet)
    return sheet
  }
}

/**
 * One page's fonts with its stylesheets: the sheets it links, then (one
 * level) those they `@import`, then the page read again with them all,
 * so the heading and body fonts its theme's CSS sets count. Null when its
 * fonts cannot be read (logged); never fails.
 */
export async function pageFonts(
  page: { html: string; url: string },
  sheet: (url: string) => Promise<Sheet | null>
): Promise<SiteFont[] | null> {
  try {
    const first = siteFonts(page.html, page.url)
    const read = async (urls: string[]) =>
      (await Promise.all(urls.map(sheet))).filter((s) => s !== null)
    const linked = first.stylesheets.map((s) => s.url)
    const sheets = await read(linked)
    const imported = siteFonts('', page.url, { sheets })
      .stylesheets.map((s) => s.url)
      .filter((url) => !linked.includes(url))
    sheets.push(...(await read(imported)))
    return sheets.length
      ? siteFonts(page.html, page.url, { sheets }).families
      : first.families
  } catch (error) {
    logger.warn('Site fonts unreadable', {
      error: error instanceof Error ? error.name : 'unknown'
    })
    return null
  }
}

/**
 * The site's fonts from its pages' (in reading order): each family once,
 * as first spelled, with every role a page gives it; heading fonts first,
 * then body fonts, then fonts only loaded, each tier as first found, at
 * most `maxFamilies`. Its files as its pages rank them, the first page's
 * first: each once, at most two per weight and style and `maxFontFiles`
 * in all; who serves it is said by the first page that found its files.
 */
export function mergeSiteFonts(
  pages: readonly (readonly SiteFont[] | null | undefined)[]
): SiteFont[] {
  const byName = new Map<string, { font: SiteFont; at: number }>()
  for (const found of pages.flatMap((p) => p ?? [])) {
    const key = found.family.toLowerCase()
    const e = byName.get(key) ?? {
      font: { ...found, roles: [], files: [] },
      at: byName.size
    }
    byName.set(key, e)
    const font = e.font
    font.roles = (['heading', 'body'] as const).filter(
      (r) => font.roles.includes(r) || found.roles.includes(r)
    )
    if (!font.files.length && (found.files.length || font.kind === 'unknown'))
      font.kind = found.kind
    for (const file of found.files) {
      const style = font.files.filter(
        (f) => f.weight === file.weight && f.italic === file.italic
      )
      if (
        font.files.length < maxFontFiles &&
        style.length < perStyle &&
        !font.files.some((f) => f.url === file.url)
      )
        font.files.push(file)
    }
  }
  const tier = ({ font }: { font: SiteFont }) =>
    font.roles.includes('heading') ? 0 : font.roles.includes('body') ? 1 : 2
  return [...byName.values()]
    .sort((a, b) => tier(a) - tier(b) || a.at - b.at)
    .slice(0, maxFamilies)
    .map((e) => e.font)
}
