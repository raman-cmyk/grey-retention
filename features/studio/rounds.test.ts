// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { SectionBrief } from './designer'
import type { RenderedSection } from './renderer'
import {
  heroPicture,
  maxRounds,
  renderKey,
  startWork,
  studioMs,
  studioRound,
  type StudioPorts,
  type StudioWork
} from './rounds'
import type { BuildRender } from './waits'

const photo = 'https://cdn.shop.example/images/tray.jpg'
const brief = (id: string): SectionBrief => ({
  mode: 'scratch',
  slot: { emailType: 'launch', angle: 'The new tray is here' },
  board: {
    id,
    render: 'designed',
    tone: 'dark',
    height: 640,
    focus: 'The new tray',
    imagery: 'product',
    space: 'airy',
    note: 'The tray large on the right, the words on the left.'
  },
  family: 'hero_product',
  words: { headline: 'Meet the cedar tray' },
  image: { url: photo },
  product: { title: 'Cedar tray' },
  brand: {
    name: 'Grove & Co',
    font: 'Poppins',
    ink: '#1a1a1a',
    background: '#f6f3ee',
    accent: '#c2410c',
    dark: '#1f2933'
  },
  fonts: []
})
const uuid = (n: number) =>
  `${String(n).padStart(8, '0')}-3333-4333-8333-333333333333`
const designed = (id: string, n = 1) => ({
  section: {
    id,
    height: 640,
    html: `<img src="${photo}" alt=""><h1>Meet the cedar tray ${n}</h1>`,
    css: ''
  },
  alt: 'Meet the cedar tray',
  runId: `run-${n}`
})
const image: RenderedSection = {
  id: 's2',
  bytes: new Uint8Array([1]),
  contentType: 'image/jpeg',
  width: 1200,
  height: 1280
}
const drawn = (n: number): BuildRender => ({
  id: uuid(n),
  key: `s2-r1-${n}`,
  state: 'drawn',
  path: `render/${uuid(n)}.jpg`,
  height: 640,
  bytes: 1,
  etag: 'e'
})
const pass = { pass: true, scores: {} as never, problems: [] }
const fail = (p = 'Make the headline larger.') => ({
  pass: false,
  scores: {} as never,
  problems: [p]
})

/** Fake ports: each call answers from its own queue (the last answer repeats). */
function ports(
  answers: {
    design?: unknown[]
    renders?: BuildRender[]
    picture?: (RenderedSection | null)[]
    critique?: unknown[]
    request?: (string | Error)[]
    fits?: boolean[]
  } = {},
  clock = { t: 1_000_000 }
) {
  const take = <T>(list: T[] | undefined, fallback: T): T =>
    !list?.length ? fallback : list.length > 1 ? list.shift()! : list[0]!
  let requests = 0
  const p = {
    design: vi.fn(async () =>
      take(answers.design, designed('s2') as unknown)
    ) as StudioPorts['design'],
    request: vi.fn<StudioPorts['request']>(async () => {
      const next = take(answers.request, uuid(++requests))
      if (next instanceof Error) throw next
      return next
    }),
    renders: vi.fn(async () => answers.renders ?? []),
    picture: vi.fn(async () => take(answers.picture, image)),
    critique: vi.fn(async () =>
      take(answers.critique, pass as unknown)
    ) as StudioPorts['critique'],
    coded: vi.fn(async () => {}),
    fits: vi.fn(() => take(answers.fits, true)),
    now: () => clock.t
  }
  return p
}

describe('the design studio’s rounds (DST-006c)', () => {
  it('designs each section and asks for its picture, then waits for them', async () => {
    const p = ports({ design: [designed('s2'), designed('s4', 2)] })
    const out = await studioRound([brief('s2'), brief('s4')], null, p)
    expect(out).toMatchObject({ seconds: studioMs / 1000 })
    const work = (out as { wait: StudioWork }).wait
    expect(work).toMatchObject({ until: 1_000_000 + studioMs, renders: 2 })
    expect(work.sections).toEqual([
      {
        id: 's2',
        round: 1,
        state: 'drawing',
        problems: [],
        render: uuid(1),
        alt: 'Meet the cedar tray'
      },
      {
        id: 's4',
        round: 1,
        state: 'drawing',
        problems: [],
        render: uuid(2),
        alt: 'Meet the cedar tray'
      }
    ])
    expect(p.request.mock.calls[0]![0]).toEqual({
      key: renderKey('s2', 1, designed('s2').section),
      section: designed('s2').section,
      hosts: ['cdn.shop.example']
    })
    expect(p.design).toHaveBeenCalledWith(brief('s2'), undefined)
  })

  it('takes a picture that passes the critic, with its height, and the hero gets it', async () => {
    const first = await studioRound([brief('s2')], null, ports())
    const p = ports({ renders: [drawn(1)] })
    const out = await studioRound(
      [brief('s2')],
      (first as { wait: StudioWork }).wait,
      p
    )
    const done = (out as { done: StudioWork }).done
    expect(done.sections[0]).toMatchObject({ state: 'done', height: 640 })
    expect(p.picture).toHaveBeenCalledWith(drawn(1))
    expect(p.critique).toHaveBeenCalledWith(brief('s2'), image)
    expect(heroPicture(done.sections[0]!, 'https://db.example/x.jpg')).toEqual({
      src: 'https://db.example/x.jpg',
      alt: 'Meet the cedar tray',
      height: 640,
      render: uuid(1)
    })
    expect(p.coded).not.toHaveBeenCalled()
  })

  it('sends the critic’s problems into the next round, then codes a section that fails its last', async () => {
    let work: unknown = null
    const p = ports()
    work = ((await studioRound([brief('s2')], work, p)) as { wait: unknown })
      .wait
    for (let round = 1; round < maxRounds; round++) {
      const next = ports({
        renders: [{ ...drawn(round), id: uuid(round) }],
        critique: [fail(`Problem ${round}`)],
        request: [uuid(round + 1)]
      })
      const out = await studioRound([brief('s2')], work, next)
      work = (out as { wait: StudioWork }).wait
      expect(next.design).toHaveBeenCalledWith(brief('s2'), {
        tries: 0,
        problems: [`Problem ${round}`],
        reasonCode: 'check_failed'
      })
      expect((work as StudioWork).sections[0]).toMatchObject({
        round: round + 1,
        state: 'drawing',
        render: uuid(round + 1)
      })
    }
    const last = ports({
      renders: [{ ...drawn(maxRounds), id: uuid(maxRounds) }],
      critique: [fail()]
    })
    const out = await studioRound([brief('s2')], work, last)
    expect((out as { done: StudioWork }).done.sections[0]).toMatchObject({
      state: 'coded',
      reason: 'critic_failed'
    })
    expect(last.coded).toHaveBeenCalledWith('s2', 'critic_failed')
    expect(last.design).not.toHaveBeenCalled()
  })

  it('codes a section whose picture failed, never came, changed, or the critic could not see', async () => {
    const waiting = async (clock = { t: 1_000_000 }) =>
      (
        (await studioRound([brief('s2')], null, ports({}, clock))) as {
          wait: StudioWork
        }
      ).wait
    for (const [answers, reason] of [
      [
        { renders: [{ ...drawn(1), state: 'failed', failure: 'timeout' }] },
        'render_failed'
      ],
      [{ renders: [] }, 'render_failed'],
      [{ renders: [drawn(1)], picture: [null] }, 'picture_unusable'],
      [{ renders: [drawn(1)], critique: [null] }, 'critic_unavailable']
    ] as const) {
      const p = ports(answers as never)
      const out = await studioRound([brief('s2')], await waiting(), p)
      expect((out as { done: StudioWork }).done.sections[0]).toMatchObject({
        state: 'coded',
        reason
      })
      expect(p.coded).toHaveBeenCalledWith('s2', reason)
    }
    // Still queued: it waits until its time, then is coded.
    const clock = { t: 1_000_000 }
    const work = await waiting(clock)
    const queued: BuildRender = { id: uuid(1), key: 'k', state: 'queued' }
    clock.t += 60_000
    const early = await studioRound(
      [brief('s2')],
      work,
      ports({ renders: [queued] }, clock)
    )
    expect(early).toMatchObject({ seconds: (studioMs - 60_000) / 1000 })
    clock.t = work.until
    const late = ports({ renders: [queued] }, clock)
    expect(
      ((await studioRound([brief('s2')], work, late)) as { done: StudioWork })
        .done.sections[0]
    ).toMatchObject({ state: 'coded', reason: 'render_timed_out' })
  })

  it('codes a section that cannot be designed or drawn, or has no picture left', async () => {
    for (const [answers, reason] of [
      [{ design: [null] }, 'design_failed'],
      [{ request: [new Error('not drawable')] }, 'not_drawable']
    ] as const) {
      const p = ports(answers as never)
      const out = await studioRound([brief('s2')], null, p)
      expect((out as { done: StudioWork }).done.sections[0]).toMatchObject({
        state: 'coded',
        reason
      })
    }
    const full = { ...startWork([brief('s2')], 1_000_000), renders: 12 }
    const p = ports()
    const out = await studioRound([brief('s2')], full, p)
    expect((out as { done: StudioWork }).done.sections[0]).toMatchObject({
      reason: 'too_many_pictures'
    })
    expect(p.request).not.toHaveBeenCalled()
  })

  it('pauses when out of time, keeping a paused design’s tries for the next claim', async () => {
    const tries = { tries: 2, problems: ['x'], reasonCode: 'check_failed' }
    const p = ports({ design: [{ paused: tries }] })
    const out = await studioRound([brief('s2')], null, p)
    const work = (out as { paused: StudioWork }).paused
    expect(work.sections[0]).toMatchObject({ state: 'design', tries })
    const next = ports()
    await studioRound([brief('s2')], work, next)
    expect(next.design).toHaveBeenCalledWith(brief('s2'), tries)
    // No time at all: nothing is asked.
    const none = ports({ fits: [false] })
    expect(await studioRound([brief('s2')], null, none)).toHaveProperty(
      'paused'
    )
    expect(none.design).not.toHaveBeenCalled()
  })

  it('codes what is left when the studio’s time is up', async () => {
    const clock = { t: 1_000_000 }
    const work = startWork([brief('s2')], clock.t)
    clock.t = work.until
    const p = ports({}, clock)
    const out = await studioRound([brief('s2')], work, p)
    expect((out as { done: StudioWork }).done.sections[0]).toMatchObject({
      reason: 'studio_timed_out'
    })
    expect(p.design).not.toHaveBeenCalled()
  })

  it('starts over from work that is not this storyboard’s', async () => {
    for (const saved of [
      { nonsense: true },
      startWork([brief('s9')], 1),
      { ...startWork([brief('s2')], 1), renders: 99 }
    ]) {
      const p = ports()
      const out = await studioRound([brief('s2')], saved, p)
      expect((out as { wait: StudioWork }).wait.until).toBe(
        1_000_000 + studioMs
      )
      expect(p.design).toHaveBeenCalledTimes(1)
    }
  })

  it('makes render keys the database takes, a new one for each design', () => {
    const a = renderKey('S2_Hero', 1, designed('s2').section)
    expect(a).toMatch(/^[a-z0-9-]{1,40}$/)
    expect(a).toMatch(/^s2-hero-r1-[0-9a-f]{8}$/)
    expect(renderKey('S2_Hero', 1, designed('s2', 2).section)).not.toBe(a)
    expect(renderKey('x'.repeat(40), 3, designed('s2').section)).toHaveLength(
      36
    )
  })

  it('gives a hero picture only for a section done', () => {
    const s = startWork([brief('s2')], 1).sections[0]!
    expect(heroPicture(s, 'https://db.example/x.jpg')).toBeNull()
  })
})
