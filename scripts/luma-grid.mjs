/**
 * DST-004b2c: the match score's grids (DST-004b1, `features/studio/match.ts`).
 * The section browser job reads each drawn section, and in Copy mode the
 * inbox section crop it rebuilds, as a small grid of grey levels: each cell
 * the area-averaged brightness of the pixels it covers (the score needs the
 * average: a flat background stays within a level or two only so).
 *
 * The picture is decoded by Chromium in a page of its own: JavaScript on
 * only for this code, every request refused, the picture given as data.
 * The crop comes through its short signed link; the link is never printed
 * (it carries a working token), so every failure is a fixed word.
 */

/** As `gridBudget` in features/studio/match.ts (a test keeps them equal). */
export const gridBudget = { columns: 48, rows: 128 }
/** The largest crop fetched: a section picture is at most 3 MiB. */
export const maxCropBytes = 3 * 1024 * 1024
/** How long fetching the crop may take. */
export const cropMs = 15_000

/**
 * The grid of an RGBA picture (`width` × `height` pixels): at most
 * `budget.columns` columns, rows at the picture's proportions (at most
 * `budget.rows`: a taller picture is made shorter), each cell the mean
 * brightness (0.299 R + 0.587 G + 0.114 B) of the pixels it covers,
 * rounded to a whole grey level. It is also run inside the page, so it
 * uses nothing from outside itself.
 */
export function averageGrid(rgba, width, height, budget) {
  const columns = Math.max(1, Math.min(budget.columns, width))
  const rows = Math.max(
    1,
    Math.min(budget.rows, height, Math.round((columns * height) / width))
  )
  const values = []
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * height) / rows)
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows))
    for (let c = 0; c < columns; c++) {
      const x0 = Math.floor((c * width) / columns)
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / columns))
      let sum = 0
      let n = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
          n++
        }
      values.push(Math.min(255, Math.max(0, Math.round(sum / n))))
    }
  }
  return { width: columns, height: rows, values }
}

/**
 * The grid of a JPEG, decoded in its own page; null when it cannot be
 * read (the match is then not measured). Never throws.
 */
export async function lumaGrid(browser, jpeg, timeoutMs = 10_000) {
  let context
  try {
    context = await browser.newContext({ javaScriptEnabled: true })
    const page = await context.newPage()
    // Nothing leaves the page: the picture is data.
    await page.route('**/*', (route) => route.abort())
    page.setDefaultTimeout(timeoutMs)
    const grid = await page.evaluate(
      async ([source, base64, budget]) => {
        const average = new Function(`return (${source})`)()
        const img = new Image()
        img.src = `data:image/jpeg;base64,${base64}`
        await img.decode()
        const w = img.naturalWidth
        const h = img.naturalHeight
        if (!w || !h) return null
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return average(ctx.getImageData(0, 0, w, h).data, w, h, budget)
      },
      [averageGrid.toString(), Buffer.from(jpeg).toString('base64'), gridBudget]
    )
    return grid && grid.values?.length === grid.width * grid.height
      ? grid
      : null
  } catch {
    return null
  } finally {
    await context?.close().catch(() => {})
  }
}

/**
 * The crop's bytes through its signed link (https, no redirect, at most
 * `maxCropBytes`, a JPEG). Throws only `reference_failed`: never the
 * link, never the answer's words.
 */
export async function fetchCrop(url, ms = cropMs) {
  try {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error()
    const response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(ms)
    })
    if (!response.ok) throw new Error()
    const type = response.headers.get('content-type') ?? ''
    if (!/^image\/jpeg\b/i.test(type)) throw new Error()
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > maxCropBytes) throw new Error()
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength || bytes.byteLength > maxCropBytes) throw new Error()
    return bytes
  } catch {
    throw new Error('reference_failed')
  }
}
