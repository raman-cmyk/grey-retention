// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { agentAsk, type AiRun, type Ask } from '@/features/intelligence/passes'
import type { SitePageKind } from '../findings'
import { readPage } from './pages'
import {
  checkedFindings,
  readSitePage,
  sampleFindings,
  siteReader
} from './reader'
import { samplePage } from './sample'

const page = (path: string, kind: SitePageKind) =>
  readPage(
    samplePage('cedar-lane.example', path)!,
    `https://cedar-lane.example${path}`,
    kind
  )
const facts = (path: string, kind: SitePageKind) =>
  checkedFindings(page(path, kind), sampleFindings(page(path, kind))).kept.map(
    (f) => [f.topic, f.value]
  )
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

describe('the sample rules', () => {
  it('find the plain facts of the sample site, each with the line it came from', () => {
    expect(facts('/pages/shipping', 'shipping')).toEqual([
      ['delivery_days', { min: 3, max: 5, region: 'United States' }],
      ['free_shipping', { kind: 'over', amount: 75, currency: 'USD' }]
    ])
    expect(facts('/pages/returns', 'returns')).toContainEqual([
      'returns',
      { days: 30 }
    ])
    expect(facts('/pages/faq', 'faq')).toContainEqual([
      'guarantee',
      { days: 365 }
    ])
    expect(facts('/products/field-overshirt', 'product')).toEqual(
      expect.arrayContaining([
        ['claim', { subject: 'product' }],
        ['locale', { language: 'en', currency: 'USD' }],
        ['price_band', { min: 89, max: 89, currency: 'USD' }]
      ])
    )
    expect(facts('/', 'home')).toEqual(
      expect.arrayContaining([
        ['price_band', { min: 89, max: 120, currency: 'USD' }],
        ['offering', {}]
      ])
    )
  })

  it('never count the free-shipping threshold as a price, and leave tone and audience to a model', () => {
    const home = facts('/', 'home')
    expect(home).not.toContainEqual([
      'price_band',
      expect.objectContaining({ min: 75 })
    ])
    expect(home.map(([t]) => t)).not.toContain('tone')
    expect(facts('/pages/about', 'about').map(([t]) => t)).not.toContain(
      'audience'
    )
  })
})

describe('checkedFindings', () => {
  const shipping = page('/pages/shipping', 'shipping')
  const raw = (over: Record<string, unknown> = {}) => ({
    topic: 'free_shipping' as const,
    statement: 'Free shipping over $75.',
    quote: 'free shipping on  orders over $75.',
    confidence: 0.9,
    kind: 'over' as const,
    amount: 75,
    currency: 'usd',
    ...over
  })

  it('keeps a finding whose quote is on the page (whitespace and case aside), with its evidence', () => {
    expect(checkedFindings(shipping, [raw()])).toEqual({
      kept: [
        {
          topic: 'free_shipping',
          statement: 'Free shipping over $75.',
          value: { kind: 'over', amount: 75, currency: 'USD' },
          evidence: {
            url: 'https://cedar-lane.example/pages/shipping',
            quote: 'free shipping on orders over $75.',
            page: 'shipping'
          },
          confidence: 0.9
        }
      ],
      dropped: 0
    })
  })

  it('drops a quote the page does not show, a value of the wrong shape, a topic the site cannot state and repeats', () => {
    const { kept, dropped } = checkedFindings(shipping, [
      raw({ quote: 'Free shipping on every order, forever.' }),
      raw({ quote: 'Hidden preview text that is never shown' }),
      raw({ amount: undefined }),
      raw({ topic: 'review_platform' }),
      raw({
        topic: 'returns',
        days: 3.5,
        quote: 'Orders ship within 1–2 business days.'
      }),
      raw(),
      raw()
    ])
    expect(kept).toHaveLength(1)
    expect(dropped).toBe(6)
  })
})

describe('readSitePage', () => {
  const input = { brand: 'Cedar Lane', page: page('/pages/returns', 'returns') }

  it('uses the sample rules when the AI is the fake', async () => {
    const ask = askWith({
      ok: true,
      content: null,
      provider: 'fake',
      model: 'fake'
    })
    const read = await readSitePage(input, ask, 'site-page:returns:1')
    expect(read).toMatchObject({ answered: true, pass: 'sample', model: null })
    expect(read.answered && read.findings.map((f) => f.topic)).toContain(
      'returns'
    )
    expect(ask.mock.calls[0]).toEqual([
      siteReader,
      input,
      { callerKey: 'site-page:returns:1', tier: 'review', industry: null }
    ])
  })

  it("keeps a model's findings that hold up, and drops the rest", async () => {
    const read = await readSitePage(
      input,
      askWith(
        gemini({
          findings: [
            {
              topic: 'returns',
              statement: 'Returns within 30 days.',
              quote: 'within 30 days for a full refund',
              confidence: 0.9,
              days: 30
            },
            {
              topic: 'claim',
              statement: 'Award winning.',
              quote: 'Award-winning since 2016',
              confidence: 0.9,
              subject: 'brand'
            }
          ]
        })
      ),
      'k'
    )
    expect(read).toMatchObject({
      pass: 'model',
      model: 'gemini-2.5-flash',
      dropped: 1
    })
    expect(
      read.answered && read.findings.map((f) => [f.topic, f.value])
    ).toEqual([['returns', { days: 30 }]])
  })

  it('drops a value whose numbers are not in its quote, a quote of a stray word, and fills in who a claim is about', () => {
    const product = page('/products/field-overshirt', 'product')
    const shipping = page('/pages/shipping', 'shipping')
    const raw = (over: Record<string, unknown>) => ({
      topic: 'free_shipping' as const,
      statement: 'Free shipping.',
      quote: 'Free shipping on orders over $75.',
      confidence: 0.9,
      kind: 'over' as const,
      amount: 75,
      currency: 'USD',
      ...over
    })
    expect(checkedFindings(shipping, [raw({ amount: 7500 })]).kept).toEqual([])
    expect(checkedFindings(shipping, [raw({ quote: '$75' })]).kept).toEqual([])
    // A value off by rounding is the quote's value, to the cent.
    expect(
      checkedFindings(shipping, [raw({ amount: 74.999 })]).kept.map(
        (f) => f.value
      )
    ).toEqual([{ kind: 'over', amount: 75, currency: 'USD' }])
    expect(
      checkedFindings(shipping, [
        raw({
          topic: 'delivery_days',
          quote: 'Delivery takes 3–5 business days in the United States.',
          min: 3,
          max: 7
        })
      ]).kept
    ).toEqual([])
    expect(
      checkedFindings(page('/pages/faq', 'faq'), [
        raw({
          topic: 'guarantee',
          quote:
            'Every piece is covered by our 1-year guarantee against defects.',
          days: 365
        })
      ]).kept.map((f) => f.value)
    ).toEqual([{ days: 365 }])
    expect(
      checkedFindings(product, [
        raw({
          topic: 'claim',
          quote: 'The most comfortable overshirt you will ever wear.',
          subject: undefined
        })
      ]).kept.map((f) => f.value)
    ).toEqual([{ subject: 'product' }])
  })

  it('reads prices with thousands separators', () => {
    const big = readPage(
      '<p>The Cabin Sofa — $1,299.00</p><p>The Lounge Chair — $649.00</p>',
      'https://shop.example/products/sofa',
      'product'
    )
    expect(
      checkedFindings(big, sampleFindings(big))
        .kept.filter((f) => f.topic === 'price_band')
        .map((f) => f.value)
    ).toEqual([{ min: 649, max: 1299, currency: 'USD' }])
  })

  it('leaves a page unread on an unreadable, refused or cut-off answer, and throws a failure worth another try', async () => {
    for (const [run, reason] of [
      [{ ok: false, code: 'invalid_output' }, 'model_unusable'],
      [{ ok: false, code: 'refused' }, 'model_refused'],
      [{ ok: false, code: 'incomplete' }, 'answer_too_long'],
      [gemini({ nonsense: true }), 'model_unusable']
    ] as [AiRun, string][])
      expect(await readSitePage(input, askWith(run), 'k')).toMatchObject({
        answered: false,
        reason
      })
    await expect(
      readSitePage(input, askWith({ ok: false, code: 'rate_limited' }), 'k')
    ).rejects.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it("runs as the workspace's own work on the review purpose, with no thinking", async () => {
    const ai = vi.fn<AiCall>(async () => ({
      ok: true,
      content: { findings: [] },
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      costMicro: 10,
      inputTokens: 100,
      outputTokens: 20,
      settled: true
    }))
    const ask = agentAsk({
      ai,
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      tenantId: 'tenant-1'
    })
    await readSitePage(input, ask, 'site-page:returns:1')
    expect(ai.mock.calls.map(([c]) => [c.tenantId, c.purpose])).toEqual([
      ['tenant-1', 'review']
    ])
    expect(siteReader).toMatchObject({
      temperature: 0,
      reasoningEffort: 'none'
    })
    // The page is data inside the task, never the instructions.
    expect(JSON.parse(siteReader.task(input)).page.text).toContain('30 days')
  })
})
