import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TriesSoFar } from '@/features/strategy/retry'
import type { Verdict } from './critic'
import { briefHosts, type DesignedResult, type SectionBrief } from './designer'
import { maxSectionBytes, type RenderedSection } from './renderer'
import { SectionNotDrawable, studioWaits } from './limits'
import { isMatchScore, withMatch } from './match'
import type { DesignedSection } from './section'
import type { BuildRender } from './waits'

/**
 * DST-006c part 1: the design studio's rounds (D25, AGENT_MAP §4 layer 3,
 * owner pick #8). For each designed section of the storyboard: the Section
 * designer designs it (DST-003), the browser draws it (DST-001b, outside
 * the app), the Design critic judges the picture (DST-004a), and its
 * problems go into the next round: 3 rounds at most, and 12 pictures a
 * build. A section that cannot be designed, drawn or judged, or still
 * fails after its last round, is its coded block (D16), each with its
 * reason. Between claims the work is kept in the design step's work
 * (`StudioWork`); a step out of time pauses, and one waiting for its
 * pictures waits (DST-006b) until they are drawn or `until`, after which
 * the sections still drawing are coded too. Each pause and wait is one of
 * the design step's 6 waits (`wait_email_round`): before the last would
 * be spent, what is unfinished is coded.
 *
 * Everything outside is a port (`StudioPorts`), so this runs with fakes in
 * tests and with the agents, the render job and storage in the build
 * (DST-006c part 2).
 */

/** Rounds a section gets at most. */
export const maxRounds = 3
/**
 * The time a build gives its pictures, from its first round: the browser
 * draws every 10 minutes (DST-001c), so 3 rounds take about 30 minutes,
 * with room for a run that starts late.
 */
export const studioMs = 45 * 60_000
/** Designed sections an email has at most (today one hero). */
export const maxDesigned = 4
/** The rounds' own waits: the design step's, less one kept for the email's views. */
export const roundWaits = studioWaits.perStep - studioWaits.forViews
/** Agent calls the critic may make (its answer tried 3 times). */
const criticCalls = 3

/** Why a section is its coded block: the log's reason codes (D16). */
export const codedReasons = {
  design_failed: 'The Section designer gave no section that passed its checks.',
  not_drawable: 'The designed section could not be drawn.',
  too_many_pictures: 'The email used all its pictures.',
  render_failed: 'The browser could not draw the section.',
  render_timed_out: 'The picture did not come in time.',
  picture_unusable: 'The drawn picture could not be read, or was changed.',
  critic_unavailable: 'The Design critic could not look at the picture.',
  critic_failed: 'The picture still failed the critic after its last round.',
  studio_timed_out: 'The design studio ran out of time.',
  not_designable: 'The section had no https photo to design with.',
  layout_changed: 'The email’s sections and its draft did not match.',
  match_failed:
    'The picture still looked too little like the reference section after its last round.',
  storyboard_reordered:
    'The Art director moved the sections: the email keeps its own order.',
  reference_unfit:
    'The copied email’s section heights do not fit this email’s sections.'
} as const
export type CodedReason = keyof typeof codedReasons

/** At most `n` UTF-16 units, never half a character. */
const cut = (text: string, n: number) =>
  text.slice(0, n).replace(/[\uD800-\uDBFF]$/, '')

const sectionState = z
  .object({
    id: z.string().min(1).max(40),
    /** The brief it was designed for: another brief starts it over. */
    brief: z.string().regex(/^[0-9a-f]{16}$/),
    round: z.int().min(1).max(maxRounds),
    state: z.enum(['design', 'drawing', 'done', 'coded']),
    /** The critic's problems, for the next round's Section designer. */
    problems: z.array(z.string().max(400)).max(20),
    /** A design paused between its tries (DST-003). */
    tries: z
      .object({
        tries: z.int().min(0).max(3),
        problems: z.array(z.string().max(2000)).max(20),
        reasonCode: z.enum(['answer_invalid', 'check_failed'])
      })
      .optional(),
    render: z.uuid().optional(),
    alt: z.string().min(1).max(400).optional(),
    /** CSS px at 600 wide. */
    height: z.int().min(1).max(1600).optional(),
    /** DST-004b2d: its last match score against its reference (Copy). */
    match: z.int().min(1).max(10).optional(),
    reason: z.enum(Object.keys(codedReasons) as [CodedReason]).optional()
  })
  // Only the states the rounds make.
  .refine((s) =>
    s.state === 'design'
      ? !s.render && !s.reason
      : s.state === 'drawing'
        ? !!s.render && !!s.alt && !s.reason
        : s.state === 'done'
          ? !!s.render && !!s.alt && !!s.height && !s.reason
          : !!s.reason
  )
export type SectionState = z.infer<typeof sectionState>

/**
 * The studio's work between claims: the design step keeps it under its
 * own key (unknown keys around it, as the database's save count, are
 * left out when it is read).
 */
export const studioWork = z.object({
  /** Past this (ms since epoch), the sections still drawing are coded. */
  until: z.int().min(0),
  /** Pictures asked for so far (12 a build). */
  renders: z.int().min(0).max(studioWaits.renders),
  /** Pauses and waits so far (the design step's 6). */
  waits: z.int().min(0).max(studioWaits.perStep),
  sections: z.array(sectionState).max(maxDesigned)
})
export type StudioWork = z.infer<typeof studioWork>
/** The build's limits a work carries, kept even when the rest is unreadable. */
const budget = z.object({
  until: z.int().min(0),
  renders: z.int().min(0).max(studioWaits.renders),
  waits: z.int().min(0).max(studioWaits.perStep)
})

type DrawnRender = Extract<BuildRender, { state: 'drawn' }>

export type StudioPorts = {
  /** The Section designer (`designSection`), from its paused tries or the critic's problems. */
  design: (
    brief: SectionBrief,
    from?: TriesSoFar
  ) => Promise<DesignedResult | { paused: TriesSoFar } | null>
  /**
   * Asks for a section to be drawn (`requestSectionRender`): it throws
   * `SectionNotDrawable` for a section that cannot be, the database's
   * refusals (PT409, 22023) and anything else as they come.
   */
  request: (input: {
    key: string
    section: DesignedSection
    hosts: string[]
    /** DST-004b2b: in Copy mode, the inbox section crop it rebuilds. */
    reference?: string
  }) => Promise<string>
  /** The build's pictures, in its own workspace (`buildRenders`). */
  renders: () => Promise<BuildRender[]>
  /**
   * The stored picture of `section`, only when its tag is the one
   * recorded; else null.
   */
  picture: (
    render: DrawnRender,
    section: string
  ) => Promise<RenderedSection | null>
  /** The Design critic's verdict (`critiqueSection`); null when it cannot answer. */
  critique: (
    brief: SectionBrief,
    image: RenderedSection
  ) => Promise<Verdict | null>
  /**
   * DST-004b: in Copy mode, how much the drawn section looks like its
   * reference section (`matchScore`, 1 to 10); null when it cannot be
   * measured (then the critic's verdict stands). Missing: never measured.
   */
  match?: (brief: SectionBrief, render: DrawnRender) => Promise<number | null>
  /**
   * A section drawn as its coded block, with why: one line for the owner's
   * log per section (the agents log their own failures as well).
   */
  coded: (section: string, reason: CodedReason) => Promise<void>
  /** Whether `calls` more agent calls (default 1) fit in this claim. */
  fits: (calls?: number) => boolean
  now: () => number
}

export type RoundOutcome =
  /** Pictures were asked for: wait for them (`wait_email_round`). */
  | { wait: StudioWork; seconds: number }
  /**
   * Out of time in this claim: wait as for pictures (never a save,
   * DST-006b). With none queued, the studio's next run takes it back at
   * once; only past `seconds` may the sweep, which draws coded blocks.
   */
  | { paused: StudioWork; seconds: number }
  /** Every section is drawn and passed, or is its coded block. */
  | { done: StudioWork }

/** A short digest of a brief: saved work for another brief starts over. */
export const briefDigest = (brief: SectionBrief) =>
  createHash('sha256').update(JSON.stringify(brief)).digest('hex').slice(0, 16)

/** A render key the database takes: the section, its round, its design. */
export function renderKey(
  id: string,
  round: number,
  section: DesignedSection,
  /** DST-004b2b: the crop it rebuilds: another reference is another render. */
  reference?: string
) {
  const name = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 24)
  // Without a reference the key is as before, so saved work keeps its renders.
  const hash = createHash('sha256')
    .update(JSON.stringify(section) + (reference ? `|${reference}` : ''))
    .digest('hex')
    .slice(0, 8)
  return `${name}-r${round}-${hash}`
}

/** The first work for these briefs: every section to design, round 1. */
export function startWork(
  briefs: readonly SectionBrief[],
  now: number,
  kept?: { until: number; renders: number; waits: number }
): StudioWork {
  return {
    until: kept?.until ?? now + studioMs,
    renders: kept?.renders ?? 0,
    waits: kept?.waits ?? 0,
    sections: briefs.map((b) => ({
      id: b.board.id,
      brief: briefDigest(b),
      round: 1,
      state: 'design',
      problems: []
    }))
  }
}

/** A database refusal the rounds read as a reason, else null. */
function refusal(error: unknown): CodedReason | null {
  if (error instanceof SectionNotDrawable) return 'not_drawable'
  const e = error as { code?: string; details?: string; message?: string }
  if (e?.code === '22023')
    // The database's fixed answers about the section: its picture limit,
    // or a key, size or origin it refuses (a retry never passes).
    return e.details === 'too_many_renders'
      ? 'too_many_pictures'
      : 'not_drawable'
  // The same key with another section (a design made again after a lost
  // claim): that design cannot be drawn under its round's key.
  if (e?.code === 'PT409' && e.message === "This key is another section's")
    return 'not_drawable'
  return null
}

/**
 * One claim's share of the rounds: it goes as far as it can, then says
 * whether to wait for pictures, pause (out of time) or finish. `saved` is
 * the studio's saved work (none on the first claim). Work for other
 * briefs starts over, keeping the build's time, pictures and waits; so
 * does work that cannot be read. A port that throws (the claim's lease
 * lost, the database or a network down) throws out of the round: the
 * step is tried again from its saved work.
 */
export async function studioRound(
  briefs: readonly SectionBrief[],
  saved: unknown,
  ports: StudioPorts
): Promise<RoundOutcome> {
  if (briefs.length > maxDesigned)
    throw new Error(`At most ${maxDesigned} designed sections`)
  const parsed = studioWork.safeParse(saved)
  const matches =
    parsed.success &&
    parsed.data.sections.length === briefs.length &&
    parsed.data.sections.every(
      (s, i) =>
        s.id === briefs[i]!.board.id && s.brief === briefDigest(briefs[i]!)
    )
  const kept = budget.safeParse(saved)
  const work: StudioWork = matches
    ? structuredClone(parsed.data)
    : startWork(briefs, ports.now(), kept.success ? kept.data : undefined)
  const code = async (s: SectionState, reason: CodedReason) => {
    s.state = 'coded'
    s.reason = reason
    delete s.tries
    delete s.render
    // A score is kept only for the picture it failed: never another's.
    if (reason !== 'match_failed') delete s.match
    await ports.coded(s.id, reason)
  }
  let renders: BuildRender[] | undefined
  let paused = false
  for (const [i, s] of work.sections.entries()) {
    const brief = briefs[i]!
    if (s.state === 'drawing') {
      renders ??= await ports.renders()
      const render = renders.find((r) => r.id === s.render)
      if (!render || render.state === 'failed') {
        await code(s, 'render_failed')
        continue
      }
      if (render.state === 'queued') {
        if (ports.now() >= work.until) await code(s, 'render_timed_out')
        continue
      }
      if (!ports.fits(criticCalls)) {
        paused = true
        continue
      }
      const picture = await ports.picture(render, s.id)
      if (
        !picture ||
        picture.id !== s.id ||
        picture.bytes.byteLength > maxSectionBytes
      ) {
        await code(s, 'picture_unusable')
        continue
      }
      const judged = await ports.critique(brief, picture)
      if (!judged) {
        await code(s, 'critic_unavailable')
        continue
      }
      // DST-004b: a Copy section must also look like its reference. A
      // match that cannot be measured (a port that fails, or a number that
      // is not a score) leaves the critic's verdict: it never costs the
      // critic's calls again.
      const measured =
        brief.mode === 'copy' && brief.reference && ports.match
          ? await ports.match(brief, render).catch(() => null)
          : null
      const verdict = isMatchScore(measured)
        ? withMatch(judged, measured)
        : judged
      // DST-004b2d: the score is kept with the section (the design proof).
      if (isMatchScore(measured)) s.match = measured
      else delete s.match
      if (verdict.pass) {
        s.state = 'done'
        s.height = render.height
        continue
      }
      if (s.round >= maxRounds) {
        // The critic passed it: only the match failed.
        await code(s, judged.pass ? 'match_failed' : 'critic_failed')
        continue
      }
      s.round++
      s.state = 'design'
      s.problems = verdict.problems.slice(0, 20).map((p) => cut(p, 400))
      delete s.render
      delete s.alt
      // The next round's picture gets its own score.
      delete s.match
    }
    if (s.state !== 'design') continue
    // Out of time, or no wait left for the picture it would ask for (one
    // is kept for the email's inbox views, DST-006d).
    if (ports.now() >= work.until || work.waits >= roundWaits) {
      await code(s, 'studio_timed_out')
      continue
    }
    // No picture left: no design is paid for.
    if (work.renders >= studioWaits.renders) {
      await code(s, 'too_many_pictures')
      continue
    }
    if (!ports.fits()) {
      paused = true
      continue
    }
    const from: TriesSoFar | undefined =
      s.tries ??
      (s.problems.length
        ? { tries: 0, problems: s.problems, reasonCode: 'check_failed' }
        : undefined)
    const made = await ports.design(brief, from)
    if (made && 'paused' in made) {
      s.tries = made.paused
      paused = true
      continue
    }
    delete s.tries
    if (!made) {
      await code(s, 'design_failed')
      continue
    }
    let render: string
    try {
      // The match score reads the crop it rebuilds (Copy mode only).
      const reference =
        brief.mode === 'copy' ? brief.reference?.image : undefined
      render = await ports.request({
        key: renderKey(s.id, s.round, made.section, reference),
        section: made.section,
        hosts: briefHosts(brief),
        ...(reference ? { reference } : {})
      })
    } catch (error) {
      const reason = refusal(error)
      if (!reason) throw error
      await code(s, reason)
      continue
    }
    work.renders++
    s.state = 'drawing'
    s.render = render
    s.alt = cut(made.alt, 400)
  }
  const waiting =
    paused ||
    work.sections.some((s) => s.state === 'design' || s.state === 'drawing')
  if (!waiting) return { done: studioWork.parse(work) }
  if (work.waits >= roundWaits) {
    // No wait is left for the rounds: what is unfinished is coded now.
    for (const s of work.sections)
      if (s.state === 'design' || s.state === 'drawing')
        await code(s, 'studio_timed_out')
    return { done: studioWork.parse(work) }
  }
  // A pause and a wait both wait until the studio's time is up: the
  // studio's job takes the step back as soon as no picture is queued.
  work.waits++
  const left = Math.ceil((work.until - ports.now()) / 1000)
  const seconds = Math.min(
    studioWaits.maxSeconds,
    Math.max(studioWaits.minSeconds, left)
  )
  if (paused || work.sections.some((s) => s.state === 'design'))
    return { paused: studioWork.parse(work), seconds }
  return { wait: studioWork.parse(work), seconds }
}

/**
 * A section done, as its hero's studio picture (DST-006a), given the
 * picture's long-lived https link; null for any other section. The caller
 * signs only a render `buildRenders` read as drawn in the build's own
 * workspace, with its tag checked.
 */
export function heroPicture(s: SectionState, src: string) {
  if (s.state !== 'done' || !s.render || !s.alt || !s.height) return null
  return { src, alt: s.alt, height: s.height, render: s.render }
}
