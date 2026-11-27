/**
 * PICK-101 (list hygiene): the one segment the app ever makes in a
 * store's Klaviyo, built here from typed inputs only (no caller passes
 * Klaviyo JSON), and the fence the client checks every segment write
 * against (`isHygieneSegmentCreate`). Pure: no network, no server-only.
 *
 * White label: the name never says the product's name. It is unique per
 * rule and per the metrics it reads: "List hygiene · 180 days · v1 · 3fa9c2d1".
 */

/** The metrics the segment reads, by their id in this account. */
export type HygieneSegmentMetrics = {
  receivedEmail: string
  clickedEmail: string
  openedEmail: string
  /** Every Active on Site metric the account has (any integration). */
  activeOnSite: readonly string[]
  /** Every Placed Order metric the account has (any integration). */
  placedOrders: readonly string[]
}

/** Everything the segment is built from. */
export type HygieneSegmentSpec = {
  version: number
  days: number
  recentOrderDays: number
  minEmails: number
  /**
   * Leave Apple Mail privacy opens out of the open count. Off until the
   * property is proven on a live account (`privacyOpenFilterProven`).
   */
  privacyFilter: boolean
  metrics: HygieneSegmentMetrics
}

/**
 * The Opened Email property Klaviyo sets on Apple privacy (machine) opens.
 * Not documented in revision 2026-10-15's segments API: unproven.
 */
export const privacyOpenProperty = 'Apple Privacy Open'

const kid = /^[A-Za-z0-9_-]{1,64}$/

/** FNV-1a, 32 bits, as 8 hex characters (stable, not a secret). */
function fnv(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * The builder's own version: a change to how definitions are built makes
 * new segments (it is in the fingerprint, so in the name).
 */
export const definitionVersion = 2

/** A short fingerprint of everything the definition is built from. */
export function hygieneFingerprint(spec: HygieneSegmentSpec) {
  const m = spec.metrics
  return fnv(
    JSON.stringify([
      definitionVersion,
      spec.version,
      spec.days,
      spec.recentOrderDays,
      spec.minEmails,
      spec.privacyFilter,
      m.receivedEmail,
      m.clickedEmail,
      m.openedEmail,
      [...m.activeOnSite].sort(),
      [...m.placedOrders].sort()
    ])
  )
}

/** The segment's name in Klaviyo (no product name). */
export const hygieneSegmentName = (spec: HygieneSegmentSpec) =>
  `List hygiene · ${spec.days} days · v${spec.version} · ${hygieneFingerprint(spec)}`

/** Only names the app makes (the client checks it too). */
export const hygieneSegmentNamePattern =
  /^List hygiene · \d{2,3} days · v\d{1,2} · [a-f0-9]{8}$/

const count = (
  metricId: string,
  operator: 'equals' | 'greater-than-or-equal',
  value: number,
  timeframe: { operator: 'in-the-last' | 'before'; quantity: number },
  metricFilters: unknown[] | null = null
) => ({
  type: 'profile-metric',
  metric_id: metricId,
  measurement: 'count',
  measurement_filter: { type: 'numeric', operator, value },
  timeframe_filter: {
    type: 'date',
    operator: timeframe.operator,
    quantity: timeframe.quantity,
    unit: 'day'
  },
  metric_filters: metricFilters
})

const privacyFilterValue = [
  {
    property: privacyOpenProperty,
    filter: { type: 'boolean', operator: 'equals', value: false }
  }
]

/**
 * The people the rule leaves out as unengaged (every group must hold).
 * Null when an input is not a Klaviyo id or the account has no order
 * metric (a keep-signal GROS cannot see never widens the segment).
 */
export function hygieneSegmentDefinition(spec: HygieneSegmentSpec) {
  const m = spec.metrics
  const ids = [
    m.receivedEmail,
    m.clickedEmail,
    m.openedEmail,
    ...m.activeOnSite,
    ...m.placedOrders
  ]
  if (!ids.every((id) => kid.test(id)) || m.placedOrders.length === 0)
    return null
  const last = { operator: 'in-the-last' as const, quantity: spec.days }
  const group = (condition: Record<string, unknown>) => ({
    conditions: [condition]
  })
  return {
    condition_groups: [
      // On the list before the window: not too new to judge.
      group(
        count(m.receivedEmail, 'greater-than-or-equal', 1, {
          operator: 'before',
          quantity: spec.days
        })
      ),
      // Enough emails (campaigns and flows) inside the window to judge.
      group(
        count(m.receivedEmail, 'greater-than-or-equal', spec.minEmails, last)
      ),
      group(count(m.clickedEmail, 'equals', 0, last)),
      group(
        count(
          m.openedEmail,
          'equals',
          0,
          last,
          spec.privacyFilter ? privacyFilterValue : null
        )
      ),
      ...[...m.activeOnSite]
        .sort()
        .map((id) => group(count(id, 'equals', 0, last))),
      ...[...m.placedOrders].sort().map((id) =>
        group(
          count(id, 'equals', 0, {
            operator: 'in-the-last',
            quantity: spec.recentOrderDays
          })
        )
      )
    ]
  }
}

// --- The fence ------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const exactKeys = (o: Obj, keys: string[]) =>
  Object.keys(o).length === keys.length &&
  keys.every((k) => Object.hasOwn(o, k))
const int = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** One condition as `hygieneSegmentDefinition` writes them, nothing else. */
function conditionOk(c: unknown) {
  if (!isObj(c)) return false
  if (
    !exactKeys(c, [
      'type',
      'metric_id',
      'measurement',
      'measurement_filter',
      'timeframe_filter',
      'metric_filters'
    ])
  )
    return false
  if (c.type !== 'profile-metric' || c.measurement !== 'count') return false
  if (typeof c.metric_id !== 'string' || !kid.test(c.metric_id)) return false
  const f = c.measurement_filter
  if (!isObj(f) || !exactKeys(f, ['type', 'operator', 'value'])) return false
  if (f.type !== 'numeric') return false
  if (!(
    (f.operator === 'equals' && f.value === 0) ||
    (f.operator === 'greater-than-or-equal' && int(f.value, 1, 100))
  ))
    return false
  const t = c.timeframe_filter
  if (!isObj(t) || !exactKeys(t, ['type', 'operator', 'quantity', 'unit']))
    return false
  if (
    t.type !== 'date' ||
    t.unit !== 'day' ||
    !['in-the-last', 'before'].includes(String(t.operator)) ||
    !int(t.quantity, 30, 730)
  )
    return false
  return (
    c.metric_filters === null ||
    JSON.stringify(c.metric_filters) === JSON.stringify(privacyFilterValue)
  )
}

type Condition = {
  metric_id: string
  measurement_filter: { operator: string; value: number }
  timeframe_filter: { operator: string; quantity: number }
  metric_filters: unknown
}

/**
 * A definition shaped exactly as the app builds it, in its order: Received
 * Email at least once before the window and at least N times inside it
 * (one metric, one window), Clicked Email 0 and Opened Email 0 inside the
 * window, any Active on Site groups at 0 inside the window, then at least
 * one Placed Order group at 0 over at least 180 days and never shorter than
 * the window. Every metric but Received Email is used once. Nothing else.
 */
export function hygieneDefinitionOk(definition: unknown) {
  if (!isObj(definition) || !exactKeys(definition, ['condition_groups']))
    return false
  const groups = definition.condition_groups
  if (
    !Array.isArray(groups) ||
    groups.length < 5 ||
    groups.length > 24 ||
    !groups.every(
      (g) =>
        isObj(g) &&
        exactKeys(g, ['conditions']) &&
        Array.isArray(g.conditions) &&
        g.conditions.length === 1 &&
        conditionOk(g.conditions[0])
    )
  )
    return false
  const c = groups.map((g) => (g as { conditions: Condition[] }).conditions[0]!)
  const [before, received, clicked, opened, ...tail] = c as [
    Condition,
    Condition,
    Condition,
    Condition,
    ...Condition[]
  ]
  const days = received.timeframe_filter.quantity
  const zero = (x: Condition, quantity: number) =>
    x.measurement_filter.operator === 'equals' &&
    x.timeframe_filter.operator === 'in-the-last' &&
    x.timeframe_filter.quantity === quantity
  if (
    before.metric_id !== received.metric_id ||
    before.measurement_filter.operator !== 'greater-than-or-equal' ||
    before.measurement_filter.value !== 1 ||
    before.timeframe_filter.operator !== 'before' ||
    before.timeframe_filter.quantity !== days ||
    before.metric_filters !== null ||
    received.measurement_filter.operator !== 'greater-than-or-equal' ||
    received.timeframe_filter.operator !== 'in-the-last' ||
    received.metric_filters !== null ||
    !zero(clicked, days) ||
    clicked.metric_filters !== null ||
    !zero(opened, days)
  )
    return false
  // The orders' window: the last group's, at least 180 days and the window.
  const orderDays = tail.at(-1)!.timeframe_filter.quantity
  if (orderDays < Math.max(days, 180)) return false
  // Site groups (the window) first, then one or more order groups.
  let i = 0
  if (orderDays !== days)
    while (i < tail.length && tail[i]!.timeframe_filter.quantity === days) i++
  const sites = tail.slice(0, i)
  const orders = tail.slice(i)
  if (
    orders.length < 1 ||
    !sites.every((x) => zero(x, days) && x.metric_filters === null) ||
    !orders.every((x) => zero(x, orderDays) && x.metric_filters === null)
  )
    return false
  const ids = [clicked, opened, ...tail].map((x) => x.metric_id)
  return new Set([...ids, received.metric_id]).size === ids.length + 1
}

/**
 * The only segment write the client lets through: `{ data: { type:
 * 'segment', attributes: { name, definition, is_starred: false } } }` with
 * a list-hygiene name and a definition shaped as the app builds them.
 */
export function isHygieneSegmentCreate(body: unknown) {
  if (!isObj(body) || !exactKeys(body, ['data'])) return false
  const data = body.data
  if (!isObj(data) || !exactKeys(data, ['type', 'attributes'])) return false
  if (data.type !== 'segment' || !isObj(data.attributes)) return false
  const a = data.attributes
  return (
    exactKeys(a, ['name', 'definition', 'is_starred']) &&
    typeof a.name === 'string' &&
    hygieneSegmentNamePattern.test(a.name) &&
    a.is_starred === false &&
    hygieneDefinitionOk(a.definition)
  )
}

/** Sorted keys, all the way down: two definitions compare as text. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (isObj(v))
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])])
    )
  return v
}

/**
 * Whether a definition Klaviyo shows is the one the app would build (a
 * missing `metric_filters` reads as none). Anything else is not ours.
 */
export function sameDefinition(shown: unknown, built: unknown) {
  const fill = (d: unknown) =>
    isObj(d) && Array.isArray(d.condition_groups)
      ? {
          condition_groups: d.condition_groups.map((g) =>
            isObj(g) && Array.isArray(g.conditions)
              ? {
                  conditions: g.conditions.map((c) =>
                    isObj(c) ? { metric_filters: null, ...c } : c
                  )
                }
              : g
          )
        }
      : d
  return (
    JSON.stringify(canonical(fill(shown))) ===
    JSON.stringify(canonical(fill(built)))
  )
}
