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
  const allowed = loadableOrigins(origins)
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: false,
    hasTouch: false,
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
