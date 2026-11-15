// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleBrand } from '@/features/blocks/samples'
import {
  AiRunError,
  AssemblyError,
  type Assembled,
  type CopyFeedback,
  type Draft,
  type RunAi
} from '@/features/assembly/assemble'
import { unknownFacts, type CatalogProduct } from '@/features/assembly/inputs'
import { assembleLocked, assembleLockedPlain } from '@/features/assembly/modes'
import { lockContent, type LockedContent, type LockInput } from './content'
import {
  brandInspectorAgent,
  checkInspection,
  codeFindings,
  copyRounds,
  copyWork,
  emailChecks,
  emailInspectorAgent,
  priceChecks,
  rewriteRounds,
  savedWork,
  workBudgetBytes,
  writeAndInspect,
  type CopyWork,
  type Finding
} from './inspect'

const tenantId = '00000000-0000-4000-8000-000000000101'
const brand = { ...sampleBrand, site: 'https://cedar.example.com' }
const product = (
  id: string,
  title: string,
  price: string,
  over: Partial<CatalogProduct> = {}
): CatalogProduct => ({
  id,
  title,
  price,
  image: `https://cedar.example.com/img/${id}.jpg`,
  url: `https://cedar.example.com/products/${id}`,
  featurable: true,
  ...over
})
const lockInput = (over: Partial<LockInput['store']> = {}): LockInput => ({
  slot: {
    date: '2026-11-17',
    emailType: 'offer',
    angle: 'The candle people love, for less',
    products: [
      { id: 'p-candle', title: 'Cedar candle' },
      { id: 'p-tray', title: 'Oak tray' }
    ],
    offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 }
  },
  sections: {
    mode: 'scratch',
    sections: [
      {
        family: 'header_logo',
        variantId: 'header_logo/seed',
        purpose: 'Logo.'
      },
      {
        family: 'offer_banner',
        variantId: 'offer_banner/seed',
        purpose: 'The offer.'
      },
      {
        family: 'product_grid_2col',
        variantId: 'product_grid_2col/seed',
        purpose: 'What the code is for.'
      },
      { family: 'cta', variantId: 'cta/seed', purpose: 'One action.' },
      { family: 'footer', variantId: 'footer/seed', purpose: 'Links.' }
    ],
    dropped: [],
    source: 'agent'
  },
  store: {
    products: [
      product('p-candle', 'Cedar candle', '$24.00'),
      product('p-tray', 'Oak tray', '$48.00')
    ],
    codes: [
      { code: 'CANDLE10', percent: 10, expiresAt: '2026-11-23T08:00:00Z' }
    ],
    maxDiscountPercent: 20,
    sendAt: '2026-11-17T18:00:00Z',
    timezone: 'America/Los_Angeles',
    facts: { ...unknownFacts, bannedPhrases: ['miracle'] },
    ...over
  },
  site: 'https://cedar.example.com'
})

const live = (content: unknown) => ({
  ok: true as const,
  content,
  provider: 'gemini' as const,
  model: 'writer'
})
/** Live writer answers for the locked sections, in order. */
const words = (over: Partial<Record<string, unknown>> = {}) => ({
  subject: 'Your favourite candle, 10% off',
  preheader: 'Use your code on the Cedar candle and the Oak tray this week.',
  blocks: [
    { type: 'header_logo', reason: 'Logo.', words: {} },
    {
      type: 'offer_banner',
      reason: 'The offer.',
      words: { detail: 'On the candle and the tray.', cta: 'Use my code' }
    },
    {
      type: 'product_grid_2col',
      reason: 'Products.',
      words: { heading: 'Made for slow evenings' }
    },
    { type: 'cta', reason: 'One action.', words: { label: 'Shop the candle' } },
    { type: 'footer', reason: 'Links.', words: {} }
  ],
  ...over
})
const withHeading = (heading: string) => {
  const w = words()
  w.blocks[2] = {
    type: 'product_grid_2col',
    reason: 'Products.',
    words: { heading }
  }
  return w
}
const writer = (...answers: unknown[]) => {
  const queue = [...answers]
  return vi.fn<RunAi>(async () => live(queue.shift() ?? answers.at(-1)))
}
const inspectors = (...answers: unknown[]) => {
  const queue = [...answers]
  return vi.fn<AiCall>(async () => {
    const next = queue.shift()
    if (next === 'refused') return { ok: false, code: 'cap_reached' }
    return {
      ok: true,
      content: next ?? { problems: [] },
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
const lock = async (raw = lockInput()): Promise<LockedContent> =>
  lockContent(raw, context(inspectors()).ctx)
const sectionsOf = (locked: LockedContent) =>
  locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
const build = (locked: LockedContent, run: RunAi) => ({
  locked,
  brandName: brand.name,
  write: (feedback: CopyFeedback[]) =>
    assembleLocked(locked.input, brand, run, sectionsOf(locked), feedback),
  plain: () => assembleLockedPlain(locked.input, brand, sectionsOf(locked))
})
const draftOf = async (locked: LockedContent, answer = words()) =>
  (
    await assembleLocked(
      locked.input,
      brand,
      writer(answer),
      sectionsOf(locked)
    )
  ).draft
const userOf = (run: ReturnType<typeof writer>, call: number) =>
  run.mock.calls[call][0].user

describe('the fix loop', () => {
  it('passes a clean email after code and both inspectors agree', async () => {
    const locked = await lock()
    const ai = inspectors({ problems: [] }, { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const result = await writeAndInspect(build(locked, writer(words())), ctx)
    expect(result.status).toBe('passed')
    expect(ai.mock.calls.map((c) => c[0].purpose)).toEqual(['review', 'label'])
    expect(fallbacks.entries()).toEqual([])
    if (result.status !== 'passed') return
    expect(result.draft.code).toBe('CANDLE10')
    expect(result.draft.productIds).toEqual(['p-candle', 'p-tray'])
  })

  it('finds a banned claim and a spammy subject in code, and the rewrite gets the exact reasons', async () => {
    const locked = await lock()
    const run = writer(
      words({
        subject: 'ACT NOW!!! Miracle candle deal',
        preheader: 'ACT NOW!!! Miracle candle deal'
      }),
      words()
    )
    const ai = inspectors()
    const { ctx } = context(ai)
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(result.status).toBe('passed')
    expect(result.rounds).toHaveLength(2)
    expect(result.rounds[0].findings.map((f) => f.rule)).toEqual(
      expect.arrayContaining([
        'banned_phrase',
        'subject_shouting',
        'preview_repeats_subject',
        'spam_words'
      ])
    )
    // Code failed, so no inspector was asked in round 1.
    expect(ai).toHaveBeenCalledTimes(2)
    expect(userOf(run, 1)).toContain('exclamation mark')
  })

  it('finds a wrong price and a typed link in the words and gets them rewritten', async () => {
    const locked = await lock()
    const run = writer(
      withHeading('Now only $19, see cedar.example.com/sale'),
      words()
    )
    const { ctx } = context(inspectors())
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(result.status).toBe('passed')
    expect(result.rounds[0].findings.map((f) => [f.rule, f.field])).toEqual([
      ['wrong_price', '3-product_grid_2col'],
      ['link_in_words', '3-product_grid_2col']
    ])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('takes an inspector’s exact problem and fix to the rewrite, and never pays twice for the same draft', async () => {
    const locked = await lock()
    const run = writer(words(), words())
    const ai = inspectors(
      {
        problems: [
          {
            field: '3-product_grid_2col',
            quote: 'slow evenings',
            reason: 'The brand never says "slow".',
            fix: 'Made for long evenings'
          }
        ]
      },
      { problems: [] }
    )
    const { ctx } = context(ai)
    const result = await writeAndInspect(build(locked, run), ctx)
    // The writer kept sending the same draft: the verdict is reused.
    expect(result.status).toBe('plain')
    expect(ai).toHaveBeenCalledTimes(2)
    expect(result.rounds[0].findings).toEqual([
      {
        by: 'brand-inspector',
        rule: 'brand-inspector',
        field: '3-product_grid_2col',
        reason: 'The brand never says "slow". Try: "Made for long evenings"'
      }
    ])
    expect(userOf(run, 1)).toContain('Made for long evenings')
  })

  it('passes the rewrite an Email inspector problem led to', async () => {
    const locked = await lock()
    const run = writer(words(), withHeading('Made for long evenings'))
    const ai = inspectors(
      { problems: [] },
      {
        problems: [
          {
            field: '3-product_grid_2col',
            quote: 'Made for slow evenings',
            reason: 'Say what the products are for.',
            fix: ''
          }
        ]
      },
      { problems: [] },
      { problems: [] }
    )
    const { ctx } = context(ai)
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(result.status).toBe('passed')
    expect(result.rounds[0].findings[0].by).toBe('email-inspector')
    expect(ai).toHaveBeenCalledTimes(4)
  })

  it('never lets an inspector pass a draft code refused', async () => {
    const locked = await lock()
    // A wrong percent every time: copy QA refuses it each round.
    const run = writer(words({ subject: 'Your candle, 30% off today' }))
    const ai = inspectors()
    const { ctx, fallbacks } = context(ai)
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(ai).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(rewriteRounds + 1)
    expect(result).toMatchObject({ status: 'plain', cause: 'rewrites_failed' })
    if (result.status !== 'plain') return
    expect(result.draft.source).toBe('plain')
    expect(result.draft.productIds).toEqual(['p-candle', 'p-tray'])
    const [entry] = fallbacks.entries()
    expect(entry).toMatchObject({
      agent: 'copy-inspectors',
      reasonCode: 'copy_plain_fallback',
      attempts: 4,
      fallback: 'Used plain copy: the facts only, in the locked sections.'
    })
    expect(entry.detail.rules).toContain('discount_over_max')
    const logged = JSON.stringify(entry)
    for (const secret of ['30%', 'CANDLE10', 'Cedar candle', 'Oak tray', '$'])
      expect(logged).not.toContain(secret)
  })

  it('never calls an old product new in plain copy', async () => {
    const launch = lockInput()
    launch.slot = {
      ...launch.slot,
      emailType: 'launch',
      offer: null,
      products: [{ id: 'p-new', title: 'Brass lamp' }]
    }
    launch.store.products = [
      product('p-new', 'Brass lamp', '$90.00', {
        image: 'http://cdn.example.com/lamp.jpg'
      }),
      product('p-candle', 'Cedar candle', '$24.00')
    ]
    launch.sections = {
      ...launch.sections,
      sections: [
        { family: 'header_logo', variantId: 'header_logo/seed', purpose: 'L' },
        {
          family: 'hero_product',
          variantId: 'hero_product/seed',
          purpose: 'The new product.'
        },
        { family: 'cta', variantId: 'cta/seed', purpose: 'One action.' },
        { family: 'footer', variantId: 'footer/seed', purpose: 'Links.' }
      ]
    }
    const locked = await lock(launch)
    expect(locked.input.products.map((p) => p.id)).toEqual(['p-candle'])
    const plain = assembleLockedPlain(locked.input, brand, sectionsOf(locked))
    expect(plain.status).toBe('ready')
    const shown = JSON.stringify([
      plain.draft.subject,
      plain.draft.preheader,
      plain.draft.blocks.map((b) => b.content)
    ])
    expect(shown).not.toMatch(/\bnew\b|launched/i)
    expect(plain.draft.subject.length).toBeLessThanOrEqual(60)
  })

  it('goes plain at once with the fake writer or no allowance, and says why', async () => {
    const locked = await lock()
    const fake = vi.fn<RunAi>(async () => ({
      ok: true,
      content: { fixture: true },
      provider: 'fake',
      model: 'fake'
    }))
    const one = context(inspectors())
    expect(await writeAndInspect(build(locked, fake), one.ctx)).toMatchObject({
      status: 'plain',
      cause: 'no_live_writer'
    })
    expect(fake).toHaveBeenCalledOnce()
    expect(one.fallbacks.entries()[0].reason).toBe(
      'No live writer is switched on (sample mode).'
    )
    const capped = vi.fn(async (): Promise<Assembled> => {
      throw new AiRunError('cap_reached')
    })
    const two = context(inspectors())
    expect(
      await writeAndInspect({ ...build(locked, fake), write: capped }, two.ctx)
    ).toMatchObject({ status: 'plain', cause: 'allowance_used' })
    expect(capped).toHaveBeenCalledOnce()
    expect(two.fallbacks.entries()[0].reason).toContain('allowance is used up')
  })

  it('asks the job to try again later when the AI is busy, without plain copy', async () => {
    const locked = await lock()
    const busy = vi.fn(async (): Promise<Assembled> => {
      throw new AiRunError('rate_limited', 30)
    })
    const { ctx, fallbacks } = context(inspectors())
    expect(
      await writeAndInspect({ ...build(locked, writer()), write: busy }, ctx)
    ).toEqual({
      status: 'retry',
      rounds: [],
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(fallbacks.entries()).toEqual([])
  })

  it('never stops for time, even with a ctx that carries a time limit', async () => {
    const locked = await lock()
    const wrongQuote = {
      problems: [
        {
          field: 'subject',
          quote: 'words that are not there',
          reason: 'This is not what the subject says.',
          fix: ''
        }
      ]
    }
    const { ctx } = context(inspectors(wrongQuote, { problems: [] }))
    const result = await writeAndInspect(build(locked, writer(words())), {
      ...ctx,
      fits: () => false
    } as typeof ctx)
    expect(result.status).toBe('passed')
  })

  it('asks the job to try again later when the AI gets busy after a round too', async () => {
    const locked = await lock()
    let calls = 0
    const busy = vi.fn(async (feedback: CopyFeedback[]): Promise<Assembled> => {
      if (calls++ === 0)
        return assembleLocked(
          locked.input,
          brand,
          writer(
            words({
              subject: 'ACT NOW!!! Miracle candle deal',
              preheader: 'ACT NOW!!! Miracle candle deal'
            })
          ),
          sectionsOf(locked),
          feedback
        )
      throw new AiRunError('rate_limited', 30)
    })
    const { ctx } = context(inspectors())
    const result = await writeAndInspect(
      { ...build(locked, writer()), write: busy },
      ctx
    )
    expect(result).toMatchObject({
      status: 'retry',
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(result.rounds).toHaveLength(1)
  })

  it('gives a wrong-shape answer’s exact problems to the next try', async () => {
    const locked = await lock()
    let calls = 0
    const feedbacks: CopyFeedback[][] = []
    const write = async (feedback: CopyFeedback[]): Promise<Assembled> => {
      feedbacks.push(feedback)
      if (calls++ === 0)
        throw new AiRunError('invalid_output', undefined, [
          { field: 'blocks', reason: 'Write exactly 5 blocks in this order.' }
        ])
      return assembleLocked(
        locked.input,
        brand,
        writer(words()),
        sectionsOf(locked)
      )
    }
    const { ctx } = context(inspectors())
    const result = await writeAndInspect(
      { ...build(locked, writer()), write },
      ctx
    )
    expect(result.status).toBe('passed')
    expect(feedbacks[1]).toEqual([
      { field: 'blocks', reason: 'Write exactly 5 blocks in this order.' }
    ])
  })

  it('throws when the brief cannot be built, and for bugs', async () => {
    const locked = await lock()
    const { ctx } = context(inspectors())
    for (const error of [
      new AssemblyError('The product cannot be featured.', 'focus_unavailable'),
      new TypeError('bug')
    ]) {
      const write = async (): Promise<Assembled> => {
        throw error
      }
      await expect(
        writeAndInspect({ ...build(locked, writer()), write }, ctx)
      ).rejects.toBe(error)
    }
  })

  it('logs an inspector that cannot answer once, and goes on with code checks', async () => {
    const locked = await lock()
    const ai = inspectors('refused', { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const result = await writeAndInspect(build(locked, writer(words())), ctx)
    expect(result.status).toBe('passed')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'brand-inspector',
        reasonCode: 'inspector_agent_failed',
        fallback: 'Checked the email with the code checks only.'
      })
    ])
  })

  it('logs an inspector that keeps quoting store words, after 3 tries', async () => {
    const locked = await lock()
    const price = {
      problems: [
        {
          field: '3-product_grid_2col',
          quote: '$48.00',
          reason: 'The price looks high.',
          fix: ''
        }
      ]
    }
    const ai = inspectors(price, price, price, { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const result = await writeAndInspect(build(locked, writer(words())), ctx)
    expect(result.status).toBe('passed')
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'brand-inspector',
      reasonCode: 'inspector_check_failed',
      reason:
        'The brand inspector kept quoting words that are not the writer’s.'
    })
  })

  it('reports an email that even plain copy cannot make', async () => {
    const locked = await lock()
    const { ctx, fallbacks } = context(inspectors())
    const result = await writeAndInspect(
      {
        ...build(locked, writer(words({ subject: 'x'.repeat(70) }))),
        plain: (): Assembled => {
          const real = assembleLockedPlain(
            locked.input,
            brand,
            sectionsOf(locked)
          )
          return { ...real, draft: { ...real.draft, productIds: ['p-tray'] } }
        }
      },
      ctx
    )
    expect(result).toMatchObject({ status: 'failed', cause: 'rewrites_failed' })
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'copy_failed',
      fallback: 'Plain copy failed the code checks too: no email was built.',
      detail: expect.objectContaining({ plainRules: ['lock_mismatch'] })
    })
  })
})

describe('the email checks (code)', () => {
  it('keep template tags, markup and hidden characters out of the subject and preview (Klaviyo reads them)', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    const rules = (over: Partial<Draft>) =>
      emailChecks({ ...draft, ...over }, locked, brand.name).map((f) => f.rule)
    expect(rules({ subject: 'Hi {{ first_name }}, 10% off' })).toContain(
      'subject_markup'
    )
    expect(rules({ subject: 'Cosy <b>evenings</b>' })).toContain(
      'subject_markup'
    )
    expect(
      rules({ preheader: 'Use your code on the candle\u200b this week.' })
    ).toContain('preview_markup')
    expect(rules({})).not.toContain('subject_markup')
  })

  it('find two main buttons, an unlocked link and a picture without words', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    const twice = {
      ...draft,
      blocks: [
        ...draft.blocks.slice(0, 4),
        {
          type: 'cta' as const,
          content: { label: 'Elsewhere', url: 'https://other.example.net/x' }
        },
        {
          type: 'hero_image' as const,
          content: {
            image: 'https://cedar.example.com/img/room.jpg',
            alt: ' ',
            headline: 'Room',
            url: 'https://cedar.example.com',
            cta: 'Look'
          }
        },
        ...draft.blocks.slice(4)
      ] as Draft['blocks']
    }
    expect(
      emailChecks(twice, locked, brand.name).map((f) => [f.rule, f.field])
    ).toEqual(
      expect.arrayContaining([
        ['one_action', 'email'],
        ['link_not_locked', '5-cta'],
        ['image_alt', '6-hero_image']
      ])
    )
    expect(emailChecks(draft, locked, brand.name)).toEqual([])
  })

  it('never blame the writer for store words: titles, the brand name and the code', async () => {
    const locked = await lock(
      lockInput({
        products: [
          product('p-candle', 'CEDAR Candle - $25 Gift Set', '$24.00'),
          product('p-tray', 'Oak tray, 2 pounds', '$48.00')
        ]
      })
    )
    const draft = await draftOf(locked)
    const loud = { ...draft, subject: 'CEDAR Candle - $25 Gift Set: CANDLE10' }
    expect(emailChecks(loud, locked, 'CEDAR')).toEqual([])
    expect(priceChecks(loud, locked, 'CEDAR')).toEqual([])
  })

  it('never blame the writer for a confirmed review', async () => {
    const raw = lockInput({
      facts: { ...unknownFacts, reviewsVerified: true },
      confirmed: {
        reviews: [
          { quote: 'A total winner, act now!!!', author: 'Ana', rating: 5 }
        ]
      }
    })
    raw.sections.sections.splice(3, 0, {
      family: 'review_strip',
      variantId: 'review_strip/seed',
      purpose: 'What customers say.'
    })
    const locked = await lock(raw)
    expect(locked.sections.map((s) => s.family)).toContain('review_strip')
    const answer = words()
    answer.blocks.splice(3, 0, {
      type: 'review_strip',
      reason: 'Reviews.',
      words: { heading: 'What people say' }
    })
    const draft = await draftOf(locked, answer)
    expect(JSON.stringify(draft.blocks)).toContain('A total winner')
    expect(emailChecks(draft, locked, brand.name)).toEqual([])
  })

  it('check subject and preview lengths', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    expect(
      emailChecks(
        { ...draft, subject: 'x'.repeat(61), preheader: 'Short' },
        locked,
        brand.name
      ).map((f) => f.rule)
    ).toEqual(['subject_length', 'preview_length'])
  })

  it('accept locked product links on another host', async () => {
    const locked = await lock(
      lockInput({
        products: [
          product('p-candle', 'Cedar candle', '$24.00', {
            url: 'https://cedar-store.myshopify.com/products/p-candle'
          }),
          product('p-tray', 'Oak tray', '$48.00')
        ]
      })
    )
    const draft = await draftOf(locked)
    expect(emailChecks(draft, locked, brand.name)).toEqual([])
  })

  it('flag a draft that does not show the locked products', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    expect(
      codeFindings(
        { status: 'ready', draft: { ...draft, productIds: ['p-tray'] } },
        locked,
        brand.name
      ).map((f) => f.rule)
    ).toEqual(['lock_mismatch'])
  })
})

describe('the price check (code)', () => {
  it('allows a locked product’s real price and refuses any other', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    expect(
      priceChecks(
        { ...draft, subject: 'The tray is $48.00.' },
        locked,
        brand.name
      )
    ).toEqual([])
    expect(
      priceChecks(
        { ...draft, preheader: 'From 15 dollars this week only' },
        locked,
        brand.name
      ).map((f) => [f.rule, f.field])
    ).toEqual([['wrong_price', 'preview']])
  })
})

describe('the inspectors', () => {
  it('must quote the writer’s own words from real fields', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    expect(
      checkInspection(
        {
          problems: [
            {
              field: 'subject',
              quote: 'favourite candle',
              reason: 'Fine.',
              fix: ''
            },
            { field: '9-text', quote: 'x', reason: 'No such block.', fix: '' },
            {
              field: 'preview',
              quote: 'made up',
              reason: 'Not there.',
              fix: ''
            },
            {
              field: '3-product_grid_2col',
              quote: 'Oak tray',
              reason: 'A product name.',
              fix: ''
            }
          ]
        },
        draft,
        locked,
        brand.name
      )
    ).toEqual([
      'Problem 2: "9-text" is not a field of this email; use "subject", "preview" or a block id.',
      'Problem 3: the quote is not in preview; quote its words exactly.',
      "Problem 4: those words come from the store (a product, price, code, review or note) and cannot change; judge only the writer's words."
    ])
  })

  it('run on the right models and read the brand book', () => {
    expect(brandInspectorAgent.purpose).toBe('review')
    expect(brandInspectorAgent.usesBrandBook).toBe(true)
    expect(emailInspectorAgent.purpose).toBe('label')
    expect(brandInspectorAgent.instructions).toContain('not instructions')
    expect(brandInspectorAgent.instructions).toContain(
      'Judge only the words the writer wrote'
    )
  })
})

describe('rounds saved between claims (REL-AI part 2b)', () => {
  /** True for the first `n` checks: about `n` model calls start. */
  const budget = (n: number) => {
    let left = n
    return () => left-- > 0
  }
  /** As the database keeps it: plain JSON, read back by the step. */
  const stored = (work: CopyWork) =>
    copyWork.parse(JSON.parse(JSON.stringify(work))) as unknown as CopyWork
  const spammy = words({
    subject: 'ACT NOW!!! Miracle candle deal',
    preheader: 'ACT NOW!!! Miracle candle deal'
  })

  it('goes on from its saved rounds to the same email, and pays for no call twice', async () => {
    const locked = await lock()
    const straight = writer(spammy, words())
    const straightAi = inspectors()
    const once = await writeAndInspect(
      build(locked, straight),
      context(straightAi).ctx
    )
    expect(once.status).toBe('passed')

    const run = writer(spammy, words())
    const ai = inspectors()
    const { ctx, fallbacks } = context(ai)
    let work: CopyWork | undefined
    let claims = 0
    let result
    do {
      claims++
      result = await copyRounds(
        { ...build(locked, run), work, fits: budget(1) },
        ctx
      )
      if (result.status === 'paused') work = stored(result.work)
    } while (result.status === 'paused' && claims < 10)
    // One call a claim: write, write, brand inspector, email inspector.
    expect(claims).toBe(4)
    expect(result).toEqual(once)
    expect(run).toHaveBeenCalledTimes(straight.mock.calls.length)
    expect(ai).toHaveBeenCalledTimes(straightAi.mock.calls.length)
    expect(fallbacks.entries()).toEqual([])
  })

  it('saves between the two inspectors, and the next claim asks only the Email inspector', async () => {
    const locked = await lock()
    const ai = inspectors()
    const { ctx } = context(ai)
    const first = await copyRounds(
      { ...build(locked, writer(words())), fits: budget(2) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    expect(first.work.pending?.next).toBe('email-inspector')
    expect(ai.mock.calls.map((c) => c[0].purpose)).toEqual(['review'])
    const next = await copyRounds(
      { ...build(locked, writer()), work: stored(first.work), fits: budget(9) },
      ctx
    )
    expect(next.status).toBe('passed')
    expect(ai.mock.calls.map((c) => c[0].purpose)).toEqual(['review', 'label'])
  })

  it('an inspector out of time between its tries goes on from them in the next claim, never skipped or logged', async () => {
    const locked = await lock()
    const wrongQuote = {
      problems: [
        {
          field: 'subject',
          quote: 'words that are not there',
          reason: 'This is not what the subject says.',
          fix: ''
        }
      ]
    }
    const ai = inspectors(wrongQuote, { problems: [] }, { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const first = await copyRounds(
      { ...build(locked, writer(words())), fits: budget(2) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    expect(first.work.pending).toMatchObject({
      next: 'brand-inspector',
      tries: { tries: 1, reasonCode: 'check_failed' }
    })
    expect(first.work.skipped).toEqual([])
    expect(fallbacks.entries()).toEqual([])
    const next = await copyRounds(
      { ...build(locked, writer()), work: stored(first.work) },
      ctx
    )
    expect(next.status).toBe('passed')
    // Its second try, with the first try's problems: nothing asked twice.
    expect(ai).toHaveBeenCalledTimes(3)
    expect(ai.mock.calls[1][0].request.user).toContain(
      'fix_these_problems_from_your_last_answer'
    )
  })

  it('an inspector that gave up stays skipped in the next claims', async () => {
    const locked = await lock()
    const problem = {
      problems: [
        {
          field: 'subject',
          quote: 'Your favourite candle',
          reason: 'Say which candle in plain words.',
          fix: 'The cedar one'
        }
      ]
    }
    const ai = inspectors('refused', problem, { problems: [] })
    const run = writer(words(), words({ subject: 'Slow evenings, 10% off' }))
    const { ctx, fallbacks } = context(ai)
    const first = await copyRounds(
      { ...build(locked, run), fits: budget(2) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    expect(first.work.skipped).toEqual(['brand-inspector'])
    const next = await copyRounds(
      { ...build(locked, run), work: stored(first.work) },
      ctx
    )
    expect(next.status).toBe('passed')
    expect(ai.mock.calls.map((c) => c[0].purpose)).toEqual([
      'review',
      'label',
      'label'
    ])
    expect(
      fallbacks.entries().filter((e) => e.agent === 'brand-inspector')
    ).toHaveLength(1)
  })

  it('reuses a verdict paid for before the save when the writer repeats a draft', async () => {
    const locked = await lock()
    const problem = {
      problems: [
        {
          field: 'subject',
          quote: 'Your favourite candle',
          reason: 'Say which candle in plain words.',
          fix: 'The cedar one'
        }
      ]
    }
    const ai = inspectors(problem, { problems: [] }, { problems: [] })
    const run = writer(
      words(),
      words(),
      words({ subject: 'Slow evenings, 10% off' })
    )
    const { ctx } = context(ai)
    const first = await copyRounds(
      { ...build(locked, run), fits: budget(3) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    const next = await copyRounds(
      { ...build(locked, run), work: stored(first.work) },
      ctx
    )
    if (next.status !== 'passed') throw new Error('expected a pass')
    expect(next.rounds.map((r) => r.findings.length)).toEqual([1, 1, 0])
    // Two inspectors for the first draft, two for the last: none again.
    expect(ai).toHaveBeenCalledTimes(4)
  })

  it('checks a saved draft by code again first: the plan’s other subjects may have changed', async () => {
    const locked = await lock()
    const ai = inspectors()
    const { ctx } = context(ai)
    const run = writer(words(), words({ subject: 'Slow evenings, 10% off' }))
    const first = await copyRounds(
      { ...build(locked, run), fits: budget(2) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    const taken: Finding = {
      by: 'code',
      rule: 'subject_taken',
      field: 'subject',
      reason: 'Another email in this plan already has this subject.'
    }
    const next = await copyRounds(
      {
        ...build(locked, run),
        work: stored(first.work),
        checks: (d) => (d.subject === words().subject ? [taken] : [])
      },
      ctx
    )
    expect(next).toMatchObject({ status: 'passed' })
    if (next.status !== 'passed') return
    expect(next.draft.subject).toBe('Slow evenings, 10% off')
    expect(next.rounds[0].findings.map((f) => f.rule)).toEqual([
      'subject_taken'
    ])
  })

  it('goes on after four rounds to the same result as a straight run', async () => {
    const locked = await lock()
    const answers = [spammy, spammy, spammy, words()]
    const once = await writeAndInspect(
      build(locked, writer(...answers)),
      context(inspectors()).ctx
    )
    const run = writer(...answers)
    const { ctx } = context(inspectors())
    let work: CopyWork | undefined
    let result
    for (let claim = 0; claim < 10; claim++) {
      result = await copyRounds(
        { ...build(locked, run), work, fits: budget(1) },
        ctx
      )
      if (result.status !== 'paused') break
      work = stored(result.work)
    }
    expect(result).toEqual(once)
    expect(once.rounds).toHaveLength(4)
  })

  it('in its last claim, out of time means plain copy, logged', async () => {
    const locked = await lock()
    const { ctx, fallbacks } = context(inspectors())
    const first = await copyRounds(
      { ...build(locked, writer(spammy)), fits: budget(1) },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    const last = await copyRounds(
      {
        ...build(locked, writer(spammy)),
        work: stored(first.work),
        fits: () => false,
        last: true
      },
      ctx
    )
    expect(last).toMatchObject({ status: 'plain', cause: 'out_of_time' })
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'copy-inspectors',
      reasonCode: 'copy_plain_fallback',
      reason: 'The copy ran out of time after 1 round.'
    })
  })

  it('saves the work when the AI gets busy after this claim did some; with nothing done, the job waits', async () => {
    const locked = await lock()
    let calls = 0
    const run = vi.fn<RunAi>(async () =>
      calls++ === 0
        ? live(spammy)
        : { ok: false, code: 'rate_limited', retryAfterSeconds: 20 }
    )
    const { ctx } = context(inspectors())
    const first = await copyRounds(
      { ...build(locked, run), fits: () => true },
      ctx
    )
    if (first.status !== 'paused') throw new Error('expected a pause')
    expect(first.work.rounds).toHaveLength(1)
    const next = await copyRounds(
      { ...build(locked, run), work: stored(first.work), fits: () => true },
      ctx
    )
    expect(next).toMatchObject({
      status: 'retry',
      code: 'rate_limited',
      retryAfterSeconds: 20
    })
    // In the step's last claim nothing more is saved: the job waits.
    const last = await copyRounds(
      { ...build(locked, writer(spammy)), fits: () => true, last: true },
      ctx
    )
    expect(last).toMatchObject({ status: 'plain', cause: 'rewrites_failed' })
    const lastBusy = await copyRounds(
      {
        ...build(locked, run),
        work: stored(first.work),
        fits: () => true,
        last: true
      },
      ctx
    )
    expect(lastBusy).toMatchObject({ status: 'retry', code: 'rate_limited' })
  })

  it('keeps every round when it can, and stays under its byte budget with long reasons in any script', async () => {
    const locked = await lock()
    const plainCase = await copyRounds(
      { ...build(locked, writer(spammy)), fits: budget(3) },
      context(inspectors()).ctx
    )
    if (plainCase.status !== 'paused') throw new Error('expected a pause')
    expect(
      stored(plainCase.work).rounds.every((r) => r.findings.length > 0)
    ).toBe(true)
    // Ten long problems from each inspector, every round, in two-byte letters.
    const heavy = {
      problems: Array.from({ length: 10 }, () => ({
        field: 'subject',
        quote: 'Your favourite',
        reason: `${'é'.repeat(295)}.`,
        fix: 'ü'.repeat(295)
      }))
    }
    const { ctx } = context(inspectors(heavy, heavy))
    const result = await copyRounds(
      { ...build(locked, writer(words())), fits: budget(5) },
      ctx
    )
    if (result.status !== 'paused') throw new Error('expected a pause')
    const work = stored(result.work)
    expect(
      new TextEncoder().encode(JSON.stringify(work)).length
    ).toBeLessThanOrEqual(workBudgetBytes)
    expect(work.rounds).toHaveLength(3)
    // The writer still gets the last two rounds' reasons.
    expect(work.rounds[2].findings.length).toBeGreaterThan(0)
    expect(work.rounds[1].findings.length).toBeGreaterThan(0)
  })

  it('sends a draft the extra checks refuse back to the writer with the reason', async () => {
    const locked = await lock()
    const taken: Finding = {
      by: 'code',
      rule: 'subject_taken',
      field: 'subject',
      reason: 'Another email in this plan already has this subject.'
    }
    const run = writer(words(), words({ subject: 'Slow evenings, 10% off' }))
    const { ctx } = context(inspectors())
    const result = await copyRounds(
      {
        ...build(locked, run),
        checks: (d) => (d.subject === words().subject ? [taken] : [])
      },
      ctx
    )
    expect(result).toMatchObject({ status: 'passed' })
    if (result.status !== 'passed') return
    expect(result.draft.subject).toBe('Slow evenings, 10% off')
    expect(userOf(run, 1)).toContain('Another email in this plan')
  })
})

describe('the saved work’s size (REL-AI part 2b)', () => {
  const many = (reason: string) =>
    Array.from({ length: 20 }, (_, i) => ({
      by: 'brand-inspector' as const,
      rule: 'brand-inspector',
      field: `${i + 1}-text`,
      reason
    }))
  it('cuts long reasons to fit, never through the middle of a character', () => {
    const reason = `a${'😀'.repeat(400)}`
    const work = savedWork({
      rounds: [0, 1, 2].map(() => ({ findings: many(reason) })),
      skipped: [],
      judged: [],
      pending: null
    })
    expect(work).not.toBeNull()
    const text = JSON.stringify(work)
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
      workBudgetBytes
    )
    for (const r of work!.rounds)
      for (const f of r.findings)
        expect(f.reason).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(copyWork.safeParse(JSON.parse(text)).success).toBe(true)
  })

  it('gives up on a draft too large to save: the step writes plain copy instead', async () => {
    const locked = await lock()
    const draft = await draftOf(locked)
    const huge = {
      ...draft,
      blocks: [
        ...draft.blocks,
        { type: 'text', content: { paras: ['é'.repeat(30_000)] } }
      ] as Draft['blocks']
    }
    expect(
      savedWork({
        rounds: [],
        skipped: [],
        judged: [],
        pending: {
          draft: huge,
          key: 'k',
          findings: [],
          next: 'brand-inspector'
        }
      })
    ).toBeNull()
  })
})
