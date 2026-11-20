import type { StoreEvent } from '@/lib/providers/klaviyo/catalog'
import type { ReportRow } from '@/lib/providers/klaviyo/history'
import { moneyOf, orderLines } from './clean'

/**
 * Cancelled and refunded orders (ONB-ORD), matched to the Placed Order
 * events read by the order's id: an integration's `OrderId`, or Klaviyo's
 * `$event_id` (Shopify's order id, on its Placed, Cancelled and Refunded
 * Order events). A cancel, or a refund of the whole order, takes the order
 * out: its units, its count and its value. A partial refund takes out only
 * its value, and the units of the lines it lists. A cancel or refund of an
 * order that was not read (placed before the window) changes nothing.
 */

/** What comes off one order. */
export type Undo = {
  /** Cancelled or refunded in full: the order no longer counts. */
  whole: boolean
  /** The money that comes off, in major units (the order's when whole). */
  value: number
  /** Units that come off per product id (every line's when whole). */
  units: Map<string, number>
}

export type Returns = {
  /** Per order read (the same objects as the orders given). */
  byOrder: Map<StoreEvent, Undo>
  cancelled: number
  refunded: number
  /** Cancels and refunds whose order was not read. */
  unmatched: number
}

const idOf = (value: unknown) => {
  const raw =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''
  return raw.length >= 1 && raw.length <= 120 ? raw : null
}

/** The ids an order's event goes by. */
export const orderIds = (props: Record<string, unknown>) => [
  ...new Set([props.OrderId, props.$event_id].flatMap((v) => idOf(v) ?? []))
]

/** Units per product id in an event's lines. */
function unitsOf(event: StoreEvent) {
  const units = new Map<string, number>()
  for (const line of orderLines(event.props))
    units.set(line.id, (units.get(line.id) ?? 0) + line.quantity)
  return units
}
const same = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([id, n]) => b.get(id) === n)

export function matchReturns(
  orders: StoreEvent[],
  cancels: StoreEvent[],
  refunds: StoreEvent[]
): Returns {
  const byId = new Map<string, StoreEvent>()
  for (const order of orders)
    for (const id of orderIds(order.props))
      if (!byId.has(id)) byId.set(id, order)
  const find = (e: StoreEvent) =>
    orderIds(e.props)
      .map((id) => byId.get(id))
      .find((o) => o !== undefined)
  let unmatched = 0
  const group = (events: StoreEvent[]) => {
    const by = new Map<StoreEvent, StoreEvent[]>()
    for (const e of events) {
      const order = find(e)
      if (order) by.set(order, [...(by.get(order) ?? []), e])
      else unmatched++
    }
    return by
  }
  const cancelled = group(cancels)
  const refunded = group(refunds)
  const byOrder = new Map<StoreEvent, Undo>()
  const whole = (order: StoreEvent): Undo => ({
    whole: true,
    value: moneyOf(order.props.$value) ?? 0,
    units: unitsOf(order)
  })
  for (const order of cancelled.keys()) byOrder.set(order, whole(order))
  for (const [order, events] of refunded) {
    if (byOrder.has(order)) continue
    const total = moneyOf(order.props.$value)
    const values = events.map((e) => moneyOf(e.props.$value))
    // A refund that does not say how much is of the whole order (Shopify
    // sends only full refunds).
    const value = values.includes(null)
      ? null
      : values.reduce<number>((sum, v) => sum + v!, 0)
    if (value === null || (total !== null && value >= total - 0.005)) {
      byOrder.set(order, whole(order))
      continue
    }
    // Partly refunded: its value, and the units of the lines a refund
    // lists, unless it only repeats the whole order's lines.
    const own = unitsOf(order)
    const units = new Map<string, number>()
    for (const e of events) {
      const lines = unitsOf(e)
      if (same(lines, own)) continue
      for (const [id, n] of lines)
        if (own.has(id))
          units.set(id, Math.min(own.get(id)!, (units.get(id) ?? 0) + n))
    }
    byOrder.set(order, { whole: false, value, units })
  }
  return {
    byOrder,
    cancelled: cancelled.size,
    refunded: [...refunded.keys()].filter((o) => !cancelled.has(o)).length,
    unmatched
  }
}

/**
 * A report's rows with the cancelled and refunded orders taken off the
 * email or flow Klaviyo credited with each (orders placed since `since`,
 * the report's own timeframe): one order for each cancelled or fully
 * refunded one, and the money. A flow's rows are taken from in turn; none
 * goes below 0, and revenue per recipient is counted again.
 */
export function netReport(
  rows: ReportRow[],
  returns: Returns,
  key: 'campaign_message_id' | 'flow_id',
  since: number
): ReportRow[] {
  const off = new Map<string, { orders: number; value: number }>()
  for (const [order, undo] of returns.byOrder) {
    if (Date.parse(order.at) < since) continue
    for (const id of (key === 'flow_id' ? order.flows : order.messages) ?? []) {
      const o = off.get(id) ?? { orders: 0, value: 0 }
      o.orders += undo.whole ? 1 : 0
      o.value += undo.value
      off.set(id, o)
    }
  }
  return rows.map((row) => {
    const o = off.get(row.groupings[key] ?? '')
    if (!o) return row
    const s = { ...row.statistics }
    const take = (name: string, want: number) => {
      if (s[name] === undefined) return 0
      const n = Math.min(s[name], want)
      s[name] -= n
      return n
    }
    o.orders -= take('conversions', o.orders)
    o.value -= take('conversion_value', o.value)
    if (s.revenue_per_recipient !== undefined && s.recipients)
      s.revenue_per_recipient = (s.conversion_value ?? 0) / s.recipients
    return { ...row, statistics: s }
  })
}
