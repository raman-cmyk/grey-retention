import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TriesSoFar } from '@/features/strategy/retry'
import type { Verdict } from './critic'
import { briefHosts, type DesignedResult, type SectionBrief } from './designer'
import type { RenderedSection } from './renderer'
import type { DesignedSection } from './section'
import { studioWaits, type BuildRender } from './waits'

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
 * the sections still drawing are coded too.
 *
 * Everything outside is a port (`StudioPorts`), so this runs with fakes in
 * tests and with the agents, the render job and storage in the build
 * (DST-006c part 2).
 */

/** Rounds a section gets at most. */
export const maxRounds = 3
/** The time a build gives its pictures, from its first round. */
export const studioMs = 30 * 60_000

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
  studio_timed_out: 'The design studio ran out of time.'
} as const
export type CodedReason = keyof typeof codedReasons

const sectionState = z.strictObject({
  id: z.string().min(1).max(40),
  round: z.int().min(1).max(maxRounds),
  state: z.enum(['design', 'drawing', 'done', 'coded']),
  /** The critic's problems, for the next round's Section designer. */
  problems: z.array(z.string().max(400)).max(20),
  /** A design paused between its tries (DST-003). */
  tries: z
    .strictObject({
      tries: z.int().min(0).max(3),
      problems: z.array(z.string().max(2000)).max(20),
      reasonCode: z.enum(['answer_invalid', 'check_failed'])
    })
    .optional(),
  render: z.uuid().optional(),
  alt: z.string().max(400).optional(),
  /** CSS px at 600 wide. */
  height: z.int().min(1).max(1600).optional(),
  reason: z.enum(Object.keys(codedReasons) as [CodedReason]).optional()
})
export type SectionState = z.infer<typeof sectionState>

/** The studio's work between claims, inside the design step's work. */
export const studioWork = z.strictObject({
  /** Past this (ms since epoch), the sections still drawing are coded. */
  until: z.int().min(0),
  /** Pictures asked for so far (12 a build). */
  renders: z.int().min(0).max(studioWaits.renders),
  sections: z.array(sectionState).max(4)
})
export type StudioWork = z.infer<typeof studioWork>

type DrawnRender = Extract<BuildRender, { state: 'drawn' }>

export type StudioPorts = {
  /** The Section designer (`designSection`), from its paused tries or the critic's problems. */
  design: (
    brief: SectionBrief,
    from?: TriesSoFar
  ) => Promise<DesignedResult | { paused: TriesSoFar } | null>
  /** Asks for a section to be drawn (`requestSectionRender`); throws when it cannot be. */
  request: (input: {
    key: string
    section: DesignedSection
    hosts: string[]
  }) => Promise<string>
  /** The build's pictures (`buildRenders`). */
  renders: () => Promise<BuildRender[]>
  /** The stored picture, only when its tag is the one recorded; else null. */
  picture: (render: DrawnRender) => Promise<RenderedSection | null>
  /** The Design critic's verdict (`critiqueSection`); null when it cannot answer. */
  critique: (
    brief: SectionBrief,
    image: RenderedSection
  ) => Promise<Verdict | null>
  /** A section drawn as its coded block, with why (the fallback log). */
  coded: (section: string, reason: CodedReason) => Promise<void>
  /** Whether one more agent call fits in this claim. */
  fits: () => boolean
  now: () => number
}

export type RoundOutcome =
  /** Pictures were asked for: wait for them (`wait_email_round`). */
  | { wait: StudioWork; seconds: number }
  /** Out of time in this claim: wait a minute and go on (never a save, DST-006b). */
  | { paused: StudioWork }
  /** Every section is drawn and passed, or is its coded block. */
  | { done: StudioWork }

/** A render key the database takes: the section, its round, its design. */
export function renderKey(id: string, round: number, section: DesignedSection) {
  const name = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 24)
  const hash = createHash('sha256')
    .update(JSON.stringify(section))
    .digest('hex')
    .slice(0, 8)
  return `${name}-r${round}-${hash}`
}

/** The first work for these briefs: every section to design, round 1. */
export function startWork(
  briefs: readonly SectionBrief[],
  now: number
): StudioWork {
  return {
    until: now + studioMs,
    renders: 0,
    sections: briefs.map((b) => ({
      id: b.board.id,
      round: 1,
      state: 'design',
      problems: []
    }))
  }
}

/**
 * One claim's share of the rounds: it goes as far as it can, then says
 * whether to wait for pictures, pause (out of time) or finish. `work` is
 * the saved work (null on the first claim); a saved work that does not
 * match the briefs starts over.
 */
export async function studioRound(
  briefs: readonly SectionBrief[],
  saved: unknown,
  ports: StudioPorts
): Promise<RoundOutcome> {
  const parsed = studioWork.safeParse(saved)
  const matches =
    parsed.success &&
    parsed.data.sections.length === briefs.length &&
    parsed.data.sections.every((s, i) => s.id === briefs[i]!.board.id)
  const work: StudioWork = matches
    ? structuredClone(parsed.data)
    : startWork(briefs, ports.now())
  const code = async (s: SectionState, reason: CodedReason) => {
    s.state = 'coded'
    s.reason = reason
    delete s.tries
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
      if (!ports.fits()) {
        paused = true
        continue
      }
      const picture = await ports.picture(render)
      if (!picture) {
        await code(s, 'picture_unusable')
        continue
      }
      const verdict = await ports.critique(brief, picture)
      if (!verdict) {
        await code(s, 'critic_unavailable')
        continue
      }
      if (verdict.pass) {
        s.state = 'done'
        s.height = render.height
        continue
      }
      if (s.round >= maxRounds) {
        await code(s, 'critic_failed')
        continue
      }
      s.round++
      s.state = 'design'
      s.problems = verdict.problems.slice(0, 20).map((p) => p.slice(0, 400))
      delete s.render
      delete s.alt
    }
    if (s.state !== 'design') continue
    if (ports.now() >= work.until) {
      await code(s, 'studio_timed_out')
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
    if (work.renders >= studioWaits.renders) {
      await code(s, 'too_many_pictures')
      continue
    }
    let render: string
    try {
      render = await ports.request({
        key: renderKey(s.id, s.round, made.section),
        section: made.section,
        hosts: briefHosts(brief)
      })
    } catch {
      await code(s, 'not_drawable')
      continue
    }
    work.renders++
    s.state = 'drawing'
    s.render = render
    s.alt = made.alt
  }
  if (paused || work.sections.some((s) => s.state === 'design'))
    return { paused: work }
  if (work.sections.some((s) => s.state === 'drawing')) {
    const left = Math.ceil((work.until - ports.now()) / 1000)
    return {
      wait: work,
      seconds: Math.min(
        studioWaits.maxSeconds,
        Math.max(studioWaits.minSeconds, left)
      )
    }
  }
  return { done: work }
}

/**
 * A section done, as its hero's studio picture (DST-006a), given the
 * picture's long-lived https link; null for any other section.
 */
export function heroPicture(s: SectionState, src: string) {
  if (s.state !== 'done' || !s.render || !s.alt || !s.height) return null
  return { src, alt: s.alt, height: s.height, render: s.render }
}
