// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import type { AiRunResult } from '@/features/ai/run'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import { memoryFallbackLog } from '@/features/fallback/log'
import { plainFooterTags } from '@/features/letter/render'
import { buildEmail, builtEmail, type PlannedEmail } from './build'
import { letterSchema } from '@/features/letter/letter'
import {
  letterDesignStep,
  letterLayout,
  letterOfferShown
} from './letter-steps'
import { sampleOffers, sampleStoreSource } from './ports'
import { runBuildStep } from './steps'

/** TXT-001c: "Create email" builds a text email (D26). */
const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'offer',
  angle: 'A note about the candle',
  products: [{ id: 'p-cedar-candle', title: 'Cedar candle' }],
  offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
  format: 'text'
}
const store = () => sampleStoreSource.read(tenantId)
const ctxWith = (ai: AiCall | null, fallbacks = memoryFallbackLog()) => ({
  tenantId,
  callerKey: 'email-build:b1',
  fallbacks,
  agents: ai
    ? { memory: new InMemoryMemoryStore(), log: new InMemoryRunLog(), ai }
    : null
})
const ok = (content: unknown): AiRunResult => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    i % 8 === 7 ? 'evening.' : 'quiet'
  ).join(' ')
const letterAnswer = {
  subject: 'A note about our cedar candle',
  preheader: 'Why we made it, and how it fills a room at night.',
  greeting: 'Hi there,',
  body: [
    'We poured the first cedar candle in our own kitchen, for the long dark evenings.',
    `Quiet ${filler(60)}`,
    'If you would like one this week, [the candle is here](1), with a little off.'
  ],
  signoff: 'Warmly,',
  ps: 'Reply and tell me what your evenings smell like.'
}
/** The model: the Letter writer answers; any other agent is not set up. */
const model = () =>
  vi.fn<AiCall>(async (call) =>
    call.callerKey.startsWith('letter-writer:')
      ? ok(letterAnswer)
      : { ok: false, code: 'setup_required' }
  )

describe('a text email in Create email (TXT-001c)', () => {
  it('builds the plain letter on the code path: one product, its offer line, a real plain-text part', async () => {
    const made = await buildEmail(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(null)
    )
    expect(made.ok).toBe(true)
    if (!made.ok) return
    const email = made.email
    expect(builtEmail.safeParse(email).success).toBe(true)
    expect(email).toMatchObject({
      format: 'text',
      approach: 'A',
      copy: 'plain',
      ai: false,
      subject: 'A short note about the Cedar candle',
      productIds: ['p-cedar-candle'],
      code: 'CANDLE10',
      offer: { percent: 10 }
    })
    expect(email.html).toContain('class="gr-letter"')
    expect(email.html).toContain(
      '<a href="https://cedar-lane.example/products/p-cedar-candle">take a look</a>'
    )
    expect(email.html).toContain('Use the code CANDLE10 for 10% off.')
    for (const tag of Object.values(klaviyoFooterTags))
      expect(email.html).toContain(tag)
    expect(email.text).toContain(
      'take a look (https://cedar-lane.example/products/p-cedar-candle)'
    )
    expect(email.text).toContain(plainFooterTags.unsubscribe)
    expect(email.html).not.toMatch(/<img\b/)
  })

  it('with the agents, the Letter writer’s letter; the Section planner is never asked', async () => {
    const ai = model()
    const made = await buildEmail(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(ai)
    )
    expect(made.ok && made.email).toMatchObject({
      format: 'text',
      copy: 'written',
      ai: true,
      subject: 'A note about our cedar candle'
    })
    const who = ai.mock.calls.map((c) => c[0].callerKey.split(':')[0])
    expect(who).not.toContain('section-planner')
    expect(who).toContain('letter-writer')
  })

  it('locks only what the letter shows: the lead product and the offer', () => {
    expect(letterLayout(planned).sections.map((s) => s.family)).toEqual([
      'product_feature',
      'offer_banner'
    ])
    expect(
      letterLayout({ ...planned, products: [], offer: null }).sections
    ).toEqual([])
  })

  it('never shares a subject with another email of the plan', async () => {
    const input = { planned, store: await store(), offers: sampleOffers }
    const next = await buildEmail(
      { ...input, taken: ['A short note about the Cedar candle'] },
      ctxWith(null)
    )
    expect(next.ok && next.email.subject).toBe(
      'A short note from Cedar Lane (sample)'
    )
    const fallbacks = memoryFallbackLog()
    const none = await buildEmail(
      {
        ...input,
        taken: [
          'A short note about the Cedar candle',
          'A short note from Cedar Lane (sample)',
          'A note from all of us at Cedar Lane (sample)',
          'A short note from us',
          'Something we wanted to share'
        ]
      },
      ctxWith(null, fallbacks)
    )
    expect(none).toEqual({ ok: false, code: 'subject_taken' })
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'subject_taken'
    })
  })

  it('runs as the job’s saved steps, and a saved letter that no longer reads starts over', async () => {
    const s = await store()
    const progress: Record<string, unknown> = {}
    const run = (step: string) =>
      runBuildStep(
        step,
        { planned, store: s, offers: sampleOffers, progress },
        ctxWith(null)
      )
    for (const step of ['sections', 'content', 'copy'] as const) {
      const made = await run(step)
      if (!made.ok || !('output' in made)) throw new Error(`${step} failed`)
      progress[step] = JSON.parse(JSON.stringify(made.output))
    }
    const design = await run('design')
    expect(design).toMatchObject({
      ok: true,
      done: 'design',
      email: { format: 'text', code: 'CANDLE10' }
    })
    progress.copy = { ...(progress.copy as object), letter: { subject: '' } }
    expect(await run('design')).toEqual({
      ok: false,
      code: 'step_progress_invalid'
    })
  })

  it('locks the lead product without asking the Content locker (one answer only)', async () => {
    const ai = model()
    await buildEmail(
      {
        planned: {
          ...planned,
          products: [
            { id: 'p-cedar-candle', title: 'Cedar candle' },
            { id: 'p-linen-throw', title: 'Linen throw' }
          ]
        },
        store: await store(),
        offers: sampleOffers
      },
      ctxWith(ai)
    )
    const who = ai.mock.calls.map((c) => c[0].callerKey.split(':')[0])
    expect(who).not.toContain('content-locker')
  })

  it('tells the Letter writer the plan’s other subjects', async () => {
    let n = 0
    const ai = vi.fn<AiCall>(async (call) =>
      call.callerKey.startsWith('letter-writer:')
        ? ok({
            ...letterAnswer,
            subject: ++n === 1 ? 'Taken already' : 'A note about our candle'
          })
        : { ok: false, code: 'setup_required' }
    )
    const made = await buildEmail(
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        taken: ['Taken already']
      },
      ctxWith(ai)
    )
    expect(made.ok && made.email.subject).toBe('A note about our candle')
    const writer = ai.mock.calls.filter((c) =>
      c[0].callerKey.startsWith('letter-writer:')
    )
    expect(writer[1]![0].request.user).toContain(
      'Another email in this plan already has this subject'
    )
  })

  it('builds no email when the plain letter fails its checks, logged', async () => {
    const s = await store()
    const fallbacks = memoryFallbackLog()
    const made = await buildEmail(
      {
        planned,
        store: { ...s, facts: { ...s.facts, bannedPhrases: ['short note'] } },
        offers: sampleOffers
      },
      ctxWith(null, fallbacks)
    )
    expect(made).toEqual({ ok: false, code: 'copy_failed' })
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'email-build',
      reasonCode: 'copy_failed'
    })
  })

  it('a planned offer that is not a working code: a letter without its line, logged', async () => {
    const fallbacks = memoryFallbackLog()
    const made = await buildEmail(
      {
        planned: {
          ...planned,
          offer: { id: 'offer:NOPE20', code: 'NOPE20', percent: 20 }
        },
        store: await store(),
        offers: sampleOffers
      },
      ctxWith(null, fallbacks)
    )
    expect(made.ok && made.email).toMatchObject({ code: null, offer: null })
    expect(made.ok && made.email.html).not.toContain('Use the code')
    expect(fallbacks.entries().map((e) => e.agent)).toContain('content-locker')
  })

  it('refuses a code that is not the one locked, and a logo not in Klaviyo', async () => {
    const made = await buildEmail(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(null)
    )
    if (!made.ok) throw new Error('build')
    const s = await store()
    const copy = {
      letter: letterSchema.parse({
        subject: 'A note',
        preheader: 'Why we made it, and how it fills a room.',
        body: ['Hello.'],
        signoff: 'Warmly,',
        signature: 'Maya',
        offer: { code: 'CANDLE10', percent: 10 },
        links: []
      }),
      productIds: [],
      changes: []
    }
    const base = {
      planned,
      store: s,
      sendAt: '2030-01-01T10:00:00Z',
      sample: true,
      copy,
      name: 'Tue · Offer'
    }
    expect(
      letterDesignStep({
        ...base,
        rules: { maxDiscountPercent: 20, codes: [] }
      })
    ).toEqual({ ok: false, code: 'offer_unsafe' })
    expect(
      letterDesignStep({
        ...base,
        store: {
          ...s,
          brand: { ...s.brand, logo: 'data:image/png;base64,iVBORw0KGgo=' }
        },
        rules: {
          maxDiscountPercent: 20,
          codes: [{ code: 'CANDLE10', percent: 10, expiresAt: null }]
        }
      })
    ).toEqual({ ok: false, code: 'render_failed' })
  })

  it('the job’s design step: the code still working, the hard checks, the format unchanged (TXT-001d)', async () => {
    const s = await store()
    /** The steps before design, saved, then the design step with `over`. */
    const design = async (over: {
      store?: typeof s
      offers?: typeof sampleOffers
      planned?: PlannedEmail
    }) => {
      const progress: Record<string, unknown> = {}
      for (const step of ['sections', 'content', 'copy'] as const) {
        const made = await runBuildStep(
          step,
          { planned, store: over.store ?? s, offers: sampleOffers, progress },
          ctxWith(null)
        )
        if (!made.ok || !('output' in made)) throw new Error(step)
        progress[step] = JSON.parse(JSON.stringify(made.output))
      }
      const fallbacks = memoryFallbackLog()
      const result = await runBuildStep(
        'design',
        {
          planned: over.planned ?? planned,
          store: over.store ?? s,
          offers: over.offers ?? sampleOffers,
          progress
        },
        ctxWith(null, fallbacks)
      )
      return { result, fallbacks }
    }
    // The code switched off in Settings since the first step.
    const off = {
      async offers() {
        return { maxDiscountPercent: 20, codes: [] }
      }
    } as unknown as typeof sampleOffers
    expect((await design({ offers: off })).result).toEqual({
      ok: false,
      code: 'offer_unsafe'
    })
    // Settings that cannot be read now.
    const unread = {
      async offers() {
        throw new Error('down')
      }
    } as unknown as typeof sampleOffers
    expect((await design({ offers: unread })).result).toEqual({
      ok: false,
      code: 'offers_unreadable'
    })
    // A product link that is not https fails the hard checks, logged.
    const http = {
      ...s,
      products: s.products.map((p) => ({
        ...p,
        url: p.url.replace('https:', 'http:')
      }))
    }
    const checked = await design({ store: http })
    expect(checked.result).toEqual({ ok: false, code: 'hard_check_failed' })
    expect(checked.fallbacks.entries()[0]).toMatchObject({
      agent: 'email-checks',
      reasonCode: 'hard_check_links'
    })
    // The slot switched to a designed email since the first step.
    const designed: PlannedEmail = { ...planned }
    delete designed.format
    expect((await design({ planned: designed })).result).toEqual({
      ok: false,
      code: 'format_changed'
    })
  })

  it('shows only a working code within the max, at its own percent', () => {
    const letter = {
      offer: { code: 'CANDLE10', percent: 10 }
    } as Parameters<typeof letterOfferShown>[0]
    const rules = (
      percent: number,
      max = 20,
      expiresAt: string | null = null
    ) => ({
      maxDiscountPercent: max,
      codes: [{ code: 'CANDLE10', percent, expiresAt }]
    })
    const sendAt = '2030-01-01T10:00:00Z'
    expect(letterOfferShown(letter, rules(10), sendAt)).toBe(true)
    expect(letterOfferShown(letter, rules(15), sendAt)).toBe(false)
    expect(letterOfferShown(letter, rules(10, 5), sendAt)).toBe(false)
    expect(
      letterOfferShown(letter, rules(10, 20, '2029-12-31T00:00:00Z'), sendAt)
    ).toBe(false)
    expect(
      letterOfferShown(letter, { maxDiscountPercent: 20, codes: [] }, sendAt)
    ).toBe(false)
  })

  it('a slot planned before formats is a designed email', async () => {
    const old: PlannedEmail = { ...planned }
    delete old.format
    const made = await buildEmail(
      { planned: old, store: await store(), offers: sampleOffers },
      ctxWith(null)
    )
    expect(made.ok && made.email.format).toBeUndefined()
    expect(made.ok && made.email.text).toBeUndefined()
  })

  it('passes the planned kind to the Letter writer (DST-PIC #24)', async () => {
    const ai = model()
    const made = await buildEmail(
      {
        planned: { ...planned, letterKind: 'thank_you' },
        store: await store(),
        offers: sampleOffers
      },
      ctxWith(ai)
    )
    expect(made.ok).toBe(true)
    const writer = ai.mock.calls.find((c) =>
      c[0].callerKey.startsWith('letter-writer:')
    )![0]
    expect(writer.request.system).toContain('This letter is a thank-you')
    expect(writer.request.user).toContain('"kind":"Thank-you"')
  })

  it('a planned kind that does not fit: a letter of no kind, logged once', async () => {
    const ai = model()
    const fallbacks = memoryFallbackLog()
    const made = await buildEmail(
      {
        // A quick question never carries an offer; this one has one.
        planned: { ...planned, letterKind: 'quick_question' },
        store: await store(),
        offers: sampleOffers
      },
      ctxWith(ai, fallbacks)
    )
    expect(made.ok).toBe(true)
    const writer = ai.mock.calls.find((c) =>
      c[0].callerKey.startsWith('letter-writer:')
    )![0]
    expect(writer.request.system).not.toContain('This letter is a quick')
    expect(fallbacks.entries()).toContainEqual(
      expect.objectContaining({
        agent: 'letter-writer',
        reasonCode: 'letter_kind_dropped',
        reason:
          'The planned kind of letter never carries an offer, and this email has one.',
        detail: { kind: 'quick_question', why: 'kind_never_offers' }
      })
    )
    // Without the agents the plain letter has no kind: nothing to log.
    const quiet = memoryFallbackLog()
    await buildEmail(
      {
        planned: { ...planned, letterKind: 'quick_question' },
        store: await store(),
        offers: sampleOffers
      },
      ctxWith(null, quiet)
    )
    expect(
      quiet.entries().filter((e) => e.reasonCode === 'letter_kind_dropped')
    ).toEqual([])
  })
})
