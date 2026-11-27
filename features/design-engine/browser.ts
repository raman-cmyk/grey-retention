import type { Browser, BrowserContext, Page } from '@playwright/test'
import { sectionEmail } from '@/features/inbox/sections'
import { loadableOrigins, makeInert } from '@/lib/sandbox/browser.mjs'
import {
  fromSnapshot,
  snapshotStyles,
  type DomSnapshot,
  type Measurement
} from './measurement'

/**
 * DES-ENGINE-001, the browser half of the measuring tool. It opens an
 * email in the same locked headless browser the inbox screenshots use
 * (`lib/sandbox/browser.mjs`): JavaScript off, no service workers, no
 * navigation, only inline pictures and the https origins the caller allows
 * (the email's own stored pictures; none by default), never a redirect,
 * and what would reach out on its own (`<link>`, `<meta>`, `<base>`,
 * frames) made inert first. It then asks Chromium, through its own
 * protocol, for a DOM snapshot of every box and computed style
 * (`DOMSnapshot.captureSnapshot`): nothing in the page runs.
 *
 * Callers launch Chromium with `launch` from `lib/sandbox/browser.mjs`: no
 * secret in its environment, and its own OS sandbox where the machine
 * allows one. Every limit below turns into a plain `{ ok: false }` reason,
 * never a crash or a wait without end.
 */

/**
 * The window an email is laid out in on a desktop: wider than the email,
 * so a phone layout (most emails switch under 600 or 620 px) never applies,
 * as the built emails' desktop view (DST-007).
 */
export const desktopWindow = 700
/** A phone's width (the built emails' phone view). */
export const phoneWindow = 375

export const browserLimits = {
  /** The inbox splitter reads at most 2,000,000 characters of an email. */
  inputBytes: 2_000_000,
  /** Boxes, words and tags in one snapshot. */
  nodes: 30_000,
  /** CSS px, as the inbox screenshots (`maxHeight`). */
  height: 16_000,
  /** One whole measurement, from opening the page to the snapshot. */
  measureMs: 30_000,
  /** The snapshot itself. */
  snapshotMs: 15_000,
  /** A picture for the owner: at most this tall (CSS px) and this heavy. */
  pictureHeight: 6_000,
  pictureBytes: 3 * 1024 * 1024
} as const

export type BrowserOptions = {
  /** https origins pictures may load from (the email's own stored pictures). */
  origins?: readonly string[]
  /** One picture or style, and the page's own load. */
  timeoutMs?: number
  /** The whole measurement (tests pass a shorter one). */
  deadlineMs?: number
  /**
   * Keep the email's own `data-gr-section` marks: only for HTML whose marks
   * came from our own splitter or drawing code (a stored inbox email, a
   * redraw). Anyone else's marks are removed and the email cut afresh.
   */
  trustMarks?: boolean
}

export type Measured =
  { ok: true; measurement: Measurement } | { ok: false; error: string }

/** Largest sizes a held picture may take (an email is not wider or taller). */
const heldMax = { width: 2_000, height: browserLimits.height }

const imgTag = /<img\b[^>]*>/gi
const srcAttr = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const sizeAttr = (tag: string, name: string) => {
  const m = new RegExp(
    `\\s${name}\\s*=\\s*["']?(\\d{1,5})(?:px)?["'\\s>/]`,
    'i'
  ).exec(tag)
  return m ? Number(m[1]) : null
}

/**
 * A picture the browser may not load (its origin is not allowed) is drawn
 * as the alt text, at the wrong size. So that the measurement keeps its
 * place, it is swapped for an empty inline drawing of the size its width
 * and height attributes give, and its own address is kept beside it
 * (`data-de-src`) for the blueprint. A picture without both attributes,
 * or with sizes no email has, is left as it is.
 */
export function holdPictures(
  html: string,
  origins: readonly string[] = []
): string {
  const allowed = loadableOrigins(origins)
  return html.replace(imgTag, (tag) => {
    const m = srcAttr.exec(tag)
    const src = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
    if (!m || /^data:/i.test(src)) return tag
    try {
      if (allowed.has(new URL(src).origin)) return tag
    } catch {
      // Not a full address: it cannot load anyway.
    }
    const w = sizeAttr(tag, 'width')
    const h = sizeAttr(tag, 'height')
    if (!w || !h || w > heldMax.width || h > heldMax.height) return tag
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`
    ).toString('base64')
    const kept = src.replace(/["<>]/g, '').slice(0, 2_000)
    // A function, so `$&` or `$'` in an address is never expanded.
    return tag.replace(
      srcAttr,
      () => ` src="data:image/svg+xml;base64,${svg}" data-de-src="${kept}"`
    )
  })
}

/** Our own marks, which nobody else's HTML may bring in. */
// DES-ENGINE-003a: after a space or a slash (`<img/data-de-src=…>`: a
// browser reads the slash as a separator too).
const ownMarks =
  /[\s/]data-(?:gr-section|de-[a-z-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const ownFlags = /[\s/]data-de-[a-z-]+(?=[\s/>])/gi

/**
 * Sections marked as the inbox marks them. HTML we did not mark ourselves
 * loses any marks it brings and is cut by the inbox's splitter; ours keeps
 * its marks (`trustMarks`).
 */
export function markedHtml(html: string, trustMarks = false): string {
  if (trustMarks && /\bdata-gr-section\s*=/i.test(html)) return html
  // A space in its place: a slash before it was the tag's separator.
  const clean = html.replace(ownMarks, ' ').replace(ownFlags, ' ')
  return sectionEmail(clean).markedHtml
}

async function lockedPage(
  browser: Browser,
  width: number,
  { origins = [], timeoutMs = 20_000 }: BrowserOptions
): Promise<{ context: BrowserContext; page: Page }> {
  const allowed = loadableOrigins(origins)
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light',
    javaScriptEnabled: false,
    serviceWorkers: 'block'
  })
  try {
    const page = await context.newPage()
    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      if (request.isNavigationRequest()) return route.abort().catch(() => {})
      if (url.startsWith('data:')) return route.continue().catch(() => {})
      let origin = ''
      try {
        origin = new URL(url).origin
      } catch {
        // An unreadable link is blocked like any other.
      }
      if (!allowed.has(origin)) return route.abort().catch(() => {})
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: timeoutMs
        })
        if (response.status() >= 300 && response.status() < 400)
          return route.abort().catch(() => {})
        return route.fulfill({ response }).catch(() => {})
      } catch {
        return route.abort().catch(() => {})
      }
    })
    return { context, page }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

class Refused extends Error {}

/** The email laid out in a locked page; throws `Refused` with the reason. */
async function open(
  browser: Browser,
  html: string,
  width: number,
  options: BrowserOptions
) {
  if (Buffer.byteLength(html) > browserLimits.inputBytes)
    throw new Refused(
      `The email is larger than ${Math.round(browserLimits.inputBytes / 1_000_000)} MB.`
    )
  const marked = holdPictures(
    markedHtml(html, options.trustMarks),
    options.origins
  )
  const { context, page } = await lockedPage(browser, width, options)
  try {
    // The page as a whole gets longer than any one picture or style.
    await page.setContent(makeInert(marked), {
      waitUntil: 'load',
      timeout: (options.timeoutMs ?? 20_000) + 10_000
    })
    if (page.url() !== 'about:blank') throw new Refused('navigated')
    return { context, page }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

/** The laid-out page's size, from the browser's own protocol. */
async function pageSize(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  try {
    const { cssContentSize } = (await cdp.send('Page.getLayoutMetrics')) as {
      cssContentSize: { width: number; height: number }
    }
    return cssContentSize
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/** Resolves with `work`, or rejects with `timeout` after `ms` (and runs `stop`). */
function deadline<T>(work: Promise<T>, ms: number, stop: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      stop()
      reject(new Refused('timeout'))
    }, ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** Plain words for why the browser could not measure an email. */
function reasonOf(error: unknown): string {
  const words = error instanceof Error ? error.message : ''
  if (words === 'navigated') return 'The email tried to open another page.'
  if (words === 'timeout' || /timeout/i.test(words))
    return 'The email took too long to open in the browser.'
  if (error instanceof Refused) return words
  return 'The email could not be opened in the browser.'
}

/**
 * Every box and computed style of the email laid out `width` wide, or why
 * it could not be measured. Never throws.
 */
export async function measureHtml(
  browser: Browser,
  html: string,
  width = desktopWindow,
  options: BrowserOptions = {}
): Promise<Measured> {
  let context: BrowserContext | null = null
  const stop = () => {
    void context?.close().catch(() => {})
  }
  const work = async (): Promise<Measured> => {
    const opened = await open(browser, html, width, options)
    context = opened.context
    const size = await pageSize(opened.context, opened.page)
    if (size.height > browserLimits.height)
      throw new Refused(
        `The email is ${Math.round(size.height)} px tall; at most ${browserLimits.height} can be measured.`
      )
    const cdp = await opened.context.newCDPSession(opened.page)
    try {
      const snap = (await deadline(
        cdp.send('DOMSnapshot.captureSnapshot', {
          computedStyles: [...snapshotStyles],
          includeDOMRects: false
        }),
        browserLimits.snapshotMs,
        stop
      )) as unknown as DomSnapshot
      const nodes = snap.documents?.[0]?.nodes?.parentIndex?.length ?? 0
      if (nodes > browserLimits.nodes)
        throw new Refused(
          `The email has ${nodes} parts; at most ${browserLimits.nodes} can be measured.`
        )
      return { ok: true, measurement: fromSnapshot(snap, width) }
    } finally {
      await cdp.detach().catch(() => {})
    }
  }
  try {
    return await deadline(
      work(),
      options.deadlineMs ?? browserLimits.measureMs,
      stop
    )
  } catch (error) {
    return { ok: false, error: reasonOf(error) }
  } finally {
    stop()
  }
}

/**
 * A JPEG of the email laid out `width` wide, for the owner to look at: at
 * most `browserLimits.pictureHeight` tall (a longer email is cut) and
 * `pictureBytes` heavy. Throws when it cannot be taken.
 */
export async function pictureOf(
  browser: Browser,
  html: string,
  width = desktopWindow,
  options: BrowserOptions = {}
): Promise<Buffer> {
  const { context, page } = await open(browser, html, width, options)
  try {
    const size = await pageSize(context, page)
    const clip = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.min(2_000, Math.ceil(size.width))),
      height: Math.max(
        1,
        Math.min(browserLimits.pictureHeight, Math.ceil(size.height))
      )
    }
    const shoot = (quality: number) =>
      page.screenshot({
        type: 'jpeg',
        quality,
        fullPage: true,
        clip,
        animations: 'disabled',
        timeout: options.timeoutMs ?? 20_000
      })
    let image = await shoot(70)
    if (image.byteLength > browserLimits.pictureBytes) image = await shoot(40)
    if (image.byteLength > browserLimits.pictureBytes)
      throw new Error('too_large')
    return image
  } finally {
    await context.close().catch(() => {})
  }
}
