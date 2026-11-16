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
    await context.close()
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
    await context.close()
  }
}

/**
 * DST-005b: the views of a whole built email the owner's preview shows:
 * at 600 (desktop), at 375 as a phone, and at 600 in dark mode (what a
 * reader sees where the inbox honours the email's own colour scheme; a
 * client that forces its own inversion, as Gmail's app, is not drawn).
 */
export const emailViews = {
  desktop: { width: 600, isMobile: false, colorScheme: 'light' },
  phone: { width: 375, isMobile: true, colorScheme: 'light' },
  dark: { width: 600, isMobile: false, colorScheme: 'dark' }
}
/** An email is drawn at most this tall (CSS px); a longer one is cut. */
export const maxEmailHeight = 6_000
/** A whole email's picture, at its own size (one pixel a CSS px). */
export const maxEmailBytes = 5 * 1024 * 1024

/**
 * Draws a whole built email in one view, as the sections are drawn
 * (JavaScript off, only its own origins, no redirect, no navigation), at
 * its full height up to `maxEmailHeight`, as a JPEG. Its height is
 * measured in the page; `cut` says a longer one was cut. Throws
 * `timeout`, `failed`, `navigated` or `too_large`.
 */
export async function renderEmail(
  browser,
  { document, view, origins },
  timeoutMs = 30_000
) {
  const v = emailViews[view]
  if (!v) throw new Error('failed')
  const { context, page } = await lockedPage(
    browser,
    {
      viewport: { width: v.width, height: 800 },
      scale: 1,
      isMobile: v.isMobile,
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
    let measured
    try {
      measured = await page.evaluate(() =>
        Math.ceil(document.documentElement.scrollHeight)
      )
    } catch {
      throw new Error('failed')
    }
    if (!Number.isInteger(measured) || measured < 1) throw new Error('failed')
    const height = Math.min(measured, maxEmailHeight)
    let image
    try {
      image = await page.screenshot({
        type: 'jpeg',
        quality,
        // The whole page, cut at the limit (a clip alone stops at the
        // viewport).
        fullPage: true,
        clip: { x: 0, y: 0, width: v.width, height },
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
      cut: measured > maxEmailHeight
    }
  } finally {
    await context.close()
  }
}
