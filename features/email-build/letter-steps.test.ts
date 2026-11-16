// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import type { AiRunResult } from '@/features/ai/run'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import { memoryFallbackLog } from '@/features/fallback/log'
import { plainFooterTags } from '@/features/letter/render'
import { buildEmail, builtEmail, type PlannedEmail } from './build'
import { letterLayout, letterOfferShown } from './letter-steps'
import { sampleOffers, sampleStoreSource } from './ports'

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
})
