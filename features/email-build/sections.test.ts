// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import type { BlockType } from '@/features/blocks/catalog'
import {
  checkSections,
  codeSectionPlan,
  copyPlan,
  planSections,
  searchVariants,
  sectionPlannerAgent,
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
