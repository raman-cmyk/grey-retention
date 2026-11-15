// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import { renderEmail } from '@/features/blocks/render'
import type { Block } from '@/features/blocks/catalog'
import type { RenderedSection } from './renderer'
import { studioDesignStep, type StudioStepPorts } from './design-step'
import type { Storyboard } from './storyboard'
import type { BuildRender } from './waits'

const photo = 'https://cdn.shop.example/images/throw.jpg'
const hero = {
  type: 'hero_product',
  content: { ...(sampleBlocks.hero_product.content as object), image: photo }
} as Block
const blocks: Block[] = [sampleBlocks.header_logo, hero, sampleBlocks.footer]
const sections = [
  { family: 'header_logo', purpose: 'Opens', products: [] },
  {
    family: 'hero_product',
    purpose: 'Leads',
    products: [{ title: 'Washed Linen Throw' }]
  },
  { family: 'footer', purpose: 'Closes', products: [] }
] as const
const board = (id: string, render: 'designed' | 'live') => ({
  id,
  render,
  tone: 'light' as const,
  height: render === 'designed' ? 640 : 120,
  focus: 'The throw',
  imagery: render === 'designed' ? ('product' as const) : ('none' as const),
  space: 'normal' as const,
  note: 'The throw large, the words beside it.'
})
const storyboard: Storyboard = {
  source: 'code',
  sections: [board('s1', 'live'), board('s2', 'designed'), board('s3', 'live')]
}
const render = '00000001-3333-4333-8333-333333333333'
const drawn: BuildRender = {
  id: render,
  key: 's2-r1-x',
  state: 'drawn',
  path: `render/${render}.jpg`,
  height: 640,
  bytes: 1,
  etag: 'e'
}
const image: RenderedSection = {
  id: 's2',
  bytes: new Uint8Array([1]),
  contentType: 'image/jpeg',
  width: 1200,
  height: 1280
}
const signed = `https://db.example/storage/v1/object/sign/studio-renders/render/${render}.jpg?token=t`

function ports(
  over: Partial<StudioStepPorts> = {},
  renders: BuildRender[] = []
): StudioStepPorts {
  return {
    storyboard: vi.fn(async () => storyboard),
    design: vi.fn(async () => ({
      section: {
        id: 's2',
        height: 640,
        html: `<img src="${photo}" alt=""><h1>Meet the Washed Linen Throw</h1>`,
        css: ''
      },
      alt: 'Just in. Meet the Washed Linen Throw.',
      runId: 'run-1'
    })),
    request: vi.fn(async () => render),
    renders: vi.fn(async () => renders),
    picture: vi.fn(async () => image),
    critique: vi.fn(async () => ({
      pass: true,
      scores: {} as never,
      problems: []
    })),
    coded: vi.fn(async () => {}),
    sign: vi.fn(async () => signed),
    fits: () => true,
    now: () => 1_000_000,
    ...over
  } as never
}
const input = (saved?: unknown) => ({
  slot: { emailType: 'launch' as const, angle: 'Meet the throw' },
  sections: sections.map((s) => ({ ...s, products: [...s.products] })),
  blocks,
  brand: sampleBrand,
  saved
})
const waitingOf = (out: unknown) =>
  (out as { waiting: { work: object; seconds: number } }).waiting

describe('the design step with the studio (DST-006c part 2a)', () => {
  it('storyboards the email, designs its hero, asks for its picture and waits, keeping both', async () => {
    const p = ports()
    const out = waitingOf(await studioDesignStep(input(), p))
    expect(p.storyboard).toHaveBeenCalledWith({
      mode: 'scratch',
      slot: { emailType: 'launch', angle: 'Meet the throw' },
      sections: [
        { id: 's1', family: 'header_logo', purpose: 'Opens', products: 0 },
        { id: 's2', family: 'hero_product', purpose: 'Leads', products: 1 },
        { id: 's3', family: 'footer', purpose: 'Closes', products: 0 }
      ]
    })
    // The brief: the hero's own words, its photo, its product, the brand.
    const brief = vi.mocked(p.design).mock.calls[0]![0]
    expect(brief).toMatchObject({
      board: { id: 's2', render: 'designed' },
      family: 'hero_product',
      words: {
        eyebrow: 'Just in',
        headline: 'Meet the Washed Linen Throw',
        sub: 'Stone-washed for a soft hand from the first night.'
      },
      image: { url: photo },
      product: { title: 'Washed Linen Throw' },
      fonts: []
    })
    expect(out.work).toMatchObject({
      studio: {
        storyboard,
        rounds: { sections: [{ id: 's2', state: 'drawing', render }] }
      }
    })
    expect(out.seconds).toBeGreaterThanOrEqual(60)
  })

  it('goes on from its work without storyboarding again, and draws the hero as its picture', async () => {
    const first = waitingOf(await studioDesignStep(input(), ports()))
    const p = ports({}, [drawn])
    const out = (await studioDesignStep(input(first.work), p)) as {
      blocks: Block[]
      pictures: number
    }
    expect(p.storyboard).not.toHaveBeenCalled()
    expect(p.design).not.toHaveBeenCalled()
    expect(p.sign).toHaveBeenCalledWith(render)
    expect(out.pictures).toBe(1)
    expect((out.blocks[1]!.content as { picture?: unknown }).picture).toEqual({
      src: signed,
      alt: 'Just in. Meet the Washed Linen Throw.',
      height: 640,
      render
    })
    // The other blocks stay as they were.
    expect(out.blocks[0]).toBe(blocks[0])
    expect(out.blocks[2]).toBe(blocks[2])
    // The email shows the picture and the live button, not the words as HTML.
    const html = renderEmail({ blocks: out.blocks, brand: sampleBrand })
    expect(html).toContain('alt="Just in. Meet the Washed Linen Throw."')
    expect(html).not.toContain('>Meet the Washed Linen Throw<')
  })

  it('draws the email coded when no storyboard fits, nothing is designed, or the hero has no https photo', async () => {
    for (const p of [
      ports({ storyboard: vi.fn(async () => null) }),
      ports({
        storyboard: vi.fn(async () => ({
          ...storyboard,
          sections: storyboard.sections.map((s) => ({
            ...s,
            render: 'live' as const
          }))
        }))
      })
    ]) {
      const out = await studioDesignStep(input(), p)
      expect(out).toEqual({ blocks, pictures: 0 })
      expect(p.design).not.toHaveBeenCalled()
    }
    const inline = {
      ...input(),
      blocks: [blocks[0]!, sampleBlocks.hero_product, blocks[2]!] as Block[]
    }
    const p = ports()
    expect(await studioDesignStep(inline, p)).toMatchObject({ pictures: 0 })
    expect(p.design).not.toHaveBeenCalled()
  })

  it('never storyboards an email whose layer 1 and draft disagree', async () => {
    const p = ports()
    const out = await studioDesignStep(
      { ...input(), sections: input().sections.slice(0, 2) },
      p
    )
    expect(out).toEqual({ blocks, pictures: 0 })
    expect(p.storyboard).not.toHaveBeenCalled()
  })

  it('keeps the hero coded, logged, when its picture cannot be linked', async () => {
    const first = waitingOf(await studioDesignStep(input(), ports()))
    const p = ports({ sign: vi.fn(async () => null) }, [drawn])
    const out = (await studioDesignStep(input(first.work), p)) as {
      blocks: Block[]
      pictures: number
    }
    expect(out.pictures).toBe(0)
    expect(out.blocks[1]).toBe(hero)
    expect(p.coded).toHaveBeenCalledWith('s2', 'picture_unusable')
  })

  it('keeps a storyboard that fitted nothing, never asking again', async () => {
    const p = ports()
    const out = await studioDesignStep(
      input({ studio: { storyboard: null } }),
      p
    )
    expect(out).toEqual({ blocks, pictures: 0 })
    expect(p.storyboard).not.toHaveBeenCalled()
  })
})
