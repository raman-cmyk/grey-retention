// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { gmailClipBytes } from '@/features/release-qa/checks'
import {
  abTestSize,
  clipMarginBytes,
  deliverability,
  heavyPictureBytes,
  runAbTest,
  summarize,
  type AbPair,
  type Drawing
} from './ab-test'
import type { PlannedEmail } from './build'
import { fakeHeroImages, fakeScreenshots, type HeroImagePort } from './design'
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
const emails = (...list: PlannedEmail[]) =>
  list.map((p, i) => ({ slot: i + 3, planned: p }))
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
const run = async (
  list: { slot: number; planned: PlannedEmail }[],
  ai: AiCall,
  heroImages: HeroImagePort = fakeHeroImages
) => {
  const fallbacks = memoryFallbackLog()
  const result = await runAbTest(
    {
      emails: list,
      store: await sampleStoreSource.read(tenantId),
      offers: sampleOffers
    },
    { shots: fakeScreenshots, heroImages },
    {
      tenantId,
      callerKey: 'ab-test:t1',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
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
      pictureBytes: null,
      score: 100
    })
  })

  it('counts only words a reader sees: no hidden preheader, no Klaviyo tags, it’s is one word', () => {
    const d = deliverability(
      `<div style="display:none;max-height:0">${words(50)}</div><p>{% unsubscribe %} it&#39;s here&nbsp;now</p>`
    )
    expect(d.words).toBe(3)
  })

  it('takes points off for clipping (with a margin), too few words per picture, no words, spam and a heavy picture', () => {
    const near = `<p>${words(60)}</p><!--${'x'.repeat(gmailClipBytes - clipMarginBytes)}-->`
    expect(deliverability(near)).toMatchObject({ clipped: true, score: 60 })
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
    expect(
      deliverability(`<p>${words(60)}</p>`, heavyPictureBytes + 1)
    ).toMatchObject({ pictureBytes: heavyPictureBytes + 1, score: 80 })
  })

  it('matches spam phrases as whole words only', () => {
    expect(
      deliverability(
        `<p>${words(60)} please contact now or learn moneywise</p>`
      ).spam
    ).toEqual([])
  })
})

describe('the A-vs-B test harness', () => {
  it('draws each planned email both ways from the same content, one look each', async () => {
    const ai = inspector({ problems: [], score: 8 })
    const { pairs, skipped } = await run(
      emails(planned(), planned({ date: inDays(4) })),
      ai
    )
    expect(skipped).toEqual([])
    expect(pairs.map((p) => [p.slot, p.bStatus])).toEqual([
      [3, 'made'],
      [4, 'made']
    ])
    for (const p of pairs) {
      expect(p.a).toMatchObject({ approach: 'A', inspected: true, looks: 8 })
      expect(p.b).toMatchObject({ approach: 'B', inspected: true, looks: 8 })
      // On fakes the picture is the product photo itself: the same email.
      expect(p.b!.html).toBe(p.a.html)
    }
    // One look per drawing: 2 emails, A and B.
    expect(ai).toHaveBeenCalledTimes(4)
  })

  it('does not draw B (nor pay for a picture) for an email without a product hero', async () => {
    const ai = inspector({ problems: [], score: 7 })
    const pictures = vi.fn(fakeHeroImages.design)
    const { pairs } = await run(
      emails(planned({ emailType: 'story', products: [] })),
      ai,
      { design: pictures }
    )
    expect(pairs[0]).toMatchObject({ bStatus: 'no_hero', b: null })
    expect(pictures).not.toHaveBeenCalled()
    expect(ai).toHaveBeenCalledTimes(1)
  })

  it('without the AI, asks the inspector once for the whole run and scores looks as unknown', async () => {
    const ai = inspector('refused')
    const { pairs } = await run(
      emails(
        planned(),
        planned({ date: inDays(4) }),
        planned({ date: inDays(5) })
      ),
      ai
    )
    expect(ai).toHaveBeenCalledTimes(1)
    for (const p of pairs) {
      expect(p.a).toMatchObject({ inspected: false, looks: null })
      expect(p.b).toMatchObject({ inspected: false, looks: null })
    }
    expect(summarize(pairs).counted.looks).toBe(0)
  })

  it('keeps an answer whose score is out of range, without the score', async () => {
    const { pairs } = await run(
      emails(planned()),
      inspector({ problems: [], score: 11 })
    )
    expect(pairs[0].a).toMatchObject({ inspected: true, looks: null })
  })

  it('logs a failed B picture once per email, and leaves B out', async () => {
    const { pairs, fallbacks } = await run(
      emails(planned(), planned({ date: inDays(4) })),
      inspector({ problems: [], score: 8 }),
      { design: async () => ({ ok: false, code: 'image_refused' }) }
    )
    expect(pairs.map((p) => [p.bStatus, p.b])).toEqual([
      ['picture_failed', null],
      ['picture_failed', null]
    ])
    const entries = fallbacks
      .entries()
      .filter((e) => e.reasonCode === 'b_picture_failed')
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((e) => e.dedupeKey)).size).toBe(2)
  })

  it('skips a planned email it cannot build, with its code, and draws at most 10', async () => {
    const one = await run(
      // Melbourne's clock skips 02:00 to 03:00 that day.
      emails(planned({ date: '2027-10-03', time: '02:30' }), planned()),
      inspector({ problems: [], score: 7 })
    )
    expect(one.skipped).toEqual([{ slot: 3, code: 'slot_time_invalid' }])
    expect(one.pairs.map((p) => p.slot)).toEqual([4])
    const many = await run(
      emails(
        ...Array.from({ length: abTestSize + 2 }, (_, i) =>
          planned({ date: inDays(2 + i) })
        )
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
    html: '',
    inspected: true,
    looks: null,
    findings: 0,
    deliverability: deliverability('<p>enough words here for one</p>'),
    ...over
  })
  const pair = (
    slot: number,
    a: Partial<Drawing>,
    b: Partial<Drawing> | null,
    bStatus: AbPair['bStatus'] = b ? 'made' : 'no_hero'
  ): AbPair => ({
    slot,
    date: inDays(2),
    emailType: 'bestseller',
    a: drawing('A', a),
    b: b ? drawing('B', b) : null,
    bStatus
  })

  it('compares the same emails on both sides, and works without stars or results', () => {
    const s = summarize([
      pair(0, { looks: 6 }, { looks: 8 }),
      pair(1, { looks: 7 }, { looks: 9 }),
      // A judged alone: left out of looks for both sides.
      pair(2, { looks: 2 }, { looks: null }),
      pair(3, { looks: 9 }, null),
      pair(4, { looks: 9 }, null, 'picture_failed')
    ])
    expect(s).toMatchObject({
      emails: 5,
      made: 3,
      noHero: 1,
      pictureFailed: 1,
      counted: { looks: 2, stars: 0, clicks: 0 },
      a: { looks: 6.5, stars: null, deliverability: 100, clickRate: null },
      b: { looks: 8.5, stars: null, deliverability: 100, clickRate: null }
    })
  })

  it('adds the owner’s optional stars and the clicks per variation, paired', () => {
    const s = summarize([pair(0, {}, {}), pair(1, {}, {})], {
      stars: { '0:A': 3, '0:B': 5, '1:B': 4, '1:A': 9 },
      results: {
        '0:A': { delivered: 100, clicks: 2 },
        '0:B': { delivered: 100, clicks: 4 },
        '1:B': { delivered: 50, clicks: 5 }
      }
    })
    // Email 1 has no valid A stars (9) and no A results: left out on both sides.
    expect(s.counted).toEqual({ looks: 0, stars: 1, clicks: 1 })
    expect(s.a).toMatchObject({ stars: 3, clickRate: 0.02 })
    expect(s.b).toMatchObject({ stars: 5, clickRate: 0.04 })
  })
})
