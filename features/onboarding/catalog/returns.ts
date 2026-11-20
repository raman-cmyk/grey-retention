import type { PagedRead, StoreEvent } from '@/lib/providers/klaviyo/catalog'
import { moneyOf, orderLines } from './clean'

/**
 * Cancelled and refunded orders (ONB-ORD), matched to the Placed Order
 * events read by the order's id: an integration's `OrderId` when it sends
 * one, else Klaviyo's `$event_id` (Shopify's order id, on its Placed,
 * Cancelled and Refunded Order events). A cancel, or a refund of the whole
 * order, takes the order out: its units, its count and its value. A partial
 * refund takes out only its value, and the units of the lines it lists. A
 * cancel or refund of an order that was not read (placed before the
 * window) changes nothing.
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

/**
 * How much of the correction was read: `whole`, `partial` (a read cut
 * short, a record skipped, or a cancel or refund left unmatched while the
 * orders were not all read) or `unread` (Klaviyo refused, or no time).
 * It never makes the catalog or the history itself incomplete.
 */
export type ReturnsState = 'whole' | 'partial' | 'unread'

const idOf = (value: unknown) => {
  const raw =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''
  return raw.length >= 1 && raw.length <= 120 ? raw : null
}

/** The order an event is of: its `OrderId` when it has one, else `$event_id`. */
export const orderId = (props: Record<string, unknown>) =>
  idOf(props.OrderId) ?? (props.OrderId == null ? idOf(props.$event_id) : null)

/** An amount of money, whatever its sign (a refund may send -25 or "-25.00"). */
const amountOf = (value: unknown) =>
  moneyOf(typeof value === 'number' ? Math.abs(value) : value)

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
  for (const order of orders) {
    const id = orderId(order.props)
    if (id && !byId.has(id)) byId.set(id, order)
  }
  let unmatched = 0
  const group = (events: StoreEvent[]) => {
    const by = new Map<StoreEvent, StoreEvent[]>()
    for (const e of events) {
      const order = byId.get(orderId(e.props) ?? '')
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
    value: amountOf(order.props.$value) ?? 0,
    units: unitsOf(order)
  })
  for (const order of cancelled.keys()) byOrder.set(order, whole(order))
  for (const [order, events] of refunded) {
    if (byOrder.has(order)) continue
    const total = amountOf(order.props.$value)
    const own = unitsOf(order)
    const units = new Map<string, number>()
    let value = 0
    let full = false
    for (const e of events) {
      const said = amountOf(e.props.$value)
      // A refund of nothing takes nothing off.
      if (said === 0) continue
      // Its own lines, unless it only repeats the whole order's.
      const lines = orderLines(e.props).filter((l) => own.has(l.id))
      const listed = lines.length > 0 && !same(unitsOf(e), own)
      // A refund that does not say how much nor which lines is of the
      // whole order (Shopify sends only full refunds).
      if (said === null && !listed) full = true
      if (listed)
        for (const l of lines)
          units.set(
            l.id,
            Math.min(own.get(l.id)!, (units.get(l.id) ?? 0) + l.quantity)
          )
      // Without an amount, the value of its lines' own prices (or none).
      value +=
        said ?? lines.reduce((sum, l) => sum + (l.price ?? 0) * l.quantity, 0)
    }
    if (full || (total !== null && total > 0 && value >= total - 0.005))
      byOrder.set(order, whole(order))
    else if (value > 0 || units.size > 0)
      byOrder.set(order, {
        whole: false,
        // An order without a value never counted any: nothing comes off.
        value: total === null ? 0 : value,
        units
      })
  }
  return {
    byOrder,
    cancelled: cancelled.size,
    refunded: [...byOrder.keys()].filter((o) => !cancelled.has(o)).length,
    unmatched
  }
}

/**
 * The state of the cancels and refunds read (`parts`: one per metric the
 * store has); `allOrders` says every order of the window was read, so a
 * cancel or refund left unmatched is of an order placed before it.
 */
export function returnsState(
  parts: PagedRead<StoreEvent>[],
  returns: Returns,
  allOrders: boolean
): ReturnsState {
  const read = parts.filter((p) => p.complete || p.records.length)
  if (parts.length && !read.length) return 'unread'
  return read.length === parts.length &&
    parts.every((p) => p.complete && p.skipped === 0) &&
    (allOrders || returns.unmatched === 0)
    ? 'whole'
    : 'partial'
}
