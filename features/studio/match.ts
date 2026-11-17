import type { Verdict } from './critic'

/**
 * DST-004b part 1 (AGENT_MAP §4 layer 3, step 5): the match score, in
 * code. In Copy mode a designed section rebuilds its reference section
 * (D1 "Exact"), so besides the Design critic's checklist it must look
 * like it: where the picture, the words and the empty space sit, and its
 * light and dark areas. Never its words or its photo, which are this
 * brand's own.
 *
 * Both pictures come as small grey-level grids (`LumaGrid`, made where the
 * pictures are drawn: part 2). Code brings them to one size at the
 * reference's proportions and compares them the way SSIM does, over small
 * windows: brightness, contrast and structure. The score is 1 to 10; a
 * Copy section passes at `matchTarget` or more.
 */

/** A picture as grey levels (0 black to 255 white), row by row. */
export type LumaGrid = {
  width: number
  height: number
  values: readonly number[]
}

/** Columns both grids are compared at (rows follow the reference). */
export const matchColumns = 24
/** The most rows compared: a section is at most 1,200 px tall at 600 wide. */
const maxRows = 72
/** The fewest rows compared, for a very wide, short section. */
const minRows = 4
/** The largest grid taken, each way. */
export const maxGridSide = 256
/** A Copy section passes at this score or more (tuned with the design proof). */
export const matchTarget = 6

/** Why a grid cannot be compared, or null when it can. */
export function gridProblem(grid: unknown): string | null {
  const g = grid as Partial<LumaGrid> | null
  if (!g || typeof g !== 'object') return 'no grid'
  const { width, height, values } = g
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width! < 1 ||
    height! < 1 ||
    width! > maxGridSide ||
    height! > maxGridSide
  )
    return 'bad size'
  if (!Array.isArray(values) || values.length !== width! * height!)
    return 'bad values'
  if (!values.every((v) => Number.isFinite(v) && v >= 0 && v <= 255))
    return 'bad values'
  return null
}

/**
 * The grid at `w` × `h`, each cell the area-weighted mean of the cells it
 * covers (a grid made smaller or larger keeps its light and dark areas).
 */
export function resample(grid: LumaGrid, w: number, h: number): number[] {
  const out: number[] = []
  const sx = grid.width / w
  const sy = grid.height / h
  for (let y = 0; y < h; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < w; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      let sum = 0
      let area = 0
      for (
        let gy = Math.floor(y0);
        gy < Math.min(grid.height, Math.ceil(y1));
        gy++
      ) {
        const dy = Math.min(y1, gy + 1) - Math.max(y0, gy)
        if (dy <= 0) continue
        for (
          let gx = Math.floor(x0);
          gx < Math.min(grid.width, Math.ceil(x1));
          gx++
        ) {
          const dx = Math.min(x1, gx + 1) - Math.max(x0, gx)
          if (dx <= 0) continue
          sum += grid.values[gy * grid.width + gx]! * dx * dy
          area += dx * dy
        }
      }
      out.push(area ? sum / area : 0)
    }
  }
  return out
}

/** SSIM's constants for 0–255 grey levels. */
const c1 = (0.01 * 255) ** 2
const c2 = (0.03 * 255) ** 2
/** The window SSIM looks through, and how far it moves each time. */
const window = 4
const stride = 2

/** The mean SSIM of two grids of the same size, over the windows. */
function ssim(
  a: readonly number[],
  b: readonly number[],
  w: number,
  h: number
) {
  let total = 0
  let windows = 0
  const side = (n: number) => Math.min(window, n)
  const ww = side(w)
  const wh = side(h)
  const starts = (n: number, s: number) => {
    const list: number[] = []
    for (let i = 0; i + s <= n; i += stride) list.push(i)
    if (list.at(-1) !== n - s) list.push(n - s)
    return list
  }
  for (const y0 of starts(h, wh))
    for (const x0 of starts(w, ww)) {
      let ma = 0
      let mb = 0
      const n = ww * wh
      for (let y = y0; y < y0 + wh; y++)
        for (let x = x0; x < x0 + ww; x++) {
          ma += a[y * w + x]!
          mb += b[y * w + x]!
        }
      ma /= n
      mb /= n
      let va = 0
      let vb = 0
      let cov = 0
      for (let y = y0; y < y0 + wh; y++)
        for (let x = x0; x < x0 + ww; x++) {
          const da = a[y * w + x]! - ma
          const db = b[y * w + x]! - mb
          va += da * da
          vb += db * db
          cov += da * db
        }
      va /= n
      vb /= n
      cov /= n
      total +=
        ((2 * ma * mb + c1) * (2 * cov + c2)) /
        ((ma * ma + mb * mb + c1) * (va + vb + c2))
      windows++
    }
  return windows ? total / windows : 0
}

/**
 * How much the drawn section looks like its reference, 1 (nothing alike)
 * to 10 (the same layout of light and dark): both brought to
 * `matchColumns` wide at the reference's proportions, then their mean
 * SSIM (below 0, nothing alike) spread over 1 to 10. Throws for a grid
 * that cannot be compared (`gridProblem`): the caller's mistake.
 */
export function matchScore(drawn: LumaGrid, reference: LumaGrid): number {
  for (const g of [drawn, reference]) {
    const problem = gridProblem(g)
    if (problem) throw new Error(`The grid cannot be compared: ${problem}`)
  }
  const w = matchColumns
  const h = Math.min(
    maxRows,
    Math.max(minRows, Math.round((w * reference.height) / reference.width))
  )
  const s = ssim(resample(drawn, w, h), resample(reference, w, h), w, h)
  return Math.min(10, Math.max(1, Math.round(1 + 9 * Math.max(0, s))))
}

/**
 * The critic's verdict with the match score (Copy mode): below
 * `matchTarget` the section fails, and the Section designer's next round
 * is told how to come closer, in layout words only.
 */
export function withMatch(
  verdict: Verdict,
  match: number
): Verdict & {
  match: number
} {
  if (match >= matchTarget) return { ...verdict, match }
  return {
    ...verdict,
    match,
    pass: false,
    problems: [
      ...verdict.problems,
      `It looks too little like the reference section (match ${match} of 10, ${matchTarget} needed): keep the reference’s layout, where the picture, the words and the empty space sit, and its light and dark areas.`
    ]
  }
}
