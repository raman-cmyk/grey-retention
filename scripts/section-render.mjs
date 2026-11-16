/**
 * DST-001: the designed-section browser (D25, AGENT_MAP §4 layer 3, step
 * 4). It draws one designed section page (`sectionDocument` in
 * `features/studio/section.ts`, already checked) in Chromium at 600 CSS px
 * wide and twice the pixels, so the picture is 1,200 px wide and stays
 * sharp when the email shows it at 600. JavaScript is off; the page may
 * load only from the https origins it is given (its pictures and fonts)
 * or inline pictures, never follows a redirect (an allowed address that
 * redirects is refused, so nothing reaches another origin through it) and
 * never navigates. A job runs it on a runner with Chromium, like the inbox
 * screenshots (part 2).
 */

export const width = 600
export const scale = 2
/** JPEG at this quality keeps a section light; a section has no transparency. */
export const quality = 85
/** A section's picture stays well under what Klaviyo takes for one image. */
export const maxBytes = 3 * 1024 * 1024
export const minHeight = 40
export const maxHeight = 1600

/**
 * The origins a page may load from: https only (loopback http for tests),
 * never an opaque one ("null": file, about, blob).
 */
export function loadableOrigins(origins) {
  return new Set(
    [...origins].filter(
      (o) =>
        /^https:\/\/[^/]+$/i.test(o) ||
        /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(o)
    )
  )
}

const reason = (error) =>
  error instanceof Error && /timeout/i.test(error.message)
    ? 'timeout'
    : 'failed'

/**
 * A page that loads only `origins` (and inline pictures), never follows a
 * redirect and never navigates, with JavaScript off and no service
 * workers: the one way this script opens what it draws.
 */
async function lockedPage(browser, options, timeoutMs) {
  const allowed = loadableOrigins(options.origins)
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: options.scale,
    isMobile: options.isMobile ?? false,
    hasTouch: false,
    colorScheme: options.colorScheme ?? 'light',
    javaScriptEnabled: false,
    serviceWorkers: 'block'
  })
  try {
    const page = await context.newPage()
    await page.route('**/*', async (route) => {
      const request = route.request()
      const url = request.url()
      if (request.isNavigationRequest()) return route.abort()
      if (url.startsWith('data:')) return route.continue()
      let origin = ''
      try {
        origin = new URL(url).origin
      } catch {
        // An unreadable link is blocked like any other.
      }
      if (!allowed.has(origin)) return route.abort()
      // The browser would follow a redirect without asking again: fetch it
      // here, never following one.
      try {
        const response = await route.fetch({
          maxRedirects: 0,
          timeout: timeoutMs
        })
        if (response.status() >= 300 && response.status() < 400)
          return route.abort()
        return route.fulfill({ response })
      } catch {
        return route.abort()
      }
    })
    return { context, page }
  } catch (error) {
    await context.close().catch(() => {})
    throw error
  }
}

/**
 * Draws one section page and returns its JPEG (1,200 px wide, `height` × 2
 * tall). Throws `timeout`, `failed`, `navigated` or `too_large`.
 */
export async function renderSection(
  browser,
  { document, height, origins },
  timeoutMs = 20_000
) {
  if (!Number.isInteger(height) || height < minHeight || height > maxHeight)
    throw new Error('failed')
  const { context, page } = await lockedPage(
    browser,
    { viewport: { width, height }, scale, origins },
    timeoutMs
  )
  try {
    try {
      await page.setContent(document, { waitUntil: 'load', timeout: timeoutMs })
    } catch (error) {
      throw new Error(reason(error))
    }
    if (page.url() !== 'about:blank') throw new Error('navigated')
    let image
    try {
      // Playwright waits for the web fonts before it takes the picture.
      image = await page.screenshot({
        type: 'jpeg',
        quality,
        clip: { x: 0, y: 0, width, height },
        animations: 'disabled',
        timeout: timeoutMs
      })
    } catch (error) {
      throw new Error(reason(error))
    }
    if (image.byteLength > maxBytes) throw new Error('too_large')
    return {
      image,
      contentType: 'image/jpeg',
      width: width * scale,
      height: height * scale
    }
  } finally {
    await context.close().catch(() => {})
  }
}

/**
 * DST-005b: the views of a whole built email the owner's preview shows:
 * at 600 (desktop), at 375 (a phone's width: the email's own media queries
 * apply), and at 600 in dark mode (what a reader sees where the inbox
 * honours the email's own colour scheme; a client that forces its own
 * inversion, as Gmail's app, is not drawn). Each is a plain page, never
 * the browser's mobile mode: that lays a page out at 980 px without a
 * viewport tag and zooms out a wide one, so the email's height would be
 * measured wrong.
 *
 * DST-007: a desktop inbox shows the 600 px email in a wider pane, and the
 * email's phone layout takes over under 620 px (`features/blocks/render.ts`),
 * so desktop and dark are laid out in a `window` 700 px wide and the
 * email's 600 px are drawn from its middle (a built email is centred). The
 * phone is laid out at its own width.
 */
export const emailViews = Object.freeze({
  desktop: Object.freeze({ width: 600, window: 700, colorScheme: 'light' }),
  phone: Object.freeze({ width: 375, window: 375, colorScheme: 'light' }),
  dark: Object.freeze({ width: 600, window: 700, colorScheme: 'dark' })
})
/** An email is drawn at most this tall (CSS px); a longer one is cut. */
export const maxEmailHeight = 6_000
/** A whole email's picture (one pixel a CSS px): the studio bucket's limit. */
export const maxEmailBytes = 3 * 1024 * 1024
/**
 * The email is laid out in a window this short: the browser never reports
 * a page shorter than its window, so the email's own height shows. A page
 * no taller (empty, or one that scrolls inside itself) is not drawn.
 */
export const emailWindow = 100

/**
 * What would reach out from the page on its own, past the route guard: a
 * <link> (prefetch, preconnect and DNS prefetch skip request
 * interception), a meta http-equiv (a refresh navigates; its value may be
 * written with entities), and frames, objects and `srcdoc` (a page inside
 * the page). A built email has none (email apps ignore them anyway); a
 * page with one is refused, never drawn.
 */
const reachesOut =
  /<link\b|\bhttp-equiv\b|<(?:iframe|frame|frameset|object|embed|portal|fencedframe)\b|\bsrcdoc\b/i

/** The page's laid-out size (CSS px), as the browser measures it, never the page's own words. */
async function layoutSize(context, page) {
  const cdp = await context.newCDPSession(page)
  try {
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics')
    return cssContentSize
  } finally {
    await cdp.detach().catch(() => {})
  }
}

/**
 * Draws a whole built email in one view, as the sections are drawn
 * (JavaScript off, only its own origins, no redirect, no navigation), at
 * its full height up to `maxEmailHeight`, as a JPEG. `cut` says a longer
 * one was cut; `wide` says the page is wider than its window, 375 on a
 * phone and 700 on desktop (the picture keeps the view's width; markup
 * wider than 600 is refused before any view, DST-005). Throws `navigated` for a page that
 * would reach out on its own or that navigated, `timeout`, `failed` (an
 * unknown view, an empty page) or `too_large`.
 */
export async function renderEmail(
  browser,
  { document, view, origins },
  timeoutMs = 30_000
) {
  if (typeof view !== 'string' || !Object.hasOwn(emailViews, view))
    throw new Error('failed')
  if (typeof document !== 'string') throw new Error('failed')
  if (reachesOut.test(document)) throw new Error('navigated')
  const v = emailViews[view]
  const { context, page } = await lockedPage(
    browser,
    {
      viewport: { width: v.window, height: emailWindow },
      scale: 1,
      colorScheme: v.colorScheme,
      origins
    },
    timeoutMs
  )
  try {
    try {
      await page.setContent(document, { waitUntil: 'load', timeout: timeoutMs })
    } catch (error) {
      throw new Error(reason(error))
    }
    if (page.url() !== 'about:blank') throw new Error('navigated')
    let size
    try {
      size = await layoutSize(context, page)
    } catch {
      throw new Error('failed')
    }
    const measured = Math.ceil(Number(size?.height))
    const across = Math.ceil(Number(size?.width))
    if (!(measured > emailWindow) || !Number.isFinite(across))
      throw new Error('failed')
    const height = Math.min(measured, maxEmailHeight)
    let image
    try {
      image = await page.screenshot({
        type: 'jpeg',
        quality,
        // The whole page, cut at the limit (a clip alone stops at the
        // window).
        fullPage: true,
        // The email's own width, from the middle of its window.
        clip: { x: (v.window - v.width) / 2, y: 0, width: v.width, height },
        animations: 'disabled',
        timeout: timeoutMs
      })
    } catch (error) {
      throw new Error(reason(error))
    }
    if (image.byteLength > maxEmailBytes) throw new Error('too_large')
    return {
      image,
      contentType: 'image/jpeg',
      width: v.width,
      height,
      cut: measured > maxEmailHeight,
      wide: across > v.window
    }
  } finally {
    await context.close().catch(() => {})
  }
}
