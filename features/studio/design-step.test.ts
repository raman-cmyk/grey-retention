// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const boards = vi.hoisted(() => ({ codeStoryboard: vi.fn() }))
vi.mock('./storyboard', async (original) => ({
  ...(await original<typeof import('./storyboard')>()),
  codeStoryboard: boards.codeStoryboard
}))
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
  const faces = [
    {
      family: 'Cedar Serif',
      url: 'https://cdn.shopify.com/cedar.woff2',
      weight: 700
    }
  ]

  it('passes collected faces into the actual design brief and render host allowlist', async () => {
    const fonts = vi.fn(async () => faces)
    const p = ports({ fonts })
    await studioDesignStep(input(), p)
    expect(fonts).toHaveBeenCalledTimes(1)
    expect(vi.mocked(p.design).mock.calls[0]![0].fonts).toEqual(faces)
    expect(vi.mocked(p.request).mock.calls[0]![0].hosts).toContain(
      'cdn.shopify.com'
    )
  })

  it('keeps pending render work when the collected fonts are unchanged across claims', async () => {
    const first = waitingOf(
      await studioDesignStep(input(), ports({ fonts: async () => faces }))
    )
    const p = ports({ fonts: async () => faces }, [drawn])
    const out = await studioDesignStep(input(first.work), p)
    expect(p.design).not.toHaveBeenCalled()
    expect(out).toMatchObject({ pictures: 1 })
  })

  it('invalidates the old brief when brand font faces change instead of reusing its old render', async () => {
    const first = waitingOf(
      await studioDesignStep(input(), ports({ fonts: async () => faces }))
    )
    const p = ports({ fonts: async () => [{ ...faces[0]!, weight: 400 }] }, [
      drawn
    ])
    await studioDesignStep(input(first.work), p)
    expect(p.design).toHaveBeenCalledTimes(1)
    expect(vi.mocked(p.design).mock.calls[0]![0].fonts[0]!.weight).toBe(400)
  })

  it('does not read fonts when the storyboard keeps every section coded', async () => {
    const fonts = vi.fn(async () => faces)
    const p = ports({
      fonts,
      storyboard: vi.fn(async () => ({
        ...storyboard,
        sections: storyboard.sections.map((s) => ({
          ...s,
          render: 'live' as const
        }))
      }))
    })
    expect(await studioDesignStep(input(), p)).toMatchObject({ pictures: 0 })
    expect(fonts).not.toHaveBeenCalled()
  })
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

  it('gives the storyboard the block a section is drawn as: steps in plain copy as text (DST-007)', async () => {
    const p = ports()
    await studioDesignStep(
      {
        ...input(),
        sections: [
          ...input().sections.slice(0, 2),
          { family: 'steps' as const, purpose: 'How to', products: [] },
          input().sections[2]!
        ],
        blocks: [blocks[0]!, blocks[1]!, sampleBlocks.text, blocks[2]!]
      },
      p
    )
    const board = vi.mocked(p.storyboard).mock.calls[0]![0]
    expect(board.sections[2]).toEqual({
      id: 's3',
      family: 'steps',
      purpose: 'How to',
      products: 0,
      drawn: 'text'
    })
    expect(board.sections[1]).not.toHaveProperty('drawn')
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
    expect(p.sign).toHaveBeenCalledWith(drawn)
    expect(out.pictures).toBe(1)
    // On the section's background (a light section: the brand's page).
    expect((out.blocks[1]!.content as { picture?: unknown }).picture).toEqual({
      src: signed,
      alt: 'Just in. Meet the Washed Linen Throw.',
      height: 640,
      render,
      bg: sampleBrand.background
    })
    // The other blocks stay as they were.
    expect(out.blocks[0]).toBe(blocks[0])
    expect(out.blocks[2]).toBe(blocks[2])
    // The email shows the picture and the live button, not the words as HTML.
    const html = renderEmail({ blocks: out.blocks, brand: sampleBrand })
    expect(html).toContain('alt="Just in. Meet the Washed Linen Throw."')
    expect(html).not.toContain('>Meet the Washed Linen Throw<')
  })

  it('returns its work with the link it signed, and reuses that link for the same picture on a later claim (DST-006d)', async () => {
    const first = waitingOf(await studioDesignStep(input(), ports()))
    const p = ports({}, [drawn])
    const out = (await studioDesignStep(input(first.work), p)) as {
      work: {
        studio: { signed: unknown; rounds: { until: number; waits: number } }
      }
      budget: { until: number; waits: number }
    }
    expect(out.work.studio.signed).toEqual({ s2: { render, src: signed } })
    expect(out.budget).toEqual({
      until: out.work.studio.rounds.until,
      waits: out.work.studio.rounds.waits
    })
    // As the database keeps it: the same link, never signed again.
    const saved = JSON.parse(JSON.stringify(out.work))
    const again = ports({}, [drawn])
    const next = (await studioDesignStep(input(saved), again)) as {
      blocks: Block[]
    }
    expect(again.sign).not.toHaveBeenCalled()
    expect(
      (next.blocks[1]!.content as { picture: { src: string } }).picture.src
    ).toBe(signed)
    // A link kept for another picture, or one that is not https, is signed again.
    for (const kept of [
      { s2: { render: '00000009-3333-4333-8333-333333333333', src: signed } },
      { s2: { render, src: 'http://db.example/x.jpg' } }
    ]) {
      const p2 = ports({}, [drawn])
      await studioDesignStep(
        input({ studio: { ...saved.studio, signed: kept } }),
        p2
      )
      expect(p2.sign).toHaveBeenCalledWith(drawn)
    }
    // Links it cannot read: the work is read afresh (a new storyboard), never a stray link used.
    const p3 = ports({}, [drawn])
    await studioDesignStep(
      input({ studio: { ...saved.studio, signed: { s2: 'nonsense' } } }),
      p3
    )
    expect(p3.storyboard).toHaveBeenCalledTimes(1)
  })

  it('returns no work when nothing has its picture (DST-006d)', async () => {
    const coded = await studioDesignStep(
      input(),
      ports({ storyboard: vi.fn(async () => null) })
    )
    expect(coded).toEqual({ blocks, pictures: 0 })
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

  it('never storyboards an email whose layer 1 and draft disagree, and says so', async () => {
    for (const sections of [
      input().sections.slice(0, 2),
      input().sections.map((s, i) =>
        i === 1 ? { ...s, family: 'hero_image' as const } : s
      )
    ]) {
      const p = ports()
      const out = await studioDesignStep({ ...input(), sections }, p)
      expect(out).toEqual({ blocks, pictures: 0 })
      expect(p.storyboard).not.toHaveBeenCalled()
      expect(p.coded).toHaveBeenCalledWith('email', 'layout_changed')
    }
  })

  it('puts a dark hero’s picture on the brand’s dark colour', async () => {
    const dark = {
      ...storyboard,
      sections: storyboard.sections.map((s) =>
        s.render === 'designed' ? { ...s, tone: 'dark' as const } : s
      )
    }
    const first = waitingOf(
      await studioDesignStep(
        input(),
        ports({ storyboard: vi.fn(async () => dark) })
      )
    )
    const out = (await studioDesignStep(
      input(first.work),
      ports({}, [drawn])
    )) as { blocks: Block[] }
    expect(
      (out.blocks[1]!.content as { picture: { bg: string } }).picture.bg
    ).toBe(sampleBrand.dark)
  })

  it('designs a photo hero from its own words and photo, with no product', async () => {
    const photoHero = {
      type: 'hero_image',
      content: {
        ...(sampleBlocks.hero_image.content as object),
        image: photo
      }
    } as Block
    const p = ports()
    await studioDesignStep(
      {
        ...input(),
        sections: [
          sections[0],
          { family: 'hero_image' as const, purpose: 'Leads', products: [] },
          sections[2]
        ].map((s) => ({ ...s, products: [...s.products] })),
        blocks: [blocks[0]!, photoHero, blocks[2]!]
      },
      p
    )
    const brief = vi.mocked(p.design).mock.calls[0]![0]
    expect(brief).toMatchObject({
      family: 'hero_image',
      words: {
        headline: 'Slow mornings, made softer',
        sub: 'The new linen collection is here, washed for a lived-in feel.'
      },
      image: { url: photo }
    })
    expect(brief).not.toHaveProperty('product')
    expect(brief.words).not.toHaveProperty('eyebrow')
  })

  it('keeps layer 1’s order, the one the copy was checked in: a storyboard that moves sections is replaced by code’s own', async () => {
    const moved = {
      ...storyboard,
      sections: [
        storyboard.sections[0]!,
        storyboard.sections[2]!,
        storyboard.sections[1]!
      ]
    }
    boards.codeStoryboard.mockReturnValueOnce(storyboard)
    const p = ports({ storyboard: vi.fn(async () => moved) })
    const out = waitingOf(await studioDesignStep(input(), p))
    expect(p.coded).toHaveBeenCalledWith('email', 'storyboard_reordered')
    expect(boards.codeStoryboard).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'scratch' })
    )
    const kept = (out.work as { studio: { storyboard: Storyboard } }).studio
      .storyboard
    expect(kept.sections.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(p.design).toHaveBeenCalledTimes(1)
    // When code's own fits none, the email is drawn coded.
    boards.codeStoryboard.mockReturnValueOnce(null)
    const none = ports({ storyboard: vi.fn(async () => moved) })
    expect(await studioDesignStep(input(), none)).toEqual({
      blocks,
      pictures: 0
    })
    expect(none.design).not.toHaveBeenCalled()
  })

  it('keeps the build’s limits from work it cannot read, and goes on as a JSON round trip', async () => {
    const first = waitingOf(await studioDesignStep(input(), ports()))
    const stored = JSON.parse(JSON.stringify(first.work))
    // Read back as the database returns it: the same work, no new storyboard.
    const again = ports({}, [{ ...drawn, state: 'queued' } as BuildRender])
    const out = await studioDesignStep(input(stored), again)
    expect(again.storyboard).not.toHaveBeenCalled()
    expect(again.design).not.toHaveBeenCalled()
    expect(waitingOf(out).work).toMatchObject({
      studio: { rounds: { waits: 2, renders: 1 } }
    })
    // A storyboard it cannot read: asked again, the rounds and their
    // limits kept (the same storyboard goes on from them).
    const broken = {
      studio: { storyboard: { nonsense: true }, rounds: stored.studio.rounds }
    }
    const p = ports({}, [{ ...drawn, state: 'queued' } as BuildRender])
    const next = waitingOf(await studioDesignStep(input(broken), p))
    expect(p.storyboard).toHaveBeenCalledTimes(1)
    expect(p.design).not.toHaveBeenCalled()
    expect(next.work).toMatchObject({
      studio: {
        rounds: { until: stored.studio.rounds.until, renders: 1, waits: 2 }
      }
    })
  })

  it('pauses as it waits, keeping the storyboard and the rounds', async () => {
    const p = ports({ fits: () => false })
    const out = waitingOf(await studioDesignStep(input(), p))
    expect(out.work).toMatchObject({
      studio: { storyboard, rounds: { sections: [{ state: 'design' }] } }
    })
    expect(p.design).not.toHaveBeenCalled()
  })

  it('keeps a hero coded when its picture is not this build’s drawn one, or its block refuses it, or the critic fails it', async () => {
    const first = waitingOf(await studioDesignStep(input(), ports()))
    for (const [last, sign] of [
      // Gone from the build's renders by the time it is linked.
      [[], signed],
      // Drawn again at another height since the critic saw it.
      [[{ ...drawn, height: 800 }], signed],
      // A link the hero's picture refuses.
      [[drawn], 'http://insecure.example/x.jpg']
    ] as const) {
      const p = ports({ sign: vi.fn(async () => sign) })
      vi.mocked(p.renders)
        .mockResolvedValueOnce([drawn])
        .mockResolvedValueOnce([...last])
      const out = (await studioDesignStep(input(first.work), p)) as {
        blocks: Block[]
        pictures: number
      }
      expect(out.pictures).toBe(0)
      expect(out.blocks[1]).toBe(hero)
      expect(p.coded).toHaveBeenCalledWith('s2', 'picture_unusable')
    }
    const failing = ports(
      {
        critique: vi.fn(async () => ({
          pass: false,
          scores: {} as never,
          problems: ['Larger.']
        }))
      },
      [drawn]
    )
    // Its next round is asked for, under its own key.
    expect(await studioDesignStep(input(first.work), failing)).toHaveProperty(
      'waiting'
    )
  })

  it('lets a port that throws throw: the step is tried again', async () => {
    const p = ports({
      storyboard: vi.fn(async () => {
        throw new Error('down')
      })
    })
    await expect(studioDesignStep(input(), p)).rejects.toThrow('down')
  })

  it('logs a designed hero it cannot design with, and draws it coded', async () => {
    const inline = {
      ...input(),
      blocks: [blocks[0]!, sampleBlocks.hero_product, blocks[2]!] as Block[]
    }
    const p = ports()
    expect(await studioDesignStep(inline, p)).toMatchObject({ pictures: 0 })
    expect(p.coded).toHaveBeenCalledWith('s2', 'not_designable')
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
