// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { productTakes } from '@/features/assembly/assemble'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import {
  codeSectionPlan,
  copyPlan,
  seedVariants,
  type SectionPlan
} from '@/features/email-build/sections'
import { emailTypes, type EmailType } from '@/features/strategy/plan'
import {
  codeStoryboard,
  emailHeight,
  maxDesignedShare,
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
            // (or when the heights cannot fit), drawn with coded blocks.
            if (!hero) expect(board, `${type} ${products} ${offer}`).toBeNull()
            if (board) {
              expect(storyboardProblems(board, input)).toEqual([])
              boards++
            }
          }
    // Most plans have a hero to design.
    expect(boards).toBeGreaterThan(emailTypes.length * 7)
  })

  it('designs the heroes and keeps every other section live in its own tone', () => {
    const board = must(codeStoryboard(launch))
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
    expect(total(board)).toBeGreaterThanOrEqual(emailHeight.min)
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
      'a live block out of its height',
      { sections: at(4, { height: 400 }) },
      'Section s5 (cta) is 80 to 180 px tall.'
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
    // A 1,200 px hero with every live block at its fewest px: 64% pictures.
    const mins = [60, 1200, 100, 300, 80, 140]
    const tall = s.map((x, i) => ({ ...x, height: mins[i] }))
    expect(storyboardProblems({ sections: tall }, launch)).toEqual([
      'Pictures are 64% of the email; keep them to 60% or less.'
    ])
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
    expect(
      storyboardProblems({ sections: at(5, { height: 30 }) }, launch)
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^The email is \d+ px tall/)
      ])
    )
  })
})
