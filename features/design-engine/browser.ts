import type { Browser, BrowserContext, Page } from '@playwright/test'
import { sectionEmail } from '@/features/inbox/sections'
import { prepareHtml } from '@/scripts/inbox-screenshots.mjs'
import { loadableOrigins } from '@/scripts/section-render.mjs'
import {
  fromSnapshot,
  snapshotStyles,
  type DomSnapshot,
  type Measurement
} from './measurement'

/**
 * DES-ENGINE-001, the browser half of the measuring tool. It opens an
 * email in the same safe headless browser the inbox screenshots use
 * (`scripts/inbox-screenshots.mjs`, `scripts/section-render.mjs`):
 * JavaScript off, no service workers, no navigation, only inline pictures
 * and the https origins the caller allows (the email's own stored
 * pictures; none by default), never a redirect, and what would reach out
 * on its own (`<link>`, `<meta>`, `<base>`, frames) made inert first. It
 * then asks Chromium, through its own protocol, for a DOM snapshot of
 * every box and computed style (`DOMSnapshot.captureSnapshot`): nothing in
 * the page runs. Chromium gets no secret: the caller launches it (as the
 * inbox job's `launch` does).
 */

/**
 * The window an email is laid out in on a desktop: wider than the email,
 * so a phone layout (most emails switch under 600 or 620 px) never applies,
 * as the built emails' desktop view (DST-007).
 */
export const desktopWindow = 700
/** A phone's width (the built emails' phone view). */
export const phoneWindow = 375

export type BrowserOptions = {
  /** https origins pictures may load from (the email's own stored pictures). */
  origins?: readonly string[]
  timeoutMs?: number
}

const imgTag = /<img\b[^>]*>/gi
const srcAttr = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
const sizeAttr = (tag: string, name: string) => {
  const m = new RegExp(
    `\\s${name}\\s*=\\s*["']?(\\d{1,4})(?:px)?["'\\s>]`,
    'i'
  ).exec(tag)
  return m ? Number(m[1]) : null
}

/**
 * A picture the browser may not load (its origin is not allowed) is drawn
 * as the alt text, at the wrong size. So that the measurement keeps its
 * place, it is swapped for an empty inline drawing of the size its width
 * and height attributes give, and its own address is kept beside it
 * (`data-de-src`) for the blueprint. A picture without both attributes is
 * left as it is.
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
    if (!w || !h) return tag
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`
    ).toString('base64')
    const kept = src.replace(/["<>]/g, '')
    return tag.replace(
      srcAttr,
      ` src="data:image/svg+xml;base64,${svg}" data-de-src="${kept}"`
    )
  })
}

/** Sections marked as the inbox marks them; an email without marks is marked first. */
export function markedHtml(html: string): string {
  if (/\bdata-gr-section\s*=/i.test(html)) return html
  return sectionEmail(html).markedHtml
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

async function open(
  browser: Browser,
  html: string,
  width: number,
  options: BrowserOptions
) {
  const { context, page } = await lockedPage(browser, width, options)
  try {
    await page.setContent(prepareHtml(html, []), {
      waitUntil: 'load',
      timeout: options.timeoutMs ?? 20_000
    })
    if (page.url() !== 'about:blank') throw new Error('navigated')
    return { context, page }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

/** Every box and computed style of the email laid out `width` wide. */
export async function measureHtml(
  browser: Browser,
  html: string,
  width = desktopWindow,
  options: BrowserOptions = {}
): Promise<Measurement> {
  const { context, page } = await open(
    browser,
    holdPictures(markedHtml(html), options.origins),
    width,
    options
  )
  try {
    const cdp = await context.newCDPSession(page)
    try {
      const snap = (await cdp.send('DOMSnapshot.captureSnapshot', {
        computedStyles: [...snapshotStyles],
        includeDOMRects: false
      })) as unknown as DomSnapshot
      return fromSnapshot(snap, width)
    } finally {
      await cdp.detach().catch(() => {})
    }
  } finally {
    await context.close().catch(() => {})
  }
}

/** A full-height JPEG of the email laid out `width` wide (for the owner to look at). */
export async function pictureOf(
  browser: Browser,
  html: string,
  width = desktopWindow,
  options: BrowserOptions = {}
): Promise<Buffer> {
  const { context, page } = await open(
    browser,
    holdPictures(markedHtml(html), options.origins),
    width,
    options
  )
  try {
    return await page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: true,
      animations: 'disabled',
      timeout: options.timeoutMs ?? 20_000
    })
  } finally {
    await context.close().catch(() => {})
  }
}
