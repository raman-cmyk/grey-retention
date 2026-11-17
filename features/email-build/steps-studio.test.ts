// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { memoryFallbackLog } from '@/features/fallback/log'
import type { Block } from '@/features/blocks/catalog'
import type { StudioStepPorts } from '@/features/studio/design-step'
import type { Storyboard } from '@/features/studio/storyboard'
import type { BuildRender, BuildView } from '@/features/studio/waits'
import {
  emailViewsMs,
  type EmailViewPorts
} from '@/features/studio/email-check'
import type { EmailVerdict } from '@/features/studio/email-critic'
import type { ReferenceEmail } from '@/features/studio/reference'
import {
  builtEmail,
  type BuildCtx,
  type BuiltEmail,
  type PlannedEmail
} from './build'
import { sampleOffersFrom, sampleStoreFrom } from './ports'
import { runBuildStep } from './steps'

/**
 * DST-006c part 2b: the design step with the design studio's ports (the
 * worker gives them only with DESIGN_STUDIO=on and the agents), and
 * without them. The ports are fakes: no AI, browser or storage.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const start = '2026-03-02'
const planned: PlannedEmail = {
  date: '2026-03-04',
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const photo = 'https://cdn.shop.example/images/throw.jpg'
/** Before the planned day, so its send time has not passed. */
const clock = () => Date.parse('2026-03-01T00:00:00Z')
const render = '00000001-3333-4333-8333-333333333333'
const signed = `https://db.example/storage/v1/object/sign/studio-renders/render/${render}.jpg?token=t`

/** The steps before design, as the job saves them, with an https hero photo. */
async function beforeDesign(reference?: BuildCtx['reference']) {
  const store = await sampleStoreFrom(start).read(tenantId)
  const progress: Record<string, unknown> = {}
  for (const step of ['sections', 'content', 'copy'] as const) {
    const made = await runBuildStep(
      step,
      { planned, store, offers: sampleOffersFrom(start), progress },
      {
        tenantId,
        callerKey: 'email-build:b1',
        fallbacks: memoryFallbackLog(),
        clock,
        // DST-002b: the owner's Copy or Remix, for the sections step.
        ...(reference ? { reference } : {})
      }
    )
    if (!made.ok || !('output' in made)) throw new Error(`${step} failed`)
    progress[step] = JSON.parse(JSON.stringify(made.output))
  }
  const blocks = (progress.copy as { draft: { blocks: Block[] } }).draft.blocks
  const hero = blocks.findIndex((b) => b.type === 'hero_product')
  expect(hero).toBeGreaterThanOrEqual(0)
  ;(blocks[hero]!.content as { image: string }).image = photo
  return { store, progress, blocks, hero }
}

function ports(
  blocks: Block[],
  hero: number,
  renders: BuildRender[] = [],
  alt = 'Meet the throw'
): StudioStepPorts {
  const storyboard: Storyboard = {
    source: 'code',
    sections: blocks.map((b, i) => ({
      id: `s${i + 1}`,
      render: i === hero ? 'designed' : 'live',
      tone: 'light',
      height: i === hero ? 640 : 120,
      focus: 'The section',
      imagery: i === hero ? 'product' : 'none',
      space: 'normal',
      note: 'As it is.'
    }))
  }
  return {
    storyboard: vi.fn(async () => storyboard),
    design: vi.fn(async () => ({
      section: {
        id: `s${hero + 1}`,
        height: 640,
        html: `<img src="${photo}" alt=""><h1>Meet the throw</h1>`,
        css: ''
      },
      alt,
      runId: 'run-1'
    })),
    request: vi.fn(async () => render),
    renders: vi.fn(async () => renders),
    picture: vi.fn(async () => ({
      id: `s${hero + 1}`,
      bytes: new Uint8Array([1]),
      contentType: 'image/jpeg' as const,
      width: 1200,
      height: 1280
    })),
    critique: vi.fn(async () => ({
      pass: true,
      scores: {} as never,
      problems: []
    })),
    coded: vi.fn(async () => {}),
    sign: vi.fn(async () => signed),
    fits: () => true,
    now: () => 1_000_000
  }
}

describe('the design step with the design studio (DST-006c part 2b)', () => {
  const step = (
    store: Awaited<ReturnType<typeof beforeDesign>>['store'],
    progress: unknown,
    studio?: StudioStepPorts,
    fallbacks = memoryFallbackLog()
  ) =>
    runBuildStep(
      'design',
      { planned, store, offers: sampleOffersFrom(start), progress },
      { tenantId, callerKey: 'email-build:b1', fallbacks, studio, clock }
    )

  it('waits for the hero’s picture, then draws the email with it', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    const first = await step(store, progress, ports(blocks, hero))
    expect(first).toMatchObject({ ok: true, waiting: 'design' })
    const { work, seconds } = first as { work: object; seconds: number }
    expect(seconds).toBeGreaterThanOrEqual(60)
    // As the database keeps it: the work beside its save count.
    const saved = { ...progress, work: { design: { ...work, saves: 0 } } }
    const drawn: BuildRender = {
      id: render,
      key: 'k',
      state: 'drawn',
      path: `render/${render}.jpg`,
      height: 640,
      bytes: 1,
      etag: 'e'
    }
    const next = await step(store, saved, ports(blocks, hero, [drawn]))
    expect(next).toMatchObject({ ok: true, done: 'design' })
    const email = (next as { email: BuiltEmail }).email
    expect(email.html).toContain('alt="Meet the throw"')
    expect(email.html).toContain(signed.replace(/&/g, '&amp;').split('?')[0])
    // EML-AB: design B, with its coded blocks as design A (the product's
    // own photo, no studio picture), stored as the job stores it.
    expect(email.approach).toBe('B')
    expect(email.designA).toContain(photo)
    expect(email.designA).not.toContain(signed.split('?')[0])
    expect(builtEmail.parse(JSON.parse(JSON.stringify(email)))).toEqual(email)
  })

  it('sends the designed email alone, logged, when its coded design fails a hard check (EML-AB)', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    // The coded hero's own words show an offer over the max; the studio's
    // picture shows none of them.
    ;(blocks[hero]!.content as { headline: string }).headline =
      'Take 90% off everything'
    const first = (await step(store, progress, ports(blocks, hero))) as {
      work: object
    }
    const drawn: BuildRender = {
      id: render,
      key: 'k',
      state: 'drawn',
      path: `render/${render}.jpg`,
      height: 640,
      bytes: 1,
      etag: 'e'
    }
    const fallbacks = memoryFallbackLog()
    const out = await step(
      store,
      { ...progress, work: { design: first.work } },
      ports(blocks, hero, [drawn]),
      fallbacks
    )
    expect(out).toMatchObject({ ok: true, done: 'design' })
    const email = (out as { email: BuiltEmail }).email
    expect(email.approach).toBe('B')
    expect(email).not.toHaveProperty('designA')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'ab-test',
        reasonCode: 'ab_no_coded',
        reason: 'Its coded design did not pass the email checks.',
        fallback:
          'Only the designed email goes into Klaviyo as a draft, with no A/B test.'
      })
    ])
  })

  it('draws the email coded, saying so once, when the studio’s work is there without its ports', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    const first = (await step(store, progress, ports(blocks, hero))) as {
      work: object
    }
    const fallbacks = memoryFallbackLog()
    const saved = { ...progress, work: { design: first.work } }
    const out = await step(store, saved, undefined, fallbacks)
    expect(out).toMatchObject({ ok: true, done: 'design' })
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-studio',
        reasonCode: 'studio_not_finished',
        fallback: 'Drew the email with its coded blocks.'
      })
    ])
    // With no studio work at all, nothing is logged.
    const plain = memoryFallbackLog()
    await step(store, progress, undefined, plain)
    expect(plain.entries()).toEqual([])
  })

  it('says once when the studio had no time for the email (DST-006e)', async () => {
    const { store, progress } = await beforeDesign()
    const fallbacks = memoryFallbackLog()
    const out = await runBuildStep(
      'design',
      { planned, store, offers: sampleOffersFrom(start), progress },
      {
        tenantId,
        callerKey: 'email-build:b1',
        fallbacks,
        clock,
        studioSkipped: true
      }
    )
    expect(out).toMatchObject({ ok: true, done: 'design' })
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        reasonCode: 'studio_no_time',
        fallback: 'Drew the email with its coded blocks.'
      })
    ])
  })

  it('says the studio stopped, not that it had no time, when its work is there (DST-006e)', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    const first = (await runBuildStep(
      'design',
      { planned, store, offers: sampleOffersFrom(start), progress },
      {
        tenantId,
        callerKey: 'email-build:b1',
        fallbacks: memoryFallbackLog(),
        studio: ports(blocks, hero),
        clock
      }
    )) as { work: object }
    const fallbacks = memoryFallbackLog()
    await runBuildStep(
      'design',
      {
        planned,
        store,
        offers: sampleOffersFrom(start),
        progress: { ...progress, work: { design: first.work } }
      },
      {
        tenantId,
        callerKey: 'email-build:b1',
        fallbacks,
        clock,
        studioSkipped: true
      }
    )
    expect(fallbacks.entries().map((e) => e.reasonCode)).toEqual([
      'studio_not_finished'
    ])
  })

  it('draws the email coded, logged, when the studio’s email fails a hard check (DST-005)', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    // A picture whose words show an offer over the max (none here).
    const alt = 'Save 90% off the throw'
    const first = (await step(
      store,
      progress,
      ports(blocks, hero, [], alt)
    )) as { work: object }
    const drawn: BuildRender = {
      id: render,
      key: 'k',
      state: 'drawn',
      path: `render/${render}.jpg`,
      height: 640,
      bytes: 1,
      etag: 'e'
    }
    const fallbacks = memoryFallbackLog()
    const out = await step(
      store,
      { ...progress, work: { design: first.work } },
      ports(blocks, hero, [drawn], alt),
      fallbacks
    )
    expect(out).toMatchObject({ ok: true, done: 'design' })
    const html = (out as { email: { html: string } }).email.html
    expect(html).not.toContain(alt)
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'email-checks',
        reasonCode: 'hard_check_offer',
        fallback: 'Drew the email with its coded blocks.'
      })
    ])
  })

  it('stops a coded email that fails a hard check, in plain words, logged; a studio one that fails with it says nothing more (DST-005)', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    // An offer drawn over the max (none here), in the hero's own words.
    ;(blocks[hero]!.content as { headline: string }).headline =
      'Take 90% off everything'
    const fallbacks = memoryFallbackLog()
    expect(await step(store, progress, undefined, fallbacks)).toEqual({
      ok: false,
      code: 'hard_check_failed'
    })
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'email-checks',
        reasonCode: 'hard_check_offer',
        reason: expect.stringContaining('90%'),
        fallback: 'No email was stored; trying again makes it again.'
      })
    ])
    // The studio's email fails too: its coded redraw fails the same way,
    // so no line says it was drawn.
    const alt = 'Take 90% off everything'
    const first = (await step(
      store,
      progress,
      ports(blocks, hero, [], alt)
    )) as { work: object }
    const drawn: BuildRender = {
      id: render,
      key: 'k',
      state: 'drawn',
      path: `render/${render}.jpg`,
      height: 640,
      bytes: 1,
      etag: 'e'
    }
    const both = memoryFallbackLog()
    expect(
      await step(
        store,
        { ...progress, work: { design: first.work } },
        ports(blocks, hero, [drawn], alt),
        both
      )
    ).toEqual({ ok: false, code: 'hard_check_failed' })
    expect(both.entries().map((e) => e.dedupeKey)).toEqual([
      expect.stringMatching(/:coded$/)
    ])
  })
})

describe('the design step judges the studio’s email whole (DST-006d part 2c)', () => {
  const drawnRender: BuildRender = {
    id: render,
    key: 'k',
    state: 'drawn',
    path: `render/${render}.jpg`,
    height: 640,
    bytes: 1,
    etag: 'e'
  }
  const nines = {
    hierarchy: 9,
    spacing: 9,
    contrast: 9,
    alignment: 9,
    product: 9,
    button: 9,
    phone: 9
  }
  const view = (v: 'desktop' | 'phone' | 'dark', n: number): BuildView => ({
    id: `0000000${n}-3333-4333-8333-333333333333`,
    key: 'any',
    view: v,
    state: 'drawn',
    path: `email/0000000${n}-3333-4333-8333-333333333333.jpg`,
    height: 2100,
    cut: false,
    wide: false,
    bytes: 1,
    etag: 'v'
  })
  const emailPorts = (
    views: BuildView[],
    verdict: EmailVerdict | null = {
      pass: true,
      scores: {} as never,
      problems: []
    }
  ) =>
    ({
      ask: vi.fn<EmailViewPorts['ask']>(async () => {}),
      views: vi.fn(async (key: string) => views.map((v) => ({ ...v, key }))),
      picture: vi.fn(async (v) => ({
        bytes: new Uint8Array([1]),
        contentType: 'image/jpeg' as const,
        width: v.view === 'phone' ? 375 : 600,
        height: 2100,
        cut: false,
        wide: false
      })),
      judge: vi.fn<EmailViewPorts['judge']>(async () => verdict)
    }) satisfies EmailViewPorts
  const step = (
    store: Awaited<ReturnType<typeof beforeDesign>>['store'],
    progress: unknown,
    studio: StudioStepPorts,
    fallbacks = memoryFallbackLog()
  ) =>
    runBuildStep(
      'design',
      { planned, store, offers: sampleOffersFrom(start), progress },
      { tenantId, callerKey: 'email-build:b1', fallbacks, studio, clock }
    )
  /** The steps to the point the hero's picture is in, as saved. */
  async function pictured() {
    const { store, progress, blocks, hero } = await beforeDesign()
    const first = (await step(store, progress, ports(blocks, hero))) as {
      work: object
    }
    const saved = { ...progress, work: { design: { ...first.work, saves: 0 } } }
    return { store, saved, blocks, hero }
  }

  it('asks for the email’s views and waits, saving its signed link and one more wait', async () => {
    const { store, saved, blocks, hero } = await pictured()
    const email = emailPorts([])
    const studio = { ...ports(blocks, hero, [drawnRender]), email }
    const out = await step(store, saved, studio)
    expect(out).toMatchObject({ ok: true, waiting: 'design' })
    expect(email.ask).toHaveBeenCalledTimes(1)
    const [key, html] = email.ask.mock.calls[0]!
    expect(key).toMatch(/^e-[0-9a-f]{24}$/)
    expect(html).toContain('alt="Meet the throw"')
    const work = (out as { work: { studio: Record<string, unknown> } }).work
    expect(work.studio.signed).toEqual({
      [`s${hero + 1}`]: { render, src: signed }
    })
    expect((work.studio.rounds as { waits: number }).waits).toBe(
      (
        saved.work.design as unknown as {
          studio: { rounds: { waits: number } }
        }
      ).studio.rounds.waits + 1
    )
  })

  it('then, with the same email on the next claim, stores it once the critic passes it', async () => {
    const { store, saved, blocks, hero } = await pictured()
    const asked = emailPorts([])
    const first = await step(store, saved, {
      ...ports(blocks, hero, [drawnRender]),
      email: asked
    })
    const again = {
      ...saved,
      work: { design: { ...(first as { work: object }).work, saves: 1 } }
    }
    const views = emailPorts([
      view('desktop', 1),
      view('phone', 2),
      view('dark', 3)
    ])
    const studio = { ...ports(blocks, hero, [drawnRender]), email: views }
    const fallbacks = memoryFallbackLog()
    const out = await step(store, again, studio, fallbacks)
    expect(out).toMatchObject({ ok: true, done: 'design' })
    // The link signed before, so the same email and the same views.
    expect(studio.sign).not.toHaveBeenCalled()
    expect(views.views.mock.calls[0]![0]).toBe(asked.ask.mock.calls[0]![0])
    expect(views.judge).toHaveBeenCalledTimes(1)
    const email = (out as { email: BuiltEmail }).email
    expect(email.html).toContain(signed.split('?')[0])
    // EML-AB: the passed email is design B, its coded blocks design A.
    expect(email).toMatchObject({ approach: 'B', designA: expect.any(String) })
    expect(fallbacks.entries()).toEqual([])
  })

  it('draws the coded email when the critic does not pass it, logging fixed words only', async () => {
    const { store, saved, blocks, hero } = await pictured()
    const first = await step(store, saved, {
      ...ports(blocks, hero, [drawnRender]),
      email: emailPorts([])
    })
    const again = {
      ...saved,
      work: { design: { ...(first as { work: object }).work, saves: 1 } }
    }
    const failing = emailPorts(
      [view('desktop', 1), view('phone', 2), view('dark', 3)],
      {
        pass: false,
        scores: { ...nines, button: 6 },
        problems: [
          'The button (easy to see and tap, clear words) scored 6 of 10.',
          'Show the code SAVE20 bigger.'
        ]
      }
    )
    const fallbacks = memoryFallbackLog()
    const out = await step(
      store,
      again,
      { ...ports(blocks, hero, [drawnRender]), email: failing },
      fallbacks
    )
    expect(out).toMatchObject({ ok: true, done: 'design' })
    const html = (out as { email: { html: string } }).email.html
    expect(html).not.toContain(signed.split('?')[0])
    // Coded only: one design, no A/B test.
    expect((out as { email: BuiltEmail }).email).toMatchObject({
      approach: 'A'
    })
    expect((out as { email: BuiltEmail }).email).not.toHaveProperty('designA')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-studio',
        reasonCode: 'email_not_passed',
        reason:
          'The whole email did not pass the Design critic. The button (easy to see and tap, clear words) scored 6 of 10.',
        fallback: 'Drew the email with its coded blocks.'
      })
    ])
    expect(JSON.stringify(fallbacks.entries())).not.toContain('SAVE20')
  })

  /** Three claims: the picture asked for, then drawn and the views asked for. */
  async function viewsAsked(blocks?: (b: Block[], hero: number) => void) {
    const { store, progress, blocks: b, hero } = await beforeDesign()
    blocks?.(b, hero)
    const first = (await step(store, progress, ports(b, hero))) as {
      work: object
    }
    const saved = { ...progress, work: { design: { ...first.work, saves: 0 } } }
    const asked = emailPorts([])
    const second = (await step(store, saved, {
      ...ports(b, hero, [drawnRender]),
      email: asked
    })) as { work: { studio: Record<string, unknown> } }
    const again = {
      ...progress,
      work: { design: { ...second.work, saves: 1 } }
    }
    return { store, blocks: b, hero, asked, second, again }
  }

  it('waits again for a view still drawing, keeping the links signed and the views’ window', async () => {
    const { store, blocks, hero, second, again } = await viewsAsked()
    const drawing = emailPorts([
      view('desktop', 1),
      view('phone', 2),
      {
        id: '00000003-3333-4333-8333-333333333333',
        key: 'any',
        view: 'dark',
        state: 'queued'
      }
    ])
    const out = await step(store, again, {
      ...ports(blocks, hero, [drawnRender]),
      email: drawing
    })
    expect(out).toMatchObject({ ok: true, waiting: 'design' })
    const work = (out as { work: { studio: Record<string, unknown> } }).work
    expect(work.studio.signed).toEqual(second.work.studio.signed)
    expect(work.studio.views).toEqual(second.work.studio.views)
    // From the studio's own clock when they were first asked for.
    expect((work.studio.views as { until: number }).until).toBe(
      1_000_000 + emailViewsMs
    )
  })

  it('pauses for the critic’s tries when this claim has no room, saved as one more wait', async () => {
    const { store, blocks, hero, second, again } = await viewsAsked()
    const ready = emailPorts([
      view('desktop', 1),
      view('phone', 2),
      view('dark', 3)
    ])
    const out = await step(store, again, {
      ...ports(blocks, hero, [drawnRender]),
      fits: () => false,
      email: ready
    })
    expect(out).toMatchObject({ ok: true, waiting: 'design' })
    expect(ready.judge).not.toHaveBeenCalled()
    const rounds = (out as { work: { studio: { rounds: { waits: number } } } })
      .work.studio.rounds
    expect(rounds.waits).toBe(
      (second.work.studio.rounds as { waits: number }).waits + 1
    )
  })

  it('draws the coded email, logged, when no wait is left for the views', async () => {
    const { store, progress, blocks, hero } = await beforeDesign()
    const first = (await step(store, progress, ports(blocks, hero))) as {
      work: { studio: { rounds: { waits: number } } }
    }
    // The design step's 6 waits spent before the views are asked for.
    const spent = structuredClone(first.work)
    spent.studio.rounds.waits = 6
    const saved = { ...progress, work: { design: { ...spent, saves: 0 } } }
    const email = emailPorts([])
    const fallbacks = memoryFallbackLog()
    const out = await step(
      store,
      saved,
      { ...ports(blocks, hero, [drawnRender]), email },
      fallbacks
    )
    expect(out).toMatchObject({ ok: true, done: 'design' })
    expect(email.ask).not.toHaveBeenCalled()
    expect((out as { email: { html: string } }).email.html).not.toContain(
      signed.split('?')[0]
    )
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-studio',
        reasonCode: 'email_no_time_left',
        reason: 'The design studio had no time left to check the whole email.'
      })
    ])
  })

  it('fails the build, with only the hard check’s line, when the coded redraw after the critic fails a hard check', async () => {
    // The hero's live words show an offer over the max (none here); the
    // studio's picture shows its own words, so only the coded email fails.
    const { store, blocks, hero, again } = await viewsAsked((b, h) => {
      ;(b[h]!.content as { headline: string }).headline =
        'Take 90% off everything'
    })
    const failing = emailPorts(
      [view('desktop', 1), view('phone', 2), view('dark', 3)],
      { pass: false, scores: { ...nines, button: 5 }, problems: [] }
    )
    const fallbacks = memoryFallbackLog()
    expect(
      await step(
        store,
        again,
        { ...ports(blocks, hero, [drawnRender]), email: failing },
        fallbacks
      )
    ).toEqual({ ok: false, code: 'hard_check_failed' })
    expect(fallbacks.entries().map((e) => e.dedupeKey)).toEqual([
      expect.stringMatching(/:coded$/)
    ])
  })

  it('gives the studio the inbox email the sections step picked (DST-002b)', async () => {
    const reference: ReferenceEmail = {
      id: 'ref-1',
      brandId: 'pine',
      brand: 'Pine & Co',
      synthetic: true,
      subject: 'The new throw',
      industry: 'home',
      emailType: 'launch',
      angle: 'new and soft',
      receivedAt: '2026-02-20T09:00:00Z',
      winner: false,
      sections: [
        {
          blockType: 'hero_image',
          height: 640,
          styles: ['dark'],
          image: 'sect/m1/0.jpg'
        },
        { blockType: 'text', height: 200 },
        { blockType: 'product_grid_2col', height: 700 },
        { blockType: 'footer', height: 200 }
      ]
    }
    const { store, progress, blocks, hero } = await beforeDesign({
      mode: 'copy',
      load: async () => ({ emails: [reference], followed: new Set() })
    })
    expect(progress.sections).toMatchObject({
      reference: { emailId: 'ref-1', mode: 'copy' }
    })
    const studio = ports(blocks, hero)
    await step(store, progress, studio)
    const story = vi.mocked(studio.storyboard).mock.calls[0]![0]
    expect(story.mode).toBe('copy')
    // The hero follows the reference's first section, as the plan copied it.
    expect(story.sections[hero]!.ref).toBe(0)
    expect(story.reference?.[0]).toMatchObject({ height: 640 })
    // The hero's brief keeps the reference's tone and height.
    expect(vi.mocked(studio.design).mock.calls[0]![0]).toMatchObject({
      mode: 'copy',
      // DST-004b: with its stored picture, saved by the sections step.
      reference: { tone: 'dark', height: 640, image: 'sect/m1/0.jpg' }
    })
    // Scratch, as before, without one.
    const plain = await beforeDesign()
    const scratch = ports(plain.blocks, plain.hero)
    await step(plain.store, plain.progress, scratch)
    expect(vi.mocked(scratch.storyboard).mock.calls[0]![0].mode).toBe('scratch')
  })
})
