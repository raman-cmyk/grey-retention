// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  findingInput,
  findingSources,
  findingTopics,
  listFindings,
  sourceTopics,
  topicValues
} from './findings'

const migrations = path.join(process.cwd(), 'supabase/migrations')
// The findings migrations in order: a later one may widen a list.
const sql = readdirSync(migrations)
  .filter((f) =>
    /_(brand_findings|klaviyo_history|ads_reading|reviews_reading)\.sql$/.test(
      f
    )
  )
  .sort()
  .map((f) => readFileSync(path.join(migrations, f), 'utf8'))
  .join('\n')
/** The list in the last statement that matches (the one in force). */
const listIn = (pattern: RegExp) =>
  [...sql.matchAll(new RegExp(pattern.source, 'g'))]
    .at(-1)?.[1]
    ?.match(/'([a-z_]+)'/g)
    ?.map((v) => v.slice(1, -1))

const finding = (over: Record<string, unknown> = {}) => ({
  topic: 'returns',
  statement: 'Returns within 30 days.',
  value: { days: 30 },
  evidence: {
    url: 'https://cedar-lane.example/pages/returns',
    quote: 'Return any unworn item within 30 days for a full refund.',
    page: 'returns'
  },
  confidence: 0.7,
  ...over
})

describe('the findings contract', () => {
  it('has the same sources, topics and site topics as the database', () => {
    expect(sql).not.toBe('')
    expect(
      listIn(/source text not null check \(source in \(([^)]+)\)/)
    ).toEqual([...findingSources])
    expect(
      listIn(
        /(?:topic text not null check|brand_findings_topic_check check) \(topic in \(([^)]+)\)/
      )?.sort()
    ).toEqual([...findingTopics].sort())
    expect(listIn(/check \(source <> 'site' or topic in \(([^)]+)\)/)).toEqual([
      ...sourceTopics.site
    ])
    expect(
      listIn(/check \(source <> 'klaviyo_history' or topic in \(([^)]+)\)/)
    ).toEqual([...sourceTopics.klaviyo_history])
    expect(listIn(/check \(source <> 'ads' or topic in \(([^)]+)\)/)).toEqual([
      ...sourceTopics.ads
    ])
    for (const source of ['reviews', 'social'] as const)
      expect(
        listIn(
          new RegExp(`check \\(source <> '${source}' or topic in \\(([^)]+)\\)`)
        )
      ).toEqual([...sourceTopics[source]])
    for (const topic of findingTopics)
      expect(sql, topic).toMatch(new RegExp(`'${topic}'`))
  })

  it('gives each topic one value shape, money in major units with its currency', () => {
    const good: Record<string, unknown[]> = {
      free_shipping: [
        { kind: 'always' },
        { kind: 'never' },
        { kind: 'over', amount: 75, currency: 'USD' },
        { kind: 'over', amount: 24.5, currency: 'EUR' }
      ],
      returns: [{ days: 0 }, { days: 30 }],
      guarantee: [{ days: 365 }],
      delivery_days: [
        { min: 3, max: 5 },
        { min: 1, max: 2, region: 'United States' }
      ],
      locale: [{ language: 'en', currency: 'USD' }],
      price_band: [{ min: 89, max: 120, currency: 'USD' }],
      claim: [{ subject: 'brand' }, { subject: 'product', productId: 'p1' }],
      review_platform: [
        { name: 'Judge.me', verified: true, rating: 4.8, count: 1200 }
      ],
      shipping: [{}],
      tone: [{}],
      promotion: [
        { kind: 'percent_off', percent: 20 },
        { kind: 'amount_off', amount: 10, currency: 'USD' },
        { kind: 'gift' },
        { kind: 'bundle' }
      ],
      angle: [{}],
      creative: [{}],
      landing_page: [
        { url: 'https://cedar-lane.example/collections/knitwear' }
      ],
      review_theme: [{}],
      objection: [{}],
      customer_words: [{}],
      quotable_review: [
        { author: 'Maya R.', url: 'https://cedar-lane.example/products/knit' },
        {
          author: 'Maya R.',
          url: 'https://cedar-lane.example/products/knit',
          rating: 5,
          date: '2026-10-01'
        }
      ]
    }
    const bad: Record<string, unknown[]> = {
      free_shipping: [
        { kind: 'over', amount: 75 },
        { kind: 'over', currency: 'USD' },
        { kind: 'over', amount: -1, currency: 'USD' },
        { kind: 'sometimes' }
      ],
      returns: [{ days: 30.5 }, { days: -1 }, {}],
      delivery_days: [{ min: 5, max: 3 }],
      locale: [
        { language: 'English', currency: 'USD' },
        { language: 'en', currency: 'usd' }
      ],
      price_band: [{ min: 120, max: 89, currency: 'USD' }],
      claim: [{ subject: 'everyone' }, {}],
      review_platform: [{ name: 'Judge.me' }],
      shipping: [{ days: 3 }],
      promotion: [
        { kind: 'percent_off' },
        { kind: 'percent_off', percent: 95 },
        { kind: 'percent_off', percent: 12.5 },
        { kind: 'amount_off', amount: 10 },
        { kind: 'free_shipping' },
        { kind: 'gift', percent: 10 }
      ],
      angle: [{ why: 'gifts' }],
      landing_page: [
        { url: 'http://cedar-lane.example/' },
        { url: 'nope' },
        {}
      ],
      objection: [{ why: 'size' }],
      quotable_review: [
        { url: 'https://cedar-lane.example/p' },
        { author: '', url: 'https://cedar-lane.example/p' },
        { author: 'Maya', url: 'http://cedar-lane.example/p' },
        { author: 'Maya', url: 'https://cedar-lane.example/p', rating: 4.5 },
        { author: 'Maya', url: 'https://cedar-lane.example/p', date: 'Oct 1' },
        { author: 'Maya', url: 'https://cedar-lane.example/p', text: 'x' }
      ]
    }
    for (const [topic, values] of Object.entries(good))
      for (const v of values)
        expect(
          topicValues[topic as keyof typeof topicValues].safeParse(v).success,
          `${topic} ${JSON.stringify(v)}`
        ).toBe(true)
    for (const [topic, values] of Object.entries(bad))
      for (const v of values)
        expect(
          topicValues[topic as keyof typeof topicValues].safeParse(v).success,
          `${topic} ${JSON.stringify(v)}`
        ).toBe(false)
  })

  it('takes a finding only with a value of its own shape and evidence', () => {
    expect(findingInput.safeParse(finding()).success).toBe(true)
    for (const over of [
      { value: { days: 'thirty' } },
      { topic: 'mood' },
      { evidence: { url: 'not a url', quote: 'x' } },
      { evidence: { url: 'https://cedar-lane.example/', quote: '' } },
      { confidence: 1.5 },
      { statement: 'x'.repeat(301) }
    ])
      expect(
        findingInput.safeParse(finding(over)).success,
        JSON.stringify(over)
      ).toBe(false)
    expect(
      findingInput.safeParse(finding({ evidence: { ref: 'catalog:item:1' } }))
        .success
    ).toBe(true)
  })
})

describe('listFindings', () => {
  function database(rows: unknown[]) {
    const calls: [string, ...unknown[]][] = []
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'is', 'order', 'limit', 'gte'])
      chain[name] = (...args: unknown[]) => {
        calls.push([name, ...args])
        return chain
      }
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null })
    const from = vi.fn(() => chain)
    return {
      calls,
      from,
      db: { from } as unknown as Parameters<typeof listFindings>[0]
    }
  }
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    run_id: 'j1',
    source: 'site',
    topic: 'returns',
    statement: 'Returns within 30 days.',
    value: { days: 30 },
    evidence: finding().evidence,
    confidence: '0.70',
    pass: 'sample',
    model: null,
    created_at: '2026-11-11T09:00:00Z',
    ...over
  })

  it('reads the current findings, newest first, with the filters asked for', async () => {
    const { db, calls, from } = database([row()])
    expect(
      await listFindings(db, 't1', {
        source: 'site',
        topic: 'returns',
        minConfidence: 0.6
      })
    ).toEqual([
      {
        id: 'f1',
        runId: 'j1',
        source: 'site',
        topic: 'returns',
        statement: 'Returns within 30 days.',
        value: { days: 30 },
        evidence: finding().evidence,
        confidence: 0.7,
        pass: 'sample',
        model: null,
        createdAt: '2026-11-11T09:00:00Z'
      }
    ])
    expect(from).toHaveBeenCalledWith('brand_findings')
    expect(calls).toEqual(
      expect.arrayContaining([
        ['eq', 'tenant_id', 't1'],
        ['is', 'superseded_at', null],
        ['order', 'created_at', { ascending: false }],
        ['eq', 'source', 'site'],
        ['eq', 'topic', 'returns'],
        ['gte', 'confidence', 0.6]
      ])
    )
  })

  it('skips a stored row that no longer reads as a finding', async () => {
    const { db } = database([row(), row({ id: 'f2', value: { days: 'x' } })])
    expect((await listFindings(db, 't1')).map((f) => f.id)).toEqual(['f1'])
  })
})
