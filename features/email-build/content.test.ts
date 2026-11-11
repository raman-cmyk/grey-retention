// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleBrand } from '@/features/blocks/samples'
import type { BlockType } from '@/features/blocks/catalog'
import { fill, productTakes, type RunAi } from '@/features/assembly/assemble'
import { assembleLocked } from '@/features/assembly/modes'
import {
  assemblyInputSchema,
  unknownFacts,
  type CatalogProduct
} from '@/features/assembly/inputs'
import {
  checkPlacement,
  contentLockerAgent,
  lockContent,
  productLock,
  productNeeds,
  productPool,
  type LockInput
} from './content'
import type { SectionPlan } from './sections'

const tenantId = '00000000-0000-4000-8000-000000000101'
const product = (
  id: string,
  title: string,
  price: string,
  over: Partial<CatalogProduct> = {}
): CatalogProduct => ({
  id,
  title,
  price,
  image: `https://cdn.example.com/${id}.jpg`,
  url: `https://cedar.example.com/products/${id}`,
  featurable: true,
  ...over
})
const products = [
  product('p-tray', 'Oak tray', '$48.00'),
  product('p-throw', 'Linen throw', '$64.00', {
    compareAt: '$70.00',
    compareAtIsSale: true
  }),
  product('p-candle', 'Cedar candle', '$24.00'),
  product('p-mug', 'Stone mug', '$18.00'),
  product('p-hidden', 'Hidden vase', '$30.00', { featurable: false }),
  product('p-http', 'Old bowl', '$12.00', {
    image: 'http://cdn.example.com/bowl.jpg'
  }),
  product('p-ask', 'Custom table', 'Ask us')
]
const plan = (...families: BlockType[]): SectionPlan => ({
  mode: 'scratch',
  sections: families.map((family) => ({
    family,
    variantId: `${family}/seed`,
    purpose: `The ${family}.`
  })),
  dropped: [],
  source: 'agent'
})
const input = (over: Partial<LockInput> = {}): LockInput => ({
  slot: {
    date: '2026-11-17',
    emailType: 'launch',
    angle: 'Meet the oak tray',
    products: [
      { id: 'p-tray', title: 'Oak tray' },
      { id: 'p-throw', title: 'Linen throw' }
    ],
    offer: null
  },
  sections: plan(
    'header_logo',
    'hero_product',
    'text',
    'product_feature',
    'cta',
    'footer'
  ),
  store: {
    products,
    codes: [
      { code: 'CANDLE10', percent: 10, expiresAt: '2026-11-23T08:00:00Z' },
      { code: 'BIG40', percent: 40, expiresAt: null },
      { code: 'OLD5', percent: 5, expiresAt: '2026-11-01T08:00:00Z' }
    ],
    maxDiscountPercent: 20,
    // 10:00 in the store's time.
    sendAt: '2026-11-17T18:00:00Z',
    timezone: 'America/Los_Angeles',
    facts: unknownFacts
  },
  site: 'https://cedar.example.com',
  ...over
})
const withSlot = (over: Partial<LockInput['slot']>) =>
  input({ slot: { ...input().slot, ...over } })

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
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'slot:run-1:0',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}
const placed = (...sections: string[][]) => ({
  sections: sections.map((products, i) => ({ section: i + 1, products }))
})

describe('locking products, prices, pictures and links', () => {
  it('takes every value from the catalog and the store link, never from the agent', async () => {
    const ai = reply(placed(['p-tray'], ['p-throw']))
    const { ctx, fallbacks } = context(ai)
    const locked = await lockContent(input(), ctx)
    expect(locked.source).toBe('agent')
    expect(locked.changes).toEqual([])
    const hero = locked.sections[1]
    expect(hero.products).toEqual([
      {
        id: 'p-tray',
        title: 'Oak tray',
        price: '$48.00',
        image: 'https://cdn.example.com/p-tray.jpg',
        url: 'https://cedar.example.com/products/p-tray',
        from: 'catalog'
      }
    ])
    expect(hero.photos).toEqual([
      {
        url: 'https://cdn.example.com/p-tray.jpg',
        alt: 'Oak tray',
        from: 'catalog'
      }
    ])
    // A confirmed sale within the max shows its old price.
    expect(locked.sections[3].products[0]).toMatchObject({
      id: 'p-throw',
      compareAt: '$70.00'
    })
    expect(locked.sections[4].link).toEqual({
      url: 'https://cedar.example.com',
      from: 'store link'
    })
    expect(locked.sections[2].link).toBeNull()
    expect(locked.offer).toBeNull()
    // The Copywriter gets only the locked products and no codes.
    expect(locked.input.products.map((p) => p.id)).toEqual([
      'p-tray',
      'p-throw'
    ])
    expect(locked.input.codes).toEqual([])
    expect(locked.input.brief).toEqual({
      campaignType: 'launch',
      goal: 'Meet the oak tray',
      focusProductIds: ['p-tray', 'p-throw']
    })
    expect(fallbacks.entries()).toEqual([])
    expect(ai.mock.calls[0][0].purpose).toBe('copy')
  })

  it('locks the planned offer from the discount codes, with its end in store time', async () => {
    const { ctx, fallbacks } = context(reply(placed(['p-tray'], ['p-throw'])))
    const locked = await lockContent(
      input({
        slot: {
          ...input().slot,
          emailType: 'offer',
          offer: { id: 'offer:CANDLE10', code: 'candle10', percent: 10 }
        },
        sections: plan(
          'header_logo',
          'offer_banner',
          'product_grid_2col',
          'cta',
          'footer'
        )
      }),
      ctx
    )
    expect(locked.offer).toEqual({
      id: 'offer:CANDLE10',
      code: 'CANDLE10',
      percent: 10,
      endsAt: '2026-11-23T08:00:00Z',
      ends: 'Ends November 22 at 11:59 PM PST',
      from: 'discount codes'
    })
    expect(locked.sections.map((s) => s.family)).toContain('offer_banner')
    expect(locked.input.codes).toEqual([
      { code: 'CANDLE10', percent: 10, expiresAt: '2026-11-23T08:00:00Z' }
    ])
    expect(locked.input.brief.offerCode).toBe('CANDLE10')
    expect(fallbacks.entries()).toEqual([])
  })

  it('sends without an offer when the code is missing, ended or above the max, and logs it in fixed words', async () => {
    for (const [code, key] of [
      ['NOPE', 'offer_not_in_codes'],
      ['OLD5', 'offer_ended'],
      ['BIG40', 'offer_above_max']
    ] as const) {
      const { ctx, fallbacks } = context(reply(placed(['p-tray', 'p-throw'])))
      const locked = await lockContent(
        input({
          slot: {
            ...input().slot,
            offer: { id: `offer:${code}`, code, percent: 10 }
          },
          sections: plan(
            'header_logo',
            'offer_banner',
            'product_grid_2col',
            'cta',
            'footer'
          )
        }),
        ctx
      )
      expect(locked.offer, key).toBeNull()
      expect(locked.input.codes).toEqual([])
      expect(locked.sections.map((s) => s.family)).toEqual([
        'header_logo',
        'product_grid_2col',
        'cta',
        'footer'
      ])
      expect(locked.changes).toEqual([
        { key, did: 'no_offer' },
        { key: 'section_no_offer', did: 'left_out' }
      ])
      const [entry] = fallbacks.entries()
      expect(entry).toMatchObject({
        agent: 'content-locker',
        reasonCode: 'content_replaced',
        attempts: 0,
        detail: { changes: [key, 'section_no_offer'] }
      })
      expect(entry.fallback).toBe(
        'Sent it without an offer; left the section out.'
      )
      expect(JSON.stringify(entry)).not.toContain(code)
    }
  })

  it('replaces a planned product it cannot lock with another real one', async () => {
    const ai = reply(placed(['p-tray'], ['p-candle']))
    const { ctx, fallbacks } = context(ai)
    const locked = await lockContent(
      withSlot({
        products: [
          { id: 'p-tray', title: 'Oak tray' },
          { id: 'p-ask', title: 'Custom table' }
        ]
      }),
      ctx
    )
    expect(locked.sections[3].products[0]).toMatchObject({
      id: 'p-candle',
      price: '$24.00',
      from: 'catalog'
    })
    expect(locked.changes).toEqual([
      { key: 'product_price_unknown', did: 'other_product' }
    ])
    expect(fallbacks.entries()[0]).toMatchObject({
      reason: 'A planned product has no known price.',
      fallback: 'Used another product.'
    })
    const sent = JSON.parse(ai.mock.calls[0][0].request.user)
    expect(sent.planned_products.map((p: { id: string }) => p.id)).toEqual([
      'p-tray'
    ])
    // Only products code can lock are offered.
    expect(sent.other_products.map((p: { id: string }) => p.id)).toEqual([
      'p-throw',
      'p-candle',
      'p-mug'
    ])
  })

  it('says why a product cannot be locked', () => {
    const byId = new Map(products.map((p) => [p.id, p]))
    expect(productLock(byId.get('p-tray'))).toBeNull()
    expect(productLock(undefined)).toBe('product_not_in_catalog')
    expect(productLock(byId.get('p-hidden'))).toBe('product_not_featurable')
    expect(productLock(byId.get('p-http'))).toBe('product_bad_photo')
    expect(productLock(byId.get('p-ask'))).toBe('product_price_unknown')
    expect(
      productLock(product('p-x', 'Bad link', '$5.00', { url: 'not a link' }))
    ).toBe('product_bad_details')
  })

  it('uses smaller product sections, or none, when products run out, and keeps a message', async () => {
    const one = { ...input().store, products: [products[0]] }
    const slot = { ...input().slot, products: [{ id: 'p-tray', title: 'x' }] }
    const { ctx, fallbacks } = context(reply())
    const smaller = await lockContent(
      input({
        slot,
        store: one,
        sections: plan('header_logo', 'product_grid_3col', 'footer')
      }),
      ctx
    )
    expect(smaller.sections.map((s) => [s.family, s.variantId])).toEqual([
      ['header_logo', 'header_logo/seed'],
      ['product_feature', 'product_feature/seed'],
      ['text', 'text/seed'],
      ['footer', 'footer/seed']
    ])
    expect(smaller.changes).toEqual([
      { key: 'section_few_products', did: 'smaller_section' }
    ])
    expect(fallbacks.entries()).toHaveLength(1)
    const none = await lockContent(
      input({
        slot,
        store: one,
        sections: plan(
          'header_logo',
          'hero_product',
          'product_grid_2col',
          'footer'
        )
      }),
      context(reply()).ctx
    )
    expect(none.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_product',
      'text',
      'footer'
    ])
    expect(none.changes).toEqual([
      { key: 'section_few_products', did: 'left_out' }
    ])
  })

  it('uses a confirmed photo for a picture hero, or a product hero without one', async () => {
    const lifestylePhoto = {
      image: 'https://cdn.example.com/room.jpg',
      alt: 'A table set for dinner'
    }
    const sections = plan('header_logo', 'hero_image', 'text', 'cta', 'footer')
    const { ctx } = context(reply())
    const photo = await lockContent(
      input({
        sections,
        store: { ...input().store, confirmed: { lifestylePhoto } }
      }),
      ctx
    )
    expect(photo.sections[1]).toMatchObject({
      family: 'hero_image',
      products: [],
      photos: [
        {
          url: 'https://cdn.example.com/room.jpg',
          alt: 'A table set for dinner',
          from: 'confirmed photos'
        }
      ],
      link: { url: 'https://cedar.example.com', from: 'store link' }
    })
    const swapped = await lockContent(input({ sections }), ctx)
    expect(swapped.sections[1]).toMatchObject({
      family: 'hero_product',
      variantId: 'hero_product/seed',
      products: [{ id: 'p-tray' }]
    })
    expect(swapped.changes).toEqual([
      { key: 'section_no_photo', did: 'product_hero' }
    ])
  })

  it('links buttons to the first product without a store link, and leaves them out with a broken one', async () => {
    const { ctx } = context(reply(placed(['p-tray'], ['p-throw'])))
    const bare = await lockContent(input({ site: '' }), ctx)
    expect(bare.sections[4].link).toEqual({
      url: 'https://cedar.example.com/products/p-tray',
      from: 'catalog'
    })
    const broken = context(reply(placed(['p-tray'], ['p-throw'])))
    const out = await lockContent(
      input({ site: 'javascript:alert(1)' }),
      broken.ctx
    )
    expect(out.sections.map((s) => s.family)).not.toContain('cta')
    expect(out.changes).toEqual([{ key: 'section_no_link', did: 'left_out' }])
  })

  it('refuses a send time on another day', async () => {
    const { ctx } = context(reply())
    await expect(
      lockContent(
        input({ store: { ...input().store, sendAt: '2026-11-18T18:00:00Z' } }),
        ctx
      )
    ).rejects.toThrow('not on the slot’s day')
  })
})

describe('the Content locker agent', () => {
  it('is asked only when there is a choice', async () => {
    const ai = reply()
    const { ctx } = context(ai)
    const locked = await lockContent(
      input({
        sections: plan('header_logo', 'product_grid_2col', 'cta', 'footer')
      }),
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
    expect(locked.source).toBe('code')
    expect(locked.sections[1].products.map((p) => p.id)).toEqual([
      'p-tray',
      'p-throw'
    ])
  })

  it('gets its exact problems back, then its answer is used', async () => {
    const ai = reply(
      placed(['p-made-up'], ['p-throw']),
      placed(['p-tray'], ['p-throw'])
    )
    const { ctx } = context(ai)
    const locked = await lockContent(input(), ctx)
    expect(ai).toHaveBeenCalledTimes(2)
    expect(
      JSON.parse(ai.mock.calls[1][0].request.user)
        .fix_these_problems_from_your_last_answer
    ).toEqual([
      '"p-made-up" is not one of the products given.',
      'Use the planned product "p-tray".',
      'Put the main planned product "p-tray" first, in section 1.',
      'Place every planned product before any other product.'
    ])
    expect(locked.source).toBe('agent')
    expect(locked.input.products.map((p) => p.id)).toEqual([
      'p-tray',
      'p-throw'
    ])
  })

  it('falls back to plan order and logs it when it cannot answer', async () => {
    const ai = reply('refused')
    const { ctx, fallbacks } = context(ai)
    const locked = await lockContent(input(), ctx)
    expect(ai).toHaveBeenCalledOnce()
    expect(locked.source).toBe('code')
    expect(locked.input.products.map((p) => p.id)).toEqual([
      'p-tray',
      'p-throw'
    ])
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'content-locker',
        reasonCode: 'content_agent_failed',
        attempts: 1,
        dedupeKey: 'content-locker:slot-run-1-0'
      })
    ])
  })

  it('checks placements', () => {
    const store = input()
    const pool = productPool(store)
    const needs = productNeeds(store.sections.sections)
    expect(needs).toEqual([
      { section: 1, family: 'hero_product', count: 1 },
      { section: 2, family: 'product_feature', count: 1 }
    ])
    expect(
      checkPlacement(placed(['p-tray'], ['p-throw']), needs, pool)
    ).toEqual([])
    expect(
      checkPlacement(
        {
          sections: [
            { section: 1, products: ['p-tray', 'p-tray'] },
            { section: 1, products: ['p-throw'] },
            { section: 3, products: ['p-mug'] }
          ]
        },
        needs,
        pool
      )
    ).toEqual([
      '"p-tray" is used twice: use each product once.',
      'Section 1 is listed twice.',
      'There is no product section 3.',
      'Section 1 (hero_product) needs exactly 1 product; you gave 2.',
      'Section 2 (product_feature) has no products.'
    ])
    // Fewer sections than planned products: only planned ones.
    expect(checkPlacement(placed(['p-mug']), [needs[0]], pool)).toEqual([
      'Use only planned products: the sections need 1 and 2 are planned.',
      'Put the main planned product "p-tray" first, in section 1.'
    ])
  })

  it('never sees prices or codes as something to write', () => {
    const task = contentLockerAgent.task({
      slot: input().slot,
      needs: productNeeds(input().sections.sections),
      pool: productPool(input()),
      problems: []
    })
    expect(JSON.parse(task)).not.toHaveProperty('codes')
    expect(contentLockerAgent.instructions).toContain(
      'Never invent a product, price, code or link'
    )
  })
})

describe('the filler places locked products exactly where locked', () => {
  it('keeps products for later sections instead of filling a grid first', () => {
    const four = [products[0], products[1], products[2], products[3]]
    const written = {
      subject: 'New in',
      preheader: 'Four things for the table',
      blocks: [
        { type: 'header_logo' as const, reason: 'logo', words: {} },
        {
          type: 'product_grid_2col' as const,
          reason: 'two',
          words: { heading: 'For the table' }
        },
        {
          type: 'product_grid_2col' as const,
          reason: 'two more',
          words: { heading: 'For the shelf' }
        },
        { type: 'footer' as const, reason: 'links', words: {} }
      ]
    }
    const { productIds, problems } = fill(
      written,
      {
        ...input().store,
        brief: { campaignType: 'launch', goal: 'x' },
        products: four
      },
      sampleBrand
    )
    expect(problems).toEqual([])
    expect(productIds).toEqual(['p-tray', 'p-throw', 'p-candle', 'p-mug'])
  })
})

const sectionsOf = (locked: {
  sections: { family: BlockType; purpose: string }[]
}) => locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
const fakeWriter = vi.fn<RunAi>(async () => ({
  ok: true,
  content: { fixture: true },
  provider: 'fake',
  model: 'fake'
}))

describe('from the lock to the written email', () => {
  it('puts each locked product in its locked section, with the sample writer', async () => {
    const { ctx } = context(reply(placed(['p-tray'], ['p-throw'])))
    const locked = await lockContent(input(), ctx)
    const built = await assembleLocked(
      locked.input,
      sampleBrand,
      fakeWriter,
      sectionsOf(locked)
    )
    expect(built.status).toBe('sample')
    expect(built.draft.productIds).toEqual(['p-tray', 'p-throw'])
    expect(built.draft.blocks.map((b) => b.type)).toEqual(
      locked.sections.map((s) => s.family)
    )
    const hero = built.draft.blocks[1].content as { url: string }
    expect(hero.url).toBe(locked.sections[1].products[0].url)
  })

  it('keeps two 2-column grids at two products each, with a live writer', async () => {
    const sections = plan(
      'header_logo',
      'product_grid_2col',
      'product_grid_2col',
      'cta',
      'footer'
    )
    const slot = {
      ...input().slot,
      products: [
        { id: 'p-tray', title: 'Oak tray' },
        { id: 'p-throw', title: 'Linen throw' },
        { id: 'p-candle', title: 'Cedar candle' },
        { id: 'p-mug', title: 'Stone mug' }
      ]
    }
    const { ctx } = context(
      reply(placed(['p-tray', 'p-throw'], ['p-candle', 'p-mug']))
    )
    const locked = await lockContent(input({ slot, sections }), ctx)
    const live = vi.fn<RunAi>(async () => ({
      ok: true,
      provider: 'gemini',
      model: 'writer',
      content: {
        subject: 'New for the table',
        preheader: 'Four new things for slow dinners at home.',
        blocks: [
          { type: 'header_logo', reason: 'Logo.', words: {} },
          {
            type: 'product_grid_2col',
            reason: 'Two.',
            words: { heading: 'For the table' }
          },
          {
            type: 'product_grid_2col',
            reason: 'Two more.',
            words: { heading: 'For the shelf' }
          },
          { type: 'cta', reason: 'One action.', words: { label: 'Shop now' } },
          { type: 'footer', reason: 'Links.', words: {} }
        ]
      }
    }))
    const built = await assembleLocked(
      locked.input,
      sampleBrand,
      live,
      sectionsOf(locked)
    )
    expect(built.status).toBe('ready')
    const grids = built.draft.blocks
      .filter((b) => b.type === 'product_grid_2col')
      .map((b) =>
        (b.content as { products: { url: string }[] }).products.map((p) =>
          p.url.split('/').pop()
        )
      )
    expect(grids).toEqual([
      ['p-tray', 'p-throw'],
      ['p-candle', 'p-mug']
    ])
  })
})

describe('more safe choices', () => {
  it('drops the offer when no section can show it, and when the plan has none', async () => {
    const offer = { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 }
    const broken = context(reply(placed(['p-tray'], ['p-throw'])))
    const noLink = await lockContent(
      input({
        site: 'javascript:alert(1)',
        slot: { ...input().slot, offer },
        sections: plan(
          'header_logo',
          'offer_banner',
          'product_grid_2col',
          'cta',
          'footer'
        )
      }),
      broken.ctx
    )
    expect(noLink.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'product_grid_2col',
      'text',
      'footer'
    ])
    expect(noLink.offer).toBeNull()
    expect(noLink.input.codes).toEqual([])
    expect(noLink.input.brief.offerCode).toBeUndefined()
    expect(noLink.changes).toEqual([
      { key: 'section_no_link', did: 'left_out' },
      { key: 'section_no_link', did: 'left_out' },
      { key: 'offer_no_section', did: 'no_offer' }
    ])
    const { ctx } = context(reply(placed(['p-tray'], ['p-throw'])))
    const noSection = await lockContent(
      input({ slot: { ...input().slot, offer } }),
      ctx
    )
    expect(noSection.offer).toBeNull()
    expect(noSection.input.codes).toEqual([])
    expect(noSection.changes).toEqual([
      { key: 'offer_no_section', did: 'no_offer' }
    ])
  })

  it('treats a blank store link like none: buttons go to the first product', async () => {
    const { ctx } = context(reply(placed(['p-tray'], ['p-throw'])))
    const locked = await lockContent(input({ site: '   ' }), ctx)
    expect(locked.sections[4].link).toEqual({
      url: 'https://cedar.example.com/products/p-tray',
      from: 'catalog'
    })
  })

  it('leaves out a section the store has nothing for', async () => {
    const { ctx } = context(reply(placed(['p-tray'], ['p-throw'])))
    const locked = await lockContent(
      input({
        sections: plan(
          'header_logo',
          'hero_product',
          'review_strip',
          'product_feature',
          'cta',
          'footer'
        )
      }),
      ctx
    )
    expect(locked.sections.map((s) => s.family)).not.toContain('review_strip')
    expect(locked.changes).toEqual([
      { key: 'section_not_fillable', did: 'left_out' }
    ])
  })

  it('says a refused planned product was left out when nothing replaced it', async () => {
    const ai = reply()
    const { ctx, fallbacks } = context(ai)
    const locked = await lockContent(
      input({
        slot: {
          ...input().slot,
          products: [
            { id: 'p-tray', title: 'Oak tray' },
            { id: 'p-ask', title: 'Custom table' }
          ]
        },
        sections: plan('header_logo', 'hero_product', 'cta', 'footer')
      }),
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
    expect(locked.changes).toEqual([
      { key: 'product_price_unknown', did: 'skipped_product' }
    ])
    expect(fallbacks.entries()[0].fallback).toBe('Left that product out.')
  })

  it('locks the checked product when the catalog repeats an id', async () => {
    const store = {
      ...input().store,
      products: [
        products[0],
        product('p-x', 'Good x', '$5.00'),
        product('p-x', 'Bad x', 'Ask us', {
          image: 'http://cdn.example.com/x.jpg'
        })
      ]
    }
    const slot = {
      ...input().slot,
      products: [
        { id: 'p-tray', title: 'Oak tray' },
        { id: 'p-x', title: 'x' }
      ]
    }
    const { ctx } = context(reply(placed(['p-tray'], ['p-x'])))
    const locked = await lockContent(input({ store, slot }), ctx)
    expect(locked.sections[3].products[0]).toMatchObject({
      id: 'p-x',
      title: 'Good x',
      price: '$5.00'
    })
    expect(locked.input.products.map((p) => p.title)).toEqual([
      'Oak tray',
      'Good x'
    ])
  })

  it('locks at most 6 products, so the writer input fits the job boundary', async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      product(`p-${i}`, `Thing ${i}`, `$${10 + i}.00`)
    )
    const slot = {
      ...input().slot,
      products: [{ id: 'p-0', title: 'Thing 0' }]
    }
    const { ctx } = context(reply('refused'))
    const locked = await lockContent(
      input({
        slot,
        store: { ...input().store, products: many },
        sections: plan(
          'header_logo',
          'hero_product',
          'product_grid_3col',
          'product_grid_3col',
          'footer'
        )
      }),
      ctx
    )
    expect(locked.input.products).toHaveLength(6)
    expect(locked.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_product',
      'product_grid_3col',
      'product_grid_2col',
      'text',
      'footer'
    ])
    expect(assemblyInputSchema.safeParse(locked.input).success).toBe(true)
  })

  it('locks confirmed customer and founder photos', async () => {
    const photo = (n: number) => ({
      image: `https://cdn.example.com/c${n}.jpg`,
      alt: `Customer photo ${n}`
    })
    const { ctx } = context(reply())
    const locked = await lockContent(
      input({
        slot: { ...input().slot, products: [] },
        store: {
          ...input().store,
          confirmed: {
            customerPhotos: [1, 2, 3, 4].map(photo),
            founder: {
              name: 'Ana',
              photo: photo(9),
              note: ['We started in a garage.']
            }
          }
        },
        sections: plan('header_logo', 'founder_note', 'ugc_grid', 'footer')
      }),
      ctx
    )
    expect(locked.sections[1].photos).toEqual([
      {
        url: 'https://cdn.example.com/c9.jpg',
        alt: 'Customer photo 9',
        from: 'confirmed photos'
      }
    ])
    expect(locked.sections[2].photos.map((p) => p.url)).toEqual([
      'https://cdn.example.com/c1.jpg',
      'https://cdn.example.com/c2.jpg',
      'https://cdn.example.com/c3.jpg'
    ])
  })
})

describe('agent give-ups', () => {
  it('log a check that keeps failing, after 3 tries', async () => {
    const wrong = placed(['p-throw'], ['p-tray'])
    const ai = reply(wrong, wrong, wrong)
    const { ctx, fallbacks } = context(ai)
    const locked = await lockContent(input(), ctx)
    expect(ai).toHaveBeenCalledTimes(3)
    expect(locked.source).toBe('code')
    expect(locked.input.products.map((p) => p.id)).toEqual([
      'p-tray',
      'p-throw'
    ])
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'content_check_failed',
      attempts: 3
    })
  })

  it('log an answer in the wrong shape', async () => {
    const ai = reply({ nope: true }, { nope: true }, { nope: true })
    const { ctx, fallbacks } = context(ai)
    expect((await lockContent(input(), ctx)).source).toBe('code')
    expect(fallbacks.entries()[0].reasonCode).toBe('content_answer_invalid')
  })

  it('leave room for the answer in the output limit', () => {
    expect(contentLockerAgent.reasoningEffort).toBe('none')
    expect(contentLockerAgent.maxOutputTokens).toBeGreaterThanOrEqual(400)
  })
})

describe('product placement in the filler', () => {
  it('gives a grid its bigger size only with products to spare', () => {
    expect(productTakes(['product_grid_2col', 'product_feature'], 5)).toEqual([
      4, 1
    ])
    expect(productTakes(['product_grid_2col', 'product_feature'], 4)).toEqual([
      2, 1
    ])
    expect(productTakes(['product_grid_3col'], 6)).toEqual([6])
    expect(productTakes(['product_grid_2col', 'product_grid_2col'], 4)).toEqual(
      [2, 2]
    )
    expect(productTakes(['hero_product', 'product_grid_3col'], 3)).toEqual([
      1, 0
    ])
  })
})
