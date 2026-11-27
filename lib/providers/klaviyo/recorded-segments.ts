import type { KlaviyoResponse, KlaviyoTransport } from './client'

/**
 * PICK-101: a made-up Klaviyo account that answers the list-hygiene calls
 * (metrics, segments by name, making a segment, a segment's size) in the
 * shapes revision 2026-10-15 publishes. It remembers what was made, so a
 * test sees a segment made once and then reused. No real account.
 */
export type SegmentFaults = {
  /** The segment is made but its answer is lost (a timeout), once. */
  loseCreate?: boolean
  /** Making a segment is refused (400: Klaviyo did not take the definition). */
  refuseCreate?: boolean
  /** The key cannot write segments (403). */
  noWriteScope?: boolean
  /** One request to this path prefix answers 503, once. */
  outage?: string
  /** Metrics the account does not have (by name). */
  without?: readonly string[]
  /** Extra metrics: [id, name, integration]. */
  extra?: readonly (readonly [string, string, string])[]
  /** A metrics page holds a record that cannot be read (the read is incomplete). */
  brokenMetric?: boolean
  /** These paths ("GET /api/metrics", "GET /api/segments") are refused (400). */
  refuse?: readonly string[]
  /** The account's id (a reconnect may be another account). */
  accountId?: string
}

export type FakeSegmentAccount = {
  segments: Map<
    string,
    {
      name: string
      definition: unknown
      created: string
      profileCount: number | null
    }
  >
  /** Every request, as "METHOD /path". */
  calls: string[]
  faults: SegmentFaults
  transport: KlaviyoTransport
}

const json = (status: number, body?: unknown): KlaviyoResponse => ({
  status,
  headers: { 'content-type': 'application/vnd.api+json' },
  body: body === undefined ? '' : JSON.stringify(body)
})
const refused = (status: number, code = 'invalid') =>
  json(status, { errors: [{ status, code, title: 'Refused.' }] })

const metricList = [
  ['MetRecv', 'Received Email', 'Klaviyo'],
  ['MetOpen', 'Opened Email', 'Klaviyo'],
  ['MetClick', 'Clicked Email', 'Klaviyo'],
  // Klaviyo's onsite tracking reports through its API integration.
  ['MetSite', 'Active on Site', 'API'],
  ['MetOrdApi', 'Placed Order', 'API'],
  ['MetOrd', 'Placed Order', 'Shopify']
] as const

/** Paths the transport knows; anything else is for another fake. */
export const segmentPaths = (path: string) =>
  path === '/api/metrics' ||
  path === '/api/accounts' ||
  /^\/api\/segments(\/[A-Za-z0-9_-]+)?\/?$/.test(path)

export function fakeSegmentAccount(
  options: { faults?: SegmentFaults; now?: () => Date; size?: number } = {}
): FakeSegmentAccount {
  const now = options.now ?? (() => new Date())
  let n = 0
  const once = new Set<string>()
  const firstTime = (key: string) => !once.has(key) && !!once.add(key)
  const account: Omit<FakeSegmentAccount, 'transport'> = {
    segments: new Map(),
    calls: [],
    faults: { ...options.faults }
  }
  const transport: KlaviyoTransport = async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    account.calls.push(`${request.method} ${path}`)
    const { outage } = account.faults
    if (outage && path.startsWith(outage) && firstTime(`outage ${outage}`))
      return refused(503, 'unavailable')
    if (account.faults.refuse?.includes(`${request.method} ${path}`))
      return refused(400)
    if (path === '/api/accounts' && request.method === 'GET')
      return json(200, {
        data: [
          {
            type: 'account',
            id: account.faults.accountId ?? 'AcctCedar',
            attributes: { timezone: 'US/Pacific' }
          }
        ]
      })
    if (path === '/api/metrics' && request.method === 'GET')
      return json(200, {
        data: [
          ...[...metricList, ...(account.faults.extra ?? [])]
            .filter(([, name]) => !account.faults.without?.includes(name))
            .map(([id, name, integration]) => ({
              type: 'metric',
              id,
              attributes: { name, integration: { name: integration } }
            })),
          ...(account.faults.brokenMetric ? [{ type: 'metric' }] : [])
        ],
        links: { next: null }
      })
    if (path === '/api/segments' && request.method === 'GET') {
      const filter = url.searchParams.get('filter') ?? ''
      const m = /^equals\(name,"([^"]*)"\)$/.exec(filter)
      if (!m) return refused(400)
      return json(200, {
        data: [...account.segments]
          .filter(([, s]) => s.name === m[1])
          .map(([id, s]) => ({
            type: 'segment',
            id,
            attributes: { name: s.name, created: s.created }
          })),
        links: { next: null }
      })
    }
    if (path === '/api/segments' && request.method === 'POST') {
      if (account.faults.noWriteScope) return refused(403, 'permission_denied')
      if (account.faults.refuseCreate) return refused(400)
      const body = JSON.parse(request.body ?? '{}')
      const a = body?.data?.attributes
      if (
        body?.data?.type !== 'segment' ||
        typeof a?.name !== 'string' ||
        !Array.isArray(a?.definition?.condition_groups) ||
        a.definition.condition_groups.length < 1
      )
        return refused(400)
      const id = `SegHyg${String(++n).padStart(3, '0')}`
      account.segments.set(id, {
        name: a.name,
        definition: a.definition,
        created: now().toISOString(),
        profileCount: options.size ?? null
      })
      if (account.faults.loseCreate && firstTime('lose create'))
        throw new Error('timeout')
      return json(201, {
        data: { type: 'segment', id, attributes: { name: a.name } }
      })
    }
    const one = /^\/api\/segments\/([A-Za-z0-9_-]+)\/?$/.exec(path)
    if (one && request.method === 'GET') {
      const s = account.segments.get(one[1]!)
      if (!s) return refused(404, 'not_found')
      return json(200, {
        data: {
          type: 'segment',
          id: one[1],
          attributes: {
            name: s.name,
            definition: s.definition,
            profile_count: s.profileCount
          }
        }
      })
    }
    return refused(404, 'not_found')
  }
  // `faults` is the same object, so a test may change it between calls.
  return Object.assign(account, { transport })
}
