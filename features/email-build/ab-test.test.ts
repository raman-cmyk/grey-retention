// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { gmailClipBytes } from '@/features/release-qa/checks'
import {
  abTestSize,
  deliverability,
  runAbTest,
  summarize,
  type AbPair,
  type Drawing
} from './ab-test'
import type { PlannedEmail } from './build'
import { fakeHeroImages, fakeScreenshots } from './design'
import { sampleOffers, sampleStoreSource } from './ports'

const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned = (over: Partial<PlannedEmail> = {}): PlannedEmail => ({
  date: inDays(2),
  time: '10:00',
  emailType: 'bestseller',
  angle: 'The throw people keep coming back for',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
  ...over
})
/** A Visual inspector that always answers the same. */
const inspector = (answer: unknown) =>
  vi.fn<AiCall>(async () =>
    answer === 'refused'
      ? { ok: false, code: 'cap_reached' }
      : {
          ok: true,
          content: answer,
          provider: 'fake',
          model: 'fake',
          costMicro: 0,
          inputTokens: 10,
          outputTokens: 10,
          settled: true
        }
  )
const context = (ai: AiCall) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'ab-test:t1',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}
const ports = { shots: fakeScreenshots, heroImages: fakeHeroImages }
const run = async (list: PlannedEmail[], ai: AiCall) => {
  const { ctx, fallbacks } = context(ai)
  const result = await runAbTest(
    {
      planned: list,
      store: await sampleStoreSource.read(tenantId),
      offers: sampleOffers
    },
    ports,
    ctx
  )
  return { ...result, fallbacks }
}

describe('deliverability (code)', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')
  it('scores a clean email 100 and says what it counted', () => {
    const d = deliverability(
      `<html><head><style>p{color:red}</style></head><body><img src="https://x.example/a.png"><p>${words(60)}</p></body></html>`
    )
    expect(d).toMatchObject({
      clipped: false,
      images: 1,
      words: 60,
      wordsPerImage: 60,
      spam: [],
      score: 100
    })
  })

  it('takes points off for clipping, too few words per picture, no words and spam', () => {
    const big = `<p>${words(60)}</p><!--${'x'.repeat(gmailClipBytes)}-->`
    expect(deliverability(big)).toMatchObject({ clipped: true, score: 60 })
    expect(
      deliverability(`<img src="a"><img src="b"><p>${words(30)}</p>`)
    ).toMatchObject({ wordsPerImage: 15, score: 80 })
    expect(deliverability('<img src="a">')).toMatchObject({
      words: 0,
      score: 50
    })
    expect(
      deliverability(`<p>${words(60)} act now, click here</p>`)
    ).toMatchObject({ spam: ['act now', 'click here'], score: 80 })
  })
})

describe('the A-vs-B test harness', () => {
  it('draws each planned email both ways from the same content, and scores each', async () => {
    const { pairs, skipped } = await run(
      [planned(), planned({ date: inDays(4) })],
      inspector({ problems: [], score: 8 })
    )
    expect(skipped).toEqual([])
    expect(pairs).toHaveLength(2)
    for (const p of pairs) {
      expect(p.a).toMatchObject({ approach: 'A', made: true, looks: 8 })
      expect(p.b).toMatchObject({ approach: 'B', made: true, looks: 8 })
      // The same locked content: the same product in both drawings.
      expect(p.a.html).toContain('Linen throw')
      expect(p.b.html).toContain('Linen throw')
      expect(p.a.deliverability.score).toBeGreaterThan(0)
      expect(p.b.deliverability.score).toBeGreaterThan(0)
    }
    expect(pairs.map((p) => p.slot)).toEqual([0, 1])
  })

  it('without the AI, scores looks as unknown and counts B as not made (it falls back to A)', async () => {
    const { pairs, fallbacks } = await run([planned()], inspector('refused'))
    expect(pairs[0].a).toMatchObject({ made: true, looks: null })
    expect(pairs[0].b).toMatchObject({ made: false, looks: null })
    expect(fallbacks.entries().map((e) => e.reasonCode)).toContain(
      'design_b_fallback'
    )
    expect(summarize(pairs).compared).toBe(0)
  })

  it('reads an older inspector answer without a score as passed, with looks unknown', async () => {
    const { pairs } = await run([planned()], inspector({ problems: [] }))
    expect(pairs[0].a).toMatchObject({ made: true, looks: null })
    expect(pairs[0].b).toMatchObject({ made: true, looks: null })
  })

  it('skips a planned email it cannot build, with its code, and draws at most 10', async () => {
    const one = await run(
      // Melbourne's clock skips 02:00 to 03:00 that day.
      [planned({ date: '2027-10-03', time: '02:30' }), planned()],
      inspector({ problems: [], score: 7 })
    )
    expect(one.skipped).toEqual([{ slot: 0, code: 'slot_time_invalid' }])
    expect(one.pairs.map((p) => p.slot)).toEqual([1])
    const many = await run(
      Array.from({ length: abTestSize + 2 }, (_, i) =>
        planned({ date: inDays(2 + i) })
      ),
      inspector({ problems: [], score: 7 })
    )
    expect(many.pairs.length + many.skipped.length).toBe(abTestSize)
  })
})

describe('the summary', () => {
  const drawing = (
    approach: 'A' | 'B',
    over: Partial<Drawing> = {}
  ): Drawing => ({
    approach,
    made: true,
    html: '',
    looks: null,
    findings: 0,
    deliverability: deliverability('<p>enough words here for one</p>'),
    ...over
  })
  const pair = (slot: number, a: Partial<Drawing>, b: Partial<Drawing>) =>
    ({
      slot,
      date: inDays(2),
      emailType: 'bestseller',
      a: drawing('A', a),
      b: drawing('B', b)
    }) satisfies AbPair

  it('compares only emails where B was made, and works without stars or results', () => {
    const pairs = [
      pair(0, { looks: 6 }, { looks: 8 }),
      pair(1, { looks: 7 }, { looks: 9 }),
      pair(2, { looks: 5 }, { made: false })
    ]
    expect(summarize(pairs)).toEqual({
      compared: 2,
      a: {
        emails: 2,
        looks: 6.5,
        stars: null,
        deliverability: 100,
        clickRate: null
      },
      b: {
        emails: 2,
        looks: 8.5,
        stars: null,
        deliverability: 100,
        clickRate: null
      }
    })
  })

  it('adds the owner’s optional stars and the clicks per variation once sent', () => {
    const pairs = [pair(0, {}, {}), pair(1, {}, {})]
    const s = summarize(pairs, {
      stars: { '0:A': 3, '0:B': 5, '1:B': 4, '1:A': 9 },
      results: {
        '0:A': { delivered: 100, clicks: 2 },
        '0:B': { delivered: 100, clicks: 4 },
        '1:B': { delivered: 0, clicks: 0 }
      }
    })
    // A 9 is not a star rating: left out, never guessed.
    expect(s.a).toMatchObject({ stars: 3, clickRate: 0.02 })
    expect(s.b).toMatchObject({ stars: 4.5, clickRate: 0.04 })
  })
})
