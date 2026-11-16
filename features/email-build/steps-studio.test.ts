// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { memoryFallbackLog } from '@/features/fallback/log'
import type { Block } from '@/features/blocks/catalog'
import type { StudioStepPorts } from '@/features/studio/design-step'
import type { Storyboard } from '@/features/studio/storyboard'
import type { BuildRender } from '@/features/studio/waits'
import type { PlannedEmail } from './build'
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
async function beforeDesign() {
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
        clock
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
    const html = (next as { email: { html: string } }).email.html
    expect(html).toContain('alt="Meet the throw"')
    expect(html).toContain(signed.replace(/&/g, '&amp;').split('?')[0])
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
})
