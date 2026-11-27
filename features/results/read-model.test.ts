import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import type { EmailResult } from './read'
import {
  abResult,
  minClicks,
  minRecipients,
  numbers,
  resultLine,
  resultsReadModel
} from './read-model'

const design = (
  d: 'A' | 'B' | null,
  s: Record<string, number>
): EmailResult['results'][number] => ({
  variation: d ? `Var${d}` : null,
  name: d ? `Design ${d}` : null,
  design: d,
  statistics: s
})
const email = (over: Partial<EmailResult> = {}): EmailResult => ({
  buildId: 'b1',
  runId: 'r1',
  slot: 0,
  sample: false,
  campaignId: 'C1',
  planned: {
    subject: '20% off knitwear',
    date: '2026-11-17',
    emailType: 'offer'
  },
  status: 'sent',
  changed: false,
  designChanged: false,
  designEvidence: false,
  scheduledFor: null,
  sendStrategy: null,
  sentAt: '2026-11-17T18:00:00Z',
  pulls: 3,
  results: [],
  clicks: [],
  complete: true,
  final: true,
  paused: null,
  checkedAt: '2026-11-20T18:00:00Z',
  ...over
})
const a = design('A', {
  recipients: 1000,
  delivered: 980,
  opens_unique: 392,
  clicks_unique: 49,
  conversions: 4,
  conversion_value: 240.5
})
const b = design('B', {
  recipients: 1000,
  delivered: 980,
  opens_unique: 400,
  clicks_unique: 30,
  conversions: 2,
  conversion_value: 120
})

describe('an email’s numbers', () => {
  it('adds up its designs, with rates over delivered emails', () => {
    expect(numbers([a, b])).toEqual({
      recipients: 2000,
      opens: 792,
      clicks: 79,
      orders: 6,
      revenue: 360.5,
      openRate: 792 / 1960,
      clickRate: 79 / 1960
    })
  })

  it('has no orders or revenue when the store’s orders could not be read', () => {
    expect(
      numbers([design(null, { recipients: 100, clicks_unique: 5 })])
    ).toMatchObject({ orders: null, revenue: null })
  })

  it('counts recipients for a row without delivered, row by row', () => {
    const one = design('A', {
      recipients: 100,
      delivered: 50,
      clicks_unique: 10
    })
    const two = design('B', { recipients: 100, clicks_unique: 10 })
    expect(numbers([one, two])?.clickRate).toBe(20 / 150)
  })

  it('uses recipients when delivered is missing, and has no rate without either', () => {
    expect(
      numbers([design(null, { recipients: 200, clicks_unique: 10 })])?.clickRate
    ).toBe(0.05)
    expect(numbers([design(null, {})])).toMatchObject({
      openRate: null,
      clickRate: null
    })
    expect(numbers([])).toBeNull()
  })
})

describe('design A against design B', () => {
  it('names the design with more clicks once final', () => {
    expect(abResult(email({ results: [a, b] }))?.verdict).toBe('a')
    expect(
      abResult(
        email({
          results: [b, design('B', a.statistics)].map((r, i) => ({
            ...r,
            design: i ? 'B' : 'A'
          }))
        })
      )?.verdict
    ).toBe('b')
  })

  it('says "even" within 10% of each other', () => {
    const close = design('B', { ...a.statistics, clicks_unique: 46 })
    expect(abResult(email({ results: [a, close] }))?.verdict).toBe('even')
  })

  it('waits while the results may still change, or too few people got either', () => {
    expect(
      abResult(email({ results: [a, b], final: false, pulls: 1 }))?.verdict
    ).toBe('too_early')
    // Given up early (or deleted): final, but not three reads of a sent email.
    expect(abResult(email({ results: [a, b], pulls: 1 }))?.verdict).toBe(
      'too_early'
    )
    expect(
      abResult(email({ results: [a, b], status: 'deleted' }))?.verdict
    ).toBe('too_early')
    const small = design('B', {
      recipients: minRecipients - 1,
      delivered: minRecipients - 1,
      clicks_unique: 30
    })
    expect(abResult(email({ results: [a, small] }))?.verdict).toBe('too_early')
  })

  it('waits for enough clicks, and counts exactly the minimum of people', () => {
    const few = (d: 'A' | 'B', clicks: number) =>
      design(d, {
        recipients: minRecipients,
        delivered: minRecipients,
        clicks_unique: clicks
      })
    expect(
      abResult(email({ results: [few('A', 10), few('B', 5)] }))?.verdict
    ).toBe('too_early')
    expect(
      abResult(email({ results: [few('A', minClicks), few('B', 5)] }))?.verdict
    ).toBe('a')
  })

  it('is not an A/B email without both designs', () => {
    expect(abResult(email({ results: [a] }))).toBeNull()
  })
})

describe('a Results line', () => {
  it('shows the plan, the status in words, the totals and the best section', () => {
    const line = resultLine(
      email({
        results: [a, b],
        changed: true,
        clicks: [
          {
            variation: 'VarA',
            design: 'A',
            url: 'https://shop.example/p/1',
            section: 1,
            block: 'hero',
            clicks: 30,
            unique: 20
          },
          {
            variation: 'VarB',
            design: 'B',
            url: 'https://shop.example/p/2',
            section: 2,
            block: 'product_grid',
            clicks: 25,
            unique: 20
          },
          {
            variation: 'VarB',
            design: 'B',
            url: 'https://shop.example/p/3',
            section: 2,
            block: 'product_grid',
            clicks: 10,
            unique: 8
          }
        ]
      })
    )
    expect(line).toMatchObject({
      subject: '20% off knitwear',
      plannedDay: '2026-11-17',
      emailType: 'offer',
      statusText: 'Sent (edited in Klaviyo)',
      final: true,
      totals: { recipients: 2000 },
      ab: { verdict: 'a' },
      topSection: { block: 'product_grid', clicks: 35 }
    })
  })

  it.each([
    ['sending', 'Sending'],
    ['cancelled', 'Cancelled in Klaviyo'],
    ['draft', 'Draft in Klaviyo'],
    ['scheduled', 'Scheduled in Klaviyo'],
    ['deleted', 'Deleted in Klaviyo'],
    ['stale', 'Not sent: its day has passed']
  ] as const)('says %s as "%s"', (status, words) => {
    expect(resultLine(email({ status, results: [] }))).toMatchObject({
      statusText: words,
      totals: null,
      ab: null,
      topSection: null
    })
  })
})

describe('the Results page', () => {
  function database(answer: { data: unknown; error: unknown }) {
    const eq = vi.fn()
    const chain = {
      select: () => chain,
      eq: (...args: unknown[]) => (eq(...args), chain),
      order: () => chain,
      limit: async () => answer
    }
    return { db: { from: () => chain } as never, eq }
  }

  it('reads only the workspace’s own emails', async () => {
    const { db, eq } = database({ data: [], error: null })
    expect(await resultsReadModel(db, 'tenant-1')).toEqual([])
    expect(eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
  })

  it('says it could not read the results', async () => {
    const { db } = database({ data: null, error: { code: '42501' } })
    expect(await resultsReadModel(db, 'tenant-1')).toBeNull()
  })
})
