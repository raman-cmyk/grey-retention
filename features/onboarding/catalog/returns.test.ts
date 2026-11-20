// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { StoreEvent } from '@/lib/providers/klaviyo/catalog'
import { salesFrom } from './clean'
import { matchReturns, orderId, returnsState } from './returns'

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
  lines: ReturnType<typeof line>[]
): StoreEvent => ({
  at: at(days),
  props: { $event_id: id, $value: value, $extra: { line_items: lines } }
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

  it('takes a negative amount as the amount, and nothing off for a refund of 0', () => {
    for (const value of [-10, '-10.00'])
      expect(
        matchReturns(
          [b],
          [],
          [event(1, { OrderId: 'B1', $value: value })]
        ).byOrder.get(b)
      ).toEqual({ whole: false, value: 10, units: new Map() })
    const lines = { Items: [{ ProductID: 1, Quantity: 2 }] }
    const zero = matchReturns(
      [b],
      [],
      [event(1, { OrderId: 'B1', $value: 0, ...lines })]
    )
    expect(zero).toMatchObject({ refunded: 0 })
    expect(zero.byOrder.size).toBe(0)
  })

  it('takes only the lines a refund lists when it says no amount: their prices, or no money', () => {
    const priced = matchReturns(
      [b],
      [],
      [
        event(1, {
          OrderId: 'B1',
          Items: [{ ProductID: 1, Quantity: 1, ItemPrice: 10 }]
        })
      ]
    )
    expect(priced.byOrder.get(b)).toEqual({
      whole: false,
      value: 10,
      units: new Map([['1', 1]])
    })
    const unpriced = matchReturns(
      [b],
      [],
      [event(1, { OrderId: 'B1', Items: [{ ProductID: 1, Quantity: 2 }] })]
    )
    expect(unpriced.byOrder.get(b)).toEqual({
      whole: false,
      value: 0,
      units: new Map([['1', 2]])
    })
    // An order that said no value counted none: no money comes off it.
    const noValue = order('N1', 2, 0, [line(1, 2)])
    delete noValue.props.$value
    expect(
      matchReturns(
        [noValue],
        [],
        [event(1, { OrderId: 'N1', $value: 5 })]
      ).byOrder.get(noValue)
    ).toMatchObject({ whole: false, value: 0 })
  })

  it('matches an OrderId only to that order, and Shopify’s $event_id otherwise', () => {
    expect(orderId({ OrderId: 1234, $event_id: 'R-1' })).toBe('1234')
    expect(orderId({ $event_id: 'A1' })).toBe('A1')
    expect(orderId({ OrderId: { id: 1 }, $event_id: 'A1' })).toBeNull()
    // A refund whose own OrderId is another order's never falls back.
    const other = matchReturns(
      [a],
      [],
      [event(1, { OrderId: 'X-9', $event_id: 'A1', $value: 40 })]
    )
    expect(other).toMatchObject({ refunded: 0, unmatched: 1 })
  })
})

describe('returnsState', () => {
  const read = (records: number, complete: boolean, skipped = 0) => ({
    records: Array.from({ length: records }, () => event(1, {})),
    complete,
    skipped
  })
  const none = matchReturns([], [], [])
  const unmatched = { ...none, unmatched: 1 }

  it('is whole when every part was read and each found its order, or all the orders were read', () => {
    expect(returnsState([read(2, true), read(0, true)], none, false)).toBe(
      'whole'
    )
    expect(returnsState([read(2, true)], unmatched, true)).toBe('whole')
  })

  it('is partial when a part was cut short, a record skipped or one left unmatched in a cut read', () => {
    expect(returnsState([read(2, false)], none, true)).toBe('partial')
    expect(returnsState([read(2, true, 1)], none, true)).toBe('partial')
    expect(returnsState([read(2, true)], unmatched, false)).toBe('partial')
    expect(returnsState([read(0, false), read(1, true)], none, true)).toBe(
      'partial'
    )
  })

  it('is unread when Klaviyo answered none of the parts', () => {
    expect(returnsState([read(0, false), read(0, false)], none, true)).toBe(
      'unread'
    )
  })
})
