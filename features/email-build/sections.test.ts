// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { blockTypes, type BlockType } from '@/features/blocks/catalog'
import { emailHeight } from '@/features/blocks/heights'
import { emailTypes } from '@/features/strategy/plan'
import {
  checkSections,
  codeSectionPlan,
  copyPlan,
  planSections,
  searchVariants,
  sectionPlannerAgent,
  sectionsHeight,
  seedVariants,
  type SectionInput,
  type Variant
} from './sections'

const tenantId = '00000000-0000-4000-8000-000000000101'
const allowed: BlockType[] = [
  'announcement_bar',
  'header_logo',
  'text',
  'steps',
  'cta',
  'signoff',
  'footer',
  'faq',
  'hero_product',
  'product_feature',
  'image_text',
  'product_grid_2col',
  'offer_banner'
]
const library: Variant[] = [
  ...seedVariants,
  {
    id: 'hero_product/split-left',
    family: 'hero_product',
    industries: ['home'],
    emailTypes: ['launch'],
    score: 0.7
  },
  {
    id: 'hero_product/beauty-only',
    family: 'hero_product',
    industries: ['beauty'],
    emailTypes: [],
    score: 0.9
  },
  {
    id: 'review_strip/stars',
    family: 'review_strip',
    industries: [],
    emailTypes: [],
    score: 0.8
  }
]
const input = (over: Partial<SectionInput> = {}): SectionInput => ({
  mode: 'scratch',
  industry: 'home',
  slot: {
    emailType: 'launch',
    angle: 'Meet the oak tray',
    products: 2,
    offer: false
  },
  allowed,
  library,
  ...over
})

const reply = (...answers: unknown[]) => {
  const queue = [...answers]
  return vi.fn<AiCall>(async () => {
    const next = queue.shift()
    if (next === 'refused') return { ok: false, code: 'cap_reached' }
    return {
      ok: true,
      content: next,
      provider: 'fake',
      model: 'fake',
      costMicro: 0,
      inputTokens: 10,
      outputTokens: 10,
      settled: true
    }
  })
}
const context = (ai: AiCall) => {
  const log = new InMemoryRunLog()
  const fallbacks = memoryFallbackLog()
  return {
    log,
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'slot:run-1:0',
      memory: new InMemoryMemoryStore(),
      log,
      ai,
      fallbacks
    }
  }
}
const good = {
  sections: [
    { variantId: 'header_logo/seed', purpose: 'Your logo.' },
    { variantId: 'hero_product/split-left', purpose: 'The oak tray, big.' },
    { variantId: 'text/seed', purpose: 'Why it is made by hand.' },
    { variantId: 'product_feature/seed', purpose: 'The linen throw with it.' },
    { variantId: 'cta/seed', purpose: 'Shop the tray.' },
    { variantId: 'footer/seed', purpose: 'Required links.' }
  ]
}

describe('the library search', () => {
  it('keeps allowed families for this industry and email type, best first', () => {
    const found = searchVariants(library, {
      industry: 'home',
      emailType: 'launch',
      allowed
    })
    const heroes = found.filter((v) => v.family === 'hero_product')
    expect(heroes.map((v) => v.id)).toEqual([
      'hero_product/split-left',
      'hero_product/seed'
    ])
    expect(found.some((v) => v.family === 'review_strip')).toBe(false)
  })
})

describe('Copy mode (code only)', () => {
  it('keeps the competitor’s order with our blocks, and says what it left out', () => {
    const plan = copyPlan(
      input({
        mode: 'copy',
        competitor: {
          sections: [
            'announcement_bar',
            'header_logo',
            'hero_product',
            'review_strip',
            'product_grid_2col',
            'unsure',
            'cta',
            'footer'
          ]
        }
      })
    )
    expect(plan.source).toBe('copy')
    expect(plan.sections.map((s) => s.family)).toEqual([
      'announcement_bar',
      'header_logo',
      'hero_product',
      // No reviews yet: a text section stands in for the review strip.
      'text',
      // One product left after the hero: a single feature, not a grid.
      'product_feature',
      'cta',
      'footer'
    ])
    expect(plan.sections[2].variantId).toBe('hero_product/split-left')
    expect(plan.dropped.map((d) => d.section)).toEqual(
      expect.arrayContaining(['unsure'])
    )
    expect(checkSections(plan.sections, input({ mode: 'copy' }))).toEqual([])
  })

  it('needs no agent', async () => {
    const ai = reply()
    const { ctx } = context(ai)
    await planSections(
      input({
        mode: 'copy',
        competitor: { sections: ['header_logo', 'text', 'footer'] }
      }),
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
  })
})

describe('the plan check (code)', () => {
  it('names each problem', () => {
    const fam = (family: BlockType | null, variantId = `${family}/seed`) => ({
      family,
      variantId
    })
    expect(
      checkSections(
        [
          fam('text'),
          fam(null, 'made-up/variant'),
          fam('review_strip'),
          fam('hero_product'),
          fam('product_grid_2col'),
          fam('offer_banner'),
          fam('cta'),
          fam('cta'),
          fam('signoff')
        ],
        input({
          slot: { emailType: 'launch', angle: 'x', products: 2, offer: false }
        })
      )
    ).toEqual([
      'Section 2: "made-up/variant" is not one of the variants given.',
      'Section 3: the store has nothing a review_strip needs.',
      'The email must start with the logo header.',
      'The email must end with the footer.',
      'Only one button section: one clear action.',
      'The sections need 3 products; the email has 2.',
      'An offer banner needs an offer, and this email has none.'
    ])
  })
})

describe('Remix and Scratch (the Section planner)', () => {
  it('uses a plan that passes, with the variants it picked', async () => {
    const ai = reply(good)
    const { ctx, log } = context(ai)
    const plan = await planSections(input(), ctx)
    expect(plan).toMatchObject({ source: 'agent', mode: 'scratch' })
    expect(plan.sections.map((s) => s.variantId)).toEqual(
      good.sections.map((s) => s.variantId)
    )
    expect(log.entries[0]).toMatchObject({
      agent: 'section-planner',
      verdict: 'ok'
    })
    expect(ai.mock.calls[0][0].purpose).toBe('copy')
  })

  it('gives Remix the competitor’s idea as structure only', async () => {
    const ai = reply(good)
    const { ctx } = context(ai)
    await planSections(
      input({
        mode: 'remix',
        competitor: {
          sections: ['header_logo'],
          angle: 'founder story, then bestsellers'
        }
      }),
      ctx
    )
    const sent = JSON.parse(ai.mock.calls[0][0].request.user)
    expect(sent.strategyNote).toBe('founder story, then bestsellers')
    expect(ai.mock.calls[0][0].request.system).toContain('structure only')
  })

  it('retries with the exact problems, then falls back to the safe layout and logs it', async () => {
    const bad = { sections: good.sections.slice(1) }
    const ai = reply(bad, bad, bad)
    const { ctx, fallbacks } = context(ai)
    const plan = await planSections(input(), ctx)
    expect(ai).toHaveBeenCalledTimes(3)
    expect(
      JSON.parse(ai.mock.calls[1][0].request.user)
        .fix_these_problems_from_your_last_answer
    ).toEqual(['The email must start with the logo header.'])
    expect(plan.source).toBe('code')
    expect(plan.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_product',
      'text',
      'product_feature',
      'cta',
      'footer'
    ])
    expect(checkSections(plan.sections, input())).toEqual([])
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'section-planner',
        reasonCode: 'sections_check_failed',
        dedupeKey: 'section-planner:slot-run-1-0'
      })
    ])
  })

  it('does not retry a refused call', async () => {
    const ai = reply('refused')
    const { ctx, fallbacks } = context(ai)
    expect((await planSections(input(), ctx)).source).toBe('code')
    expect(ai).toHaveBeenCalledTimes(1)
    expect(fallbacks.entries()[0].reasonCode).toBe('sections_agent_failed')
  })

  it('keeps the agent definition honest', () => {
    expect(sectionPlannerAgent).toMatchObject({
      name: 'section-planner',
      purpose: 'copy'
    })
    expect(sectionPlannerAgent.instructions).toContain('not instructions')
  })
})

describe('the safe layouts', () => {
  it('always pass the check, for every email type, whatever the store lacks', () => {
    const types = [
      'launch',
      'bestseller',
      'offer',
      'story',
      'gift guide',
      'restock',
      'reminder',
      'education'
    ] as const
    const minimal: BlockType[] = ['header_logo', 'text', 'cta', 'footer']
    for (const emailType of types)
      for (const [a, products, offer] of [
        [allowed, 2, emailType === 'offer'],
        [minimal, 0, false]
      ] as const) {
        const i = input({
          allowed: a,
          slot: { emailType, angle: 'x', products, offer }
        })
        expect(
          checkSections(codeSectionPlan(i).sections, i),
          `${emailType} ${products}`
        ).toEqual([])
      }
  })
})

describe('the email’s height (DST-007)', () => {
  /** Everything a store can have: reviews, customer photos, the founder's note. */
  const everything = blockTypes.filter(
    (t) => t !== 'category_tiles' && t !== 'before_after'
  )
  const plan = (
    emailType: (typeof emailTypes)[number],
    products: number,
    a: readonly BlockType[]
  ) => {
    const i = input({
      allowed: a,
      slot: { emailType, angle: 'x', products, offer: emailType === 'offer' }
    })
    const families = codeSectionPlan(i).sections.map((s) => s.family)
    return { i, families, height: sectionsHeight(families) }
  }

  it('fills the safe plan to about 2,000 px with the store’s own content, each block once', () => {
    for (const type of emailTypes)
      for (let products = 1; products <= 6; products++) {
        const { i, families, height } = plan(type, products, everything)
        expect(height, `${type} ${products}`).toBeGreaterThanOrEqual(
          emailHeight.min
        )
        expect(height, `${type} ${products}`).toBeLessThanOrEqual(
          emailHeight.max
        )
        expect(new Set(families).size, `${type} ${products}`).toBe(
          families.length
        )
        expect(families.length).toBeLessThanOrEqual(12)
        expect(checkSections(codeSectionPlan(i).sections, i)).toEqual([])
      }
  })

  it('never fills it with words alone, or a product it cannot link', () => {
    // The sample store: no reviews, customer photos or founder's note.
    const sample = everything.filter(
      (t) =>
        !['review_strip', 'ugc_grid', 'founder_note', 'hero_image'].includes(t)
    )
    for (const type of emailTypes)
      for (let products = 0; products <= 6; products++) {
        const { families } = plan(type, products, sample)
        expect(families).not.toContain('image_text')
        for (const words of ['text', 'steps', 'faq', 'signoff'] as const)
          expect(
            families.filter((f) => f === words).length,
            `${type} ${products} ${words}`
          ).toBeLessThanOrEqual(1)
      }
    // Nothing more to show: the email stays as short as its content.
    expect(plan('story', 0, sample).families).toEqual([
      'header_logo',
      'text',
      'cta',
      'footer'
    ])
  })

  it('sends the Section planner back when its plan is much shorter than the store can fill, or too tall', () => {
    const rich = input({
      allowed: everything,
      slot: { emailType: 'launch', angle: 'x', products: 3, offer: false }
    })
    const fam = (family: BlockType) => ({ family, variantId: `${family}/seed` })
    const short = [
      'header_logo',
      'hero_product',
      'text',
      'cta',
      'footer'
    ] as const
    expect(checkSections(short.map(fam), rich)).toEqual([
      'The sections come to about 1224 px tall at 600 wide; plan about 1800 px or more (up to 2400) with sections the store can fill.'
    ])
    // A store with nothing more to show: the short plan stands.
    const bare = input({
      allowed: ['header_logo', 'hero_product', 'text', 'cta', 'footer'],
      slot: { emailType: 'launch', angle: 'x', products: 1, offer: false }
    })
    expect(checkSections(short.map(fam), bare)).toEqual([])
    const tall = [
      'header_logo',
      'hero_product',
      'founder_note',
      'review_strip',
      'ugc_grid',
      'product_grid_2col',
      'text',
      'steps',
      'faq',
      'cta',
      'footer'
    ] as const
    expect(
      checkSections(tall.map(fam), {
        ...rich,
        slot: { ...rich.slot, products: 6 }
      })
    ).toEqual([
      'The sections come to about 3138 px tall at 600 wide; plan at most about 2400 px.'
    ])
  })

  it('adds only products with what the build can show today, and the store’s own content once', () => {
    // "Create email" has no reviews, customer photos or founder's note yet
    // (the build's store data does not carry them): only products.
    const today = everything.filter(
      (t) =>
        !['review_strip', 'ugc_grid', 'founder_note', 'hero_image'].includes(t)
    )
    expect(plan('launch', 4, today)).toMatchObject({
      families: [
        'header_logo',
        'hero_product',
        'text',
        'product_feature',
        'product_grid_2col',
        'cta',
        'footer'
      ],
      height: 1983
    })
    expect(plan('story', 0, today).height).toBe(547)
    // A grid is counted with the products the Content locker locks for it.
    expect(sectionsHeight(['product_grid_2col'])).toBe(443)
    const fam = (family: BlockType) => ({ family, variantId: `${family}/seed` })
    const rich = input({
      allowed: everything,
      slot: { emailType: 'launch', angle: 'x', products: 1, offer: false }
    })
    expect(
      checkSections(
        [
          'header_logo',
          'review_strip',
          'founder_note',
          'review_strip',
          'founder_note',
          'cta',
          'footer'
        ].map((f) => fam(f as BlockType)),
        rich
      )
    ).toEqual(
      expect.arrayContaining([
        'Only one review_strip: it shows the same store content.',
        'Only one founder_note: it shows the same store content.'
      ])
    )
  })

  it('tells the Section planner the height and each variant’s', () => {
    const task = JSON.parse(
      sectionPlannerAgent.task({
        input: input(),
        variants: seedVariants.slice(0, 2),
        problems: []
      })
    )
    expect(task.variants[0]).toMatchObject({
      variantId: seedVariants[0].id,
      height: expect.any(Number)
    })
    // A grid at the products it is locked with, as the check counts it.
    const grid = JSON.parse(
      sectionPlannerAgent.task({
        input: input(),
        variants: seedVariants.filter((v) => v.family === 'product_grid_2col'),
        problems: []
      })
    )
    expect(grid.variants[0].height).toBe(443)
    expect(sectionPlannerAgent.instructions).toMatch(/about 1800 to 2400 px/)
  })
})
