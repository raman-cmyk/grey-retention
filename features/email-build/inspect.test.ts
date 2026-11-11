// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleBrand } from '@/features/blocks/samples'
import {
  AiRunError,
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
  emailChecks,
  emailInspectorAgent,
  priceChecks,
  rewriteRounds,
  writeAndInspect
} from './inspect'

const tenantId = '00000000-0000-4000-8000-000000000101'
const brand = { ...sampleBrand, site: 'https://cedar.example.com' }
const product = (id: string, title: string, price: string): CatalogProduct => ({
  id,
  title,
  price,
  image: `https://cedar.example.com/img/${id}.jpg`,
  url: `https://cedar.example.com/products/${id}`,
  featurable: true
})
const lockInput: LockInput = {
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
    facts: { ...unknownFacts, bannedPhrases: ['miracle'] }
  },
  site: 'https://cedar.example.com'
}

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
const lock = async (): Promise<LockedContent> =>
  lockContent(lockInput, context(inspectors()).ctx)
const build = (locked: LockedContent, run: RunAi) => ({
  locked,
  write: (feedback: CopyFeedback[]) =>
    assembleLocked(
      locked.input,
      brand,
      run,
      locked.sections.map((s) => ({ type: s.family, reason: s.purpose })),
      feedback
    ),
  plain: () =>
    assembleLockedPlain(
      locked.input,
      brand,
      locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
    )
})
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
    const rules = result.rounds[0].findings.map((f) => f.rule)
    expect(rules).toEqual(
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

  it('finds a wrong price in the words and gets it rewritten', async () => {
    const locked = await lock()
    const priced = words()
    priced.blocks[2] = {
      type: 'product_grid_2col',
      reason: 'Products.',
      words: { heading: 'The candle, now only $19' }
    }
    const run = writer(priced, words())
    const { ctx } = context(inspectors())
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(result.status).toBe('passed')
    expect(result.rounds[0].findings).toEqual([
      {
        by: 'code',
        rule: 'wrong_price',
        field: '3-product_grid_2col',
        reason:
          '"$19" is not a product\'s price: never write a price, the system shows it.'
      }
    ])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('takes an inspector’s exact problem and fix to the rewrite', async () => {
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
      { problems: [] },
      { problems: [] },
      { problems: [] }
    )
    const { ctx } = context(ai)
    const result = await writeAndInspect(build(locked, run), ctx)
    expect(result.status).toBe('passed')
    expect(result.rounds[0].findings).toEqual([
      {
        by: 'brand-inspector',
        rule: 'inspector',
        field: '3-product_grid_2col',
        reason: 'The brand never says "slow". Try: "Made for long evenings"'
      }
    ])
    expect(userOf(run, 1)).toContain('Made for long evenings')
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
    expect(result.status).toBe('plain')
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
    expect(JSON.stringify(entry)).not.toContain('30%')
  })

  it('falls back to plain copy at once with the fake writer or a used-up allowance', async () => {
    const locked = await lock()
    const fake = vi.fn<RunAi>(async () => ({
      ok: true,
      content: { fixture: true },
      provider: 'fake',
      model: 'fake'
    }))
    const one = context(inspectors())
    expect((await writeAndInspect(build(locked, fake), one.ctx)).status).toBe(
      'plain'
    )
    expect(fake).toHaveBeenCalledOnce()
    const capped = vi.fn<RunAi>(async () => {
      throw new AiRunError('cap_reached')
    })
    const two = context(inspectors())
    const out = await writeAndInspect(
      { ...build(locked, capped), write: capped as never },
      two.ctx
    )
    expect(out.status).toBe('plain')
    expect(capped).toHaveBeenCalledOnce()
    expect(two.fallbacks.entries()[0].reason).toBe(
      'The copy still failed after 0 tries: no live writer.'
    )
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

  it('reports an email that even plain copy cannot make', async () => {
    const locked = await lock()
    const { ctx, fallbacks } = context(inspectors())
    const result = await writeAndInspect(
      {
        ...build(locked, writer(words({ subject: 'x'.repeat(70) }))),
        plain: (): Assembled => ({
          status: 'rewrite',
          draft: {
            subject: '',
            preheader: '',
            plan: [],
            blocks: [],
            source: 'plain',
            productIds: [],
            code: null
          },
          problems: [{ field: 'email', reason: 'Broken.' }]
        })
      },
      ctx
    )
    expect(result.status).toBe('failed')
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'copy_failed',
      fallback: 'Plain copy failed the code checks too: no email was built.'
    })
  })
})

describe('the email checks (code)', () => {
  it('find two main buttons, a link outside the store and a picture without words', async () => {
    const locked = await lock()
    const ready = await assembleLocked(
      locked.input,
      brand,
      writer(words()),
      locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
    )
    const draft = ready.draft
    const twice = {
      ...draft,
      blocks: [
        ...draft.blocks.slice(0, 3),
        draft.blocks[3],
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
            url: 'http://cedar.example.com',
            cta: 'Look'
          }
        },
        ...draft.blocks.slice(4)
      ] as Draft['blocks']
    }
    const rules = emailChecks(twice, ['cedar.example.com']).map((f) => [
      f.rule,
      f.field
    ])
    expect(rules).toEqual(
      expect.arrayContaining([
        ['one_action', 'email'],
        ['link_host', '5-cta'],
        ['link_https', '6-hero_image'],
        ['image_alt', '6-hero_image']
      ])
    )
    expect(emailChecks(draft, ['cedar.example.com'], 'CANDLE10')).toEqual([])
  })

  it('check subject and preview lengths, and leave the offer code alone in capitals', () => {
    const draft = {
      subject: 'CANDLE10 inside',
      preheader: 'Short',
      plan: [],
      blocks: [],
      source: 'model' as const,
      productIds: [],
      code: 'CANDLE10'
    }
    expect(emailChecks(draft, [], 'CANDLE10').map((f) => f.rule)).toEqual([
      'preview_length'
    ])
  })
})

describe('the price check (code)', () => {
  it('allows a locked product’s real price and refuses any other', async () => {
    const locked = await lock()
    const { draft } = await assembleLocked(
      locked.input,
      brand,
      writer(words()),
      locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
    )
    expect(
      priceChecks({ ...draft, subject: 'Cedar candle, $24.00' }, locked)
    ).toEqual([])
    expect(
      priceChecks(
        { ...draft, preheader: 'From 15 dollars this week only' },
        locked
      ).map((f) => [f.rule, f.field])
    ).toEqual([['wrong_price', 'preview']])
  })
})

describe('the inspectors', () => {
  it('must quote real words from real fields', async () => {
    const locked = await lock()
    const { draft } = await assembleLocked(
      locked.input,
      brand,
      writer(words()),
      locked.sections.map((s) => ({ type: s.family, reason: s.purpose }))
    )
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
            }
          ]
        },
        draft
      )
    ).toEqual([
      'Problem 2: "9-text" is not a field of this email; use "subject", "preview" or a block id.',
      'Problem 3: the quote is not in preview; quote its words exactly.'
    ])
  })

  it('run on the right models and read the brand book', () => {
    expect(brandInspectorAgent.purpose).toBe('review')
    expect(brandInspectorAgent.usesBrandBook).toBe(true)
    expect(emailInspectorAgent.purpose).toBe('label')
    expect(brandInspectorAgent.instructions).toContain('not instructions')
  })
})
