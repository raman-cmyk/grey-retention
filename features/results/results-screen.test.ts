// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ResultLine } from './read-model'
import { money, percent, resultEmail, resultsScreen } from './results-screen'
import { loadResultsScreen } from './results-screen-load'

vi.mock('server-only', () => ({}))

const tenant = '00000000-0000-4000-8000-000000000101'
const usd = { currency: 'USD', timezone: 'UTC' }
const plain = { currency: null, timezone: 'UTC' }
const n = (over: Partial<ResultLine['totals'] & object> = {}) => ({
  recipients: 1240,
  opens: 471,
  clicks: 26,
  orders: 9,
  revenue: 412,
  openRate: 0.38,
  clickRate: 0.021,
  ...over
})
const line = (over: Partial<ResultLine> = {}): ResultLine => ({
  buildId: 'b1',
  subject: '20% off knitwear',
  plannedDay: '2026-11-17',
  emailType: 'offer',
  status: 'sent',
  statusText: 'Sent',
  edited: false,
  scheduledFor: null,
  sendStrategy: null,
  sentAt: '2026-11-17T18:00:00Z',
  final: true,
  complete: true,
  sample: false,
  totals: n(),
  ab: null,
  topSection: { block: 'product_feature', clicks: 14 },
  ...over
})

describe('the Results page (UI-RES-a)', () => {
  it('says when results cannot be read, or nothing went to Klaviyo yet', () => {
    expect(resultsScreen(null, usd)).toEqual({ kind: 'error' })
    expect(resultsScreen([], usd)).toEqual({ kind: 'empty' })
  })

  it('shows a sent email’s numbers the short way', () => {
    expect(resultEmail(line(), usd)).toEqual({
      buildId: 'b1',
      title: '20% off knitwear',
      day: 'Tue 17',
      state: 'sent',
      status: 'sent',
      statusText: 'Sent',
      numbers: {
        sent: '1,240',
        opened: '38%',
        clicked: '2.1%',
        sales: '$412',
        orders: '9'
      },
      note: null,
      ab: null,
      topSection: 'The products got the most clicks (14).',
      sample: false
    })
  })

  it('says how sure the numbers are, never a made-up 0', () => {
    expect(resultEmail(line({ final: false }), usd).note).toBe(
      'Numbers can still change: they are read for three days after the send.'
    )
    expect(resultEmail(line({ complete: false }), usd).note).toBe(
      'Some numbers could not be read from Klaviyo.'
    )
    expect(resultEmail(line({ totals: null }), usd)).toMatchObject({
      numbers: null,
      note: 'Klaviyo has no numbers for it yet.'
    })
    // Orders not read: no sales, no orders, the rest still shown.
    expect(
      resultEmail(line({ totals: n({ orders: null, revenue: null }) }), usd)
        .numbers
    ).toMatchObject({ sent: '1,240', sales: null, orders: null })
  })

  it('sorts emails into sent, waiting and the rest, and names the day', () => {
    const screen = resultsScreen(
      [
        line(),
        line({
          buildId: 'b2',
          status: 'scheduled',
          statusText: 'Scheduled in Klaviyo',
          sentAt: null,
          plannedDay: '2026-11-20',
          totals: null,
          topSection: null
        }),
        line({
          buildId: 'b3',
          status: 'stale',
          statusText: 'Not sent: its day has passed',
          sentAt: null,
          subject: null,
          totals: null,
          topSection: { block: 'unknown_block', clicks: 3 }
        })
      ],
      plain
    )
    if (screen.kind !== 'results') throw new Error('expected results')
    expect(screen.counts).toEqual({
      sent: 1,
      scheduled: 1,
      draft: 0,
      sample: 0,
      other: 1
    })
    expect(screen.sample).toBe(false)
    expect(screen.emails[1]).toMatchObject({
      state: 'scheduled',
      day: 'Fri 20',
      note: null
    })
    expect(screen.emails[2]).toMatchObject({
      state: 'other',
      title: 'An email from your plan',
      topSection: null
    })
    // No currency known: the plain amount.
    expect(screen.emails[0].numbers?.sales).toBe('412.00')
  })

  it('says which version won, or why it is too early', () => {
    const ab = (verdict: 'a' | 'b' | 'even' | 'too_early') =>
      resultEmail(
        line({
          ab: {
            a: n({ recipients: 600, clickRate: 0.018 }),
            b: n({ recipients: 640, clickRate: 0.024 }),
            verdict
          }
        }),
        usd
      ).ab
    expect(ab('b')).toMatchObject({
      verdict: 'Version B got more clicks: 2.4% against 1.8%.',
      winner: 'b',
      a: { sent: '600' },
      b: { sent: '640' }
    })
    expect(ab('a')?.verdict).toBe(
      'Version A got more clicks: 1.8% against 2.4%.'
    )
    expect(ab('even')).toMatchObject({
      verdict: 'Versions A and B got about the same clicks.',
      winner: null
    })
    expect(ab('too_early')?.verdict).toBe(
      'Too few people or clicks to pick a winner: it takes 100 people on each version and 30 clicks.'
    )
    // Still being read: too early, not too few.
    expect(
      resultEmail(
        line({
          final: false,
          ab: { a: n(), b: n(), verdict: 'too_early' }
        }),
        usd
      ).ab?.verdict
    ).toBe(
      'Too early to pick a winner: it takes three days of results, 100 people on each version and 30 clicks.'
    )
  })

  it('never shows a sample email as sent, alone or among real ones', () => {
    const all = resultsScreen([line({ sample: true })], usd)
    const mixed = resultsScreen(
      [line({ sample: true }), line({ buildId: 'b2' })],
      usd
    )
    expect(all.kind === 'results' && all.sample).toBe(true)
    if (mixed.kind !== 'results') throw new Error('expected results')
    expect(mixed.sample).toBe(false)
    expect(mixed.counts).toMatchObject({ sent: 1, sample: 1 })
    expect(mixed.emails[0]).toMatchObject({
      state: 'sample',
      statusText: 'Sample: not sent',
      topSection: null,
      note: 'A sample: this email was never sent, and its numbers are examples.'
    })
  })

  it('tells a draft to schedule from a scheduled one, and an email still sending', () => {
    expect(
      resultEmail(
        line({ status: 'draft', statusText: 'Draft in Klaviyo', totals: null }),
        usd
      )
    ).toMatchObject({
      state: 'draft',
      statusText: 'Draft in Klaviyo: ready for you to schedule'
    })
    expect(
      resultEmail(
        line({ status: 'draft', statusText: 'Draft in Klaviyo', totals: null }),
        { ...usd, today: '2026-11-18' }
      ).statusText
    ).toBe('Draft in Klaviyo: its planned day has passed')
    expect(
      resultEmail(line({ status: 'sending', statusText: 'Sending' }), usd)
    ).toMatchObject({
      state: 'sent',
      note: 'Still sending: the numbers will change.'
    })
    expect(resultEmail(line({ final: false, complete: false }), usd).note).toBe(
      'Numbers can still change: they are read for three days after the send. Some numbers could not be read from Klaviyo.'
    )
  })

  it('says when Klaviyo will send a scheduled email, in store time, and an edited draft (PICK-99)', () => {
    expect(
      resultEmail(
        line({
          status: 'scheduled',
          statusText: 'Scheduled in Klaviyo',
          scheduledFor: '2026-11-21T02:00:00Z',
          sendStrategy: 'static',
          totals: null
        }),
        { currency: 'USD', timezone: 'America/Los_Angeles' }
      ).statusText
    ).toBe('Scheduled in Klaviyo for 20 Nov, 18:00 (store time)')
    expect(
      resultEmail(
        line({
          status: 'draft',
          statusText: 'Draft in Klaviyo (edited in Klaviyo)',
          edited: true,
          totals: null
        }),
        usd
      ).statusText
    ).toBe('Draft in Klaviyo (edited in Klaviyo)')
  })

  it('names the send day in the store’s time zone', () => {
    // 6 pm in Los Angeles on Tue 17 is Wed 18 in UTC.
    const at = line({
      sentAt: '2026-11-18T02:00:00Z',
      plannedDay: '2026-11-17'
    })
    expect(resultEmail(at, usd).day).toBe('Wed 18')
    expect(
      resultEmail(at, { currency: 'USD', timezone: 'America/Los_Angeles' }).day
    ).toBe('Tue 17')
  })

  it('never shows a rate Klaviyo did not give as 0%', () => {
    expect(
      resultEmail(line({ totals: n({ openRate: null, clickRate: null }) }), usd)
        .numbers
    ).toMatchObject({ opened: null, clicked: null })
  })

  it('writes rates and money the short way', () => {
    expect(percent(0.38)).toBe('38%')
    expect(percent(0.0213)).toBe('2.1%')
    expect(percent(null)).toBeNull()
    expect(money(412, 'USD')).toBe('$412')
    expect(money(412.5, 'EUR')).toBe('€412.50')
    expect(money(412, 'usd')).toBe('412.00')
    expect(money(null, 'USD')).toBeNull()
    // A currency's own decimals.
    expect(money(412.5, 'JPY')).toBe('¥413')
    expect(money(412, 'JPY')).toBe('¥412')
  })
})

/** A query that answers each table once awaited, and records its calls. */
function fakeDb(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: [string, unknown[]][] = []
  const db = {
    from: (table: string) => {
      calls.push(['from', [table]])
      const result = results[table]
      const query: Record<string, unknown> = {
        then: (done: (r: unknown) => unknown) =>
          Promise.resolve(result).then(done),
        maybeSingle: () => Promise.resolve(result)
      }
      for (const name of ['select', 'eq', 'order', 'limit'])
        query[name] = (...args: unknown[]) => {
          calls.push([name, args])
          return query
        }
      return query
    }
  }
  return { db: db as never, calls }
}

const stored = {
  build_id: 'b1',
  run_id: 'r1',
  slot: 0,
  sample: false,
  campaign_id: 'C1',
  planned: { subject: '20% off knitwear', date: '2026-11-17' },
  status: 'sent',
  changed: false,
  sent_at: '2026-11-17T18:00:00Z',
  pulls: 3,
  results: [
    {
      variation: null,
      name: null,
      design: null,
      statistics: {
        recipients: 100,
        delivered: 100,
        opens_unique: 40,
        clicks_unique: 5,
        conversions: 2,
        conversion_value: 80
      }
    }
  ],
  clicks: [],
  complete: true,
  final: true,
  paused: null,
  checked_at: null
}

describe('loading the Results page (UI-RES-a)', () => {
  it('reads the workspace’s lines and its Klaviyo currency, tenant first', async () => {
    const { db, calls } = fakeDb({
      klaviyo_email_results: { data: [stored], error: null },
      workspace_connections: { data: { account_currency: 'GBP' }, error: null }
    })
    const screen = await loadResultsScreen(db, tenant)
    expect(screen.kind === 'results' && screen.emails[0].numbers).toEqual({
      sent: '100',
      opened: '40%',
      clicked: '5%',
      sales: '£80',
      orders: '2'
    })
    expect(calls.filter(([c]) => c === 'eq')).toEqual([
      ['eq', ['tenant_id', tenant]],
      ['eq', ['tenant_id', tenant]],
      ['eq', ['provider', 'klaviyo']],
      ['eq', ['id', tenant]]
    ])
  })

  it('shows plain amounts when the currency cannot be read, and an error when the lines cannot', async () => {
    const plain = await loadResultsScreen(
      fakeDb({
        klaviyo_email_results: { data: [stored], error: null },
        workspace_connections: { data: null, error: { message: 'x' } }
      }).db,
      tenant
    )
    expect(plain.kind === 'results' && plain.emails[0].numbers?.sales).toBe(
      '80.00'
    )
    expect(
      await loadResultsScreen(
        fakeDb({
          klaviyo_email_results: { data: null, error: { message: 'x' } },
          workspace_connections: { data: null, error: null }
        }).db,
        tenant
      )
    ).toEqual({ kind: 'error' })
  })
})
