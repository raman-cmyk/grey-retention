// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AiRun, Ask } from '@/features/intelligence/passes'
import {
  adLibraryUrl,
  ownAds,
  sampleAds,
  type LibraryAd
} from '@/lib/providers/ad-library'
import {
  analyseAds,
  analystInput,
  checkedAdFindings,
  countedAdFindings,
  sampleAdFindings
} from './analyst'

const domain = 'cedar-lane.example'
const ads = ownAds(sampleAds(domain), domain)
const byText = (part: string) => ads.find((a) => a.texts[0]!.includes(part))!
const sale = byText('20% off')
const shipping = byText('Free shipping')
const gift = byText('A gift')
const video = byText('See how')

const askWith = (run: AiRun) => {
  const mock = vi.fn(async () => run)
  return mock as unknown as Ask & typeof mock
}
const gemini = (content: unknown): AiRun => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'gemini-2.5-flash'
})
const raw = (over: Record<string, unknown>) => ({
  topic: 'angle' as const,
  statement: 'Ads present the knits as gifts for her.',
  adIds: [gift.id],
  quote: 'A gift she will wear every day',
  confidence: 0.8,
  ...over
})

describe('the Ads analyst’s findings that hold up', () => {
  it('keeps an offer whose numbers are in the ad’s own words, citing that ad', () => {
    const { kept, dropped } = checkedAdFindings(ads, [
      raw({
        topic: 'promotion',
        statement: 'A live ad offers 20% off every knit.',
        adIds: [sale.id],
        quote: 'The weekend sale is on: 20% off every knit.',
        kind: 'percent_off',
        percent: 20
      }),
      raw({
        topic: 'free_shipping',
        statement: 'Free shipping on orders over $75.',
        adIds: [shipping.id],
        quote: 'Free shipping on orders over $75.',
        kind: 'over',
        amount: 75,
        currency: 'USD'
      }),
      raw({})
    ])
    expect(dropped).toBe(0)
    expect(kept.map((f) => [f.topic, f.value, f.evidence])).toEqual([
      [
        'promotion',
        { kind: 'percent_off', percent: 20 },
        {
          url: adLibraryUrl(sale.id),
          quote: 'The weekend sale is on: 20% off every knit.'
        }
      ],
      [
        'free_shipping',
        { kind: 'over', amount: 75, currency: 'USD' },
        {
          url: adLibraryUrl(shipping.id),
          quote: 'Free shipping on orders over $75.'
        }
      ],
      [
        'angle',
        {},
        { url: adLibraryUrl(gift.id), quote: 'A gift she will wear every day' }
      ]
    ])
  })

  it('drops what the ads do not say, or says with made-up numbers or claims', () => {
    const cases = [
      // An ad this read does not have.
      raw({ adIds: ['999'] }),
      raw({ adIds: [gift.id, '999'] }),
      // Words the ad does not have, or too few.
      raw({ quote: 'A gift for everyone you love' }),
      raw({ quote: 'A gift' }),
      // The quote is from another ad than the first cited.
      raw({ adIds: [sale.id], quote: 'A gift she will wear every day' }),
      // A percentage the quote does not show.
      raw({
        topic: 'promotion',
        adIds: [sale.id],
        quote: 'The weekend sale is on: 20% off every knit.',
        kind: 'percent_off',
        percent: 30
      }),
      // An amount in another currency than the quote's sign.
      raw({
        topic: 'free_shipping',
        adIds: [shipping.id],
        quote: 'Free shipping on orders over $75.',
        kind: 'over',
        amount: 75,
        currency: 'EUR'
      }),
      // Free shipping the quote does not offer.
      raw({ topic: 'free_shipping', kind: 'always' }),
      // A promotion with no kind.
      raw({ topic: 'promotion' }),
      // Words-only topics in plain words: no numbers, no claims.
      raw({ statement: 'The ads offer 3 colours as gifts.' }),
      raw({ statement: 'The best gifts in the world.' })
    ]
    const { kept, dropped } = checkedAdFindings(ads, cases)
    expect(kept).toEqual([])
    expect(dropped).toBe(cases.length)
  })

  it('caps its confidence and keeps a finding once', () => {
    const { kept } = checkedAdFindings(ads, [
      raw({ confidence: 1 }),
      raw({ statement: 'The same angle again.' })
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0]!.confidence).toBe(0.9)
  })
})

describe('the sample rules and what code counts', () => {
  it('find the plain offers of the sample ads, each with its sentence', () => {
    const { kept } = checkedAdFindings(ads, sampleAdFindings(ads))
    // Newest ad first.
    expect(kept.map((f) => [f.topic, f.value, f.adId])).toEqual([
      [
        'free_shipping',
        { kind: 'over', amount: 75, currency: 'USD' },
        shipping.id
      ],
      ['promotion', { kind: 'percent_off', percent: 20 }, sale.id]
    ])
  })

  it('count the landing pages (without their tracking) and the formats', () => {
    const counted = countedAdFindings(ads)
    const pages = counted.filter((f) => f.topic === 'landing_page')
    expect(pages.map((f) => f.value)).toEqual([
      { url: 'https://cedar-lane.example/' },
      { url: 'https://cedar-lane.example/collections/knitwear' },
      { url: 'https://cedar-lane.example/products/field-overshirt' }
    ])
    for (const f of pages) {
      if (!('url' in f.evidence)) throw new Error('no url')
      const { url } = f.evidence
      const ad = ads.find((a) => adLibraryUrl(a.id) === url)!
      expect(
        'quote' in f.evidence && ad.texts[0]!.startsWith(f.evidence.quote)
      ).toBe(true)
    }
    expect(counted.find((f) => f.topic === 'creative')?.statement).toBe(
      'Live ads mix pictures, carousels and videos, shown on Facebook and Instagram.'
    )
    const pictures: LibraryAd[] = ads.map((a) => ({ ...a, media: 'image' }))
    expect(
      countedAdFindings(pictures).find((f) => f.topic === 'creative')?.statement
    ).toBe('Most live ads are pictures, shown on Facebook and Instagram.')
  })

  it('hand the analyst each ad’s words and the path it sends people to', () => {
    const input = analystInput('Cedar Lane', [sale])
    expect(input.ads[0]).toMatchObject({
      id: sale.id,
      landing: '/collections/knitwear',
      started: sale.startedAt.slice(0, 10)
    })
  })
})

describe('asking the Ads analyst', () => {
  it('uses the sample rules when the AI is the fake', async () => {
    const ask = askWith({
      ok: true,
      content: null,
      provider: 'fake',
      model: 'fake'
    })
    const read = await analyseAds('Cedar Lane', ads, ask, 'ads-read')
    expect(read).toMatchObject({ answered: true, pass: 'sample', model: null })
    expect((ask.mock.calls[0] as unknown[])[2]).toMatchObject({
      tier: 'review'
    })
  })

  it('keeps a model’s findings only when they hold up', async () => {
    const read = await analyseAds(
      'Cedar Lane',
      ads,
      askWith(gemini({ findings: [raw({}), raw({ adIds: ['999'] })] })),
      'ads-read'
    )
    expect(read).toMatchObject({
      answered: true,
      pass: 'model',
      model: 'gemini-2.5-flash',
      dropped: 1
    })
    if (read.answered) expect(read.findings).toHaveLength(1)
  })

  it('leaves the ads without words on an unusable answer, and tries again on an outage', async () => {
    for (const [run, reason] of [
      [{ ok: false, code: 'invalid_output' }, 'model_unusable'],
      [{ ok: false, code: 'refused' }, 'model_refused'],
      [{ ok: false, code: 'incomplete' }, 'answer_too_long'],
      [gemini({ findings: 'none' }), 'model_unusable']
    ] as const)
      expect(
        await analyseAds('Cedar Lane', ads, askWith(run as AiRun), 'k')
      ).toEqual({ answered: false, reason })
    await expect(
      analyseAds(
        'Cedar Lane',
        ads,
        askWith({ ok: false, code: 'rate_limited' }),
        'k'
      )
    ).rejects.toMatchObject({ name: 'TagError', retryable: true })
    await expect(
      analyseAds(
        'Cedar Lane',
        ads,
        askWith({ ok: false, code: 'cap_reached' }),
        'k'
      )
    ).rejects.toMatchObject({ name: 'TagError' })
  })

  it('never names the video ad’s quote as another ad’s', () => {
    const { kept } = checkedAdFindings(ads, [
      raw({
        topic: 'creative',
        statement: 'Ads show how the clothes are made.',
        adIds: [video.id, gift.id],
        quote: 'See how the Field Overshirt is made'
      })
    ])
    expect(kept.map((f) => f.adId)).toEqual([video.id])
  })
})
