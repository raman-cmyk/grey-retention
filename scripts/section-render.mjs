/**
 * DST-001: the designed-section browser (D25, AGENT_MAP §4 layer 3, step
 * 4). It draws one designed section page (`sectionDocument` in
 * `features/studio/section.ts`, already checked) in Chromium at 600 CSS px
 * wide and twice the pixels, so the picture is 1,200 px wide and stays
 * sharp when the email shows it at 600. JavaScript is off; the page may
 * load only from the origins it is given (its pictures and fonts) or
 * inline pictures, and never navigate. A job runs it on a runner with
 * Chromium, like the inbox screenshots (part 2).
 */

export const width = 600
export const scale = 2
/** A section's picture stays well under what Klaviyo takes for one image. */
export const maxBytes = 4 * 1024 * 1024

/**
 * Draws one section page and returns its PNG (1,200 px wide, `height` × 2
 * tall). Throws `timeout`, `navigated` or `too_large`.
 */
export async function renderSection(
  browser,
  { document, height, origins },
  timeoutMs = 20_000
) {
  const allowed = new Set(origins)
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
    await page.route('**/*', (route) => {
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
      return allowed.has(origin) ? route.continue() : route.abort()
    })
    try {
      await page.setContent(document, { waitUntil: 'load', timeout: timeoutMs })
    } catch (error) {
      throw new Error(
        error instanceof Error && /timeout/i.test(error.message)
          ? 'timeout'
          : 'failed'
      )
    }
    if (page.url() !== 'about:blank') throw new Error('navigated')
    // Playwright waits for the web fonts before it takes the picture.
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      animations: 'disabled',
      timeout: timeoutMs
    })
    if (png.byteLength > maxBytes) throw new Error('too_large')
    return { png, width: width * scale, height: height * scale }
  } finally {
    await context.close()
  }
}
