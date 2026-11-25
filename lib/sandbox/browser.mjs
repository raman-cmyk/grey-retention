/**
 * The locked headless browser's shared rules (INB-002, DST-001,
 * DES-ENGINE-001). Plain JavaScript, so the browser jobs in `scripts/`
 * (run by Node on a GitHub runner) and the TypeScript code in `features/`
 * share one copy: which origins a page may load from, what is made inert
 * before a stranger's HTML is drawn, and how Chromium is launched.
 */

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

/**
 * Tags that reach out on their own, past request interception: <link>
 * (prefetch, preconnect and DNS prefetch skip it; email apps ignore <link>
 * anyway), <meta> (a refresh navigates after the page loads) and <base>
 * (it moves every relative address); and the pages inside a page (<iframe>,
 * <frame>, <object>, <embed>), which email apps drop and which today's
 * Chromium keeps quiet only by its own rules. Each is turned, wherever it
 * is written, into an empty hidden `<wbr>` that keeps the old attributes as
 * plain text: a pattern over a whole tag misses one whose attribute holds a
 * "<" (INB-002b review), and an unknown tag name would wrap everything
 * after it, so `body > table` rules would stop matching (second review).
 */
const inertTags = /<(link|meta|base|iframe|frame|object|embed)\b/gi

/** The HTML with every tag that reaches out on its own made inert. */
export function makeInert(html) {
  return html.replace(
    inertTags,
    (_, tag) => `<wbr hidden data-gr-${tag.toLowerCase()}`
  )
}

/**
 * Chromium parses strangers' HTML and images: it gets no secret in its
 * environment, and its own OS sandbox where the machine allows one (a
 * machine that cannot give one, such as some containers, falls back to
 * launching without it).
 */
export async function launch(chromium) {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
  try {
    return await chromium.launch({ chromiumSandbox: true, env })
  } catch {
    return chromium.launch({ env })
  }
}
