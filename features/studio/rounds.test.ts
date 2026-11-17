// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { SectionBrief } from './designer'
import type { RenderedSection } from './renderer'
import { SectionNotDrawable } from './render-jobs'
import {
  briefDigest,
  heroPicture,
  maxRounds,
  renderKey,
  startWork,
  studioMs,
  studioRound,
  type StudioPorts,
  type StudioWork,
  roundWaits
} from './rounds'
import type { BuildRender } from './waits'
import { matchTarget } from './match'

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
    picture: vi.fn<StudioPorts['picture']>(async () =>
      take(answers.picture, image)
    ),
    critique: vi.fn(async () =>
      take(answers.critique, pass as unknown)
    ) as StudioPorts['critique'],
    coded: vi.fn(async () => {}),
    fits: vi.fn<StudioPorts['fits']>(() => take(answers.fits, true)),
    now: () => clock.t
  }
  return p
}

const waitOf = (out: unknown) => (out as { wait: StudioWork }).wait
const doneOf = (out: unknown) => (out as { done: StudioWork }).done
/** The work after a first claim: the section drawing its picture uuid(1). */
const drawing = async (clock = { t: 1_000_000 }) =>
  waitOf(await studioRound([brief('s2')], null, ports({}, clock)))

describe('the design studio’s rounds (DST-006c)', () => {
  it('designs each section and asks for its picture, then waits for them', async () => {
    const p = ports({ design: [designed('s2'), designed('s4', 2)] })
    const out = await studioRound([brief('s2'), brief('s4')], null, p)
    expect(out).toMatchObject({ seconds: studioMs / 1000 })
    const work = waitOf(out)
    expect(work).toMatchObject({
      until: 1_000_000 + studioMs,
      renders: 2,
      waits: 1
    })
    expect(work.sections).toEqual([
      {
        id: 's2',
        brief: briefDigest(brief('s2')),
        round: 1,
        state: 'drawing',
        problems: [],
        render: uuid(1),
        alt: 'Meet the cedar tray'
      },
      {
        id: 's4',
        brief: briefDigest(brief('s4')),
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
    const p = ports({ renders: [drawn(1)] })
    const done = doneOf(await studioRound([brief('s2')], await drawing(), p))
    expect(done.sections[0]).toMatchObject({ state: 'done', height: 640 })
    expect(p.picture).toHaveBeenCalledWith(drawn(1), 's2')
    expect(p.critique).toHaveBeenCalledWith(brief('s2'), image)
    // The critic may try its answer 3 times: room for all of them first.
    expect(p.fits).toHaveBeenCalledWith(3)
    expect(heroPicture(done.sections[0]!, 'https://db.example/x.jpg')).toEqual({
      src: 'https://db.example/x.jpg',
      alt: 'Meet the cedar tray',
      height: 640,
      render: uuid(1)
    })
    expect(p.coded).not.toHaveBeenCalled()
  })

  it('sends the critic’s problems into the next round, then codes a section that fails its last', async () => {
    let work: StudioWork = await drawing()
    for (let round = 1; round < maxRounds; round++) {
      const next = ports({
        renders: [{ ...drawn(round), id: uuid(round) }],
        critique: [fail(`Problem ${round}`)],
        request: [uuid(round + 1)]
      })
      work = waitOf(await studioRound([brief('s2')], work, next))
      expect(next.design).toHaveBeenCalledWith(brief('s2'), {
        tries: 0,
        problems: [`Problem ${round}`],
        reasonCode: 'check_failed'
      })
      expect(work.sections[0]).toMatchObject({
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
    expect(doneOf(out).sections[0]).toMatchObject({
      state: 'coded',
      reason: 'critic_failed'
    })
    expect(last.coded).toHaveBeenCalledWith('s2', 'critic_failed')
    expect(last.design).not.toHaveBeenCalled()
  })

  it('codes a section whose picture failed, is missing, was changed, is another’s, too large, or unseen', async () => {
    const big = { ...image, bytes: new Uint8Array(3 * 1024 * 1024 + 1) }
    for (const [answers, reason] of [
      [
        { renders: [{ ...drawn(1), state: 'failed', failure: 'timeout' }] },
        'render_failed'
      ],
      [{ renders: [] }, 'render_failed'],
      [{ renders: [drawn(1)], picture: [null] }, 'picture_unusable'],
      [
        { renders: [drawn(1)], picture: [{ ...image, id: 's9' }] },
        'picture_unusable'
      ],
      [{ renders: [drawn(1)], picture: [big] }, 'picture_unusable'],
      [{ renders: [drawn(1)], critique: [null] }, 'critic_unavailable']
    ] as const) {
      const p = ports(answers as never)
      const out = await studioRound([brief('s2')], await drawing(), p)
      expect(doneOf(out).sections[0]).toMatchObject({ state: 'coded', reason })
      expect(p.coded).toHaveBeenCalledWith('s2', reason)
      expect(p.critique).toHaveBeenCalledTimes(
        reason === 'critic_unavailable' ? 1 : 0
      )
    }
  })

  it('waits for a picture still queued until its time, at least a minute, then codes it', async () => {
    const clock = { t: 1_000_000 }
    const work = await drawing(clock)
    const queued: BuildRender = { id: uuid(1), key: 'k', state: 'queued' }
    clock.t += 60_000
    const early = await studioRound(
      [brief('s2')],
      work,
      ports({ renders: [queued] }, clock)
    )
    expect(early).toMatchObject({ seconds: (studioMs - 60_000) / 1000 })
    expect(waitOf(early).waits).toBe(2)
    clock.t = work.until - 10_000
    expect(
      await studioRound(
        [brief('s2')],
        work,
        ports({ renders: [queued] }, clock)
      )
    ).toMatchObject({ seconds: 60 })
    clock.t = work.until
    const late = ports({ renders: [queued] }, clock)
    expect(
      doneOf(await studioRound([brief('s2')], work, late)).sections[0]
    ).toMatchObject({ state: 'coded', reason: 'render_timed_out' })
  })

  it('codes a section that cannot be designed or drawn, and pays for no design with no picture left', async () => {
    for (const [answers, reason] of [
      [{ design: [null] }, 'design_failed'],
      [{ request: [new SectionNotDrawable(['x'])] }, 'not_drawable'],
      [
        {
          request: [
            Object.assign(new Error('x'), {
              code: 'PT409',
              message: "This key is another section's"
            })
          ]
        },
        'not_drawable'
      ],
      [
        {
          request: [
            Object.assign(new Error('x'), {
              code: '22023',
              details: 'too_many_renders'
            })
          ]
        },
        'too_many_pictures'
      ],
      [
        {
          request: [
            Object.assign(new Error('A render loads from https origins only'), {
              code: '22023'
            })
          ]
        },
        'not_drawable'
      ]
    ] as const) {
      const p = ports(answers as never)
      const out = await studioRound([brief('s2')], null, p)
      expect(doneOf(out).sections[0]).toMatchObject({ state: 'coded', reason })
    }
    const full = { ...startWork([brief('s2')], 1_000_000), renders: 12 }
    const p = ports()
    const out = await studioRound([brief('s2')], full, p)
    expect(doneOf(out).sections[0]).toMatchObject({
      reason: 'too_many_pictures'
    })
    expect(p.design).not.toHaveBeenCalled()
    expect(p.request).not.toHaveBeenCalled()
  })

  it('lets a lost claim or a database down throw, never coding the section', async () => {
    for (const error of [
      Object.assign(new Error('Lease unavailable'), { code: 'PT409' }),
      new Error('fetch failed')
    ]) {
      const p = ports({ request: [error] })
      await expect(studioRound([brief('s2')], null, p)).rejects.toBe(error)
      expect(p.coded).not.toHaveBeenCalled()
    }
    const down = ports()
    down.renders.mockRejectedValueOnce(new Error('down'))
    await expect(
      studioRound([brief('s2')], await drawing(), down)
    ).rejects.toThrow('down')
  })

  it('pauses when out of time, keeping a paused design’s tries, and waits as for pictures', async () => {
    const tries = { tries: 2, problems: ['x'], reasonCode: 'check_failed' }
    const p = ports({ design: [{ paused: tries }] })
    const out = await studioRound([brief('s2')], null, p)
    expect(out).toMatchObject({ seconds: studioMs / 1000 })
    const work = (out as { paused: StudioWork }).paused
    expect(work.sections[0]).toMatchObject({ state: 'design', tries })
    const next = ports()
    await studioRound([brief('s2')], work, next)
    expect(next.design).toHaveBeenCalledWith(brief('s2'), tries)
    // No time for a design, or for the critic's tries: nothing is asked.
    const none = ports({ fits: [false] })
    expect(await studioRound([brief('s2')], null, none)).toHaveProperty(
      'paused'
    )
    expect(none.design).not.toHaveBeenCalled()
    const busy = ports({ renders: [drawn(1)], fits: [false] })
    expect(
      await studioRound([brief('s2')], await drawing(), busy)
    ).toHaveProperty('paused')
    expect(busy.picture).not.toHaveBeenCalled()
    expect(busy.critique).not.toHaveBeenCalled()
  })

  it('codes what is left when the studio’s time or its waits are up', async () => {
    const clock = { t: 1_000_000 }
    const work = startWork([brief('s2')], clock.t)
    clock.t = work.until
    const p = ports({}, clock)
    expect(
      doneOf(await studioRound([brief('s2')], work, p)).sections[0]
    ).toMatchObject({ reason: 'studio_timed_out' })
    expect(p.design).not.toHaveBeenCalled()
    // The design step's 6 waits are spent: nothing waits again.
    const spent = { ...(await drawing()), waits: 6 }
    const queued: BuildRender = { id: uuid(1), key: 'k', state: 'queued' }
    const last = ports({ renders: [queued] })
    const out = await studioRound([brief('s2')], spent, last)
    expect(doneOf(out).sections[0]).toMatchObject({
      state: 'coded',
      reason: 'studio_timed_out'
    })
    expect(last.coded).toHaveBeenCalledWith('s2', 'studio_timed_out')
    // A picture that failed the critic is never designed again with no
    // wait left for its next picture.
    const failed = ports({ renders: [drawn(1)], critique: [fail()] })
    const out2 = await studioRound([brief('s2')], spent, failed)
    expect(doneOf(out2).sections[0]).toMatchObject({
      reason: 'studio_timed_out'
    })
    expect(failed.design).not.toHaveBeenCalled()
    expect(failed.request).not.toHaveBeenCalled()
  })

  it('keeps the design step’s last wait for the email’s inbox views (DST-006d)', async () => {
    expect(roundWaits).toBe(5)
    const five = { ...(await drawing()), waits: 5 }
    const queued: BuildRender = { id: uuid(1), key: 'k', state: 'queued' }
    const p = ports({ renders: [queued] })
    const out = await studioRound([brief('s2')], five, p)
    expect(doneOf(out)).toMatchObject({
      waits: 5,
      sections: [{ state: 'coded', reason: 'studio_timed_out' }]
    })
    // One wait short of that, it still waits for its picture.
    const four = { ...(await drawing()), waits: 4 }
    expect(
      await studioRound([brief('s2')], four, ports({ renders: [queued] }))
    ).toMatchObject({ wait: { waits: 5 } })
  })

  it('reads its work beside the database’s save count, and starts over for another brief, keeping the build’s limits', async () => {
    const work = await drawing()
    const resumed = ports({ renders: [drawn(1)] })
    await studioRound([brief('s2')], { ...work, saves: 3 }, resumed)
    expect(resumed.design).not.toHaveBeenCalled()
    expect(resumed.critique).toHaveBeenCalledTimes(1)
    // Same id, another brief: it starts over within the same time,
    // pictures and waits.
    const other = {
      ...brief('s2'),
      board: { ...brief('s2').board, height: 800 }
    }
    const again = ports({ request: [uuid(7)] })
    const out = waitOf(await studioRound([other], work, again))
    expect(again.design).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ until: work.until, renders: 2, waits: 2 })
    expect(out.sections[0]).toMatchObject({
      brief: briefDigest(other),
      render: uuid(7)
    })
    // Unreadable work starts over too.
    for (const saved of [{ nonsense: true }, startWork([brief('s9')], 1)]) {
      const p = ports()
      await studioRound([brief('s2')], saved, p)
      expect(p.design).toHaveBeenCalledTimes(1)
    }
  })

  it('refuses work no round makes, and more designed sections than an email has', async () => {
    const work = await drawing()
    for (const broken of [
      { ...work.sections[0]!, state: 'done' },
      { ...work.sections[0]!, state: 'coded' },
      { ...work.sections[0]!, render: undefined }
    ]) {
      const p = ports()
      await studioRound([brief('s2')], { ...work, sections: [broken] }, p)
      // Read as unreadable: designed again from the start.
      expect(p.design).toHaveBeenCalledTimes(1)
    }
    await expect(
      studioRound(['s1', 's2', 's3', 's4', 's5'].map(brief), null, ports())
    ).rejects.toThrow('At most 4 designed sections')
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
    expect(
      heroPicture(
        { ...s, state: 'coded', reason: 'critic_failed' },
        'https://db.example/x.jpg'
      )
    ).toBeNull()
  })
})

describe('the match score in the rounds (DST-004b)', () => {
  const copy = (over: Partial<SectionBrief> = {}): SectionBrief => ({
    ...brief('s2'),
    mode: 'copy',
    reference: { tone: 'dark', height: 640 },
    ...over
  })
  /** The second claim of a section whose picture uuid(1) is drawn. */
  const judge = async (b: SectionBrief, match?: StudioPorts['match']) => {
    const first = waitOf(await studioRound([b], null, ports()))
    const p = { ...ports({ renders: [drawn(1)] }), ...(match ? { match } : {}) }
    const out = await studioRound([b], first, p)
    return { out, p }
  }

  it('takes a Copy section that looks like its reference', async () => {
    const match = vi.fn<NonNullable<StudioPorts['match']>>(
      async () => matchTarget
    )
    const { out } = await judge(copy(), match)
    expect(doneOf(out).sections[0]).toMatchObject({ state: 'done' })
    expect(match).toHaveBeenCalledWith(copy(), image)
  })

  it('designs a Copy section again, told how to come closer, when it looks too little like it', async () => {
    const { out, p } = await judge(copy(), async () => matchTarget - 2)
    const work = waitOf(out)
    expect(work.sections[0]).toMatchObject({ round: 2, state: 'drawing' })
    expect(work.sections[0]!.problems).toEqual([
      expect.stringMatching(
        new RegExp(
          `^It looks too little like the reference section \\(match ${matchTarget - 2} of 10`
        )
      )
    ])
    expect(p.design).toHaveBeenCalledWith(
      copy(),
      expect.objectContaining({
        problems: [expect.stringMatching(/too little like the reference/)]
      })
    )
  })

  it('keeps the critic’s verdict when the match cannot be measured', async () => {
    const { out } = await judge(copy(), async () => null)
    expect(doneOf(out).sections[0]).toMatchObject({ state: 'done' })
  })

  it('measures only a Copy section with a reference', async () => {
    const match = vi.fn<NonNullable<StudioPorts['match']>>(async () => 1)
    for (const b of [
      brief('s2'),
      { ...brief('s2'), mode: 'remix' as const },
      copy({ reference: undefined })
    ]) {
      const { out } = await judge(b, match)
      expect(doneOf(out).sections[0]).toMatchObject({ state: 'done' })
    }
    expect(match).not.toHaveBeenCalled()
    // No match port: never measured.
    const { out } = await judge(copy())
    expect(doneOf(out).sections[0]).toMatchObject({ state: 'done' })
  })

  it('keeps the critic’s verdict, once, when the port fails or answers no score', async () => {
    const answers: (() => Promise<number | null>)[] = [
      async () => {
        throw new Error('The grid cannot be compared: bad values')
      },
      async () => Number.NaN,
      async () => 0.8,
      async () => 11
    ]
    for (const answer of answers) {
      const { out, p } = await judge(copy(), answer)
      expect(doneOf(out).sections[0]).toMatchObject({ state: 'done' })
      // The critic is never asked again for the same picture.
      expect(p.critique).toHaveBeenCalledTimes(1)
    }
  })

  it('codes a Copy section that still looks too little like it after its last round, and says so', async () => {
    let work: StudioWork = waitOf(await studioRound([copy()], null, ports()))
    const low = async () => 2
    for (let round = 1; round <= maxRounds; round++) {
      const next = {
        ...ports({
          renders: [{ ...drawn(round), id: uuid(round) }],
          request: [uuid(round + 1)]
        }),
        match: low
      }
      const out = await studioRound([copy()], work, next)
      if (round < maxRounds) {
        work = waitOf(out)
        continue
      }
      expect(doneOf(out).sections[0]).toMatchObject({ state: 'coded' })
      // The critic passed it: the owner’s log says the match failed.
      expect(next.coded).toHaveBeenCalledWith('s2', 'match_failed')
      expect(next.coded).not.toHaveBeenCalledWith('s2', 'critic_failed')
    }
  })
})
