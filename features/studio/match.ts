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
 * reference's proportions and compares their layouts: which cells stand
 * out from the background (the photo, the words, a shape), with small
 * moves forgiven, and how light or dark the background is. What a photo
 * shows never counts (Copy always has the brand's own photo). The score
 * is 1 to 10; a Copy section passes at `matchTarget` or more.
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

/** How far from the background a cell is content (a tenth of the range). */
const contentStep = 26
/** How far a cell's content reaches its neighbours: small moves are forgiven. */
const reach = 1

/** The width of the grey-level bands the background is found in. */
const band = 16
/** A background is real when this share of the cells is at its level. */
const realGround = 0.25
/**
 * How close to the background level a flat background's cells are: a
 * drawn flat colour stays within a level or two once made smaller; a
 * smooth photo (a soft wall, a sky) does not.
 */
const flatStep = 2
/** One picture with a flat background, the other filled: about half alike. */
const mixedGround = 0.6

/**
 * The picture’s background level: the grey level most of its edge cells
 * share (the band holding the most of them, then the middle value inside
 * it), and whether it is a real background (a quarter of all the cells
 * within `flatStep` of its level, as a flat colour is). A photo spreads
 * over many levels; a section's background is one. A section the photo
 * fills has none.
 */
function backgroundOf(values: readonly number[], w: number, h: number) {
  const bands = new Map<number, number[]>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!(y === 0 || x === 0 || y === h - 1 || x === w - 1)) continue
      const v = values[y * w + x]!
      const k = Math.min(15, Math.floor(v / band))
      const list = bands.get(k) ?? []
      list.push(v)
      bands.set(k, list)
    }
  let best: number[] = []
  for (const list of bands.values()) if (list.length > best.length) best = list
  best.sort((p, q) => p - q)
  const level = best[Math.floor(best.length / 2)] ?? 255
  const share =
    values.filter((v) => Math.abs(v - level) <= flatStep).length / values.length
  return { level, real: share >= realGround }
}

/**
 * Where the picture has content (a photo, words, a shape): a cell that
 * stands out from the background, or has texture (its neighbours differ
 * from it), is 1, else 0; then each is spread over its neighbours
 * (`reach`), so a small move costs a little, not everything. A picture
 * with no flat background (a photo fills it) is content everywhere. What
 * the content looks like inside (the photo) never counts.
 */
function contentMap(values: readonly number[], w: number, h: number) {
  const bg = backgroundOf(values, w, h)
  const ground = bg.level
  const at = (x: number, y: number) => values[y * w + x]!
  const solid: number[] = []
  // No flat background: the content fills it all.
  if (!bg.real) return { ground, real: false, spread: values.map(() => 1) }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = at(x, y)
      let textured = false
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1]
      ] as const) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        if (Math.abs(at(xx, yy) - v) > contentStep) textured = true
      }
      solid.push(textured || Math.abs(v - ground) > contentStep ? 1 : 0)
    }
  const spread: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const yy = y + dy
          const xx = x + dx
          if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue
          sum += solid[yy * w + xx]!
          n++
        }
      spread.push(sum / n)
    }
  return { ground, real: bg.real, spread }
}

/**
 * How much two pictures of the same size share their layout, 0 to 1:
 * where their content sits (the weighted overlap of their content maps;
 * two empty pictures share it fully), times how close their backgrounds
 * are: a light background against a dark one shares nothing, and a flat
 * background against a picture a photo fills about half (`mixedGround`).
 */
export function layoutShare(
  a: readonly number[],
  b: readonly number[],
  w: number,
  h: number
) {
  const ma = contentMap(a, w, h)
  const mb = contentMap(b, w, h)
  let both = 0
  let either = 0
  for (let i = 0; i < w * h; i++) {
    both += Math.min(ma.spread[i]!, mb.spread[i]!)
    either += Math.max(ma.spread[i]!, mb.spread[i]!)
  }
  const overlap = either ? both / either : 1
  // Light against dark shares nothing; flat against filled about half.
  const tone =
    ma.real && mb.real
      ? 1 - Math.min(1, (2 * Math.abs(ma.ground - mb.ground)) / 255)
      : ma.real || mb.real
        ? mixedGround
        : 1
  return overlap * tone
}

/**
 * How much the drawn section looks like its reference, 1 (nothing alike)
 * to 10 (the same layout): both brought to `matchColumns` wide at the
 * reference's proportions, then where their content sits and how their
 * backgrounds compare (`layoutShare`), spread over 1 to 10. What the
 * photo shows and the words never count: a Copy rebuild has this brand's
 * own. Throws for a grid that cannot be compared (`gridProblem`): the
 * caller's mistake.
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
  const share = layoutShare(
    resample(drawn, w, h),
    resample(reference, w, h),
    w,
    h
  )
  return Math.min(10, Math.max(1, Math.round(1 + 9 * share)))
}

/** A score the rounds take: a whole number from 1 to 10, else none. */
export const isMatchScore = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10

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
