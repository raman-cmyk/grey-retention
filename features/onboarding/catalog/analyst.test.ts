// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import {
  agentAsk,
  sampleAsk,
  type Ask,
  type AiRun
} from '@/features/intelligence/passes'
import {
  analyseCatalog,
  analystInput,
  analystProducts,
  catalogAnalyst,
  sampleOffering
} from './analyst'
import type { Listed } from './clean'

const product = (id: string, title: string, units = 0, price = 45): Listed => ({
  externalId: id,
  title,
  url: `https://cedar.example/products/${id}`,
  image: 'https://cedar.example/i.jpg',
  price,
  compareAt: null,
  saleSeen: false,
  published: true,
  launchedAt: null,
  stock: null,
  variantCount: 1,
  units30d: units,
  units90d: units
})
const products = [
  product('a', 'Canvas Tote', 3),
  product('b', 'Canvas Tote', 1),
  product('c', 'Field Overshirt', 5, 89)
]
const input = analystInput('Cedar Goods', 'USD', products)
const answering = (run: AiRun) => vi.fn(async () => run) as unknown as Ask

describe('the Catalog analyst', () => {
  it('sees the best sellers first, with ids, titles, prices and sales only', () => {
    expect(input.products).toEqual([
      { id: 'c', title: 'Field Overshirt', price: 89, sold90d: 5 },
      { id: 'a', title: 'Canvas Tote', price: 45, sold90d: 3 },
      { id: 'b', title: 'Canvas Tote', price: 45, sold90d: 1 }
    ])
    const many = Array.from({ length: 200 }, (_, i) =>
      product(`p${i}`, `P ${i}`)
    )
    expect(analystInput('B', 'USD', many).products).toHaveLength(
      analystProducts
    )
    // The titles are data inside the task, never the instructions.
    expect(JSON.parse(catalogAnalyst.task(input)).products[0].title).toBe(
      'Field Overshirt'
    )
    expect(catalogAnalyst).toMatchObject({
      purpose: 'review',
      temperature: 0,
      reasoningEffort: 'none'
    })
  })

  it('uses the sample rules when the AI is the fake', async () => {
    expect(
      await analyseCatalog(input, products, sampleAsk, 'catalog:1')
    ).toEqual({
      answered: true,
      duplicates: [{ keep: 'a', drop: 'b' }],
      offering: {
        statement: 'Sells products such as Field Overshirt and Canvas Tote.',
        confidence: 0.6
      },
      pass: 'sample',
      model: null
    })
    expect(sampleOffering([])).toBeNull()
  })

  it("checks a model's answer: real alike duplicates, a plain sentence, a confidence of at most 0.9", async () => {
    const read = await analyseCatalog(
      input,
      products,
      answering({
        ok: true,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        content: {
          duplicates: [
            { keep: 'b', drop: 'a' },
            { keep: 'c', drop: 'a' }
          ],
          offering: {
            statement: 'Sells canvas bags and overshirts.',
            confidence: 1
          }
        }
      }),
      'catalog:1'
    )
    expect(read).toEqual({
      answered: true,
      duplicates: [{ keep: 'a', drop: 'b' }],
      offering: {
        statement: 'Sells canvas bags and overshirts.',
        confidence: 0.9
      },
      pass: 'model',
      model: 'gemini-2.5-flash'
    })
    for (const statement of [
      'Sells the best bags in town.',
      'Sells bags from $45.',
      'Sells 3 kinds of bags.',
      'Award winning canvas bags.'
    ]) {
      const claim = await analyseCatalog(
        input,
        products,
        answering({
          ok: true,
          provider: 'gemini',
          model: 'm',
          content: { duplicates: [], offering: { statement, confidence: 0.8 } }
        }),
        'k'
      )
      expect(claim.answered && claim.offering, statement).toBeNull()
    }
  })

  it('says why there is no analysis, and never throws', async () => {
    for (const [run, reason] of [
      [{ ok: false, code: 'incomplete' }, 'answer_too_long'],
      [{ ok: false, code: 'refused' }, 'model_refused'],
      [{ ok: false, code: 'invalid_output' }, 'model_unusable'],
      [{ ok: false, code: 'cap_reached' }, 'budget_spent'],
      [{ ok: false, code: 'unavailable' }, 'model_failed'],
      [
        {
          ok: true,
          provider: 'gemini',
          model: 'm',
          content: { duplicates: 'x' }
        },
        'model_unusable'
      ]
    ] as [AiRun, string][])
      expect(
        await analyseCatalog(input, products, answering(run), 'k')
      ).toEqual({
        answered: false,
        reason
      })
    const broken = (async () => {
      throw new Error('network')
    }) as Ask
    expect(await analyseCatalog(input, products, broken, 'k')).toEqual({
      answered: false,
      reason: 'model_failed'
    })
  })

  it("runs as the workspace's own work on the review purpose", async () => {
    const ai = vi.fn<AiCall>(async () => ({
      ok: true,
      content: {
        duplicates: [],
        offering: { statement: 'Sells canvas bags.', confidence: 0.7 }
      },
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
    await analyseCatalog(input, products, ask, 'catalog:job-1')
    expect(ai.mock.calls.map(([c]) => [c.tenantId, c.purpose])).toEqual([
      ['tenant-1', 'review']
    ])
  })
})
