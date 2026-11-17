// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import type { Block } from '@/features/blocks/catalog'
import { sectionDesignerAgent } from './designer'
import {
  studioDesignStep,
  type StudioStepInput,
  type StudioStepPorts
} from './design-step'
import {
  artDirectorAgent,
  codeStoryboard,
  type StoryboardInput
} from './storyboard'

/**
 * DST-002b part b2c: the design studio follows the inbox email the
 * sections step picked: in Copy each designed hero keeps its reference
 * section's tone and about its height; in Remix the Art director sees the
 * reference. The storyboard is code's own (no AI); the studio stops at
 * its first wait.
 */
const photo = 'https://cdn.shop.example/images/throw.jpg'
const hero = {
  type: 'hero_product',
  content: { ...(sampleBlocks.hero_product.content as object), image: photo }
} as Block
const blocks: Block[] = [
  sampleBlocks.header_logo,
  hero,
  sampleBlocks.product_grid_2col,
  sampleBlocks.text,
  sampleBlocks.footer
]
const sections = [
  { family: 'header_logo', purpose: 'Opens', products: [] },
  {
    family: 'hero_product',
    purpose: 'Leads',
    products: [{ title: 'Washed Linen Throw' }],
    source: 0
  },
  {
    family: 'product_grid_2col',
    purpose: 'Shows more',
    products: [{ title: 'Cedar candle' }, { title: 'Wool blanket' }],
    source: 1
  },
  { family: 'text', purpose: 'Tells', products: [], source: 2 },
  { family: 'footer', purpose: 'Closes', products: [] }
] satisfies StudioStepInput['sections']

/** The reference as the sections step saves it (`referenceDna`). */
const followed = (
  mode: 'copy' | 'remix',
  heroHeight = 700,
  tone: 'light' | 'dark' | 'accent' = 'light'
): NonNullable<StudioStepInput['reference']> => ({
  mode,
  reference: [
    { family: 'hero_image', tone, height: heroHeight },
    { family: 'product_grid_2col', tone: 'light', height: 700 },
    { family: 'text', tone: 'light', height: 200 }
  ],
  refIndex: [0, 1, 2, null],
  images: ['sect/m1/1.jpg', 'sect/m1/2.jpg', null]
})

function ports(over: Partial<StudioStepPorts> = {}): StudioStepPorts {
  return {
    // The Art director's stand-in: code's own storyboard for the input.
    storyboard: vi.fn(async (input: StoryboardInput) => codeStoryboard(input)),
    design: vi.fn(async () => ({
      section: {
        id: 's2',
        height: 640,
        html: `<img src="${photo}" alt=""><h1>Meet the Washed Linen Throw</h1>`,
        css: ''
      },
      alt: 'Meet the Washed Linen Throw.',
      runId: 'run-1'
    })),
    request: vi.fn(async () => '00000001-3333-4333-8333-333333333333'),
    renders: vi.fn(async () => []),
    picture: vi.fn(async () => null),
    critique: vi.fn(async () => ({
      pass: true,
      scores: {} as never,
      problems: []
    })),
    coded: vi.fn(async () => {}),
    sign: vi.fn(async () => null),
    fits: () => true,
    now: () => 1_000_000,
    ...over
  } as never
}
const input = (
  reference?: StudioStepInput['reference'],
  saved?: unknown
): StudioStepInput => ({
  slot: { emailType: 'launch', angle: 'Meet the throw' },
  sections: sections.map((s) => ({ ...s, products: [...s.products] })),
  blocks,
  brand: sampleBrand,
  saved,
  ...(reference ? { reference } : {})
})
/** The header, the hero and the footer only. */
const short = (
  reference?: StudioStepInput['reference'],
  saved?: unknown
): StudioStepInput => {
  const full = input(reference, saved)
  const keep = [0, 1, 4]
  return {
    ...full,
    sections: keep.map((i) => full.sections[i]!),
    blocks: keep.map((i) => full.blocks[i]!)
  }
}
const storyOf = (p: StudioStepPorts) =>
  vi.mocked(p.storyboard).mock.calls[0]![0]
const briefOf = (p: StudioStepPorts) => vi.mocked(p.design).mock.calls[0]![0]

describe('the design studio follows the reference email (DST-002b)', () => {
  it('copies: each section knows the reference section it follows, and the hero keeps its tone and height', async () => {
    const p = ports()
    await studioDesignStep(input(followed('copy', 700, 'dark')), p)
    const story = storyOf(p)
    expect(story.mode).toBe('copy')
    expect(story.sections.map((s) => s.ref)).toEqual([
      undefined,
      0,
      1,
      2,
      undefined
    ])
    expect(story.reference).toEqual(followed('copy', 700, 'dark').reference)
    const brief = briefOf(p)
    expect(brief).toMatchObject({
      mode: 'copy',
      board: { id: 's2', render: 'designed', tone: 'dark' },
      reference: { tone: 'dark', height: 700 }
    })
    // About the reference's height (within a quarter of it).
    expect(brief.board.height).toBeGreaterThanOrEqual(525)
    expect(brief.board.height).toBeLessThanOrEqual(875)
    expect(p.coded).not.toHaveBeenCalled()
  })

  it('gives a copied hero its reference picture for the match score, never to an agent (DST-004b)', async () => {
    const p = ports()
    await studioDesignStep(input(followed('copy', 700, 'dark')), p)
    const brief = briefOf(p)
    expect(brief.reference).toEqual({
      tone: 'dark',
      height: 700,
      image: 'sect/m1/1.jpg'
    })
    const sent = sectionDesignerAgent.task({ brief, problems: [] })
    expect(sent).not.toContain('sect/m1/')
    expect(JSON.parse(sent).section.reference).toEqual({
      tone: 'dark',
      height: 700
    })
    // An unsafe path, or none, gives no picture.
    for (const images of [['../x.jpg', null, null], undefined]) {
      const q = ports()
      await studioDesignStep(
        input({
          ...followed('copy', 700, 'dark'),
          ...(images ? { images } : { images: undefined })
        }),
        q
      )
      expect(briefOf(q).reference).not.toHaveProperty('image')
    }
  })

  it('remixes: its own plan follows no section, the Art director sees the whole reference, the hero is free', async () => {
    const p = ports()
    // A Remix plan is the planner's own: its sections have no source.
    const own = input(followed('remix', 700, 'dark'))
    await studioDesignStep(
      {
        ...own,
        sections: own.sections.map((s) => ({ ...s, source: undefined }))
      },
      p
    )
    const story = storyOf(p)
    expect(story.mode).toBe('remix')
    expect(story.sections.every((s) => s.ref === undefined)).toBe(true)
    expect(story.reference).toEqual(followed('remix', 700, 'dark').reference)
    const sent = JSON.parse(
      artDirectorAgent.task({ input: story, problems: [] })
    )
    expect(sent.reference_email).toEqual([
      { kind: 'hero_image', tone: 'dark', height: 700 },
      { kind: 'product_grid_2col', tone: 'light', height: 700 },
      { kind: 'text', tone: 'light', height: 200 }
    ])
    const brief = briefOf(p)
    expect(brief.mode).toBe('remix')
    expect(brief).not.toHaveProperty('reference')
  })

  it('designs from scratch in the copied order, and says so, when the reference heights cannot fit', async () => {
    // A 1,500 px hero keeps at least 1,125 px: more than a short email's
    // live sections can carry as pictures (60% of the email at most).
    const tall = followed('copy', 1_500)
    const p = ports()
    await studioDesignStep(short(tall), p)
    expect(p.coded).toHaveBeenCalledWith('email', 'reference_unfit')
    expect(storyOf(p).mode).toBe('scratch')
    expect(storyOf(p)).not.toHaveProperty('reference')
    expect(briefOf(p).mode).toBe('scratch')
    expect(briefOf(p)).not.toHaveProperty('reference')
    // The same reference fits the longer email: it is copied.
    const fits = ports()
    await studioDesignStep(input(tall), fits)
    expect(storyOf(fits).mode).toBe('copy')
    expect(fits.coded).not.toHaveBeenCalled()
  })

  it('says it once: a later claim goes on from the saved storyboard', async () => {
    const tall = followed('copy', 1_500)
    const first = ports()
    const out = (await studioDesignStep(short(tall), first)) as {
      waiting: { work: object }
    }
    expect(first.coded).toHaveBeenCalledWith('email', 'reference_unfit')
    const later = ports()
    await studioDesignStep(
      short(tall, JSON.parse(JSON.stringify(out.waiting.work))),
      later
    )
    expect(later.storyboard).not.toHaveBeenCalled()
    expect(later.coded).not.toHaveBeenCalledWith('email', 'reference_unfit')
    // The same briefs: the rounds go on, nothing is designed or drawn again.
    expect(later.design).not.toHaveBeenCalled()
    expect(later.request).not.toHaveBeenCalled()
  })

  it('goes on with a copied email the same way on a later claim', async () => {
    const copy = followed('copy', 700, 'dark')
    const first = ports()
    const out = (await studioDesignStep(input(copy), first)) as {
      waiting: { work: object }
    }
    expect(first.design).toHaveBeenCalledTimes(1)
    const later = ports()
    await studioDesignStep(
      input(copy, JSON.parse(JSON.stringify(out.waiting.work))),
      later
    )
    expect(later.storyboard).not.toHaveBeenCalled()
    expect(later.design).not.toHaveBeenCalled()
    expect(later.request).not.toHaveBeenCalled()
  })

  it('follows nothing a section’s own bad place points to', async () => {
    const p = ports()
    const bad = input(followed('copy'))
    await studioDesignStep(
      {
        ...bad,
        sections: bad.sections.map((s, i) =>
          i === 1 ? { ...s, source: 9 } : i === 2 ? { ...s, source: -1 } : s
        )
      },
      p
    )
    const story = storyOf(p)
    expect(story.sections.map((s) => s.ref)).toEqual([
      undefined,
      undefined,
      undefined,
      2,
      undefined
    ])
    expect(briefOf(p)).not.toHaveProperty('reference')
  })

  it('follows nothing an index it does not hold points to (a saved reference read back)', async () => {
    const p = ports()
    await studioDesignStep(
      input({ ...followed('copy'), refIndex: [7, -1, null] }),
      p
    )
    const story = storyOf(p)
    expect(story.mode).toBe('copy')
    expect(story.sections.every((s) => s.ref === undefined)).toBe(true)
    expect(briefOf(p)).not.toHaveProperty('reference')
  })

  it('is Scratch as before without a reference', async () => {
    const p = ports()
    await studioDesignStep(input(), p)
    const story = storyOf(p)
    expect(story.mode).toBe('scratch')
    expect(story).not.toHaveProperty('reference')
    expect(story.sections.some((s) => 'ref' in s)).toBe(false)
    expect(briefOf(p).mode).toBe('scratch')
  })
})
