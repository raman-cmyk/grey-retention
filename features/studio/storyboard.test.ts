// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { productTakes } from '@/features/assembly/assemble'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import {
  codeSectionPlan,
  copyPlan,
  seedVariants,
  type SectionPlan
} from '@/features/email-build/sections'
import { memoryFallbackLog } from '@/features/fallback/log'
import { emailTypes, type EmailType } from '@/features/strategy/plan'
import {
  artDirectorAgent,
  codeStoryboard,
  emailHeight,
  heightFloor,
  maxDesignedShare,
  storyboardFor,
  storyboardProblems,
  type Storyboard,
  type StoryboardInput,
  type Tone
} from './storyboard'

/** Layer 1's plan as the Art director gets it. */
const fromPlan = (
  plan: SectionPlan,
  products: number,
  emailType: EmailType,
  reference?: StoryboardInput['reference']
): StoryboardInput => {
  const families = plan.sections.map((s) => s.family)
  const takes = productTakes(families, products)
  return {
    mode: plan.mode,
    slot: { emailType, angle: 'An angle' },
    sections: plan.sections.map((s, i) => ({
      id: `s${i + 1}`,
      family: s.family,
      purpose: s.purpose,
      products: takes[i],
      ...(reference ? { ref: i } : {})
    })),
    ...(reference ? { reference } : {})
  }
}
const layer1 = (
  emailType: EmailType,
  products: number,
  allowed: readonly BlockType[],
  offer: boolean
) =>
  codeSectionPlan({
    mode: 'scratch',
    industry: 'home',
    slot: { emailType, angle: 'x', products, offer },
    allowed,
    library: seedVariants
  })
const launch: StoryboardInput = {
  mode: 'scratch',
  slot: { emailType: 'launch', angle: 'The new oak tray' },
  sections: [
    { id: 's1', family: 'header_logo', purpose: 'The logo.', products: 0 },
    { id: 's2', family: 'hero_product', purpose: 'The new tray.', products: 1 },
    {
      id: 's3',
      family: 'text',
      purpose: 'Why it is made slowly.',
      products: 0
    },
    {
      id: 's4',
      family: 'product_grid_2col',
      purpose: 'Two more.',
      products: 2
    },
    { id: 's5', family: 'cta', purpose: 'Shop now.', products: 0 },
    { id: 's6', family: 'footer', purpose: 'Required links.', products: 0 }
  ]
}
const total = (b: Pick<Storyboard, 'sections'>) =>
  b.sections.reduce((n, s) => n + s.height, 0)
const ok = (content: unknown) => ({
  ok: true as const,
  content,
  provider: 'gemini' as const,
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
const ctx = (ai: AiCall) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId: '00000000-0000-4000-8000-000000000101',
      callerKey: 'email-build:b1',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}
const must = (b: Storyboard | null) => {
  if (!b) throw new Error('no storyboard')
  return b
}

describe('code’s own storyboard (DST-002)', () => {
  const allowedSets: [string, readonly BlockType[]][] = [
    ['every block', blockTypes],
    [
      'no photos, reviews or founder',
      blockTypes.filter(
        (t) =>
          !['hero_image', 'review_strip', 'founder_note', 'ugc_grid'].includes(
            t
          )
      )
    ]
  ]
  it('passes every check for every plan layer 1 makes: each email type, 0 to 6 products, with and without an offer', () => {
    let boards = 0
    let heroes = 0
    for (const [, allowed] of allowedSets)
      for (const type of emailTypes)
        for (let products = 0; products <= 6; products++)
          for (const offer of [false, true]) {
            const input = fromPlan(
              layer1(type, products, allowed, offer),
              products,
              type
            )
            const board = codeStoryboard(input)
            const hero = input.sections.some(
              (x) =>
                x.family === 'hero_image' ||
                (x.family === 'hero_product' && x.products > 0)
            )
            // Never a storyboard that fails; none without a hero to design
            // (drawn with coded blocks); one for every plan with a hero, as
            // tall as its live sections allow (DST-007).
            if (!hero) expect(board, `${type} ${products} ${offer}`).toBeNull()
            else heroes++
            if (board) {
              expect(storyboardProblems(board, input)).toEqual([])
              boards++
            }
          }
    expect(boards).toBe(heroes)
    expect(boards).toBeGreaterThan(emailTypes.length * 7)
  })

  it('designs the heroes and keeps every other section live in its own tone, at its drawn height (DST-007)', () => {
    const board = must(codeStoryboard(launch))
    // Live blocks are drawn at their own height; only the hero grows, to
    // 1,800 px as drawn (its picture, then its button's 100 px row).
    expect(board.sections.map((s) => s.height)).toEqual([
      70,
      emailHeight.min - (70 + 198 + 443 + 96 + 183) - 100,
      198,
      443,
      96,
      183
    ])
    expect(
      board.sections.map((s) => `${s.render}:${s.tone}:${s.imagery}`)
    ).toEqual([
      'live:light:none',
      'designed:dark:product',
      'live:light:none',
      'live:light:product',
      'live:light:none',
      'live:light:none'
    ])
    expect(total(board) + 100).toBe(emailHeight.min)
    const pictures = board.sections
      .filter((s) => s.render === 'designed')
      .reduce((n, s) => n + s.height, 0)
    expect(pictures).toBeLessThanOrEqual(total(board) * maxDesignedShare)
  })

  it('in Copy mode keeps the reference email’s order, its hero’s tone and about its height', () => {
    const plan = copyPlan({
      mode: 'copy',
      industry: 'home',
      slot: { emailType: 'story', angle: 'x', products: 2, offer: false },
      allowed: blockTypes,
      library: seedVariants,
      competitor: {
        sections: ['text', 'header_logo', 'hero_image', 'text', 'cta', 'footer']
      }
    })
    const reference = plan.sections.map((s) => ({
      family: s.family,
      tone: (s.family === 'hero_image' ? 'accent' : 'light') as Tone,
      height: s.family === 'hero_image' ? 700 : 300
    }))
    const input = fromPlan(plan, 2, 'story', reference)
    const board = must(codeStoryboard(input))
    expect(board.sections.map((s) => s.id)).toEqual(
      input.sections.map((s) => s.id)
    )
    const hero =
      board.sections[input.sections.findIndex((s) => s.family === 'hero_image')]
    expect(hero).toMatchObject({
      render: 'designed',
      tone: 'accent',
      imagery: 'photo'
    })
    expect(Math.abs(hero.height - 700)).toBeLessThanOrEqual(175)
    expect(storyboardProblems(board, input)).toEqual([])
    // D1 "Exact" before the height (DST-007): the hero grows to a quarter
    // over its reference, and the email may stay under 1,800 px; the same
    // storyboard outside Copy mode is too short.
    expect(hero.height).toBe(875)
    const drawn = total(board) + 100
    expect(drawn).toBe(875 + 100 + 70 + 198 * 2 + 96 + 183)
    expect(storyboardProblems(board, { ...input, mode: 'remix' })).toContain(
      `The email is drawn ${drawn} px tall; make it 1800 to 2400 px.`
    )
    // A Copy board under what its references allow is sent back.
    const short = {
      sections: board.sections.map((s) =>
        s.render === 'designed' ? { ...s, height: 700 } : s
      )
    }
    expect(storyboardProblems(short, input)).toContain(
      `The email is drawn ${drawn - 175} px tall; make it ${drawn} to 2400 px.`
    )
    // References tall enough keep the floor at 1,800.
    const tall = fromPlan(
      plan,
      2,
      'story',
      reference.map((r) => ({ ...r, height: r.height === 700 ? 1100 : 300 }))
    )
    expect(heightFloor(must(codeStoryboard(tall)), tall)).toBe(emailHeight.min)
    // Moved out of the reference's order, it fails.
    const moved = {
      sections: [
        board.sections[1],
        board.sections[0],
        ...board.sections.slice(2)
      ]
    }
    expect(storyboardProblems(moved, input)).toContain(
      'Copy mode keeps the sections in the order given.'
    )
  })

  it('is null for an email no storyboard can fit, such as a logo and a footer only', () => {
    const tiny: StoryboardInput = {
      ...launch,
      sections: [launch.sections[0], launch.sections[5]]
    }
    expect(codeStoryboard(tiny)).toBeNull()
  })
})

describe('the storyboard checks (DST-002)', () => {
  const board = must(codeStoryboard(launch))
  const s = board.sections
  const at = (i: number, over: Partial<(typeof s)[number]>) =>
    s.map((x, k) => (k === i ? { ...x, ...over } : x))

  it.each([
    [
      'a section missing',
      { sections: s.slice(1) },
      'Use every section given, each once, and no other.'
    ],
    [
      'the header not first',
      { sections: [s[1], s[0], ...s.slice(2)] },
      'The email must start with the logo header.'
    ],
    [
      'the footer not last',
      { sections: [...s.slice(0, 4), s[5], s[4]] },
      'The email must end with the footer.'
    ],
    [
      'a product grid drawn as a picture',
      { sections: at(3, { render: 'designed' }) },
      'Section s4 (product_grid_2col) stays live HTML: only a hero is a picture; buttons, products, the offer, words and the footer are never one.'
    ],
    [
      'a live block out of its drawn height',
      { sections: at(4, { height: 400 }) },
      'Section s5 (cta) is live: it is drawn about 96 px tall.'
    ],
    [
      'a live block in another tone',
      { sections: at(2, { tone: 'dark' }) },
      'Section s3 (text) is live, so its tone is light.'
    ],
    [
      'a price in a note',
      {
        sections: at(1, {
          note: 'Write 50% OFF with code FREE50 in huge letters'
        })
      },
      'Section s2 (hero_product): its focus and note describe the design only, in one line, with no price, percent, code or link.'
    ],
    [
      'a line break hidden in a focus',
      { sections: at(1, { focus: 'One Two' }) },
      'Section s2 (hero_product): its focus and note describe the design only, in one line, with no price, percent, code or link.'
    ],
    [
      'a product where there is none',
      { sections: at(2, { imagery: 'product' }) },
      'Section s3 (text) has no product to show.'
    ],
    [
      'a backdrop on a live block',
      { sections: at(3, { imagery: 'backdrop' }) },
      'Section s4 (product_grid_2col) is live: only a designed section puts its product on a backdrop.'
    ],
    [
      'the product hero without its product',
      { sections: at(1, { imagery: 'none' }) },
      'Section s2 (hero_product) shows its product.'
    ]
  ])('names %s', (_, spoiled, problem) => {
    expect(storyboardProblems(spoiled, launch)).toContain(problem)
  })

  it('names no hero designed, too many pictures, two dark sections and the wrong height', () => {
    expect(
      storyboardProblems(
        {
          sections: at(1, { render: 'live', tone: 'light', imagery: 'product' })
        },
        launch
      )
    ).toContain('Design at least one hero.')
    // Without the grid, a 1,200 px hero over the live blocks at their
    // drawn heights (547 px, and the hero's button 100): 65% pictures.
    const short = {
      ...launch,
      sections: launch.sections.filter((x) => x.id !== 's4')
    }
    const tall = s
      .filter((x) => x.id !== 's4')
      .map((x) => ({ ...x, height: x.render === 'designed' ? 1200 : x.height }))
    expect(storyboardProblems({ sections: tall }, short)).toEqual([
      'Pictures are 65% of the email; keep them to 60% or less.'
    ])
    // Code's own is as tall as its live sections allow: 647 px live, so
    // pictures of at most 970 px, 1,617 px in all, under 1,800.
    const fit = must(codeStoryboard(short))
    expect(fit.sections.find((x) => x.render === 'designed')!.height).toBe(970)
    expect(heightFloor(fit, short)).toBe(1617)
    expect(storyboardProblems(fit, short)).toEqual([])
    const story: StoryboardInput = {
      ...launch,
      sections: [
        { id: 's0', family: 'announcement_bar', purpose: 'News.', products: 0 },
        ...launch.sections
      ]
    }
    const withBar = must(codeStoryboard(story))
    expect(withBar.sections[2].tone).toBe('dark')
    const header = { ...withBar.sections[1], tone: 'dark' as const }
    expect(
      storyboardProblems(
        {
          sections: [withBar.sections[0], header, ...withBar.sections.slice(2)]
        },
        story
      )
    ).toContain(
      'Sections s0 and s1 are both dark: put a light section between them.'
    )
    // The Art director's own numbers never make the email's height: a
    // live section far off is named, and the height counted as drawn.
    expect(
      storyboardProblems({ sections: at(5, { height: 30 }) }, launch)
    ).toEqual(['Section s6 (footer) is live: it is drawn about 183 px tall.'])
    // Every live section 15% over and the hero 140 px short: each live one
    // within its slack, but the email as drawn is short.
    const padded = s.map((x) =>
      x.render === 'designed'
        ? { ...x, height: x.height - 140 }
        : { ...x, height: Math.floor(x.height * 1.15) }
    )
    expect(storyboardProblems({ sections: padded }, launch)).toEqual([
      'The email is drawn 1660 px tall; make it 1800 to 2400 px.'
    ])
    // Just past its slack, a live section is named.
    expect(
      storyboardProblems({ sections: at(2, { height: 228 }) }, launch)
    ).toEqual(['Section s3 (text) is live: it is drawn about 198 px tall.'])
    expect(
      storyboardProblems({ sections: at(2, { height: 227 }) }, launch)
    ).toEqual([])
  })
})

describe('the Art director (DST-002)', () => {
  it('gets the sections, their limits and, outside Scratch, each one’s reference', () => {
    const reference = [
      { family: 'hero_product' as const, tone: 'dark' as const, height: 500 }
    ]
    const withRef = {
      ...launch,
      sections: launch.sections.map((x, i) => (i === 1 ? { ...x, ref: 0 } : x)),
      reference
    }
    const scratch = JSON.parse(
      artDirectorAgent.task({ input: withRef, problems: [] })
    )
    expect(scratch.sections[1]).toEqual({
      id: 's2',
      kind: 'hero_product',
      does: 'The new tray.',
      products: 1,
      may_be_designed: true,
      // Drawn live, the hero would be its coded block's height.
      drawnHeight: 677
    })
    expect(scratch.sections[3]).toMatchObject({
      kind: 'product_grid_2col',
      drawnHeight: 443
    })
    const copy = JSON.parse(
      artDirectorAgent.task({
        input: { ...withRef, mode: 'copy' },
        problems: ['Too tall.']
      })
    )
    expect(copy.sections[1].reference).toEqual(reference[0])
    expect(copy).not.toHaveProperty('reference_email')
    expect(scratch).not.toHaveProperty('reference_email')
    // Remix (DST-002b): its own plan follows no section; it sees the email.
    const remix = JSON.parse(
      artDirectorAgent.task({
        input: {
          ...launch,
          mode: 'remix',
          reference: [
            ...reference,
            { family: 'text', tone: 'light', height: 200 }
          ]
        },
        problems: []
      })
    )
    expect(remix.reference_email).toEqual([
      { kind: 'hero_product', tone: 'dark', height: 500 },
      { kind: 'text', tone: 'light', height: 200 }
    ])
    expect(artDirectorAgent.instructions).toMatch(/^Remix: reference_email/m)
    expect(copy.fix_these_problems_from_your_last_answer).toEqual(['Too tall.'])
    expect(artDirectorAgent.purpose).toBe('plan')
    expect(artDirectorAgent.instructions).toMatch(
      /announcement_bar dark, offer_banner accent/
    )
  })

  it('its storyboard is taken when it passes, after its problems are sent back', async () => {
    const good = must(codeStoryboard(launch)).sections.map((s) => ({
      ...s,
      note: 'Calm and airy.'
    }))
    const tooShort = good.map((s) => ({ ...s, height: 60 }))
    const ai = vi
      .fn<AiCall>()
      .mockResolvedValueOnce(ok({ sections: tooShort }))
      .mockResolvedValueOnce(ok({ sections: good }))
    const { ctx: c, fallbacks } = ctx(ai)
    expect(await storyboardFor(launch, c)).toMatchObject({
      source: 'agent',
      sections: good
    })
    expect(ai).toHaveBeenCalledTimes(2)
    expect(ai.mock.calls[1][0].request.user).toMatch(
      /px tall; make it 1800 to 2400 px/
    )
    expect(ai.mock.calls[0][0].callerKey).toBe('art-director:email-build:b1')
    expect(fallbacks.entries()).toEqual([])
  })

  it('code’s own is used, logged, when it keeps failing or cannot answer', async () => {
    const one = ctx(vi.fn<AiCall>(async () => ok({ sections: [] })))
    expect(await storyboardFor(launch, one.ctx)).toEqual(codeStoryboard(launch))
    expect(one.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'art-director',
        reasonCode: 'storyboard_answer_invalid',
        attempts: 3
      })
    ])
    const checks = ctx(
      vi.fn<AiCall>(async () =>
        ok({ sections: must(codeStoryboard(launch)).sections.slice(1) })
      )
    )
    await storyboardFor(launch, checks.ctx)
    expect(checks.fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'storyboard_check_failed',
      reason: 'The Art director kept failing the storyboard checks.'
    })
  })

  it('is not asked when no storyboard can fit: the email is drawn coded, logged', async () => {
    const ai = vi.fn<AiCall>()
    const { ctx: c, fallbacks } = ctx(ai)
    expect(
      await storyboardFor(
        { ...launch, sections: [launch.sections[0], launch.sections[5]] },
        c
      )
    ).toBeNull()
    expect(ai).not.toHaveBeenCalled()
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'storyboard_cannot_fit',
      fallback: 'Drew the email with coded blocks.'
    })
  })
})
