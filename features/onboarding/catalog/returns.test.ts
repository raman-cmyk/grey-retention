// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StoreEvent } from '@/lib/providers/klaviyo/catalog'
import { salesFrom } from './clean'
import { matchReturns, netReport, orderIds } from './returns'

const now = Date.parse('2026-11-11T12:00:00Z')
const day = 86_400_000
const at = (days: number) => new Date(now - days * day).toISOString()
const line = (id: number, quantity: number) => ({
  product_id: id,
  title: `Product ${id}`,
  quantity,
  price: '10.00'
})
/** A Shopify-shaped order: its id in $event_id, its lines in $extra. */
const order = (
  id: string,
  days: number,
  value: number,
  lines: ReturnType<typeof line>[],
  credit: Partial<Pick<StoreEvent, 'messages' | 'flows'>> = {}
): StoreEvent => ({
  at: at(days),
  props: { $event_id: id, $value: value, $extra: { line_items: lines } },
  ...credit
})
const event = (days: number, props: Record<string, unknown>): StoreEvent => ({
  at: at(days),
  props
})

describe('matchReturns', () => {
  const a = order('A1', 3, 40, [line(1, 2), line(2, 2)])
  const b = order('B1', 20, 30, [line(1, 3)])
  const c = order('C1', 40, 50, [line(3, 1)])

  it('takes out a cancelled order and one refunded in full, by the order id', () => {
    const returns = matchReturns(
      [a, b, c],
      [event(1, { ...a.props, Reason: 'customer' })],
      [event(10, { ...b.props })]
    )
    expect(returns).toMatchObject({ cancelled: 1, refunded: 1, unmatched: 0 })
    expect(returns.byOrder.get(a)).toEqual({
      whole: true,
      value: 40,
      units: new Map([
        ['1', 2],
        ['2', 2]
      ])
    })
    expect(returns.byOrder.get(b)?.whole).toBe(true)
    expect(returns.byOrder.has(c)).toBe(false)
    // The best seller loses the units it never sold.
    const sales = salesFrom([a, b, c], now, returns.byOrder)
    expect(sales.get('1')).toMatchObject({ units30d: 0, units90d: 0 })
    expect(sales.get('3')).toMatchObject({ units30d: 0, units90d: 1 })
  })

  it('takes out only the value and the listed units of a partial refund, matched by OrderId', () => {
    const refund = event(1, {
      OrderId: 'B1',
      $event_id: 'R-7',
      $value: 10,
      Items: [{ ProductID: 1, Quantity: 1, ItemPrice: 10 }]
    })
    const returns = matchReturns([a, b], [], [refund])
    expect(returns.byOrder.get(b)).toEqual({
      whole: false,
      value: 10,
      units: new Map([['1', 1]])
    })
    expect(salesFrom([b], now, returns.byOrder).get('1')).toMatchObject({
      units30d: 2,
      units90d: 2
    })
  })

  it('takes no units for a partial refund that repeats the whole order, and adds refunds up', () => {
    const repeat = matchReturns([a], [], [event(1, { ...a.props, $value: 5 })])
    expect(repeat.byOrder.get(a)).toEqual({
      whole: false,
      value: 5,
      units: new Map()
    })
    // Two refunds that come to the order's value refund it in full.
    const twice = matchReturns(
      [b],
      [],
      [
        event(5, { OrderId: 'B1', $value: 20 }),
        event(2, { OrderId: 'B1', $value: 10 })
      ]
    )
    expect(twice).toMatchObject({ refunded: 1 })
    expect(twice.byOrder.get(b)).toMatchObject({ whole: true, value: 30 })
    // A refund that does not say how much is of the whole order.
    const unsaid = matchReturns([b], [], [event(2, { $event_id: 'B1' })])
    expect(unsaid.byOrder.get(b)?.whole).toBe(true)
  })

  it('counts an order cancelled and refunded once, and changes nothing for an order not read', () => {
    const returns = matchReturns(
      [a],
      [event(2, { $event_id: 'A1' }), event(2, { $event_id: 'OLD-9' })],
      [event(1, { $event_id: 'A1', $value: 40 })]
    )
    expect(returns).toMatchObject({ cancelled: 1, refunded: 0, unmatched: 1 })
    expect(returns.byOrder.size).toBe(1)
    expect(matchReturns([a], [], []).byOrder.size).toBe(0)
  })

  it('reads the order ids an integration and Shopify send', () => {
    expect(orderIds({ OrderId: 1234, $event_id: '1234' })).toEqual(['1234'])
    expect(orderIds({ OrderId: 'X-1', $event_id: 'R-1' })).toEqual([
      'X-1',
      'R-1'
    ])
    expect(orderIds({ $event_id: '', OrderId: { id: 1 } })).toEqual([])
  })
})

describe('netReport', () => {
  const row = (
    key: string,
    id: string,
    conversions: number,
    value: number
  ) => ({
    groupings: { [key]: id },
    statistics: {
      recipients: 1000,
      conversions,
      conversion_value: value,
      revenue_per_recipient: value / 1000
    }
  })
  const email = order('A1', 3, 400, [line(1, 1)], { messages: ['Msg1'] })
  const partly = order('B1', 3, 200, [line(1, 1)], { messages: ['Msg1'] })
  const flowOrder = order('C1', 30, 300, [line(1, 1)], { flows: ['Flw1'] })
  const old = order('D1', 120, 100, [line(1, 1)], { flows: ['Flw1'] })
  const returns = matchReturns(
    [email, partly, flowOrder, old],
    [event(1, { $event_id: 'A1' }), event(1, { $event_id: 'D1' })],
    [
      event(1, { OrderId: 'B1', $value: 50 }),
      event(1, { $event_id: 'C1', $value: 300 })
    ]
  )

  it('takes each order off the email credited with it, and its revenue per recipient', () => {
    const [netted, other] = netReport(
      [
        row('campaign_message_id', 'Msg1', 10, 1000),
        row('campaign_message_id', 'Msg2', 5, 500)
      ],
      returns,
      'campaign_message_id',
      now - 365 * day
    )
    expect(netted!.statistics).toEqual({
      recipients: 1000,
      conversions: 9,
      conversion_value: 550,
      revenue_per_recipient: 0.55
    })
    expect(other!.statistics.conversions).toBe(5)
  })

  it("takes a flow's orders off its rows in turn, never below 0, only within the report's days", () => {
    const rows = netReport(
      [row('flow_id', 'Flw1', 1, 120), row('flow_id', 'Flw1', 4, 500)],
      returns,
      'flow_id',
      now - 90 * day
    )
    // The 120-day-old order was not in the 90 days: only the $300 one.
    expect(
      rows.map((r) => [r.statistics.conversions, r.statistics.conversion_value])
    ).toEqual([
      [0, 0],
      [4, 320]
    ])
  })
})
